import type { EstatusConteo, Prisma } from "@prisma/client";
import type { UsuarioSesion } from "@/lib/db";
import { aFechaDeBase, hoyEnMexico } from "@/lib/fechas";
import { chocaCon } from "@/lib/movimientos/errores";
import {
  asegurarYBloquearExistencias,
  bloquearArticulos,
  bloquearCapasVivas,
  consumirCapasPEPS,
  descontarExistencias,
  excesoDeCapacidad,
  incrementarExistencias,
  tomarFolio,
  TOPE_ENTERO,
} from "@/lib/movimientos/primitivas";
import { textoObligatorio, transicionar } from "./captura";
import { ErrorDeDominio, traducirErrorDeBase } from "./errores";
import { crearCapasSinCosto } from "./primitivas";

/*
  Hoja de conteo físico (contrato de la fase 7, §2.4). Al abrirla el servidor
  lee las existencias de la bodega; mientras está en borrador se captura y
  corrige lo contado. Confirmar compara, bajo candado, que el stock no haya
  cambiado desde que se leyó: si cambió, se rechaza y hay que actualizarla.
  Las diferencias se vuelven hasta dos AJUSTE —positivo con capa sin costo,
  negativo con consumo PEPS—; diferencia cero no crea movimiento. La hoja no
  congela la bodega ni reserva nada.
*/

type Tx = Prisma.TransactionClient;

export type DatosHoja = { bodegaId: string; motivo: string; observaciones?: string | null };
export type RenglonCapturado = { articuloId: string; cantidadContada: number | null; observaciones?: string | null };
export type DatosConteo = { revision: number; renglones: RenglonCapturado[] };
export type ResultadoHoja = { id: string; revision: number; repetido: boolean };
export type ResultadoConfirmacionConteo = { id: string; ajustes: string[]; repetido: boolean };

const NO_EXISTE = "La hoja de conteo no existe.";
export const TOPE_RENGLONES = 2000;

type Hoja = {
  id: string;
  bodegaId: string;
  estatus: EstatusConteo;
  motivo: string;
  revision: number;
  motivoCancelacion: string | null;
};

async function bloquearHoja(tx: Tx, id: string): Promise<Hoja> {
  const [h] = await tx.$queryRaw<Hoja[]>`
    SELECT id, "bodegaId", estatus, motivo, revision, "motivoCancelacion"
    FROM "HojaConteo" WHERE id = ${id}::uuid FOR UPDATE`;
  if (!h) throw new ErrorDeDominio("no-encontrado", NO_EXISTE);
  return h;
}

function exigirBorrador(h: Hoja): void {
  if (h.estatus === "CONFIRMADO") throw new ErrorDeDominio("estado", "La hoja de conteo ya está confirmada y no cambia.");
  if (h.estatus !== "BORRADOR") throw new ErrorDeDominio("estado", "La hoja de conteo fue descartada.");
}

/** Se revisó otra versión de la hoja: nadie confirma ni guarda sobre lo que no vio. */
function exigirRevision(h: Hoja, revision: number): void {
  if (h.revision !== revision) {
    throw new ErrorDeDominio("conflicto", "La hoja cambió desde que la abriste. Recárgala y revisa las diferencias actuales.");
  }
}

async function bodegaActiva(tx: Tx, bodegaId: string): Promise<void> {
  const [b] = await tx.$queryRaw<{ activa: boolean }[]>`SELECT activa FROM "Bodega" WHERE id = ${bodegaId}::uuid FOR SHARE`;
  if (!b?.activa) throw new ErrorDeDominio("catalogo", "La bodega no existe o está dada de baja.");
}

/** Lo que hay hoy de esos artículos en la bodega; lo ausente es cero. Lectura, no reserva. */
async function existenciasDe(tx: Tx, bodegaId: string, articuloIds: readonly string[]): Promise<Map<string, number>> {
  const filas = await tx.existencia.findMany({ where: { bodegaId, articuloId: { in: [...articuloIds] } }, select: { articuloId: true, cantidad: true } });
  return new Map(filas.map((f) => [f.articuloId, f.cantidad]));
}

