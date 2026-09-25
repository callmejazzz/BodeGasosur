import "server-only";
import type { Prisma } from "@prisma/client";
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
} satisfies Prisma.MovimientoSelect;

export type SalidaResumen = Prisma.MovimientoGetPayload<{ select: typeof RESUMEN }>;

/** La lista se corta en 200: pasado eso, la pantalla avisa y pide afinar la búsqueda. */
export const TOPE_LISTA = 200;

export type FiltroSalidas = {
  estatus: EstatusSalida | "todas";
  /** Folio, clave de bodega o número de estación (tolerante), alias, solicitante o quién retiró. */
  busqueda: string;
};

/** Ids cuyo folio, clave de bodega o número de estación coinciden ignorando guiones, ceros y mayúsculas. */
async function idsPorClave(db: Db, texto: string): Promise<string[]> {
  const filas = await db.$queryRaw<{ id: string }[]>`
    SELECT m.id
    FROM "Movimiento" m
    JOIN "Bodega" b ON b.id = m."bodegaOrigenId"
    JOIN catalogo_gasosur."Estacion" s ON s.id = m."estacionId"
    WHERE m.tipo = 'SALIDA'
      AND clave_normalizada(${texto}) <> ''
      AND (position(clave_normalizada(${texto}) IN clave_normalizada(m.folio)) > 0
        OR position(clave_normalizada(${texto}) IN clave_normalizada(b.clave)) > 0
        OR position(clave_normalizada(${texto}) IN clave_normalizada(s.numero)) > 0)`;
  return filas.map((f) => f.id);
}

/** La más reciente arriba. Pide una fila de más para saber si el tope se quedó corto. */
export async function listarSalidas(db: Db, filtro: FiltroSalidas): Promise<{ filas: SalidaResumen[]; hayMas: boolean }> {
  const q = filtro.busqueda.trim().slice(0, 80);
  const filas = await db.movimiento.findMany({
    where: {
      tipo: "SALIDA",
      estatus: filtro.estatus === "todas" ? undefined : filtro.estatus,
      OR: q
        ? [
            { id: { in: await idsPorClave(db, q) } },
            { estacion: { alias: { contains: q, mode: "insensitive" } } },
            { solicitadoPor: { nombre: { contains: q, mode: "insensitive" } } },
            { entregadoA: { contains: q, mode: "insensitive" } },
          ]
        : undefined,
    },
    select: RESUMEN,
    orderBy: { createdAt: "desc" },
    take: TOPE_LISTA + 1,
  });
  return { filas: filas.slice(0, TOPE_LISTA), hayMas: filas.length > TOPE_LISTA };
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

export type Pendientes = { filas: SalidaResumen[]; total: number };
export type Bandeja = { porAutorizar: Pendientes; porRetirar: Pendientes; porRecibir: Pendientes };

/** Lo que espera a alguien, la más antigua primero: autorizar, retirar o confirmar recepción. */
export async function bandejaDeSalidas(db: Db): Promise<Bandeja> {
  const pendientes = async (estatus: EstatusSalida): Promise<Pendientes> => ({
    filas: await db.movimiento.findMany({
      where: { tipo: "SALIDA", estatus },
      select: RESUMEN,
      orderBy: { createdAt: "asc" },
      take: TOPE_BANDEJA,
    }),
    total: await db.movimiento.count({ where: { tipo: "SALIDA", estatus } }),
  });
  // Secuencial a propósito: dentro de una transacción hay una sola conexión.
  const porAutorizar = await pendientes("SOLICITADA");
  const porRetirar = await pendientes("AUTORIZADA");
  const porRecibir = await pendientes("RETIRADA");
  return { porAutorizar, porRetirar, porRecibir };
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
  };
}
