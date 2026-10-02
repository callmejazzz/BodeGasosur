import type { Prisma } from "@prisma/client";
import type { UsuarioSesion } from "@/lib/db";
import { aFechaDeBase, hoyEnMexico } from "@/lib/fechas";
import { asegurarYBloquearExistencias, bloquearArticulos, excesoDeCapacidad, incrementarExistencias, tomarFolio } from "@/lib/movimientos/primitivas";
import {
  crearConLlave,
  descartarBorrador,
  exigirBorrador,
  firma,
  normalizarPartidas,
  partidasParaCrear,
  resolverLlave,
  revalidarPartidas,
  transicionar,
  type Encabezado,
  type PartidaCapturada,
  type PartidaNormalizada,
  type ResultadoAlta,
  type ResultadoConfirmacion,
  type ResultadoDescarte,
} from "./captura";
import { ErrorDeDominio, traducirErrorDeBase } from "./errores";
import { crearCapasDeDevolucion, crearCapasSinCosto, saldoDeSalida } from "./primitivas";

/*
  Devolución desde una estación (contrato de la fase 7, §2.2 y §2.3). Vinculada
  a una salida retirada o recibida de la misma estación, regresa a la bodega
  de la que salió, cada artículo se limita a lo que todavía no vuelve y las
  capas nuevas heredan costo y fecha original de los consumos de esa salida.
  Sin salida, entra sin costo a cualquier bodega, con la fecha de la
  devolución, y no cierra préstamo alguno.
*/

type Tx = Prisma.TransactionClient;

export type DatosDevolucion = {
  encabezado: { estacionId: string; bodegaDestinoId: string; salidaId?: string | null; observaciones?: string | null };
  partidas: PartidaCapturada[];
};

const NO_EXISTE = "La devolución no existe.";

type Salida = {
  id: string;
  tipo: string;
  estatus: string;
  folio: string | null;
  estacionId: string | null;
  bodegaOrigenId: string | null;
  bodega: string | null;
  revertida: boolean;
};

async function leerSalida(tx: Tx, id: string): Promise<Salida | null> {
  const [s] = await tx.$queryRaw<Salida[]>`
    SELECT m.id, m.tipo::text, m.estatus::text, m.folio, m."estacionId", m."bodegaOrigenId",
           b.clave || ' · ' || b.nombre AS bodega,
           EXISTS (SELECT 1 FROM "Movimiento" r WHERE r."cancelaAId" = m.id) AS revertida
    FROM "Movimiento" m LEFT JOIN "Bodega" b ON b.id = m."bodegaOrigenId"
    WHERE m.id = ${id}::uuid`;
  return s ?? null;
}

/** La salida vinculada tiene que haber entregado material a esa estación, seguir vigente y haber salido de esa bodega. */
function exigirSalidaDevolvible(s: Salida | null, estacionId: string, bodegaDestinoId: string): Salida {
  if (!s || s.tipo !== "SALIDA") throw new ErrorDeDominio("datos", "La salida vinculada no existe.");
  if (s.estatus !== "RETIRADA" && s.estatus !== "RECIBIDA") {
    throw new ErrorDeDominio("estado", "Solo se devuelve material de una salida ya retirada o recibida.");
  }
  if (s.estacionId !== estacionId) throw new ErrorDeDominio("datos", `La salida ${s.folio} es de otra estación.`);
  if (s.revertida) throw new ErrorDeDominio("estado", `La salida ${s.folio} fue revertida: ya no admite devoluciones.`);
  if (s.bodegaOrigenId !== bodegaDestinoId) {
    throw new ErrorDeDominio("datos", `La devolución de ${s.folio} regresa a la bodega de la que salió: ${s.bodega}.`);
  }
  return s;
}

/** Cada artículo tiene que estar en la salida y no pasar de lo que falta por volver. */
async function exigirSaldo(tx: Tx, salida: Salida, partidas: readonly { articuloId: string; cantidad: number }[]): Promise<void> {
  const saldo = new Map((await saldoDeSalida(tx, salida.id)).map((s) => [s.articuloId, s]));
  for (const p of partidas) {
    const s = saldo.get(p.articuloId);
    if (!s) throw new ErrorDeDominio("saldo", `Un artículo de la devolución no salió en ${salida.folio}.`);
    if (p.cantidad > s.pendiente) {
      throw new ErrorDeDominio("saldo", `${s.clave}: de ${salida.folio} faltan por volver ${s.pendiente} ${s.unidad} y la devolución trae ${p.cantidad}.`);
    }
  }
}

