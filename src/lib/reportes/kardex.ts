import "server-only";
import { Prisma, type TipoMovimiento } from "@prisma/client";
import { paginaDe } from "@/lib/movimientos/lista";
import { POR_PAGINA } from "@/lib/paginacion";
import type { FiltrosKardex } from "./filtros";
import { HECHOS, importeConSigno, todas } from "./hechos";

/*
  Kardex de un artículo (contrato §3.3): el efecto de cada partida en cada
  bodega, con el saldo corrido de esa bodega. Un traspaso son dos filas. El
  saldo arranca con los hechos anteriores al rango, que no se muestran, y el
  orden fecha → confirmación → movimiento → partida lo hace reproducible.
*/

type Db = Prisma.TransactionClient;
const sql = Prisma.sql;

export type ArticuloDeKardex = { id: string; clave: string; descripcion: string; unidad: string; activo: boolean };

export type FilaKardex = {
  id: string;
  fecha: Date;
  movimientoId: string;
  tipoMovimiento: TipoMovimiento;
  folio: string | null;
  tipo: string;
  originalId: string | null;
  originalTipo: TipoMovimiento | null;
  bodega: string;
  contraparte: string | null;
  referencia: string | null;
  entra: number;
  sale: number;
  saldo: number;
  importe: string | null;
  importeConIva: string | null;
  sinCosto: number;
};

export type ResumenBodega = { id: string; bodega: string; bodegaActiva: boolean; inicial: number; entradas: number; salidas: number; final: number };

export async function articuloDeKardex(db: Db, id: string): Promise<ArticuloDeKardex | null> {
  if (!id) return null;
  const a = await db.articulo.findUnique({ where: { id }, select: { id: true, clave: true, descripcion: true, activo: true, unidad: { select: { clave: true } } } });
  return a && { id: a.id, clave: a.clave, descripcion: a.descripcion, unidad: a.unidad.clave, activo: a.activo };
}

const hechos = (f: FiltrosKardex) => sql`
  SELECT h.* FROM (${HECHOS}) h
  WHERE ${todas([sql`h."articuloId" = ${f.articuloId}::uuid`, sql`h.fecha <= ${f.hasta}::date`, f.bodegaId ? sql`h."bodegaId" = ${f.bodegaId}::uuid` : null])}`;

