import "server-only";
import { Prisma } from "@prisma/client";
import { paginaDe } from "@/lib/movimientos/lista";
import { POR_PAGINA } from "@/lib/paginacion";
import type { FiltrosGasto } from "./filtros";
import { importeConSigno, todas } from "./hechos";

/*
  Gasto acumulado por estación (contrato §3.4): consumo neto de salidas que no
  son préstamo. Suman los consumos del retiro; restan las devoluciones
  vinculadas, con el costo de sus capas; la reversa de cualquiera de los dos
  compensa en su propia fecha. Una devolución sin salida no se atribuye.
*/

type Db = Prisma.TransactionClient;
const sql = Prisma.sql;

export type FilaGastoDetalle = {
  id: string;
  numeroEstacion: string;
  alias: string;
  estacionActiva: boolean;
  articuloId: string;
  claveArticulo: string;
  descripcion: string;
  unidad: string;
  articuloActivo: boolean;
  retirado: number;
  devuelto: number;
  neto: number;
  importe: string | null;
  importeConIva: string | null;
  sinCosto: number;
};

export type FilaGastoEstacion = {
  id: string;
  numeroEstacion: string;
  alias: string;
  estacionActiva: boolean;
  articulos: number;
  importe: string | null;
  importeConIva: string | null;
  articulosSinCosto: number;
};

export type TotalGasto = { importe: string | null; importeConIva: string | null; conPiezasSinCosto: boolean };

/** Cada hecho del periodo con su estación, artículo y efecto: `retirado` y `devuelto` netos de reversas. */
function hechos(f: FiltrosGasto) {
  const filtro = todas([
    sql`g.fecha BETWEEN ${f.desde}::date AND ${f.hasta}::date`,
    f.estacionId ? sql`g."estacionId" = ${f.estacionId}::uuid` : null,
    f.articuloId ? sql`g."articuloId" = ${f.articuloId}::uuid` : null,
  ]);
  return sql`
    SELECT g.* FROM (
      SELECT s."estacionId", p."articuloId", s.fecha, k.cantidad AS retirado, 0 AS devuelto, k."costoUnitario" AS costo, k."costoUnitarioConIva" AS "costoConIva"
      FROM "ConsumoCapa" k JOIN "MovimientoPartida" p ON p.id = k."partidaId" JOIN "Movimiento" s ON s.id = p."movimientoId"
      WHERE s.tipo = 'SALIDA' AND s.estatus IN ('RETIRADA', 'RECIBIDA') AND NOT s."esPrestamo"
      UNION ALL
      SELECT s."estacionId", p."articuloId", r.fecha, -x.cantidad, 0, x."costoUnitario", x."costoUnitarioConIva"
      FROM "RestitucionCapa" x JOIN "MovimientoPartida" p ON p.id = x."partidaId" JOIN "Movimiento" r ON r.id = p."movimientoId"
      JOIN "Movimiento" s ON s.id = r."cancelaAId"
      WHERE r.estatus = 'CONFIRMADO' AND s.tipo = 'SALIDA' AND NOT s."esPrestamo"
      UNION ALL
      SELECT s."estacionId", c."articuloId", d.fecha, 0, c."cantidadInicial", c."costoUnitario", c."costoUnitarioConIva"
      FROM "CapaCosto" c JOIN "Movimiento" d ON d.id = c."movimientoId" JOIN "Movimiento" s ON s.id = d."devuelveAId"
      WHERE d.tipo = 'DEVOLUCION' AND d.estatus = 'CONFIRMADO' AND NOT s."esPrestamo"
      UNION ALL
      SELECT s."estacionId", p."articuloId", r.fecha, 0, -k.cantidad, k."costoUnitario", k."costoUnitarioConIva"
      FROM "ConsumoCapa" k JOIN "MovimientoPartida" p ON p.id = k."partidaId" JOIN "Movimiento" r ON r.id = p."movimientoId"
      JOIN "Movimiento" d ON d.id = r."cancelaAId" JOIN "Movimiento" s ON s.id = d."devuelveAId"
      WHERE r.estatus = 'CONFIRMADO' AND d.tipo = 'DEVOLUCION' AND NOT s."esPrestamo"
    ) g
    WHERE ${filtro}`;
}