/** FOR SHARE de bodega y estación, activas; la salida vinculada se valida sin candado solo al capturar. */
async function validarCaptura(tx: Tx, d: DatosDevolucion): Promise<{ partidas: PartidaNormalizada[]; salidaId: string | null }> {
  const { estacionId, bodegaDestinoId } = d.encabezado;
  const [bodega] = await tx.$queryRaw<{ activa: boolean }[]>`SELECT activa FROM "Bodega" WHERE id = ${bodegaDestinoId}::uuid FOR SHARE`;
  const [estacion] = await tx.$queryRaw<{ activa: boolean }[]>`SELECT activa FROM catalogo_gasosur."Estacion" WHERE id = ${estacionId}::uuid FOR SHARE`;
  if (!bodega?.activa) throw new ErrorDeDominio("catalogo", "La bodega que recibe no existe o está dada de baja.");
  if (!estacion?.activa) throw new ErrorDeDominio("catalogo", "La estación no existe o está dada de baja.");
  const partidas = await normalizarPartidas(tx, d.partidas, "devolución");
  const salidaId = d.encabezado.salidaId || null;
  if (salidaId) await exigirSaldo(tx, exigirSalidaDevolvible(await leerSalida(tx, salidaId), estacionId, bodegaDestinoId), partidas);
  return { partidas, salidaId };
}

const firmaDeCaptura = (d: DatosDevolucion) =>
  firma({ estacionId: d.encabezado.estacionId, bodegaDestinoId: d.encabezado.bodegaDestinoId, salidaId: d.encabezado.salidaId, observaciones: d.encabezado.observaciones }, d.partidas);
const firmaDeGuardado = (m: { estacionId: string | null; bodegaDestinoId: string | null; devuelveAId: string | null; observaciones: string | null; partidas: Parameters<typeof firma>[1] }) =>
  firma({ estacionId: m.estacionId, bodegaDestinoId: m.bodegaDestinoId, salidaId: m.devuelveAId, observaciones: m.observaciones }, m.partidas);

