import "server-only";
import type { EstatusConteo, EstatusMovimiento, Prisma, TipoMovimiento } from "@prisma/client";
import { diaSiguiente, inicioDelDiaEnMexico } from "@/lib/fechas";
import { enOrden, idsDeLista, paginaDe, sql } from "@/lib/movimientos/lista";
import { acotarPagina, POR_PAGINA, saltoDe, type Pagina } from "@/lib/paginacion";
import { saldoDeSalida } from "./primitivas";

// Lecturas de traspasos, devoluciones, ajustes, préstamos y hojas de conteo.
// Reciben el cliente: solo consultar() lo entrega, con la sesión y el permiso
// ya comprobados.

type Db = Prisma.TransactionClient;

export type TipoInventario = Extract<TipoMovimiento, "TRASPASO" | "DEVOLUCION" | "AJUSTE">;

/** A dónde lleva un movimiento según su tipo. */
export function rutaDeMovimiento(tipo: TipoMovimiento, id: string): string {
  const base = { ENTRADA: "/entradas", SALIDA: "/salidas", TRASPASO: "/traspasos", DEVOLUCION: "/devoluciones", AJUSTE: "/ajustes" }[tipo];
  return `${base}/${id}`;
}

const REFERENCIA = { id: true, folio: true, tipo: true } satisfies Prisma.MovimientoSelect;

const RESUMEN = {
  id: true,
  tipo: true,
  folio: true,
  estatus: true,
  fecha: true,
  motivo: true,
  createdAt: true,
  conteoId: true,
  bodegaOrigen: { select: { clave: true, nombre: true } },
  bodegaDestino: { select: { clave: true, nombre: true } },
  estacion: { select: { numero: true, alias: true } },
  devuelveA: { select: REFERENCIA },
  cancelaA: { select: REFERENCIA },
  canceladoPor: { select: REFERENCIA },
  _count: { select: { partidas: true } },
} satisfies Prisma.MovimientoSelect;

export type MovimientoResumen = Prisma.MovimientoGetPayload<{ select: typeof RESUMEN }>;

export type FiltroMovimientos = { estatus: EstatusMovimiento | "todos"; busqueda: string };

/**
 * Borradores primero; luego los confirmados por folio, del más alto al más
 * bajo; al final los descartados. Dentro de borradores y descartados, lo más
 * nuevo arriba; el id desempata, así que las páginas no se enciman.
 *
 * La reversa de un traspaso no es una fila: vive en el historial del
 * revertido, y buscar su folio encuentra a ese traspaso.
 */
export async function listarMovimientos(db: Db, tipo: TipoInventario, filtro: FiltroMovimientos, pedida = 1) {
  const sinReversas = tipo === "TRASPASO";
  const filtros = sinReversas ? [sql`m."cancelaAId" IS NULL`] : [];
  if (filtro.estatus !== "todos") filtros.push(sql`m.estatus = ${filtro.estatus}::"EstatusMovimiento"`);
  const { ids, pagina } = await idsDeLista(db, {
    tipo,
    abiertos: ["BORRADOR"],
    joins: sql`
      LEFT JOIN "Bodega" o ON o.id = m."bodegaOrigenId"
      LEFT JOIN "Bodega" d ON d.id = m."bodegaDestinoId"
      LEFT JOIN catalogo_gasosur."Estacion" s ON s.id = m."estacionId"
      LEFT JOIN "Movimiento" r ON r."cancelaAId" = m.id`,
    filtros,
    busqueda: filtro.busqueda.slice(0, 80),
    claves: sinReversas ? [sql`m.folio`, sql`r.folio`, sql`o.clave`, sql`d.clave`, sql`s.numero`] : [sql`m.folio`, sql`o.clave`, sql`d.clave`, sql`s.numero`],
    textos: [sql`o.nombre`, sql`d.nombre`, sql`s.alias`, sql`m.motivo`, sql`m.observaciones`],
    pagina: pedida,
  });
  return { filas: enOrden(ids, await db.movimiento.findMany({ where: { id: { in: ids } }, select: RESUMEN })), pagina };
}

