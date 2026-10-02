import "server-only";
import type { Prisma } from "@prisma/client";
import { enOrden, idsDeLista, sql } from "@/lib/movimientos/lista";
import { usuarioTienePermiso, type Permiso, type SujetoDePermisos } from "@/lib/permisos";
import type { EstatusSalida } from "./servicio";

// Lecturas de salidas. Recibe el cliente: solo consultar() lo entrega.

type Db = Prisma.TransactionClient;

const RESUMEN = {
  id: true,
  folio: true,
  estatus: true,
  fecha: true,
  esPrestamo: true,
  entregadoA: true,
  createdAt: true,
  autorizadoEn: true,
  entregadoEn: true,
  recibidoEn: true,
  bodegaOrigen: { select: { clave: true, nombre: true } },
  estacion: { select: { numero: true, alias: true } },
  area: { select: { nombre: true } },
  solicitadoPor: { select: { nombre: true } },
  _count: { select: { partidas: true } },
  canceladoPor: { select: { id: true } },
} satisfies Prisma.MovimientoSelect;

export type SalidaResumen = Prisma.MovimientoGetPayload<{ select: typeof RESUMEN }>;

/** Cada tramo entrega hasta 200 salidas; el cursor permite consultar las anteriores. */
export const TOPE_LISTA = 200;

export type FiltroSalidas = {
  estatus: EstatusSalida | "todas";
  /** Folio, clave de bodega o número de estación (tolerante); nombre de bodega, alias, solicitante o quién retiró. */
  busqueda: string;
  soloPrestamos?: boolean;
  cursor?: string;
};

/**
 * Lo que sigue en curso primero (solicitadas y autorizadas, sin folio todavía);
 * luego las retiradas o recibidas por folio, del más alto al más bajo; al
 * final rechazadas y canceladas, la más nueva arriba. El id desempata y hace
 * estable el cursor.
 */
export async function listarSalidas(db: Db, filtro: FiltroSalidas): Promise<{ filas: SalidaResumen[]; hayMas: boolean; cursorActual: string | null; cursorSiguiente: string | null }> {
  const cursor = filtro.cursor ? await db.movimiento.findFirst({ where: { id: filtro.cursor, tipo: "SALIDA" }, select: { id: true } }) : null;
  const filtros = [];
  if (filtro.estatus !== "todas") filtros.push(sql`m.estatus = ${filtro.estatus}::"EstatusMovimiento"`);
  if (filtro.soloPrestamos) filtros.push(sql`m."esPrestamo"`);
  const ids = await idsDeLista(db, {
    tipo: "SALIDA",
    abiertos: ["SOLICITADA", "AUTORIZADA"],
    joins: sql`
      LEFT JOIN "Bodega" b ON b.id = m."bodegaOrigenId"
      LEFT JOIN catalogo_gasosur."Estacion" s ON s.id = m."estacionId"
      LEFT JOIN "Persona" p ON p.id = m."solicitadoPorId"`,
    filtros,
    busqueda: filtro.busqueda.slice(0, 80),
    claves: [sql`m.folio`, sql`b.clave`, sql`s.numero`],
    textos: [sql`b.nombre`, sql`s.alias`, sql`p.nombre`, sql`m."entregadoA"`],
    cursor: cursor?.id,
    tope: TOPE_LISTA + 1,
  });
  const hayMas = ids.length > TOPE_LISTA;
  const visibles = ids.slice(0, TOPE_LISTA);
  const filas = enOrden(visibles, await db.movimiento.findMany({ where: { id: { in: visibles } }, select: RESUMEN }));
  return { filas, hayMas, cursorActual: cursor?.id ?? null, cursorSiguiente: hayMas ? visibles.at(-1)! : null };
}

