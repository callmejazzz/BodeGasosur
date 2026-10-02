import type { EstatusMovimiento, Presentacion, Prisma, TipoMovimiento } from "@prisma/client";
import type { UsuarioSesion } from "@/lib/db";
import { chocaCon } from "@/lib/movimientos/errores";
import { aUnidadBase, bloquearArticulos } from "@/lib/movimientos/primitivas";
import { ErrorDeDominio } from "./errores";

// Lo que comparten los borradores de traspaso y devolución: partidas en unidad
// base, llave de idempotencia, candado del encabezado y descarte. El actor
// siempre llega de accionProtegida(); nada de aquí lo toma de los datos.

type Tx = Prisma.TransactionClient;

export const TOPE_PARTIDAS = 200;

export type PartidaCapturada = {
  articuloId: string;
  presentacion: Presentacion;
  cantidadCapturada: number;
  observaciones?: string | null;
};

export type PartidaNormalizada = {
  articuloId: string;
  presentacion: Presentacion;
  cantidadCapturada: number;
  factorConversion: number;
  cantidad: number;
  observaciones: string | null;
};

export type ResultadoAlta = { id: string; repetido: boolean };
export type ResultadoConfirmacion = { id: string; folio: string; repetido: boolean };
export type ResultadoDescarte = { id: string; repetido: boolean };

export function textoObligatorio(valor: string, pregunta: string): string {
  const limpio = valor.trim();
  if (!limpio) throw new ErrorDeDominio("datos", pregunta);
  return limpio;
}

/** Partidas en unidad base: artículos activos, sin repetir, factor del catálogo. Bloquea los artículos FOR SHARE. */
export async function normalizarPartidas(tx: Tx, partidas: readonly PartidaCapturada[], movimiento: string): Promise<PartidaNormalizada[]> {
  if (partidas.length === 0) throw new ErrorDeDominio("partidas", `El ${movimiento} necesita al menos una partida.`);
  if (partidas.length > TOPE_PARTIDAS) throw new ErrorDeDominio("partidas", `Demasiadas partidas en un solo ${movimiento}.`);
  const ids = partidas.map((p) => p.articuloId);
  if (new Set(ids).size !== ids.length) {
    throw new ErrorDeDominio("partidas", `Un artículo no puede aparecer dos veces en el mismo ${movimiento}.`);
  }
  await bloquearArticulos(tx, ids);
  const articulos = new Map(
    (await tx.articulo.findMany({ where: { id: { in: ids } }, select: { id: true, clave: true, activo: true, piezasPorCaja: true } })).map((a) => [a.id, a]),
  );
  return partidas.map((p) => {
    const articulo = articulos.get(p.articuloId);
    if (!articulo?.activo) throw new ErrorDeDominio("catalogo", `Un artículo del ${movimiento} no existe o está dado de baja.`);
    const base = aUnidadBase(articulo.clave, p.presentacion, p.cantidadCapturada, articulo.piezasPorCaja);
    if ("error" in base) throw new ErrorDeDominio("partidas", base.error);
    return {
      articuloId: p.articuloId,
      presentacion: p.presentacion,
      cantidadCapturada: p.cantidadCapturada,
      ...base,
      observaciones: p.observaciones?.trim() || null,
    };
  });
}

export function partidasParaCrear(partidas: readonly PartidaNormalizada[]) {
  return partidas.map((p, i) => ({
    orden: i + 1,
    articuloId: p.articuloId,
    presentacionCapturada: p.presentacion,
    cantidadCapturada: p.cantidadCapturada,
    factorConversion: p.factorConversion,
    cantidad: p.cantidad,
    observaciones: p.observaciones,
  }));
}

/**
 * Justo antes de afectar inventario, con los artículos ya bloqueados: cada
 * partida sigue activa y su caja vale lo que valía al guardarse. El borrador
 * no se reinterpreta: se vuelve a guardar.
 */
export async function revalidarPartidas(tx: Tx, movimientoId: string): Promise<{ articuloId: string; cantidad: number }[]> {
  const partidas = await tx.movimientoPartida.findMany({
    where: { movimientoId },
    select: { articuloId: true, cantidad: true, presentacionCapturada: true, factorConversion: true, articulo: { select: { clave: true, activo: true, piezasPorCaja: true } } },
    orderBy: { orden: "asc" },
  });
  if (partidas.length === 0) throw new ErrorDeDominio("partidas", "El borrador no tiene partidas.");
  for (const p of partidas) {
    if (!p.articulo.activo) throw new ErrorDeDominio("catalogo", `${p.articulo.clave} está dado de baja.`);
    if (p.presentacionCapturada === "CAJA" && p.factorConversion !== p.articulo.piezasPorCaja) {
      throw new ErrorDeDominio(
        "factor-desactualizado",
        `${p.articulo.clave} pasó de ${p.factorConversion} a ${p.articulo.piezasPorCaja ?? "ninguna"} piezas por caja: vuelve a guardar esa partida.`,
      );
    }
  }
  return partidas.map((p) => ({ articuloId: p.articuloId, cantidad: p.cantidad }));
}

// ─────────────────────────────── Encabezado ──────────────────────────────────

export type Encabezado = {
  id: string;
  tipo: TipoMovimiento;
  estatus: EstatusMovimiento;
  folio: string | null;
  fecha: Date;
  bodegaOrigenId: string | null;
  bodegaDestinoId: string | null;
  estacionId: string | null;
  devuelveAId: string | null;
  cancelaAId: string | null;
  motivoCancelacion: string | null;
};

