import "server-only";
import type { EstatusMovimiento, Prisma } from "@prisma/client";
import type { FiltroEntradas, FiltroEstatus } from "@/lib/entradas/filtros";
import { aFechaDeBase } from "@/lib/fechas";

// Lecturas de entradas. Recibe el cliente: solo consultar() lo entrega.

type Db = Prisma.TransactionClient;

const ESTATUS_POR_FILTRO: Record<FiltroEstatus, EstatusMovimiento[]> = {
  todas: ["BORRADOR", "CONFIRMADO", "CANCELADO"],
  borradores: ["BORRADOR"],
  confirmadas: ["CONFIRMADO"],
  descartadas: ["CANCELADO"],
};

const RESUMEN = {
  id: true,
  folio: true,
  estatus: true,
  fecha: true,
  referencia: true,
  moneda: true,
  total: true,
  confirmadoEn: true,
  createdAt: true,
  proveedor: { select: { nombreComercial: true } },
  bodegaDestino: { select: { clave: true, nombre: true } },
  _count: { select: { partidas: true } },
} satisfies Prisma.MovimientoSelect;

export type EntradaResumen = Prisma.MovimientoGetPayload<{ select: typeof RESUMEN }>;

/** La lista se corta en 200: pasado eso, la pantalla avisa y pide afinar los filtros. */
export const TOPE_LISTA = 200;

/** Ids cuyo folio o clave de bodega coinciden ignorando guiones, ceros y mayúsculas (clave_normalizada). */
async function idsPorClave(db: Db, texto: string): Promise<string[]> {
  const filas = await db.$queryRaw<{ id: string }[]>`
    SELECT m.id
    FROM "Movimiento" m
    LEFT JOIN "Bodega" b ON b.id = m."bodegaDestinoId"
    WHERE m.tipo = 'ENTRADA'
      AND clave_normalizada(${texto}) <> ''
      AND (position(clave_normalizada(${texto}) IN clave_normalizada(m.folio)) > 0
        OR position(clave_normalizada(${texto}) IN clave_normalizada(b.clave)) > 0)`;
  return filas.map((f) => f.id);
}

/**
 * Los borradores van primero, del más recientemente tocado al más viejo; el
 * resto por orden de creación, la más nueva arriba. Pide una fila de más para
 * saber si el tope se quedó corto.
 */
export async function listarEntradas(db: Db, filtro: FiltroEntradas): Promise<{ filas: EntradaResumen[]; hayMas: boolean }> {
  const q = filtro.busqueda.trim();
  const where: Prisma.MovimientoWhereInput = {
    tipo: "ENTRADA",
    referencia: filtro.referencia === "sin" ? null : filtro.referencia === "con" ? { not: null } : undefined,
    fecha:
      filtro.desde || filtro.hasta
        ? { gte: filtro.desde ? aFechaDeBase(filtro.desde) : undefined, lte: filtro.hasta ? aFechaDeBase(filtro.hasta) : undefined }
        : undefined,
    OR: q
      ? [
          { id: { in: await idsPorClave(db, q) } },
          { referencia: { contains: q, mode: "insensitive" } },
          { proveedor: { nombreComercial: { contains: q, mode: "insensitive" } } },
          { bodegaDestino: { nombre: { contains: q, mode: "insensitive" } } },
        ]
      : undefined,
  };

  const estatus = ESTATUS_POR_FILTRO[filtro.estatus];
  const cerrados = estatus.filter((s) => s !== "BORRADOR");
  const tope = TOPE_LISTA + 1;
  const borradores = estatus.includes("BORRADOR")
    ? await db.movimiento.findMany({ where: { ...where, estatus: "BORRADOR" }, select: RESUMEN, orderBy: { updatedAt: "desc" }, take: tope })
    : [];
  const resto =
    cerrados.length > 0 && borradores.length < tope
      ? await db.movimiento.findMany({
          where: { ...where, estatus: { in: cerrados } },
          select: RESUMEN,
          orderBy: { createdAt: "desc" },
          take: tope - borradores.length,
        })
      : [];
  const todas = [...borradores, ...resto];
  return { filas: todas.slice(0, TOPE_LISTA), hayMas: todas.length > TOPE_LISTA };
}

