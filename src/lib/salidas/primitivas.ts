import type { Prisma } from "@prisma/client";
import { ErrorDeDominio } from "./errores";

// Primitivas de PostgreSQL del retiro. Orden de bloqueo: encabezado →
// contrapartes → artículos → existencias → capas → folio. Las de artículos,
// existencias y folio son compartidas (@/lib/movimientos/primitivas).

type Tx = Prisma.TransactionClient;

export type Contrapartes = {
  bodegaOrigenId: string;
  estacionId: string;
  areaId: string | null;
  solicitadoPorId: string | null;
};

/** FOR SHARE, siempre bodega → estación → área → solicitante: nadie los da de baja mientras se retira. */
export async function bloquearContrapartes(tx: Tx, c: Contrapartes): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Bodega" WHERE id = ${c.bodegaOrigenId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM catalogo_gasosur."Estacion" WHERE id = ${c.estacionId}::uuid FOR SHARE`;
  if (c.areaId) await tx.$queryRaw`SELECT id FROM "Area" WHERE id = ${c.areaId}::uuid FOR SHARE`;
  if (c.solicitadoPorId) await tx.$queryRaw`SELECT id FROM "Persona" WHERE id = ${c.solicitadoPorId}::uuid FOR SHARE`;
}

/**
 * FOR UPDATE sobre las capas vivas, en el orden PEPS y sin SKIP LOCKED:
 * saltar una capa ocupada consumiría una más nueva. Va después de las
 * existencias, así la lectura ya incluye las capas de una entrada que
 * confirmó mientras se esperaba ese candado.
 */
export async function bloquearCapasVivas(tx: Tx, bodegaId: string, articuloIds: readonly string[]): Promise<void> {
  if (articuloIds.length === 0) return;
  const ids = [...new Set(articuloIds)].sort();
  await tx.$queryRaw`
    SELECT id FROM "CapaCosto"
    WHERE "bodegaId" = ${bodegaId}::uuid AND "articuloId" = ANY(${ids}::uuid[]) AND "cantidadRestante" > 0
    ORDER BY "articuloId", "fechaOriginal", id
    FOR UPDATE`;
}

/**
 * Antes de descontar: por cada partida, la existencia alcanza y coincide con
 * lo que queda en sus capas (invariante 9). Un descuadre se reporta primero,
 * porque con él la existencia no es confiable.
 */
export async function verificarExistencias(tx: Tx, movimientoId: string, bodegaId: string): Promise<void> {
  const filas = await tx.$queryRaw<{ clave: string; pedida: number; existencia: number; cuadra: boolean }[]>`
    SELECT a.clave, p.cantidad AS pedida, coalesce(e.cantidad, 0) AS existencia,
           coalesce(e.cantidad, 0) = coalesce((
             SELECT sum(c."cantidadRestante") FROM "CapaCosto" c
             WHERE c."bodegaId" = ${bodegaId}::uuid AND c."articuloId" = p."articuloId"
           ), 0) AS cuadra
    FROM "MovimientoPartida" p
    JOIN "Articulo" a ON a.id = p."articuloId"
    LEFT JOIN "Existencia" e ON e."bodegaId" = ${bodegaId}::uuid AND e."articuloId" = p."articuloId"
    WHERE p."movimientoId" = ${movimientoId}::uuid
    ORDER BY p.orden`;

  const descuadre = filas.find((f) => !f.cuadra);
  if (descuadre) {
    throw new ErrorDeDominio(
      "invariante",
      `${descuadre.clave}: la existencia no coincide con sus capas de costo. Avisa al administrador antes de retirar.`,
    );
  }
  const falta = filas.find((f) => f.existencia < f.pedida);
  if (falta) {
    throw new ErrorDeDominio(
      "existencia",
      `${falta.clave}: hay ${falta.existencia} en la bodega y la salida pide ${falta.pedida}.`,
    );
  }
}

/**
 * PEPS en una sola sentencia: reparte cada partida entre sus capas vivas por
 * (fechaOriginal, id), crea el ConsumoCapa con el par de costos de cada capa
 * —nulos si la capa no tiene costo— y descuenta cantidadRestante. Exige
 * haber bloqueado y verificado antes.
 */
export async function consumirCapasPEPS(
  tx: Tx,
  movimientoId: string,
  bodegaId: string,
): Promise<{ consumos: number; capas: number; piezas: number }> {
  const [r] = await tx.$queryRaw<{ consumos: number; capas: number; piezas: number }[]>`
    WITH partida AS (
      SELECT id, "articuloId", cantidad FROM "MovimientoPartida" WHERE "movimientoId" = ${movimientoId}::uuid
    ), capa AS (
      SELECT c.id, c."articuloId", c."cantidadRestante" AS restante, c."costoUnitario", c."costoUnitarioConIva",
             sum(c."cantidadRestante") OVER (
               PARTITION BY c."articuloId" ORDER BY c."fechaOriginal", c.id
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) - c."cantidadRestante" AS previo
      FROM "CapaCosto" c
      WHERE c."bodegaId" = ${bodegaId}::uuid AND c."cantidadRestante" > 0
        AND c."articuloId" IN (SELECT "articuloId" FROM partida)
    ), reparto AS (
      SELECT p.id AS "partidaId", c.id AS "capaId", least(c.restante, p.cantidad - c.previo)::int AS cantidad,
             c."costoUnitario", c."costoUnitarioConIva"
      FROM partida p JOIN capa c ON c."articuloId" = p."articuloId"
      WHERE c.previo < p.cantidad
    ), consumo AS (
      INSERT INTO "ConsumoCapa" (id, "partidaId", "capaId", cantidad, "costoUnitario", "costoUnitarioConIva")
      SELECT uuid_generate_v7(), "partidaId", "capaId", cantidad, "costoUnitario", "costoUnitarioConIva" FROM reparto
      RETURNING "capaId", cantidad
    ), descuento AS (
      UPDATE "CapaCosto" c SET "cantidadRestante" = c."cantidadRestante" - consumo.cantidad
      FROM consumo WHERE c.id = consumo."capaId"
      RETURNING c.id
    )
    SELECT (SELECT count(*) FROM consumo)::int AS consumos,
           (SELECT count(*) FROM descuento)::int AS capas,
           (SELECT coalesce(sum(cantidad), 0) FROM consumo)::int AS piezas`;
  return r;
}

/** Resta de la existencia las partidas del movimiento. Exige haber bloqueado antes. */
export async function descontarExistencias(tx: Tx, movimientoId: string, bodegaId: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE "Existencia" e
    SET cantidad = e.cantidad - p.cantidad, "actualizadoEn" = now()
    FROM "MovimientoPartida" p
    WHERE p."movimientoId" = ${movimientoId}::uuid
      AND e."bodegaId" = ${bodegaId}::uuid AND e."articuloId" = p."articuloId"`;
}