/** Los artículos con existencia en la bodega que la hoja todavía no tiene, por clave. */
async function faltantesConExistencia(tx: Tx, hojaId: string, bodegaId: string): Promise<{ articuloId: string; cantidad: number }[]> {
  return tx.$queryRaw`
    SELECT e."articuloId", e.cantidad FROM "Existencia" e JOIN "Articulo" a ON a.id = e."articuloId"
    WHERE e."bodegaId" = ${bodegaId}::uuid AND e.cantidad > 0
      AND NOT EXISTS (SELECT 1 FROM "RenglonConteo" r WHERE r."hojaId" = ${hojaId}::uuid AND r."articuloId" = e."articuloId")
    ORDER BY a.clave`;
}

async function agregarRenglones(tx: Tx, hojaId: string, nuevos: readonly { articuloId: string; cantidadEsperada: number; cantidadContada?: number | null; observaciones?: string | null }[]) {
  if (nuevos.length === 0) return;
  const { _max } = await tx.renglonConteo.aggregate({ where: { hojaId }, _max: { orden: true } });
  const base = _max.orden ?? 0;
  await tx.renglonConteo.createMany({
    data: nuevos.map((r, i) => ({
      hojaId,
      articuloId: r.articuloId,
      orden: base + i + 1,
      cantidadEsperada: r.cantidadEsperada,
      cantidadContada: r.cantidadContada ?? null,
      observaciones: r.observaciones?.trim() || null,
    })),
  });
}

// ──────────────────────────────── Abrir ──────────────────────────────────────

const canonica = (d: DatosHoja) => JSON.stringify([d.bodegaId.trim().toLowerCase(), d.motivo.trim(), (d.observaciones ?? "").trim()]);

/**
 * Abre la hoja con un renglón por artículo con existencia en la bodega. La
 * llave hace idempotente la apertura: misma llave y datos, misma hoja.
 */