const DETALLE = {
  id: true,
  folio: true,
  estatus: true,
  fecha: true,
  referencia: true,
  observaciones: true,
  moneda: true,
  tipoCambio: true,
  subtotal: true,
  iva: true,
  total: true,
  proveedorId: true,
  bodegaDestinoId: true,
  motivoCancelacion: true,
  confirmadoEn: true,
  canceladoEn: true,
  createdAt: true,
  updatedAt: true,
  proveedor: { select: { nombreComercial: true, activo: true } },
  bodegaDestino: { select: { clave: true, nombre: true, activa: true } },
  creadoPor: { select: { correo: true } },
  confirmadoPor: { select: { correo: true } },
  canceladoPorUsuario: { select: { correo: true } },
  partidas: {
    select: {
      id: true,
      articuloId: true,
      presentacionCapturada: true,
      cantidadCapturada: true,
      factorConversion: true,
      cantidad: true,
      costoUnitarioCapturado: true,
      tasaIva: true,
      costoUnitario: true,
      costoUnitarioConIva: true,
      numeroSerie: true,
      observaciones: true,
      articulo: { select: { clave: true, descripcion: true, piezasPorCaja: true, activo: true, unidad: { select: { clave: true } } } },
    },
    orderBy: { orden: "asc" },
  },
} satisfies Prisma.MovimientoSelect;

export type EntradaDetalle = Prisma.MovimientoGetPayload<{ select: typeof DETALLE }>;

export async function obtenerEntrada(db: Db, id: string): Promise<EntradaDetalle | null> {
  return db.movimiento.findFirst({ where: { id, tipo: "ENTRADA" }, select: DETALLE });
}

/** Otras recepciones del mismo proveedor y referencia (11 §7): se muestran, no se descuentan. */
export function entradasRelacionadas(db: Db, entrada: Pick<EntradaDetalle, "id" | "proveedorId" | "referencia">) {
  if (!entrada.referencia || !entrada.proveedorId) return Promise.resolve([] as EntradaResumen[]);
  return db.movimiento.findMany({
    where: { tipo: "ENTRADA", id: { not: entrada.id }, proveedorId: entrada.proveedorId, referencia: entrada.referencia },
    select: RESUMEN,
    orderBy: { fecha: "asc" },
  });
}

export type OpcionArticulo = { id: string; clave: string; descripcion: string; unidad: string; piezasPorCaja: number | null };
export type OpcionesCaptura = {
  proveedores: { id: string; nombre: string }[];
  bodegas: { id: string; nombre: string }[];
  articulos: OpcionArticulo[];
};

/**
 * Catálogos activos para el formulario. `conservar` mantiene en la lista lo
 * que el borrador ya tiene asignado aunque esté dado de baja, para que la
 * edición no lo pierda en silencio; la confirmación lo rechazará con motivo.
 */
export async function cargarOpcionesDeCaptura(
  db: Db,
  conservar: { proveedorId?: string | null; bodegaId?: string | null; articuloIds?: string[] } = {},
): Promise<OpcionesCaptura> {
  const proveedores = await db.proveedor.findMany({
    where: { OR: [{ activo: true }, ...(conservar.proveedorId ? [{ id: conservar.proveedorId }] : [])] },
    select: { id: true, nombreComercial: true },
    orderBy: { nombreComercial: "asc" },
  });
  const bodegas = await db.bodega.findMany({
    where: { OR: [{ activa: true }, ...(conservar.bodegaId ? [{ id: conservar.bodegaId }] : [])] },
    select: { id: true, clave: true, nombre: true },
    orderBy: { nombre: "asc" },
  });
  const articulos = await db.articulo.findMany({
    where: { OR: [{ activo: true }, ...(conservar.articuloIds?.length ? [{ id: { in: conservar.articuloIds } }] : [])] },
    select: { id: true, clave: true, descripcion: true, piezasPorCaja: true, unidad: { select: { clave: true } } },
    orderBy: { clave: "asc" },
  });
  return {
    proveedores: proveedores.map((p) => ({ id: p.id, nombre: p.nombreComercial })),
    bodegas: bodegas.map((b) => ({ id: b.id, nombre: `${b.clave} · ${b.nombre}` })),
    articulos: articulos.map((a) => ({ id: a.id, clave: a.clave, descripcion: a.descripcion, unidad: a.unidad.clave, piezasPorCaja: a.piezasPorCaja })),
  };
}