function detalle(f: FiltrosGasto) {
  return sql`
    WITH g AS (SELECT *, retirado - devuelto AS neto FROM (${hechos(f)}) h)
    SELECT "estacionId", "articuloId",
           sum(retirado)::int AS retirado, sum(devuelto)::int AS devuelto, sum(neto)::int AS neto,
           -- Lo que se compensó del todo vale cero aunque su costo no se conozca.
           coalesce(sum(${importeConSigno(sql`neto`, sql`costo`)}), CASE WHEN sum(neto) = 0 THEN 0.00 END) AS importe,
           coalesce(sum(${importeConSigno(sql`neto`, sql`"costoConIva"`)}), CASE WHEN sum(neto) = 0 THEN 0.00 END) AS "importeConIva",
           coalesce(sum(neto) FILTER (WHERE costo IS NULL), 0)::int AS "sinCosto"
    FROM g GROUP BY "estacionId", "articuloId"`;
}

const consultaDetalle = (f: FiltrosGasto) => sql`
  SELECT d."estacionId"::text || ':' || d."articuloId"::text AS id, s.numero AS "numeroEstacion", s.alias, s.activa AS "estacionActiva",
         a.id AS "articuloId", a.clave AS "claveArticulo", a.descripcion, u.clave AS unidad, a.activo AS "articuloActivo",
         d.retirado, d.devuelto, d.neto, d.importe::text AS importe, d."importeConIva"::text AS "importeConIva", d."sinCosto"
  FROM (${detalle(f)}) d
  JOIN catalogo_gasosur."Estacion" s ON s.id = d."estacionId"
  JOIN "Articulo" a ON a.id = d."articuloId"
  JOIN "UnidadMedida" u ON u.id = a."unidadId"`;

const consultaEstaciones = (f: FiltrosGasto) => sql`
  SELECT d."estacionId"::text AS id, s.numero AS "numeroEstacion", s.alias, s.activa AS "estacionActiva",
         count(*)::int AS articulos, sum(d.importe)::text AS importe, sum(d."importeConIva")::text AS "importeConIva",
         count(*) FILTER (WHERE d."sinCosto" <> 0)::int AS "articulosSinCosto"
  FROM (${detalle(f)}) d
  JOIN catalogo_gasosur."Estacion" s ON s.id = d."estacionId"
  GROUP BY d."estacionId", s.numero, s.alias, s.activa`;

/** Por estación y artículo: las cantidades en la unidad de cada artículo. */
export function gastoPorArticulo(db: Db, f: FiltrosGasto, pedida = 1, tamano = POR_PAGINA) {
  return paginaDe<FilaGastoDetalle>(db, consultaDetalle(f), sql`"numeroEstacion", "claveArticulo", id`, pedida, tamano);
}

/** Por estación: suma importes, no cantidades de artículos distintos. */
export function gastoPorEstacion(db: Db, f: FiltrosGasto, pedida = 1, tamano = POR_PAGINA) {
  return paginaDe<FilaGastoEstacion>(db, consultaEstaciones(f), sql`"numeroEstacion", id`, pedida, tamano);
}

export async function totalGasto(db: Db, f: FiltrosGasto): Promise<TotalGasto> {
  const [t] = await db.$queryRaw<TotalGasto[]>`
    SELECT sum(importe)::text AS importe, sum("importeConIva")::text AS "importeConIva", bool_or("sinCosto" <> 0) IS TRUE AS "conPiezasSinCosto"
    FROM (${detalle(f)}) d`;
  return t;
}
