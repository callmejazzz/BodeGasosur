import "server-only";
import type { EstatusMovimiento, Prisma } from "@prisma/client";
import type { FiltroEntradas, FiltroEstatus } from "@/lib/entradas/filtros";
import { enOrden, idsDeLista, sql } from "@/lib/movimientos/lista";
import type { Pagina } from "@/lib/paginacion";

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
  canceladoPor: { select: { id: true } },
} satisfies Prisma.MovimientoSelect;

export type EntradaResumen = Prisma.MovimientoGetPayload<{ select: typeof RESUMEN }>;

/**
 * Borradores primero, del más recientemente tocado al más viejo; luego las
 * confirmadas por folio, del más alto al más bajo; al final las descartadas,
 * la más nueva arriba. Folio y clave de bodega se buscan como clave; la
 * referencia, el proveedor y el nombre de la bodega, sin acentos.
 */
export async function listarEntradas(db: Db, filtro: FiltroEntradas, pedida = 1): Promise<{ filas: EntradaResumen[]; pagina: Pagina }> {
  const filtros = [sql`m.estatus::text = ANY(${ESTATUS_POR_FILTRO[filtro.estatus]}::text[])`];
  if (filtro.referencia === "con") filtros.push(sql`m.referencia IS NOT NULL`);
  if (filtro.referencia === "sin") filtros.push(sql`m.referencia IS NULL`);
  if (filtro.desde) filtros.push(sql`m.fecha >= ${filtro.desde}::date`);
  if (filtro.hasta) filtros.push(sql`m.fecha <= ${filtro.hasta}::date`);
  const { ids, pagina } = await idsDeLista(db, {
    tipo: "ENTRADA",
    abiertos: ["BORRADOR"],
    abiertosPorToque: true,
    joins: sql`LEFT JOIN "Bodega" b ON b.id = m."bodegaDestinoId" LEFT JOIN "Proveedor" p ON p.id = m."proveedorId"`,
    filtros,
    busqueda: filtro.busqueda,
    claves: [sql`m.folio`, sql`b.clave`],
    textos: [sql`m.referencia`, sql`p."nombreComercial"`, sql`b.nombre`],
    pagina: pedida,
  });
  const filas = await db.movimiento.findMany({ where: { id: { in: ids } }, select: RESUMEN });
  return { filas: enOrden(ids, filas), pagina };
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
