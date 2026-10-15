import "server-only";
import { Prisma } from "@prisma/client";

const sql = Prisma.sql;

/*
  Los hechos que mueven existencia (contrato de la fase 8, §2), uno por capa
  creada, consumo o restitución, en la fecha del movimiento que lo produjo.
  `cantidad` lleva signo: suman capas y restituciones, restan consumos. La
  reversa se reconoce por cancelaAId, sea AJUSTE o TRASPASO. `costo` es el
  congelado en el hecho; `costoCapa`, el de la capa, para valuar lo que queda.
*/
export const HECHOS = sql`
  SELECT c."bodegaId", c."articuloId", m.id AS "movimientoId", p.id AS "partidaId", m.fecha, m.tipo::text AS tipo,
         m."cancelaAId" IS NOT NULL AS reversa, c.id AS "capaId", c."cantidadInicial" AS cantidad,
         c."costoUnitario" AS costo, c."costoUnitarioConIva" AS "costoConIva",
         c."costoUnitario" AS "costoCapa", c."costoUnitarioConIva" AS "costoCapaConIva"
  FROM "CapaCosto" c
  JOIN "Movimiento" m ON m.id = c."movimientoId"
  LEFT JOIN "MovimientoPartida" p ON p."movimientoId" = m.id AND p."articuloId" = c."articuloId"
  WHERE m.estatus IN ('CONFIRMADO', 'RETIRADA', 'RECIBIDA')
  UNION ALL
  SELECT c."bodegaId", c."articuloId", m.id, p.id, m.fecha, m.tipo::text, m."cancelaAId" IS NOT NULL, c.id, -k.cantidad,
         k."costoUnitario", k."costoUnitarioConIva", c."costoUnitario", c."costoUnitarioConIva"
  FROM "ConsumoCapa" k
  JOIN "MovimientoPartida" p ON p.id = k."partidaId"
  JOIN "Movimiento" m ON m.id = p."movimientoId"
  JOIN "CapaCosto" c ON c.id = k."capaId"
  WHERE m.estatus IN ('CONFIRMADO', 'RETIRADA', 'RECIBIDA')
  UNION ALL
  SELECT c."bodegaId", c."articuloId", m.id, p.id, m.fecha, m.tipo::text, m."cancelaAId" IS NOT NULL, c.id, r.cantidad,
         r."costoUnitario", r."costoUnitarioConIva", c."costoUnitario", c."costoUnitarioConIva"
  FROM "RestitucionCapa" r
  JOIN "MovimientoPartida" p ON p.id = r."partidaId"
  JOIN "Movimiento" m ON m.id = p."movimientoId"
  JOIN "CapaCosto" c ON c.id = r."capaId"
  WHERE m.estatus IN ('CONFIRMADO', 'RETIRADA', 'RECIBIDA')`;

/** Importe de un hecho con su signo, redondeado por renglón como importe_renglon(). */
export const importeConSigno = (cantidad: Prisma.Sql, costo: Prisma.Sql) =>
  sql`CASE WHEN ${cantidad} < 0 THEN -importe_renglon(-${cantidad}, ${costo}) ELSE importe_renglon(${cantidad}, ${costo}) END`;

/** El artículo `a` por clave (sin guiones ni ceros) o por descripción (sin acentos), como las listas. */
export function coincideArticulo(busqueda: string): Prisma.Sql {
  const q = busqueda.trim();
  if (!q) return sql`true`;
  return sql`(
    (clave_normalizada(${q}) <> '' AND position(clave_normalizada(${q}) IN clave_normalizada(a.clave)) > 0)
    OR position(texto_buscable(${q}) IN texto_buscable(a.descripcion)) > 0)`;
}

/** Condiciones opcionales unidas con AND; sin ninguna, verdadero. */
export const todas = (condiciones: (Prisma.Sql | null | false)[]) => {
  const vigentes = condiciones.filter((c): c is Prisma.Sql => !!c);
  return vigentes.length ? Prisma.join(vigentes, " AND ") : sql`true`;
};
