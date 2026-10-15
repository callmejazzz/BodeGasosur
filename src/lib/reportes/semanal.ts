import "server-only";
import { Prisma } from "@prisma/client";
import { paginaDe } from "@/lib/movimientos/lista";
import { POR_PAGINA } from "@/lib/paginacion";
import { coincideArticulo, HECHOS, todas } from "./hechos";

/*
  Reporte semanal (contrato §3.1): por artículo y bodega, del saldo al inicio
  del sábado al saldo al cierre del viernes, con cada alta y baja de la semana
  en su columna. El valor final es lo que quedaba de cada capa al corte,
  redondeado por capa.
*/

type Db = Prisma.TransactionClient;
const sql = Prisma.sql;

export type ConsultaSemanal = { inicio: string; corte: string; bodegaId: string; busqueda: string };

export type Movimientos = {
  inicial: number;
  compras: number;
  salidas: number;
  recibidos: number;
  enviados: number;
  devoluciones: number;
  ajustesMas: number;
  ajustesMenos: number;
  reversasMas: number;
  reversasMenos: number;
  final: number;
  importe: string | null;
  importeConIva: string | null;
  sinCosto: number;
};

type Articulo = { articuloId: string; claveArticulo: string; descripcion: string; unidad: string; articuloActivo: boolean };

export type FilaSemanal = Movimientos & Articulo & { id: string; bodegaId: string; claveBodega: string; bodega: string; bodegaActiva: boolean };
export type TotalArticulo = Movimientos & Articulo & { id: string };
export type TotalSemanal = { importe: string | null; importeConIva: string | null; filas: number; filasSinCosto: number };

const CANTIDADES = ["inicial", "compras", "salidas", "recibidos", "enviados", "devoluciones", "ajustesMas", "ajustesMenos", "reversasMas", "reversasMenos", "final", "sinCosto"] as const;

/** Las filas con sus importes en numeric; cada salida las agrega o pagina a su modo. */
function base(c: ConsultaSemanal) {
  const enSemana = sql`fecha >= ${c.inicio}::date`;
  const columna = (nombre: string, condicion: Prisma.Sql, signo: 1 | -1) =>
    sql`coalesce(${Prisma.raw(signo < 0 ? "-" : "")}sum(cantidad) FILTER (WHERE ${enSemana} AND ${condicion}), 0)::int AS ${Prisma.raw(`"${nombre}"`)}`;
  const ordinario = (tipo: string, alta: boolean) => sql`NOT reversa AND tipo = ${tipo} AND cantidad ${Prisma.raw(alta ? ">" : "<")} 0`;
  return sql`
    WITH h AS (
      SELECT h.* FROM (${HECHOS}) h JOIN "Articulo" a ON a.id = h."articuloId"
      WHERE ${todas([sql`h.fecha <= ${c.corte}::date`, c.bodegaId ? sql`h."bodegaId" = ${c.bodegaId}::uuid` : null, coincideArticulo(c.busqueda)])}
    ),
    cuentas AS (
      SELECT "bodegaId", "articuloId",
             coalesce(sum(cantidad) FILTER (WHERE fecha < ${c.inicio}::date), 0)::int AS inicial,
             ${columna("compras", ordinario("ENTRADA", true), 1)},
             ${columna("salidas", ordinario("SALIDA", false), -1)},
             ${columna("recibidos", ordinario("TRASPASO", true), 1)},
             ${columna("enviados", ordinario("TRASPASO", false), -1)},
             ${columna("devoluciones", ordinario("DEVOLUCION", true), 1)},
             ${columna("ajustesMas", ordinario("AJUSTE", true), 1)},
             ${columna("ajustesMenos", ordinario("AJUSTE", false), -1)},
             ${columna("reversasMas", sql`reversa AND cantidad > 0`, 1)},
             ${columna("reversasMenos", sql`reversa AND cantidad < 0`, -1)},
             count(*) FILTER (WHERE ${enSemana}) AS hechos,
             sum(cantidad)::int AS final
      FROM h GROUP BY "bodegaId", "articuloId"
    ),
    restos AS (
      SELECT "bodegaId", "articuloId", "costoCapa", "costoCapaConIva", sum(cantidad)::int AS resto
      FROM h GROUP BY "capaId", "bodegaId", "articuloId", "costoCapa", "costoCapaConIva"
    ),
    valor AS (
      SELECT "bodegaId", "articuloId",
             sum(importe_renglon(resto, "costoCapa")) AS importe,
             sum(importe_renglon(resto, "costoCapaConIva")) AS "importeConIva",
             coalesce(sum(resto) FILTER (WHERE "costoCapa" IS NULL), 0)::int AS "sinCosto"
      FROM restos WHERE resto <> 0 GROUP BY "bodegaId", "articuloId"
    ),
    filas AS (
      SELECT c."bodegaId"::text || ':' || c."articuloId"::text AS id, c."bodegaId", b.clave AS "claveBodega", b.clave || ' · ' || b.nombre AS bodega, b.activa AS "bodegaActiva",
             c."articuloId", a.clave AS "claveArticulo", a.descripcion, u.clave AS unidad, a.activo AS "articuloActivo",
             c.inicial, c.compras, c.salidas, c.recibidos, c.enviados, c.devoluciones, c."ajustesMas", c."ajustesMenos", c."reversasMas", c."reversasMenos", c.final,
             -- Sin piezas el valor es cero, no desconocido.
             coalesce(v.importe, CASE WHEN c.final = 0 THEN 0.00 END) AS importe,
             coalesce(v."importeConIva", CASE WHEN c.final = 0 THEN 0.00 END) AS "importeConIva",
             coalesce(v."sinCosto", 0) AS "sinCosto"
      FROM cuentas c
      JOIN "Bodega" b ON b.id = c."bodegaId"
      JOIN "Articulo" a ON a.id = c."articuloId"
      JOIN "UnidadMedida" u ON u.id = a."unidadId"
      LEFT JOIN valor v ON v."bodegaId" = c."bodegaId" AND v."articuloId" = c."articuloId"
      WHERE c.hechos > 0 OR c.inicial <> 0 OR c.final <> 0
    )`;
}