// ──────────────────────────────── Detalle ────────────────────────────────────

const CAPA_REF = { select: { fechaOriginal: true, bodega: { select: { nombre: true } }, movimiento: { select: REFERENCIA } } } as const;

const DETALLE = {
  ...RESUMEN,
  observaciones: true,
  motivoCancelacion: true,
  confirmadoEn: true,
  canceladoEn: true,
  updatedAt: true,
  bodegaOrigenId: true,
  bodegaDestinoId: true,
  estacionId: true,
  bodegaOrigen: { select: { clave: true, nombre: true, activa: true } },
  bodegaDestino: { select: { clave: true, nombre: true, activa: true } },
  estacion: { select: { numero: true, alias: true, activa: true } },
  conteo: { select: { id: true, motivo: true } },
  devuelveA: { select: { ...REFERENCIA, esPrestamo: true, bodegaOrigen: { select: { id: true, clave: true, nombre: true } } } },
  creadoPor: { select: { correo: true } },
  confirmadoPor: { select: { correo: true } },
  canceladoPorUsuario: { select: { correo: true } },
  canceladoPor: { select: { ...REFERENCIA, motivo: true, confirmadoEn: true, creadoPor: { select: { correo: true } } } },
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
      consumos: {
        select: { cantidad: true, costoUnitario: true, costoUnitarioConIva: true, capa: CAPA_REF },
        orderBy: [{ capa: { fechaOriginal: "asc" } }, { capaId: "asc" }],
      },
      restituciones: {
        select: { cantidad: true, costoUnitario: true, costoUnitarioConIva: true, capa: CAPA_REF },
        orderBy: [{ capa: { fechaOriginal: "asc" } }, { capaId: "asc" }],
      },
    },
    orderBy: { orden: "asc" },
  },
  capas: {
    select: {
      articuloId: true,
      cantidadInicial: true,
      cantidadRestante: true,
      fechaOriginal: true,
      costoUnitario: true,
      costoUnitarioConIva: true,
      origen: { select: { movimiento: { select: REFERENCIA } } },
    },
    orderBy: [{ fechaOriginal: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.MovimientoSelect;

export type MovimientoDetalle = Prisma.MovimientoGetPayload<{ select: typeof DETALLE }>;

export async function obtenerMovimiento(db: Db, tipo: TipoInventario, id: string): Promise<MovimientoDetalle | null> {
  return db.movimiento.findFirst({ where: { id, tipo }, select: DETALLE });
}

export type Valuacion = { importe: string | null; importeConIva: string | null; piezasSinCosto: number };
export type ValuacionMovimiento = { salio: Valuacion; entro: Valuacion; volvio: Valuacion };

/** Valor de lo que salió (consumos), entró (capas creadas) y volvió (restituciones), redondeado por renglón. */
export async function valuarMovimiento(db: Db, id: string): Promise<ValuacionMovimiento> {
  const [v] = await db.$queryRaw<{ salio: Valuacion; entro: Valuacion; volvio: Valuacion }[]>`
    SELECT
      (SELECT jsonb_build_object('importe', sum(importe_renglon(k.cantidad, k."costoUnitario"))::text,
                                 'importeConIva', sum(importe_renglon(k.cantidad, k."costoUnitarioConIva"))::text,
                                 'piezasSinCosto', coalesce(sum(k.cantidad) FILTER (WHERE k."costoUnitario" IS NULL), 0))
         FROM "ConsumoCapa" k JOIN "MovimientoPartida" p ON p.id = k."partidaId" WHERE p."movimientoId" = ${id}::uuid) AS salio,
      (SELECT jsonb_build_object('importe', sum(importe_renglon(c."cantidadInicial", c."costoUnitario"))::text,
                                 'importeConIva', sum(importe_renglon(c."cantidadInicial", c."costoUnitarioConIva"))::text,
                                 'piezasSinCosto', coalesce(sum(c."cantidadInicial") FILTER (WHERE c."costoUnitario" IS NULL), 0))
         FROM "CapaCosto" c WHERE c."movimientoId" = ${id}::uuid) AS entro,
      (SELECT jsonb_build_object('importe', sum(importe_renglon(r.cantidad, r."costoUnitario"))::text,
                                 'importeConIva', sum(importe_renglon(r.cantidad, r."costoUnitarioConIva"))::text,
                                 'piezasSinCosto', coalesce(sum(r.cantidad) FILTER (WHERE r."costoUnitario" IS NULL), 0))
         FROM "RestitucionCapa" r JOIN "MovimientoPartida" p ON p.id = r."partidaId" WHERE p."movimientoId" = ${id}::uuid) AS volvio`;
  return v;
}

/** La reversa de un movimiento, si la tiene: el original la muestra y enlaza. */
export async function reversaDe(db: Db, id: string) {
  return db.movimiento.findUnique({
    where: { cancelaAId: id },
    select: { ...REFERENCIA, motivo: true, confirmadoEn: true, creadoPor: { select: { correo: true } } },
  });
}

// ───────────────────────────── Opciones de captura ───────────────────────────

export type Opcion = { id: string; nombre: string };
export type OpcionArticulo = { id: string; clave: string; descripcion: string; unidad: string; piezasPorCaja: number | null };

/** Solo catálogo activo, más lo que ya esté en el borrador aunque se haya dado de baja. */
export async function opcionesDeArticulos(db: Db, incluir: readonly string[] = []): Promise<OpcionArticulo[]> {
  const articulos = await db.articulo.findMany({
    where: { OR: [{ activo: true }, { id: { in: [...incluir] } }] },
    select: { id: true, clave: true, descripcion: true, piezasPorCaja: true, unidad: { select: { clave: true } } },
    orderBy: { clave: "asc" },
  });
  return articulos.map((a) => ({ id: a.id, clave: a.clave, descripcion: a.descripcion, unidad: a.unidad.clave, piezasPorCaja: a.piezasPorCaja }));
}

export async function opcionesDeBodegas(db: Db): Promise<Opcion[]> {
  const bodegas = await db.bodega.findMany({ where: { activa: true }, select: { id: true, clave: true, nombre: true }, orderBy: { nombre: "asc" } });
  return bodegas.map((b) => ({ id: b.id, nombre: `${b.clave} · ${b.nombre}` }));
}

export async function opcionesDeEstaciones(db: Db): Promise<Opcion[]> {
  const estaciones = await db.estacion.findMany({ where: { activa: true }, select: { id: true, numero: true, alias: true }, orderBy: { numero: "asc" } });
  return estaciones.map((s) => ({ id: s.id, nombre: `${s.numero} · ${s.alias}` }));
}

/** bodegaId → articuloId → cantidad; solo lo que hay. Informativo: la confirmación lo vuelve a comprobar. */
export async function existenciasPorBodega(db: Db): Promise<Record<string, Record<string, number>>> {
  const filas = await db.existencia.findMany({ where: { cantidad: { gt: 0 }, bodega: { activa: true } }, select: { bodegaId: true, articuloId: true, cantidad: true } });
  const porBodega: Record<string, Record<string, number>> = {};
  for (const f of filas) (porBodega[f.bodegaId] ??= {})[f.articuloId] = f.cantidad;
  return porBodega;
}

export type SalidaDevolvible = {
  id: string;
  folio: string;
  esPrestamo: boolean;
  /** La estación a la que salió: la devolución viene de ahí. */
  estacion: Opcion;
  /** La bodega de la que salió: la devolución regresa ahí. */
  bodega: Opcion;
  /** articuloId → lo que falta por volver; vacío si ya volvió todo. */
  pendientes: Record<string, number>;
};

/** El enlace desde una salida o un préstamo trae el id; la búsqueda del formulario, el folio. */
export type ConsultaDeSalida = { id: string } | { folio: string };

/** La salida con lo que falta por volver, o por qué no admite devolución. */
export type SalidaConsultada = { salida: SalidaDevolvible; motivo?: undefined } | { salida?: undefined; motivo: string };

/**
 * Una salida para vincularla a una devolución. Las mismas reglas que la
 * captura vuelve a exigir al guardar: retirada o recibida, sin reversa y con
 * algo pendiente. El folio se compara como clave (S-000012, s12, 12).
 */
export async function salidaParaDevolver(db: Db, consulta: ConsultaDeSalida): Promise<SalidaConsultada> {
  const id = "id" in consulta ? consulta.id : null;
  const tecleado = "folio" in consulta ? consulta.folio : null;
  // Solo el número: se entiende como folio de salida.
  const folio = tecleado !== null && /^\d+$/.test(tecleado) ? `S-${tecleado}` : tecleado;
  const [s] = await db.$queryRaw<{ id: string; folio: string | null; estatus: string; esPrestamo: boolean; estacionId: string; estacion: string; bodegaId: string; bodega: string; revertida: boolean }[]>`
    SELECT m.id, m.folio, m.estatus::text AS estatus, m."esPrestamo",
           s.id AS "estacionId", s.numero || ' · ' || s.alias AS estacion, b.id AS "bodegaId", b.clave || ' · ' || b.nombre AS bodega,
           EXISTS (SELECT 1 FROM "Movimiento" r WHERE r."cancelaAId" = m.id) AS revertida
    FROM "Movimiento" m
    JOIN catalogo_gasosur."Estacion" s ON s.id = m."estacionId"
    JOIN "Bodega" b ON b.id = m."bodegaOrigenId"
    WHERE m.tipo = 'SALIDA' AND (m.id = ${id}::uuid OR clave_normalizada(m.folio) = clave_normalizada(${folio}))
    LIMIT 1`;
  if (!s) return { motivo: tecleado === null ? "La salida del enlace no existe." : `No hay una salida con el folio ${tecleado}.` };
  if (s.estatus !== "RETIRADA" && s.estatus !== "RECIBIDA") return { motivo: "Solo se devuelve material de una salida ya retirada o recibida." };
  if (s.revertida) return { motivo: `La salida ${s.folio} fue revertida: ya no admite devoluciones.` };
  const pendientes = Object.fromEntries((await saldoDeSalida(db, s.id)).filter((a) => a.pendiente > 0).map((a) => [a.articuloId, a.pendiente]));
  const salida: SalidaDevolvible = {
    id: s.id,
    folio: s.folio!,
    esPrestamo: s.esPrestamo,
    estacion: { id: s.estacionId, nombre: s.estacion },
    bodega: { id: s.bodegaId, nombre: s.bodega },
    pendientes,
  };
  return Object.keys(pendientes).length ? { salida } : { motivo: `De la salida ${s.folio} ya volvió todo lo que salió.` };
}

/**
 * Las salidas que una devolución puede vincular —retiradas o recibidas, sin
 * reversa y con algo pendiente—, la más reciente arriba, una página a la vez.
 * El texto busca en folio y número de estación como clave, y en alias de
 * estación y bodega sin acentos.
 */
export async function listarSalidasDevolvibles(db: Db, filtro: { estacionId: string | null; texto: string }, pedida = 1): Promise<{ filas: SalidaDevolvible[]; pagina: Pagina }> {
  const q = filtro.texto.trim();
  const { filas, pagina } = await paginaDe<SalidaDevolvible>(
    db,
    sql`
      SELECT m.id, m.folio, m."esPrestamo", m."entregadoEn",
             jsonb_build_object('id', s.id, 'nombre', s.numero || ' · ' || s.alias) AS estacion,
             jsonb_build_object('id', b.id, 'nombre', b.clave || ' · ' || b.nombre) AS bodega,
             jsonb_object_agg(p."articuloId", p.cantidad - x.devuelto) FILTER (WHERE p.cantidad > x.devuelto) AS pendientes
      FROM "Movimiento" m
      JOIN "MovimientoPartida" p ON p."movimientoId" = m.id
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(c."cantidadInicial"), 0)::int AS devuelto FROM "CapaCosto" c JOIN "Movimiento" d ON d.id = c."movimientoId"
        WHERE d."devuelveAId" = m.id AND c."articuloId" = p."articuloId" AND devolucion_vigente(d.id)) x
      JOIN catalogo_gasosur."Estacion" s ON s.id = m."estacionId"
      JOIN "Bodega" b ON b.id = m."bodegaOrigenId"
      WHERE m.tipo = 'SALIDA' AND m.estatus IN ('RETIRADA','RECIBIDA')
        AND NOT EXISTS (SELECT 1 FROM "Movimiento" r WHERE r."cancelaAId" = m.id)
        AND (${filtro.estacionId}::uuid IS NULL OR m."estacionId" = ${filtro.estacionId}::uuid)
        AND (${q} = ''
          OR (clave_normalizada(${q}) <> '' AND (position(clave_normalizada(${q}) IN clave_normalizada(m.folio)) > 0
                                              OR position(clave_normalizada(${q}) IN clave_normalizada(s.numero)) > 0))
          OR position(texto_buscable(${q}) IN texto_buscable(s.alias)) > 0
          OR position(texto_buscable(${q}) IN texto_buscable(b.nombre)) > 0)
      GROUP BY m.id, s.id, b.id
      HAVING bool_or(p.cantidad > x.devuelto)`,
    sql`"entregadoEn" DESC, id DESC`,
    pedida,
  );
  // Solo lo que el selector necesita: la fila trae además la fecha de orden y el total.
  return { filas: filas.map((s) => ({ id: s.id, folio: s.folio, esPrestamo: s.esPrestamo, estacion: s.estacion, bodega: s.bodega, pendientes: s.pendientes })), pagina };
}

// ──────────────────────────────── Préstamos ──────────────────────────────────

export type EstadoPrestamo = "abiertos" | "cerrados" | "todos";

export type Prestamo = {
  id: string;
  folio: string;
  fecha: Date;
  estacion: string;
  bodega: string;
  retirado: number;
  devuelto: number;
  pendiente: number;
};

/**
 * Salidas marcadas como préstamo, retiradas o recibidas y sin reversa, con
 * lo retirado, lo devuelto en devoluciones vigentes y lo que falta. Abierto
 * mientras falte cualquier pieza de cualquier artículo. El más antiguo
 * primero: es el que lleva más tiempo fuera.
 */
export async function listarPrestamos(db: Db, estado: EstadoPrestamo, pedida = 1): Promise<{ filas: Prestamo[]; pagina: Pagina }> {
  return paginaDe<Prestamo>(
    db,
    sql`
      SELECT m.id, m.folio, m.fecha, m."entregadoEn", s.alias AS estacion, b.nombre AS bodega,
             sum(p.cantidad)::int AS retirado, sum(x.devuelto)::int AS devuelto, sum(p.cantidad - x.devuelto)::int AS pendiente
      FROM "Movimiento" m
      JOIN "MovimientoPartida" p ON p."movimientoId" = m.id
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(c."cantidadInicial"), 0) AS devuelto FROM "CapaCosto" c JOIN "Movimiento" d ON d.id = c."movimientoId"
        WHERE d."devuelveAId" = m.id AND c."articuloId" = p."articuloId" AND devolucion_vigente(d.id)) x
      JOIN catalogo_gasosur."Estacion" s ON s.id = m."estacionId"
      JOIN "Bodega" b ON b.id = m."bodegaOrigenId"
      WHERE m.tipo = 'SALIDA' AND m."esPrestamo" AND m.estatus IN ('RETIRADA','RECIBIDA')
        AND NOT EXISTS (SELECT 1 FROM "Movimiento" r WHERE r."cancelaAId" = m.id)
      GROUP BY m.id, s.alias, b.nombre
      HAVING ${estado} = 'todos' OR (${estado} = 'abiertos') = bool_or(p.cantidad > x.devuelto)`,
    sql`"entregadoEn", id`,
    pedida,
  );
}

export type EstadoDevolucion = "completa" | "parcial";

/**
 * Cuánto volvió de cada salida en devoluciones vigentes: completa si volvió
 * todo lo retirado, parcial si algo. Las que no tienen devolución no aparecen.
 * Basta comparar totales: cada artículo ya está topado por su partida.
 */
export async function devolucionDeSalidas(db: Db, ids: readonly string[]): Promise<Record<string, EstadoDevolucion>> {
  if (ids.length === 0) return {};
  const filas = await db.$queryRaw<{ id: string; completa: boolean }[]>`
    SELECT d."devuelveAId" AS id,
           sum(c."cantidadInicial") >= (SELECT sum(p.cantidad) FROM "MovimientoPartida" p WHERE p."movimientoId" = d."devuelveAId") AS completa
    FROM "Movimiento" d JOIN "CapaCosto" c ON c."movimientoId" = d.id
    WHERE d.tipo = 'DEVOLUCION' AND d."devuelveAId" = ANY(${[...ids]}::uuid[]) AND devolucion_vigente(d.id)
    GROUP BY d."devuelveAId"`;
  return Object.fromEntries(filas.map((f) => [f.id, f.completa ? "completa" : "parcial"]));
}

/** Devoluciones de una salida, vigentes o no, para su detalle. */
export async function devolucionesDe(db: Db, salidaId: string) {
  return db.movimiento.findMany({
    where: { tipo: "DEVOLUCION", devuelveAId: salidaId, estatus: { not: "CANCELADO" } },
    select: { id: true, folio: true, estatus: true, fecha: true, canceladoPor: { select: { id: true, folio: true } } },
    orderBy: { createdAt: "asc" },
  });
}

// ─────────────────────────────── Hojas de conteo ─────────────────────────────

const RESUMEN_HOJA = {
  id: true,
  estatus: true,
  motivo: true,
  createdAt: true,
  confirmadoEn: true,
  revision: true,
  bodega: { select: { clave: true, nombre: true } },
  creadoPor: { select: { correo: true } },
  _count: { select: { renglones: true, ajustes: true } },
} satisfies Prisma.HojaConteoSelect;

export type HojaResumen = Prisma.HojaConteoGetPayload<{ select: typeof RESUMEN_HOJA }>;

/** La más reciente arriba. Las fechas son días de México sobre el instante en que se abrió. */
export async function listarHojas(db: Db, filtro: { estatus: EstatusConteo | "todos"; desde?: string; hasta?: string }, pedida = 1) {
  const where: Prisma.HojaConteoWhereInput = {
    estatus: filtro.estatus === "todos" ? undefined : filtro.estatus,
    createdAt:
      filtro.desde || filtro.hasta
        ? {
            gte: filtro.desde ? inicioDelDiaEnMexico(filtro.desde) : undefined,
            lt: filtro.hasta ? inicioDelDiaEnMexico(diaSiguiente(filtro.hasta)) : undefined,
          }
        : undefined,
  };
  const pagina = acotarPagina(pedida, await db.hojaConteo.count({ where }));
  const filas = await db.hojaConteo.findMany({
    where,
    select: RESUMEN_HOJA,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: saltoDe(pagina),
    take: POR_PAGINA,
  });
  return { filas, pagina };
}

const DETALLE_HOJA = {
  ...RESUMEN_HOJA,
  bodegaId: true,
  observaciones: true,
  motivoCancelacion: true,
  canceladoEn: true,
  updatedAt: true,
  bodega: { select: { clave: true, nombre: true, activa: true } },
  confirmadoPor: { select: { correo: true } },
  canceladoPor: { select: { correo: true } },
  renglones: {
    select: {
      articuloId: true,
      orden: true,
      cantidadEsperada: true,
      cantidadContada: true,
      observaciones: true,
      articulo: { select: { clave: true, descripcion: true, activo: true, unidad: { select: { clave: true } } } },
    },
    orderBy: { orden: "asc" },
  },
  ajustes: {
    select: { id: true, folio: true, bodegaOrigenId: true, bodegaDestinoId: true, _count: { select: { partidas: true } }, canceladoPor: { select: REFERENCIA } },
    orderBy: { folio: "asc" },
  },
} satisfies Prisma.HojaConteoSelect;

export type HojaDetalle = Prisma.HojaConteoGetPayload<{ select: typeof DETALLE_HOJA }>;

export async function obtenerHoja(db: Db, id: string): Promise<HojaDetalle | null> {
  return db.hojaConteo.findUnique({ where: { id }, select: DETALLE_HOJA });
}