const DETALLE = {
  ...RESUMEN,
  observaciones: true,
  motivoRechazo: true,
  motivoCancelacion: true,
  rechazadoEn: true,
  canceladoEn: true,
  updatedAt: true,
  bodegaOrigen: { select: { clave: true, nombre: true, activa: true } },
  estacion: { select: { numero: true, alias: true, activa: true } },
  area: { select: { nombre: true, activa: true } },
  solicitadoPor: { select: { nombre: true, activa: true } },
  creadoPor: { select: { correo: true } },
  autorizadoPor: { select: { correo: true } },
  rechazadoPor: { select: { correo: true } },
  entregadoPor: { select: { correo: true } },
  recibidoPor: { select: { correo: true } },
  canceladoPorUsuario: { select: { correo: true } },
  partidas: {
    select: {
      id: true,
      orden: true,
      articuloId: true,
      presentacionCapturada: true,
      cantidadCapturada: true,
      factorConversion: true,
      cantidad: true,
      observaciones: true,
      articulo: { select: { clave: true, descripcion: true, piezasPorCaja: true, activo: true, unidad: { select: { clave: true } } } },
      // PEPS: de qué capa salió cada pieza y a qué costo, en el orden en que se consumió.
      consumos: {
        select: {
          cantidad: true,
          costoUnitario: true,
          costoUnitarioConIva: true,
          capa: { select: { fechaOriginal: true, movimiento: { select: { folio: true } } } },
        },
        orderBy: [{ capa: { fechaOriginal: "asc" } }, { capaId: "asc" }],
      },
    },
    orderBy: { orden: "asc" },
  },
} satisfies Prisma.MovimientoSelect;

export type SalidaDetalle = Prisma.MovimientoGetPayload<{ select: typeof DETALLE }>;

export async function obtenerSalida(db: Db, id: string): Promise<SalidaDetalle | null> {
  return db.movimiento.findFirst({ where: { id, tipo: "SALIDA" }, select: DETALLE });
}

export type Valuacion = { importe: string | null; importeConIva: string | null; piezasSinCosto: number };

/**
 * Valor de una salida retirada: suma de sus consumos, redondeada por renglón
 * en PostgreSQL. No hay costo unitario único cuando una partida tocó capas de
 * costos distintos; las piezas de capas sin costo se cuentan aparte.
 */
export async function valuarSalida(db: Db, id: string): Promise<Valuacion> {
  const [v] = await db.$queryRaw<Valuacion[]>`
    SELECT sum(importe_renglon(c.cantidad, c."costoUnitario"))::text        AS "importe",
           sum(importe_renglon(c.cantidad, c."costoUnitarioConIva"))::text  AS "importeConIva",
           coalesce(sum(c.cantidad) FILTER (WHERE c."costoUnitario" IS NULL), 0)::int AS "piezasSinCosto"
    FROM "ConsumoCapa" c
    JOIN "MovimientoPartida" p ON p.id = c."partidaId"
    JOIN "Movimiento" m ON m.id = p."movimientoId"
    WHERE m.id = ${id}::uuid AND m.tipo = 'SALIDA'`;
  return v;
}

// ──────────────────────────────── Bandeja ────────────────────────────────────

const TOPE_BANDEJA = 50;

/** Cada sección espera a quien tiene su permiso: autorizar, retirar o confirmar recepción. */
export const SECCIONES = [
  { clave: "porAutorizar", estatus: "SOLICITADA", permiso: "salidas:autorizar" },
  { clave: "porRetirar", estatus: "AUTORIZADA", permiso: "salidas:retirar" },
  { clave: "porRecibir", estatus: "RETIRADA", permiso: "salidas:recibir" },
] as const satisfies readonly { clave: string; estatus: EstatusSalida; permiso: Permiso }[];

export type ClaveSeccion = (typeof SECCIONES)[number]["clave"];
export type SeccionBandeja = { clave: ClaveSeccion; estatus: EstatusSalida; filas: SalidaResumen[]; total: number };

const seccionesDe = (usuario: SujetoDePermisos) => SECCIONES.filter((s) => usuarioTienePermiso(usuario, s.permiso));

function ordenDeBandeja(estatus: EstatusSalida): Prisma.MovimientoOrderByWithRelationInput[] {
  if (estatus === "SOLICITADA") return [{ createdAt: "asc" }, { id: "asc" }];
  if (estatus === "AUTORIZADA") return [{ autorizadoEn: "asc" }, { id: "asc" }];
  return [{ entregadoEn: "asc" }, { id: "asc" }];
}