/** FOR UPDATE del encabezado de un borrador capturable. Otro tipo responde igual que uno inexistente. */
export async function bloquearMovimiento(tx: Tx, id: string, tipo: TipoMovimiento, noExiste: string): Promise<Encabezado> {
  const filas = await tx.$queryRaw<Encabezado[]>`
    SELECT id, tipo, estatus, folio, fecha, "bodegaOrigenId", "bodegaDestinoId", "estacionId",
           "devuelveAId", "cancelaAId", "motivoCancelacion"
    FROM "Movimiento" WHERE id = ${id}::uuid FOR UPDATE`;
  const m = filas[0];
  if (!m || m.tipo !== tipo || m.cancelaAId !== null) throw new ErrorDeDominio("no-encontrado", noExiste);
  return m;
}

/** El cambio de estatus condicionado al de origen; con el candado tomado siempre afecta una fila. */
export async function transicionar(tx: Tx, id: string, desde: EstatusMovimiento, data: Prisma.MovimientoUncheckedUpdateManyInput): Promise<void> {
  const { count } = await tx.movimiento.updateMany({ where: { id, estatus: desde }, data });
  if (count !== 1) throw new ErrorDeDominio("concurrencia", "El movimiento cambió mientras se guardaba; vuelve a intentarlo.");
}

export function exigirBorrador(m: Encabezado, nombre: string): void {
  if (m.estatus === "CONFIRMADO") throw new ErrorDeDominio("estado", `El ${nombre} ${m.folio} ya está confirmado y no se edita.`);
  if (m.estatus !== "BORRADOR") throw new ErrorDeDominio("estado", `El ${nombre} fue descartado.`);
}

/** BORRADOR → CANCELADO con motivo. Repetirlo con el mismo motivo devuelve lo hecho; con otro, conflicto. */
export async function descartarBorrador(tx: Tx, usuario: UsuarioSesion, m: Encabezado, motivo: string, nombre: string): Promise<ResultadoDescarte> {
  const texto = textoObligatorio(motivo, `Di por qué se descarta el ${nombre}.`);
  if (m.estatus === "CANCELADO") {
    if (m.motivoCancelacion === texto) return { id: m.id, repetido: true };
    throw new ErrorDeDominio("conflicto", `El ${nombre} ya se descartó con otro motivo.`);
  }
  exigirBorrador(m, nombre);
  await transicionar(tx, m.id, "BORRADOR", { estatus: "CANCELADO", motivoCancelacion: texto, canceladoPorId: usuario.id, canceladoEn: new Date() });
  return { id: m.id, repetido: false };
}

// ──────────────────────────── Idempotencia del alta ──────────────────────────

const textoCanonico = (v: string | null | undefined) => (v ?? "").trim();
const idCanonico = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

type PartidaGuardada = { articuloId: string; presentacionCapturada: string; cantidadCapturada: number; observaciones: string | null };

/**
 * Representación canónica: solo lo que la persona escribió, con claves fijas,
 * partidas ordenadas y JSON.stringify (como en entradas y salidas). Los
 * derivados —factor, cantidad base, costos— no participan.
 */
export function firma(encabezado: Record<string, string | null | undefined>, partidas: readonly (PartidaCapturada | PartidaGuardada)[]): string {
  const campos = Object.fromEntries(
    Object.entries(encabezado)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([clave, valor]) => [clave, clave.endsWith("Id") ? idCanonico(valor) : textoCanonico(valor)]),
  );
  const lineas = partidas
    .map((p) =>
      JSON.stringify({
        articuloId: idCanonico(p.articuloId),
        presentacion: "presentacion" in p ? p.presentacion : p.presentacionCapturada,
        cantidadCapturada: p.cantidadCapturada,
        observaciones: textoCanonico(p.observaciones),
      }),
    )
    .sort();
  return JSON.stringify({ ...campos, partidas: lineas });
}

/**
 * Busca la llave antes de validar nada. Nulo si no existe; el id si es del
 * mismo actor, del mismo tipo y con la misma captura; si no, conflicto. La
 * llave no concede acceso.
 */
export async function resolverLlave(
  tx: Tx,
  usuario: UsuarioSesion,
  llave: string,
  tipo: TipoMovimiento,
  firmaDeCaptura: string,
  firmaDeGuardado: (m: Prisma.MovimientoGetPayload<{ include: { partidas: true } }>) => string,
  nombre: string,
): Promise<string | null> {
  const existente = await tx.movimiento.findUnique({ where: { llaveIdempotencia: llave }, include: { partidas: true } });
  if (!existente) return null;
  if (existente.tipo !== tipo || existente.creadoPorId !== usuario.id || firmaDeGuardado(existente) !== firmaDeCaptura) {
    throw new ErrorDeDominio("conflicto-idempotencia", `Esta captura ya se envió con otros datos. Abre el ${nombre} guardado.`);
  }
  return existente.id;
}

/**
 * El INSERT del alta en un savepoint: si dos solicitudes con la misma llave
 * llegan juntas, la segunda retrocede solo su INSERT y devuelve al ganador.
 */
export async function crearConLlave(tx: Tx, crear: () => Promise<{ id: string }>, reintentar: () => Promise<string | null>): Promise<ResultadoAlta> {
  await tx.$executeRawUnsafe("SAVEPOINT alta_inventario");
  try {
    const { id } = await crear();
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT alta_inventario");
    return { id, repetido: false };
  } catch (error) {
    if (!chocaCon(error, "llaveIdempotencia")) throw error;
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT alta_inventario");
    const ganador = await reintentar();
    if (!ganador) throw new ErrorDeDominio("concurrencia", "La captura se cruzó con otra; inténtalo de nuevo.");
    return { id: ganador, repetido: true };
  }
}
