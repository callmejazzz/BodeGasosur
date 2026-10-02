import type { Prisma } from "@prisma/client";
import type { UsuarioSesion } from "@/lib/db";
import { aFechaDeBase, hoyEnMexico } from "@/lib/fechas";
import {
  asegurarYBloquearExistenciasDe,
  bloquearArticulos,
  bloquearCapasVivas,
  consumirCapasPEPS,
  descontarExistencias,
  excesoDeCapacidad,
  existenciasParaEgreso,
  incrementarExistencias,
  tomarFolio,
} from "@/lib/movimientos/primitivas";
import {
  bloquearMovimiento,
  crearConLlave,
  descartarBorrador,
  exigirBorrador,
  firma,
  normalizarPartidas,
  partidasParaCrear,
  resolverLlave,
  revalidarPartidas,
  transicionar,
  type PartidaCapturada,
  type ResultadoAlta,
  type ResultadoConfirmacion,
  type ResultadoDescarte,
} from "./captura";
import { ErrorDeDominio, traducirErrorDeBase } from "./errores";
import { crearCapasDeTraspaso } from "./primitivas";

/*
  Traspaso entre bodegas (contrato de la fase 7, §2.1). El borrador no tiene
  folio ni efecto; confirmar consume PEPS en origen y crea en destino una capa
  por fragmento consumido con su fecha original y su par de costos, así la
  valuación total no cambia. Cada función recibe `tx` y `usuario` de
  accionProtegida(): el actor sale de la sesión, nunca de los datos.
*/

type Tx = Prisma.TransactionClient;

export type DatosTraspaso = {
  encabezado: { bodegaOrigenId: string; bodegaDestinoId: string; observaciones?: string | null };
  partidas: PartidaCapturada[];
};

const NO_EXISTE = "El traspaso no existe.";

/** FOR SHARE de las dos bodegas, en orden de id, y ambas activas y distintas. */
async function validarBodegas(tx: Tx, origenId: string, destinoId: string): Promise<void> {
  if (origenId === destinoId) throw new ErrorDeDominio("datos", "La bodega de origen y la de destino tienen que ser distintas.");
  const ids = [origenId, destinoId].sort();
  const filas = await tx.$queryRaw<{ id: string; activa: boolean }[]>`
    SELECT id, activa FROM "Bodega" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR SHARE`;
  const activa = (id: string) => filas.find((b) => b.id === id)?.activa === true;
  if (!activa(origenId)) throw new ErrorDeDominio("catalogo", "La bodega de origen no existe o está dada de baja.");
  if (!activa(destinoId)) throw new ErrorDeDominio("catalogo", "La bodega de destino no existe o está dada de baja.");
}

const firmaDeCaptura = (d: DatosTraspaso) => firma({ bodegaOrigenId: d.encabezado.bodegaOrigenId, bodegaDestinoId: d.encabezado.bodegaDestinoId, observaciones: d.encabezado.observaciones }, d.partidas);
const firmaDeGuardado = (m: { bodegaOrigenId: string | null; bodegaDestinoId: string | null; observaciones: string | null; partidas: Parameters<typeof firma>[1] }) =>
  firma({ bodegaOrigenId: m.bodegaOrigenId, bodegaDestinoId: m.bodegaDestinoId, observaciones: m.observaciones }, m.partidas);