/** Lo que espera al usuario, la más antigua primero. Las secciones en las que no puede actuar no se consultan. */
export async function bandejaDeSalidas(db: Db, usuario: SujetoDePermisos): Promise<SeccionBandeja[]> {
  const bandeja: SeccionBandeja[] = [];
  // Secuencial a propósito: dentro de una transacción hay una sola conexión.
  for (const { clave, estatus } of seccionesDe(usuario)) {
    const filas = await db.movimiento.findMany({
      where: { tipo: "SALIDA", estatus },
      select: RESUMEN,
      orderBy: ordenDeBandeja(estatus),
      take: TOPE_BANDEJA,
    });
    const total = await db.movimiento.count({ where: { tipo: "SALIDA", estatus } });
    bandeja.push({ clave, estatus, filas, total });
  }
  return bandeja;
}

/** Cuántas salidas esperan al usuario; null si no puede actuar en ninguna sección. */
export async function contarPendientes(db: Db, usuario: SujetoDePermisos): Promise<number | null> {
  const secciones = seccionesDe(usuario);
  if (secciones.length === 0) return null;
  return db.movimiento.count({ where: { tipo: "SALIDA", estatus: { in: secciones.map((s) => s.estatus) } } });
}

// ─────────────────────────────── Existencias ─────────────────────────────────
// Informativas: el retiro las vuelve a comprobar bajo candado.

/** Existencia en la bodega de origen de cada artículo de la salida. */
export async function existenciasDeSalida(db: Db, id: string): Promise<Record<string, number>> {
  const filas = await db.$queryRaw<{ articuloId: string; cantidad: number }[]>`
    SELECT p."articuloId", coalesce(e.cantidad, 0) AS cantidad
    FROM "MovimientoPartida" p
    JOIN "Movimiento" m ON m.id = p."movimientoId"
    LEFT JOIN "Existencia" e ON e."bodegaId" = m."bodegaOrigenId" AND e."articuloId" = p."articuloId"
    WHERE m.id = ${id}::uuid AND m.tipo = 'SALIDA'`;
  return Object.fromEntries(filas.map((f) => [f.articuloId, f.cantidad]));
}

/** bodegaId → articuloId → cantidad, solo catálogo activo y solo lo que hay. */
async function existenciasActivas(db: Db): Promise<Record<string, Record<string, number>>> {
  const filas = await db.existencia.findMany({
    where: { cantidad: { gt: 0 }, bodega: { activa: true }, articulo: { activo: true } },
    select: { bodegaId: true, articuloId: true, cantidad: true },
  });
  const porBodega: Record<string, Record<string, number>> = {};
  for (const f of filas) (porBodega[f.bodegaId] ??= {})[f.articuloId] = f.cantidad;
  return porBodega;
}

// ─────────────────────────── Opciones de captura ─────────────────────────────

export type Opcion = { id: string; nombre: string };
export type OpcionArticulo = { id: string; clave: string; descripcion: string; unidad: string; piezasPorCaja: number | null };
export type OpcionesCaptura = {
  bodegas: Opcion[];
  estaciones: Opcion[];
  areas: Opcion[];
  personas: Opcion[];
  articulos: OpcionArticulo[];
  /** bodegaId → articuloId → cantidad; lo ausente es cero. */
  existencias: Record<string, Record<string, number>>;
};

/** Solo catálogo activo: una solicitud no se edita, así que no hay asignaciones previas que conservar. */
export async function cargarOpcionesDeCaptura(db: Db): Promise<OpcionesCaptura> {
  const bodegas = await db.bodega.findMany({ where: { activa: true }, select: { id: true, clave: true, nombre: true }, orderBy: { nombre: "asc" } });
  const estaciones = await db.estacion.findMany({ where: { activa: true }, select: { id: true, numero: true, alias: true }, orderBy: { numero: "asc" } });
  const areas = await db.area.findMany({ where: { activa: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
  const personas = await db.persona.findMany({ where: { activa: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
  const articulos = await db.articulo.findMany({
    where: { activo: true },
    select: { id: true, clave: true, descripcion: true, piezasPorCaja: true, unidad: { select: { clave: true } } },
    orderBy: { clave: "asc" },
  });
  return {
    bodegas: bodegas.map((b) => ({ id: b.id, nombre: `${b.clave} · ${b.nombre}` })),
    estaciones: estaciones.map((s) => ({ id: s.id, nombre: `${s.numero} · ${s.alias}` })),
    areas,
    personas,
    articulos: articulos.map((a) => ({ id: a.id, clave: a.clave, descripcion: a.descripcion, unidad: a.unidad.clave, piezasPorCaja: a.piezasPorCaja })),
    existencias: await existenciasActivas(db),
  };
}