export async function abrirHoja(tx: Tx, usuario: UsuarioSesion, llaveIdempotencia: string, datos: DatosHoja): Promise<ResultadoHoja> {
  try {
    const resolver = async () => {
      const h = await tx.hojaConteo.findUnique({ where: { llaveIdempotencia } });
      if (!h) return null;
      if (h.creadoPorId !== usuario.id || canonica(h) !== canonica(datos)) {
        throw new ErrorDeDominio("conflicto-idempotencia", "Esta captura ya se envió con otros datos. Abre la hoja guardada.");
      }
      return { id: h.id, revision: h.revision, repetido: true };
    };
    const previo = await resolver();
    if (previo) return previo;

    const motivo = textoObligatorio(datos.motivo, "Di el motivo del conteo.");
    await bodegaActiva(tx, datos.bodegaId);

    await tx.$executeRawUnsafe("SAVEPOINT alta_conteo");
    let id: string;
    try {
      ({ id } = await tx.hojaConteo.create({
        data: {
          bodegaId: datos.bodegaId,
          estatus: "BORRADOR",
          motivo,
          observaciones: datos.observaciones?.trim() || null,
          llaveIdempotencia,
          creadoPorId: usuario.id,
        },
        select: { id: true },
      }));
    } catch (error) {
      if (!chocaCon(error, "llaveIdempotencia")) throw error;
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT alta_conteo");
      const ganador = await resolver();
      if (!ganador) throw new ErrorDeDominio("concurrencia", "La captura se cruzó con otra; inténtalo de nuevo.");
      return ganador;
    }
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT alta_conteo");

    const iniciales = await faltantesConExistencia(tx, id, datos.bodegaId);
    await agregarRenglones(tx, id, iniciales.map((r) => ({ articuloId: r.articuloId, cantidadEsperada: r.cantidad })));
    return { id, revision: 1, repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

// ─────────────────────────────── Capturar ────────────────────────────────────

/**
 * Guarda lo contado sobre la revisión que la persona tenía abierta. Un
 * artículo nuevo entra con la existencia que lee el servidor en ese momento;
 * la esperada de los renglones ya leídos no se mueve: para eso está actualizar.
 */
export async function guardarConteo(tx: Tx, usuario: UsuarioSesion, id: string, datos: DatosConteo): Promise<ResultadoHoja> {
  try {
    const h = await bloquearHoja(tx, id);
    exigirBorrador(h);
    exigirRevision(h, datos.revision);

    const ids = datos.renglones.map((r) => r.articuloId);
    if (new Set(ids).size !== ids.length) throw new ErrorDeDominio("partidas", "Un artículo no puede aparecer dos veces en la hoja.");
    for (const r of datos.renglones) {
      if (r.cantidadContada !== null && (!Number.isInteger(r.cantidadContada) || r.cantidadContada < 0 || r.cantidadContada > TOPE_ENTERO)) {
        throw new ErrorDeDominio("partidas", "Lo contado tiene que ser un entero de cero en adelante.");
      }
    }

    const actuales = new Map((await tx.renglonConteo.findMany({ where: { hojaId: id }, select: { id: true, articuloId: true } })).map((r) => [r.articuloId, r.id]));
    if (actuales.size + ids.filter((a) => !actuales.has(a)).length > TOPE_RENGLONES) {
      throw new ErrorDeDominio("partidas", "Demasiados artículos en una sola hoja.");
    }
    const nuevos = datos.renglones.filter((r) => !actuales.has(r.articuloId));
    if (nuevos.length > 0) {
      await bloquearArticulos(tx, nuevos.map((r) => r.articuloId));
      const activos = new Set((await tx.articulo.findMany({ where: { id: { in: nuevos.map((r) => r.articuloId) }, activo: true }, select: { id: true } })).map((a) => a.id));
      if (nuevos.some((r) => !activos.has(r.articuloId))) throw new ErrorDeDominio("catalogo", "Un artículo agregado no existe o está dado de baja.");
      const hay = await existenciasDe(tx, h.bodegaId, nuevos.map((r) => r.articuloId));
      await agregarRenglones(tx, id, nuevos.map((r) => ({ ...r, cantidadEsperada: hay.get(r.articuloId) ?? 0 })));
    }
    // Secuencial a propósito: dentro de una transacción hay una sola conexión.
    for (const r of datos.renglones) {
      const renglonId = actuales.get(r.articuloId);
      if (renglonId) {
        await tx.renglonConteo.update({ where: { id: renglonId }, data: { cantidadContada: r.cantidadContada, observaciones: r.observaciones?.trim() || null } });
      }
    }
    const { revision } = await tx.hojaConteo.update({ where: { id }, data: { revision: { increment: 1 } }, select: { revision: true } });
    return { id, revision, repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

/**
 * Vuelve a leer la existencia esperada de cada renglón y agrega los artículos
 * que aparecieron con existencia. Lo contado se conserva: la persona revisa
 * las diferencias nuevas antes de confirmar.
 */
export async function actualizarHoja(tx: Tx, usuario: UsuarioSesion, id: string, revision: number): Promise<ResultadoHoja> {
  try {
    const h = await bloquearHoja(tx, id);
    exigirBorrador(h);
    exigirRevision(h, revision);
    await tx.$executeRaw`
      WITH hoy AS (
        SELECT r.id, coalesce(e.cantidad, 0) AS cantidad FROM "RenglonConteo" r
        LEFT JOIN "Existencia" e ON e."bodegaId" = ${h.bodegaId}::uuid AND e."articuloId" = r."articuloId"
        WHERE r."hojaId" = ${id}::uuid
      )
      UPDATE "RenglonConteo" r SET "cantidadEsperada" = hoy.cantidad
      FROM hoy WHERE r.id = hoy.id AND r."cantidadEsperada" <> hoy.cantidad`;
    const nuevos = await faltantesConExistencia(tx, id, h.bodegaId);
    await agregarRenglones(tx, id, nuevos.map((r) => ({ articuloId: r.articuloId, cantidadEsperada: r.cantidad })));
    const { revision: nueva } = await tx.hojaConteo.update({ where: { id }, data: { revision: { increment: 1 } }, select: { revision: true } });
    return { id, revision: nueva, repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

export async function descartarHoja(tx: Tx, usuario: UsuarioSesion, id: string, motivo: string): Promise<{ id: string; repetido: boolean }> {
  try {
    const texto = textoObligatorio(motivo, "Di por qué se descarta la hoja.");
    const h = await bloquearHoja(tx, id);
    if (h.estatus === "CANCELADO") {
      if (h.motivoCancelacion === texto) return { id, repetido: true };
      throw new ErrorDeDominio("conflicto", "La hoja ya se descartó con otro motivo.");
    }
    exigirBorrador(h);
    const { count } = await tx.hojaConteo.updateMany({
      where: { id, estatus: "BORRADOR" },
      data: { estatus: "CANCELADO", motivoCancelacion: texto, canceladoPorId: usuario.id, canceladoEn: new Date() },
    });
    if (count !== 1) throw new ErrorDeDominio("concurrencia", "La hoja cambió mientras se guardaba; vuelve a intentarlo.");
    return { id, repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}

// ─────────────────────────────── Confirmar ───────────────────────────────────

const foliosDeAjustes = async (tx: Tx, hojaId: string) =>
  (await tx.movimiento.findMany({ where: { conteoId: hojaId }, select: { folio: true }, orderBy: { folio: "asc" } })).map((m) => m.folio!);

async function crearAjuste(tx: Tx, usuario: UsuarioSesion, h: Hoja, signo: "+" | "-", partidas: { articuloId: string; cantidad: number }[], fecha: Date): Promise<string> {
  const { id } = await tx.movimiento.create({
    data: {
      tipo: "AJUSTE",
      estatus: "BORRADOR",
      fecha,
      motivo: h.motivo,
      conteoId: h.id,
      ...(signo === "+" ? { bodegaDestinoId: h.bodegaId } : { bodegaOrigenId: h.bodegaId }),
      creadoPorId: usuario.id,
      partidas: {
        create: partidas.map((p, i) => ({
          orden: i + 1,
          articuloId: p.articuloId,
          presentacionCapturada: "UNIDAD" as const,
          cantidadCapturada: p.cantidad,
          factorConversion: 1,
          cantidad: p.cantidad,
        })),
      },
    },
    select: { id: true },
  });
  return id;
}

/**
 * BORRADOR → CONFIRMADO. Orden de candados: hoja → bodega → artículos
 * contados → existencias → capas de los faltantes → folios. Si la existencia
 * de un artículo contado ya no es la esperada, la hoja es obsoleta y no se
 * guarda nada. Un reintento sobre la misma revisión devuelve los mismos folios.
 */
export async function confirmarConteo(tx: Tx, usuario: UsuarioSesion, id: string, revision: number): Promise<ResultadoConfirmacionConteo> {
  try {
    const h = await bloquearHoja(tx, id);
    if (h.estatus === "CONFIRMADO") {
      exigirRevision(h, revision);
      return { id, ajustes: await foliosDeAjustes(tx, id), repetido: true };
    }
    exigirBorrador(h);
    exigirRevision(h, revision);

    const contados = await tx.renglonConteo.findMany({
      where: { hojaId: id, cantidadContada: { not: null } },
      select: { articuloId: true, cantidadEsperada: true, cantidadContada: true, articulo: { select: { clave: true } } },
      orderBy: { orden: "asc" },
    });
    if (contados.length === 0) throw new ErrorDeDominio("partidas", "Captura lo contado de al menos un artículo antes de confirmar.");

    await bodegaActiva(tx, h.bodegaId);
    const articuloIds = contados.map((r) => r.articuloId);
    await bloquearArticulos(tx, articuloIds);
    const hay = new Map((await asegurarYBloquearExistencias(tx, h.bodegaId, articuloIds)).map((e) => [e.articuloId, e.cantidad]));

    const cambiaron = contados.filter((r) => (hay.get(r.articuloId) ?? 0) !== r.cantidadEsperada);
    if (cambiaron.length > 0) {
      const detalle = cambiaron.slice(0, 5).map((r) => `${r.articulo.clave} (se leyó ${r.cantidadEsperada}, hay ${hay.get(r.articuloId) ?? 0})`).join(", ");
      throw new ErrorDeDominio("conteo-obsoleto", `La existencia cambió desde que se leyó la hoja: ${detalle}. Actualiza la hoja y revisa las diferencias.`);
    }

    const positivas = contados.filter((r) => r.cantidadContada! > r.cantidadEsperada).map((r) => ({ articuloId: r.articuloId, cantidad: r.cantidadContada! - r.cantidadEsperada }));
    const negativas = contados.filter((r) => r.cantidadContada! < r.cantidadEsperada).map((r) => ({ articuloId: r.articuloId, cantidad: r.cantidadEsperada - r.cantidadContada! }));
    const hoy = aFechaDeBase(hoyEnMexico());
    const ajustes: string[] = [];

    if (negativas.length > 0) {
      const ajusteId = await crearAjuste(tx, usuario, h, "-", negativas, hoy);
      await bloquearCapasVivas(tx, h.bodegaId, negativas.map((p) => p.articuloId));
      const piezas = negativas.reduce((n, p) => n + p.cantidad, 0);
      const consumo = await consumirCapasPEPS(tx, ajusteId, h.bodegaId);
      const descontadas = await descontarExistencias(tx, ajusteId, h.bodegaId);
      if (consumo.piezas !== piezas || consumo.capas !== consumo.consumos || descontadas !== negativas.length) {
        throw new ErrorDeDominio("invariante", "La existencia no coincide con sus capas de costo; avisa al administrador antes de ajustar.");
      }
      ajustes.push(ajusteId);
    }
    if (positivas.length > 0) {
      const ajusteId = await crearAjuste(tx, usuario, h, "+", positivas, hoy);
      const exceso = await excesoDeCapacidad(tx, ajusteId, h.bodegaId);
      if (exceso) throw new ErrorDeDominio("partidas", `${exceso.clave}: lo contado rebasa lo que el sistema puede registrar.`);
      if ((await crearCapasSinCosto(tx, ajusteId, h.bodegaId, hoy)) !== positivas.length || (await incrementarExistencias(tx, ajusteId, h.bodegaId)) !== positivas.length) {
        throw new ErrorDeDominio("invariante", "El ajuste no cuadró con la hoja; no se guardó nada.");
      }
      ajustes.push(ajusteId);
    }

    const folios: string[] = [];
    for (const ajusteId of ajustes) {
      const folio = await tomarFolio(tx, "AJUSTE");
      await transicionar(tx, ajusteId, "BORRADOR", { estatus: "CONFIRMADO", folio, confirmadoPorId: usuario.id, confirmadoEn: new Date() });
      folios.push(folio);
    }
    const { count } = await tx.hojaConteo.updateMany({
      where: { id, estatus: "BORRADOR", revision },
      data: { estatus: "CONFIRMADO", confirmadoPorId: usuario.id, confirmadoEn: new Date() },
    });
    if (count !== 1) throw new ErrorDeDominio("concurrencia", "La hoja cambió mientras se confirmaba; vuelve a intentarlo.");
    return { id, ajustes: folios, repetido: false };
  } catch (error) {
    traducirErrorDeBase(error);
  }
}