const consultaFilas = (c: ConsultaSemanal) => sql`${base(c)}
  SELECT id, "bodegaId", "claveBodega", bodega, "bodegaActiva", "articuloId", "claveArticulo", descripcion, unidad, "articuloActivo",
         ${Prisma.join(CANTIDADES.map((k) => Prisma.raw(`"${k}"`)))}, importe::text AS importe, "importeConIva"::text AS "importeConIva"
  FROM filas`;
const ORDEN_FILAS = sql`"claveBodega", "claveArticulo", id`;

const consultaArticulos = (c: ConsultaSemanal) => sql`${base(c)}
  SELECT "articuloId"::text AS id, "articuloId", "claveArticulo", descripcion, unidad, "articuloActivo",
         ${Prisma.join(CANTIDADES.map((k) => sql`sum(${Prisma.raw(`"${k}"`)})::int AS ${Prisma.raw(`"${k}"`)}`))},
         sum(importe)::text AS importe, sum("importeConIva")::text AS "importeConIva"
  FROM filas GROUP BY "articuloId", "claveArticulo", descripcion, unidad, "articuloActivo"`;
const ORDEN_ARTICULOS = sql`"claveArticulo", id`;

export function filasSemanal(db: Db, c: ConsultaSemanal, pedida = 1, tamano = POR_PAGINA) {
  return paginaDe<FilaSemanal>(db, consultaFilas(c), ORDEN_FILAS, pedida, tamano);
}

/** Cantidades por artículo y su unidad, sumando bodegas: nunca piezas de artículos distintos. */
export function totalesPorArticulo(db: Db, c: ConsultaSemanal, pedida = 1, tamano = POR_PAGINA) {
  return paginaDe<TotalArticulo>(db, consultaArticulos(c), ORDEN_ARTICULOS, pedida, tamano);
}

/** El valor conocido total y cuántas filas tienen piezas sin costo, que no entran en él. */
export async function totalSemanal(db: Db, c: ConsultaSemanal): Promise<TotalSemanal> {
  const [t] = await db.$queryRaw<TotalSemanal[]>`${base(c)}
    SELECT sum(importe)::text AS importe, sum("importeConIva")::text AS "importeConIva",
           count(*)::int AS filas, count(*) FILTER (WHERE "sinCosto" > 0)::int AS "filasSinCosto"
    FROM filas`;
  return t;
}
