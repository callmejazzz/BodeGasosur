import "server-only";
import { Prisma } from "@prisma/client";
import { paginaDe } from "@/lib/movimientos/lista";
import { POR_PAGINA } from "@/lib/paginacion";
import type { FiltrosFrecuencia } from "./filtros";
import { coincideArticulo, todas } from "./hechos";

/*
  Frecuencia de consumo (contrato §3.5): cuántas salidas retiradas llevaron
  cada artículo. Cuenta partidas, no capas; una salida revertida deja de
  contar y una devolución no resta retiros. Los préstamos cuentan como retiro
  y se separan en su columna.
*/

type Db = Prisma.TransactionClient;
const sql = Prisma.sql;

export type FilaFrecuencia = {
  id: string;
  articuloId: string;
  claveArticulo: string;
  descripcion: string;
  unidad: string;
  articuloActivo: boolean;
  retiros: number;
  prestamos: number;
  unidades: number;
  ultimo: Date;
};

const consulta = (f: FiltrosFrecuencia) => sql`
  SELECT a.id::text AS id, a.id AS "articuloId", a.clave AS "claveArticulo", a.descripcion, u.clave AS unidad, a.activo AS "articuloActivo",
         count(*)::int AS retiros, count(*) FILTER (WHERE m."esPrestamo")::int AS prestamos,
         sum(p.cantidad)::int AS unidades, max(m.fecha) AS ultimo
  FROM "MovimientoPartida" p
  JOIN "Movimiento" m ON m.id = p."movimientoId"
  JOIN "Articulo" a ON a.id = p."articuloId"
  JOIN "UnidadMedida" u ON u.id = a."unidadId"
  WHERE m.tipo = 'SALIDA' AND m.estatus IN ('RETIRADA', 'RECIBIDA')
    AND NOT EXISTS (SELECT 1 FROM "Movimiento" r WHERE r."cancelaAId" = m.id)
    AND ${todas([
      sql`m.fecha BETWEEN ${f.desde}::date AND ${f.hasta}::date`,
      f.estacionId ? sql`m."estacionId" = ${f.estacionId}::uuid` : null,
      f.bodegaId ? sql`m."bodegaOrigenId" = ${f.bodegaId}::uuid` : null,
      coincideArticulo(f.busqueda),
    ])}
  GROUP BY a.id, a.clave, a.descripcion, u.clave, a.activo`;

export function filasFrecuencia(db: Db, f: FiltrosFrecuencia, pedida = 1, tamano = POR_PAGINA) {
  return paginaDe<FilaFrecuencia>(db, consulta(f), sql`retiros DESC, "claveArticulo", id`, pedida, tamano);
}