export async function crearDevolucion(tx: Tx, usuario: UsuarioSesion, llaveIdempotencia: string, datos: DatosDevolucion): Promise<ResultadoAlta> {
  try {
    const resolver = () => resolverLlave(tx, usuario, llaveIdempotencia, "DEVOLUCION", firmaDeCaptura(datos), firmaDeGuardado, "devolución");
    const previo = await resolver();
    if (previo) return { id: previo, repetido: true };
    const { partidas, salidaId } = await validarCaptura(tx, datos);
    return await crearConLlave(
      tx,
      () =>
        tx.movimiento.create({
          data: {
            tipo: "DEVOLUCION",
            estatus: "BORRADOR",
            llaveIdempotencia,
            fecha: aFechaDeBase(hoyEnMexico()),
            estacionId: datos.encabezado.estacionId,
            bodegaDestinoId: datos.encabezado.bodegaDestinoId,
            devuelveAId: salidaId,
            observaciones: datos.encabezado.observaciones?.trim() || null,
            creadoPorId: usuario.id,
            partidas: { create: partidasParaCrear(partidas) },
          },
          select: { id: true },
        }),
      resolver,
    );
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

/**
 * El candado de la devolución y el de su salida, en orden de id; bajo ellos
 * se vuelve a leer la devolución, porque un borrador pudo cambiar de salida
 * mientras se esperaba.
 */
async function bloquearDevolucion(tx: Tx, id: string): Promise<Encabezado> {
  const [previo] = await tx.$queryRaw<{ devuelveAId: string | null }[]>`SELECT "devuelveAId" FROM "Movimiento" WHERE id = ${id}::uuid`;
  const ids = [id, previo?.devuelveAId].filter((x): x is string => !!x).sort();
  await tx.$queryRaw`SELECT id FROM "Movimiento" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  const [m] = await tx.$queryRaw<Encabezado[]>`
    SELECT id, tipo, estatus, folio, fecha, "bodegaOrigenId", "bodegaDestinoId", "estacionId",
           "devuelveAId", "cancelaAId", "motivoCancelacion"
    FROM "Movimiento" WHERE id = ${id}::uuid`;
  if (!m || m.tipo !== "DEVOLUCION") throw new ErrorDeDominio("no-encontrado", NO_EXISTE);
  if (m.devuelveAId !== (previo?.devuelveAId ?? null)) {
    throw new ErrorDeDominio("concurrencia", "La devolución cambió mientras se guardaba; vuelve a intentarlo.");
  }
  return m;
}

export async function guardarDevolucion(tx: Tx, usuario: UsuarioSesion, id: string, datos: DatosDevolucion): Promise<{ id: string }> {
  try {
    const m = await bloquearDevolucion(tx, id);
    exigirBorrador(m, "devolución");
    const { partidas, salidaId } = await validarCaptura(tx, datos);
    await tx.movimientoPartida.deleteMany({ where: { movimientoId: id } });
    await tx.movimiento.update({
      where: { id },
      data: {
        estacionId: datos.encabezado.estacionId,
        bodegaDestinoId: datos.encabezado.bodegaDestinoId,
        devuelveAId: salidaId,
        observaciones: datos.encabezado.observaciones?.trim() || null,
        partidas: { create: partidasParaCrear(partidas) },
      },
      select: { id: true },
    });
    return { id };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

export async function descartarDevolucion(tx: Tx, usuario: UsuarioSesion, id: string, motivo: string): Promise<ResultadoDescarte> {
  try {
    return await descartarBorrador(tx, usuario, await bloquearDevolucion(tx, id), motivo, "devolución");
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

/**
 * BORRADOR → CONFIRMADO. Orden de candados: encabezados por id (devolución y
 * salida) → bodega y estación → artículos → existencias → folio. El saldo se
 * calcula con la salida bloqueada: dos devoluciones de la misma salida se
 * esperan y la segunda ve lo que confirmó la primera.
 */
export async function confirmarDevolucion(tx: Tx, usuario: UsuarioSesion, id: string): Promise<ResultadoConfirmacion> {
  try {
    const m = await bloquearDevolucion(tx, id);
    if (m.estatus === "CONFIRMADO") return { id, folio: m.folio!, repetido: true };
    exigirBorrador(m, "devolución");
    const destino = m.bodegaDestinoId!;

    const [bodega] = await tx.$queryRaw<{ activa: boolean }[]>`SELECT activa FROM "Bodega" WHERE id = ${destino}::uuid FOR SHARE`;
    const [estacion] = await tx.$queryRaw<{ activa: boolean }[]>`SELECT activa FROM catalogo_gasosur."Estacion" WHERE id = ${m.estacionId}::uuid FOR SHARE`;
    if (!bodega?.activa) throw new ErrorDeDominio("catalogo", "La bodega que recibe está dada de baja.");
    if (!estacion?.activa) throw new ErrorDeDominio("catalogo", "La estación está dada de baja.");

    const articuloIds = (await tx.movimientoPartida.findMany({ where: { movimientoId: id }, select: { articuloId: true } })).map((p) => p.articuloId);
    await bloquearArticulos(tx, articuloIds);
    const partidas = await revalidarPartidas(tx, id);
    await asegurarYBloquearExistencias(tx, destino, articuloIds);
    const exceso = await excesoDeCapacidad(tx, id, destino);
    if (exceso) throw new ErrorDeDominio("partidas", `${exceso.clave}: la existencia más la devolución rebasa lo que el sistema puede registrar.`);

    const hoy = aFechaDeBase(hoyEnMexico());
    const piezas = partidas.reduce((n, p) => n + p.cantidad, 0);
    if (m.devuelveAId) {
      const salida = exigirSalidaDevolvible(await leerSalida(tx, m.devuelveAId), m.estacionId!, destino);
      await exigirSaldo(tx, salida, partidas);
      const creadas = await crearCapasDeDevolucion(tx, id, salida.id, destino, hoy);
      if (creadas.piezas !== piezas) throw new ErrorDeDominio("invariante", "La devolución no cuadró con los consumos de la salida; no se guardó nada.");
    } else if ((await crearCapasSinCosto(tx, id, destino, hoy)) !== partidas.length) {
      throw new ErrorDeDominio("invariante", "La devolución no cuadró con sus partidas; no se guardó nada.");
    }
    if ((await incrementarExistencias(tx, id, destino)) !== partidas.length) {
      throw new ErrorDeDominio("invariante", "La devolución no cuadró con la existencia; no se guardó nada.");
    }

    const folio = await tomarFolio(tx, "DEVOLUCION");
    await transicionar(tx, id, "BORRADOR", { estatus: "CONFIRMADO", folio, fecha: hoy, confirmadoPorId: usuario.id, confirmadoEn: new Date() });
    return { id, folio, repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}