/** El borrador, con su llave: repetirla con la misma captura devuelve el mismo traspaso. */
export async function crearTraspaso(tx: Tx, usuario: UsuarioSesion, llaveIdempotencia: string, datos: DatosTraspaso): Promise<ResultadoAlta> {
  try {
    const resolver = () => resolverLlave(tx, usuario, llaveIdempotencia, "TRASPASO", firmaDeCaptura(datos), firmaDeGuardado, "traspaso");
    const previo = await resolver();
    if (previo) return { id: previo, repetido: true };

    const { bodegaOrigenId, bodegaDestinoId } = datos.encabezado;
    await validarBodegas(tx, bodegaOrigenId, bodegaDestinoId);
    const partidas = await normalizarPartidas(tx, datos.partidas, "traspaso");

    return await crearConLlave(
      tx,
      () =>
        tx.movimiento.create({
          data: {
            tipo: "TRASPASO",
            estatus: "BORRADOR",
            llaveIdempotencia,
            // Provisional: al confirmar se fija el día en que se movió el material.
            fecha: aFechaDeBase(hoyEnMexico()),
            bodegaOrigenId,
            bodegaDestinoId,
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

/** Reemplaza encabezado y partidas de un borrador, con su candado. */
export async function guardarTraspaso(tx: Tx, usuario: UsuarioSesion, id: string, datos: DatosTraspaso): Promise<{ id: string }> {
  try {
    const m = await bloquearMovimiento(tx, id, "TRASPASO", NO_EXISTE);
    exigirBorrador(m, "traspaso");
    const { bodegaOrigenId, bodegaDestinoId } = datos.encabezado;
    await validarBodegas(tx, bodegaOrigenId, bodegaDestinoId);
    const partidas = await normalizarPartidas(tx, datos.partidas, "traspaso");
    await tx.movimientoPartida.deleteMany({ where: { movimientoId: id } });
    await tx.movimiento.update({
      where: { id },
      data: {
        bodegaOrigenId,
        bodegaDestinoId,
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

export async function descartarTraspaso(tx: Tx, usuario: UsuarioSesion, id: string, motivo: string): Promise<ResultadoDescarte> {
  try {
    return await descartarBorrador(tx, usuario, await bloquearMovimiento(tx, id, "TRASPASO", NO_EXISTE), motivo, "traspaso");
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

/**
 * BORRADOR → CONFIRMADO en una transacción. Orden de candados: encabezado →
 * bodegas (por id) → artículos → existencias de ambas bodegas por (bodegaId,
 * articuloId) → capas de origen por (fechaOriginal, id) → folio. Un reintento
 * sobre el confirmado devuelve el mismo folio sin escribir.
 */
export async function confirmarTraspaso(tx: Tx, usuario: UsuarioSesion, id: string): Promise<ResultadoConfirmacion> {
  try {
    const m = await bloquearMovimiento(tx, id, "TRASPASO", NO_EXISTE);
    if (m.estatus === "CONFIRMADO") return { id, folio: m.folio!, repetido: true };
    exigirBorrador(m, "traspaso");
    const origen = m.bodegaOrigenId!;
    const destino = m.bodegaDestinoId!;

    await validarBodegas(tx, origen, destino);
    const articuloIds = (await tx.movimientoPartida.findMany({ where: { movimientoId: id }, select: { articuloId: true } })).map((p) => p.articuloId);
    await bloquearArticulos(tx, articuloIds);
    const partidas = await revalidarPartidas(tx, id);

    await asegurarYBloquearExistenciasDe(tx, [origen, destino].flatMap((bodegaId) => articuloIds.map((articuloId) => ({ bodegaId, articuloId }))));
    await bloquearCapasVivas(tx, origen, articuloIds);

    const filas = await existenciasParaEgreso(tx, id, origen);
    const descuadre = filas.find((f) => !f.cuadra);
    if (descuadre) throw new ErrorDeDominio("invariante", `${descuadre.clave}: la existencia no coincide con sus capas de costo. Avisa al administrador antes de traspasar.`);
    const falta = filas.find((f) => f.existencia < f.pedida);
    if (falta) throw new ErrorDeDominio("existencia", `${falta.clave}: hay ${falta.existencia} en la bodega de origen y el traspaso pide ${falta.pedida}.`);
    const exceso = await excesoDeCapacidad(tx, id, destino);
    if (exceso) throw new ErrorDeDominio("partidas", `${exceso.clave}: la existencia en destino más el traspaso rebasa lo que el sistema puede registrar.`);

    const hoy = aFechaDeBase(hoyEnMexico());
    const pedidas = partidas.reduce((n, p) => n + p.cantidad, 0);
    const consumo = await consumirCapasPEPS(tx, id, origen);
    const hijas = await crearCapasDeTraspaso(tx, id, destino, hoy);
    const descontadas = await descontarExistencias(tx, id, origen);
    const sumadas = await incrementarExistencias(tx, id, destino);
    if (consumo.piezas !== pedidas || consumo.capas !== consumo.consumos || hijas !== consumo.consumos || descontadas !== partidas.length || sumadas !== partidas.length) {
      throw new ErrorDeDominio("invariante", "El traspaso no cuadró entre origen y destino; no se movió nada.");
    }

    const folio = await tomarFolio(tx, "TRASPASO");
    await transicionar(tx, id, "BORRADOR", { estatus: "CONFIRMADO", folio, fecha: hoy, confirmadoPorId: usuario.id, confirmadoEn: new Date() });
    return { id, folio, repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}
