import "server-only";
import { Prisma } from "@prisma/client";
import { paginaDe } from "@/lib/movimientos/lista";
import { POR_PAGINA } from "@/lib/paginacion";
import type { FiltrosExistencias } from "./filtros";
import { coincideArticulo, todas } from "./hechos";

/*
  Existencias por bodega y mínimo (contrato §3.2): una consulta actual, no
  histórica. La cantidad es Existencia; el valor, lo que queda de cada capa.
  El mínimo del artículo se compara en cada bodega. Lo inactivo con
  existencia sigue visible, sin indicador.
*/

type Db = Prisma.TransactionClient;
const sql = Prisma.sql;

export type FilaExistencia = {
  id: string;
  bodegaId: string;
  bodega: string;
  bodegaActiva: boolean;
  articuloId: string;
  claveArticulo: string;
  descripcion: string;
  unidad: string;
  articuloActivo: boolean;
  existencia: number;
  minimo: number;
  diferencia: number;
  bajoMinimo: boolean;
  importe: string | null;
  importeConIva: string | null;
  sinCosto: number;
};

export type TotalExistencias = { importe: string | null; importeConIva: string | null; filas: number; bajoMinimo: number; filasSinCosto: number };

function base(f: FiltrosExistencias) {
  // Sin existencia, un artículo aparece si está bajo su mínimo o si se le buscó.
  const visible = f.busqueda
    ? sql`(existencia <> 0 OR "bajoMinimo" OR ("articuloActivo" AND "bodegaActiva"))`
    : sql`(existencia <> 0 OR "bajoMinimo")`;
  return sql`
    WITH valor AS (
      SELECT "bodegaId", "articuloId",
             sum(importe_renglon("cantidadRestante", "costoUnitario")) AS importe,
             sum(importe_renglon("cantidadRestante", "costoUnitarioConIva")) AS "importeConIva",
             coalesce(sum("cantidadRestante") FILTER (WHERE "costoUnitario" IS NULL), 0)::int AS "sinCosto"
      FROM "CapaCosto" WHERE "cantidadRestante" > 0 GROUP BY "bodegaId", "articuloId"
    ),
    cruce AS (
      SELECT b.id::text || ':' || a.id::text AS id, b.id AS "bodegaId", b.clave AS "claveBodega", b.clave || ' · ' || b.nombre AS bodega, b.activa AS "bodegaActiva",
             a.id AS "articuloId", a.clave AS "claveArticulo", a.descripcion, u.clave AS unidad, a.activo AS "articuloActivo",
             coalesce(e.cantidad, 0) AS existencia, a."stockMinimo" AS minimo, coalesce(e.cantidad, 0) - a."stockMinimo" AS diferencia,
             (a.activo AND b.activa AND coalesce(e.cantidad, 0) < a."stockMinimo") AS "bajoMinimo",
             v.importe, v."importeConIva", coalesce(v."sinCosto", 0) AS "sinCosto"
      FROM "Bodega" b
      CROSS JOIN "Articulo" a
      JOIN "UnidadMedida" u ON u.id = a."unidadId"
      LEFT JOIN "Existencia" e ON e."bodegaId" = b.id AND e."articuloId" = a.id
      LEFT JOIN valor v ON v."bodegaId" = b.id AND v."articuloId" = a.id
      WHERE ${todas([f.bodegaId ? sql`b.id = ${f.bodegaId}::uuid` : null, coincideArticulo(f.busqueda)])}
    ),
    filas AS (SELECT * FROM cruce WHERE ${visible} ${f.bajoMinimo ? sql`AND "bajoMinimo"` : Prisma.empty})`;
}

const consultaFilas = (f: FiltrosExistencias) => sql`${base(f)}
  SELECT id, "bodegaId", "claveBodega", bodega, "bodegaActiva", "articuloId", "claveArticulo", descripcion, unidad, "articuloActivo",
         existencia, minimo, diferencia, "bajoMinimo", importe::text AS importe, "importeConIva"::text AS "importeConIva", "sinCosto"
  FROM filas`;
const ORDEN = sql`"bajoMinimo" DESC, "claveBodega", "claveArticulo", id`;

export function filasExistencias(db: Db, f: FiltrosExistencias, pedida = 1, tamano = POR_PAGINA) {
  return paginaDe<FilaExistencia>(db, consultaFilas(f), ORDEN, pedida, tamano);
}

export async function totalExistencias(db: Db, f: FiltrosExistencias): Promise<TotalExistencias> {
  const [t] = await db.$queryRaw<TotalExistencias[]>`${base(f)}
    SELECT sum(importe)::text AS importe, sum("importeConIva")::text AS "importeConIva", count(*)::int AS filas,
           count(*) FILTER (WHERE "bajoMinimo")::int AS "bajoMinimo", count(*) FILTER (WHERE "sinCosto" > 0)::int AS "filasSinCosto"
    FROM filas`;
  return t;
}