function consultaFilas(f: FiltrosKardex) {
  return sql`
    WITH partidas AS (
      SELECT "movimientoId", "partidaId", "bodegaId", fecha,
             coalesce(sum(cantidad) FILTER (WHERE cantidad > 0), 0)::int AS entra,
             coalesce(-sum(cantidad) FILTER (WHERE cantidad < 0), 0)::int AS sale,
             sum(${importeConSigno(sql`cantidad`, sql`costo`)}) AS importe,
             sum(${importeConSigno(sql`cantidad`, sql`"costoConIva"`)}) AS "importeConIva",
             coalesce(sum(abs(cantidad)) FILTER (WHERE costo IS NULL), 0)::int AS "sinCosto"
      FROM (${hechos(f)}) h
      GROUP BY "movimientoId", "partidaId", "bodegaId", fecha
    ),
    corridas AS (
      SELECT x.*,
             sum(x.entra - x.sale) OVER (
               PARTITION BY x."bodegaId"
               ORDER BY x.fecha, coalesce(m."confirmadoEn", m."entregadoEn"), x."movimientoId", x."partidaId"
               ROWS UNBOUNDED PRECEDING)::int AS saldo
      FROM partidas x JOIN "Movimiento" m ON m.id = x."movimientoId"
    )
    SELECT coalesce(x."partidaId", x."movimientoId")::text || ':' || x."bodegaId"::text AS id,
           x.fecha, coalesce(m."confirmadoEn", m."entregadoEn") AS instante, x."movimientoId", x."partidaId",
           m.tipo AS "tipoMovimiento", m.folio, o.id AS "originalId", o.tipo AS "originalTipo",
           CASE WHEN o.id IS NOT NULL THEN 'Reversa de ' || coalesce(o.folio, 'un movimiento')
                WHEN m.tipo = 'ENTRADA' THEN 'Entrada'
                WHEN m.tipo = 'SALIDA' THEN CASE WHEN m."esPrestamo" THEN 'Salida (préstamo)' ELSE 'Salida' END
                WHEN m.tipo = 'TRASPASO' THEN 'Traspaso'
                WHEN m.tipo = 'DEVOLUCION' THEN 'Devolución'
                WHEN m."conteoId" IS NOT NULL THEN 'Ajuste por conteo'
                ELSE 'Ajuste' END AS tipo,
           b.clave || ' · ' || b.nombre AS bodega,
           CASE m.tipo
             WHEN 'ENTRADA' THEN pr."nombreComercial"
             WHEN 'SALIDA' THEN s.numero || ' · ' || s.alias
             WHEN 'DEVOLUCION' THEN s.numero || ' · ' || s.alias
             WHEN 'TRASPASO' THEN CASE WHEN x."bodegaId" = m."bodegaDestinoId" THEN 'De ' || bo.clave || ' · ' || bo.nombre
                                       ELSE 'A ' || bd.clave || ' · ' || bd.nombre END
           END AS contraparte,
           CASE m.tipo
             WHEN 'ENTRADA' THEN m.referencia
             WHEN 'SALIDA' THEN ar.nombre
             WHEN 'DEVOLUCION' THEN CASE WHEN dv.id IS NULL THEN 'Sin salida vinculada' ELSE 'Salida ' || dv.folio END
             ELSE m.motivo
           END AS referencia,
           x.entra, x.sale, x.saldo, x.importe::text AS importe, x."importeConIva"::text AS "importeConIva", x."sinCosto"
    FROM corridas x
    JOIN "Movimiento" m ON m.id = x."movimientoId"
    JOIN "Bodega" b ON b.id = x."bodegaId"
    LEFT JOIN "Movimiento" o ON o.id = m."cancelaAId"
    LEFT JOIN "Movimiento" dv ON dv.id = m."devuelveAId"
    LEFT JOIN "Proveedor" pr ON pr.id = m."proveedorId"
    LEFT JOIN catalogo_gasosur."Estacion" s ON s.id = m."estacionId"
    LEFT JOIN "Area" ar ON ar.id = m."areaId"
    LEFT JOIN "Bodega" bo ON bo.id = m."bodegaOrigenId"
    LEFT JOIN "Bodega" bd ON bd.id = m."bodegaDestinoId"
    WHERE x.fecha >= ${f.desde}::date`;
}

// Las bodegas se intercalan por fecha; cada fila lleva el saldo de la suya.
const ORDEN = sql`fecha, instante, "movimientoId", "partidaId", id`;

export function filasKardex(db: Db, f: FiltrosKardex, pedida = 1, tamano = POR_PAGINA) {
  return paginaDe<FilaKardex>(db, consultaFilas(f), ORDEN, pedida, tamano);
}

/** Saldo inicial, altas, bajas y saldo final de cada bodega con historia del artículo. */
export function resumenKardex(db: Db, f: FiltrosKardex, pedida = 1, tamano = POR_PAGINA) {
  return paginaDe<ResumenBodega>(
    db,
    sql`
      SELECT h."bodegaId"::text AS id, b.clave AS "claveBodega", b.clave || ' · ' || b.nombre AS bodega, b.activa AS "bodegaActiva",
             coalesce(sum(cantidad) FILTER (WHERE fecha < ${f.desde}::date), 0)::int AS inicial,
             coalesce(sum(cantidad) FILTER (WHERE fecha >= ${f.desde}::date AND cantidad > 0), 0)::int AS entradas,
             coalesce(-sum(cantidad) FILTER (WHERE fecha >= ${f.desde}::date AND cantidad < 0), 0)::int AS salidas,
             sum(cantidad)::int AS final
      FROM (${hechos(f)}) h JOIN "Bodega" b ON b.id = h."bodegaId"
      GROUP BY h."bodegaId", b.clave, b.nombre, b.activa`,
    sql`"claveBodega", id`,
    pedida,
    tamano,
  );
}
