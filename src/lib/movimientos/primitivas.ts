import type { Prisma, Presentacion, TipoMovimiento } from "@prisma/client";

// Primitivas que comparten los movimientos (11 §5, §9): bloqueo ordenado de
// artículos, existencias y capas, consumo PEPS, folio y conversión a la unidad
// base. No lanzan errores de dominio: cada dominio decide qué decir.

type Tx = Prisma.TransactionClient;

/** Tope de las columnas `integer` de cantidades. */
export const TOPE_ENTERO = 2_147_483_647;

// ─────────────────────────────── Artículos ───────────────────────────────────

/**
 * FOR SHARE sobre los artículos, ordenados por id: nadie cambia piezasPorCaja
 * ni da de baja un artículo mientras se confirma. Va después del encabezado y
 * antes de las existencias, siempre.
 */
export async function bloquearArticulos(tx: Tx, articuloIds: readonly string[]): Promise<void> {
  if (articuloIds.length === 0) return;
  const ids = [...new Set(articuloIds)].sort();
  await tx.$queryRaw`SELECT id FROM "Articulo" WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR SHARE`;
}

// ─────────────────────────────── Existencia ──────────────────────────────────

/** Crea en cero las filas que falten y las bloquea FOR UPDATE por articuloId. */
export async function asegurarYBloquearExistencias(
  tx: Tx,
  bodegaId: string,
  articuloIds: readonly string[],
): Promise<{ articuloId: string; cantidad: number }[]> {
  if (articuloIds.length === 0) return [];
  const ids = [...new Set(articuloIds)].sort();

  await tx.$executeRaw`
    INSERT INTO "Existencia" ("bodegaId", "articuloId", cantidad, "actualizadoEn")
    SELECT ${bodegaId}::uuid, a, 0, now() FROM unnest(${ids}::uuid[]) AS a
    ON CONFLICT DO NOTHING`;

  return tx.$queryRaw<{ articuloId: string; cantidad: number }[]>`
    SELECT "articuloId", cantidad FROM "Existencia"
    WHERE "bodegaId" = ${bodegaId}::uuid AND "articuloId" = ANY(${ids}::uuid[])
    ORDER BY "articuloId" FOR UPDATE`;
}

/**
 * Crea en cero las que falten y bloquea FOR UPDATE las existencias de varias
 * bodegas en un solo orden estable, (bodegaId, articuloId): dos traspasos en
 * sentidos opuestos toman sus filas en el mismo orden y no se interbloquean.
 */
export async function asegurarYBloquearExistenciasDe(
  tx: Tx,
  pares: readonly { bodegaId: string; articuloId: string }[],
): Promise<{ bodegaId: string; articuloId: string; cantidad: number }[]> {
  if (pares.length === 0) return [];
  const bodegas = pares.map((p) => p.bodegaId);
  const articulos = pares.map((p) => p.articuloId);
  await tx.$executeRaw`
    INSERT INTO "Existencia" ("bodegaId", "articuloId", cantidad, "actualizadoEn")
    SELECT b, a, 0, now() FROM unnest(${bodegas}::uuid[], ${articulos}::uuid[]) AS x(b, a)
    ORDER BY b, a
    ON CONFLICT DO NOTHING`;
  return tx.$queryRaw<{ bodegaId: string; articuloId: string; cantidad: number }[]>`
    SELECT e."bodegaId", e."articuloId", e.cantidad FROM "Existencia" e
    JOIN unnest(${bodegas}::uuid[], ${articulos}::uuid[]) AS x(b, a) ON e."bodegaId" = x.b AND e."articuloId" = x.a
    ORDER BY e."bodegaId", e."articuloId" FOR UPDATE OF e`;
}

/** Suma a la existencia las partidas del movimiento. Exige haber bloqueado antes. */
export async function incrementarExistencias(tx: Tx, movimientoId: string, bodegaId: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE "Existencia" e
    SET cantidad = e.cantidad + p.cantidad, "actualizadoEn" = now()
    FROM "MovimientoPartida" p
    WHERE p."movimientoId" = ${movimientoId}::uuid
      AND e."bodegaId" = ${bodegaId}::uuid AND e."articuloId" = p."articuloId"`;
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

/** Por partida: lo pedido, lo que hay y si la existencia cuadra con sus capas (invariante 9). */
export async function existenciasParaEgreso(
  tx: Tx,
  movimientoId: string,
  bodegaId: string,
): Promise<{ clave: string; pedida: number; existencia: number; cuadra: boolean }[]> {
  return tx.$queryRaw`
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
}

/** La primera partida cuya suma rebasaría el tope de `integer` en la bodega; null si todas caben. */
export async function excesoDeCapacidad(
  tx: Tx,
  movimientoId: string,
  bodegaId: string,
): Promise<{ clave: string; existencia: number; entra: number } | null> {
  const fuera = await tx.$queryRaw<{ clave: string; existencia: number; entra: number }[]>`
    SELECT a.clave, e.cantidad AS existencia, p.cantidad AS entra
    FROM "MovimientoPartida" p
    JOIN "Existencia" e ON e."bodegaId" = ${bodegaId}::uuid AND e."articuloId" = p."articuloId"
    JOIN "Articulo" a ON a.id = p."articuloId"
    WHERE p."movimientoId" = ${movimientoId}::uuid
      AND e.cantidad::bigint + p.cantidad > 2147483647
    ORDER BY a.clave LIMIT 1`;
  return fuera[0] ?? null;
}

// ───────────────────────────────── Capas ─────────────────────────────────────

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

// ───────────────────────────────── Folio ─────────────────────────────────────

export async function tomarFolio(tx: Tx, tipo: TipoMovimiento): Promise<string> {
  const filas = await tx.$queryRaw<{ prefijo: string; numero: number }[]>`
    UPDATE "Folio" SET siguiente = siguiente + 1
    WHERE tipo = ${tipo}::"TipoMovimiento"
    RETURNING prefijo, siguiente - 1 AS numero`;
  const fila = filas[0];
  if (!fila) throw new Error(`No hay consecutivo configurado para ${tipo}.`);
  return `${fila.prefijo}-${String(fila.numero).padStart(6, "0")}`;
}

// ─────────────────────────── Unidad base (11 §5) ─────────────────────────────

export type ConversionAUnidadBase = { factorConversion: number; cantidad: number } | { error: string };

/**
 * Cantidad capturada → unidad base. El factor sale del catálogo, nunca del
 * navegador. Devuelve el motivo en vez de lanzar: cada dominio lo envuelve en
 * su propio error.
 */
export function aUnidadBase(
  clave: string,
  presentacion: Presentacion,
  cantidadCapturada: number,
  piezasPorCaja: number | null,
): ConversionAUnidadBase {
  if (!Number.isInteger(cantidadCapturada) || cantidadCapturada <= 0) {
    return { error: `${clave}: la cantidad tiene que ser un entero positivo.` };
  }
  let factorConversion = 1;
  if (presentacion === "CAJA") {
    if (!piezasPorCaja) return { error: `${clave} no se maneja por caja: captúralo en su unidad.` };
    factorConversion = piezasPorCaja;
  } else if (presentacion !== "UNIDAD") {
    return { error: `${clave}: la presentación tiene que ser UNIDAD o CAJA.` };
  }
  const cantidad = cantidadCapturada * factorConversion;
  if (cantidad > TOPE_ENTERO) return { error: `${clave}: la cantidad en unidades base es demasiado grande.` };
  return { factorConversion, cantidad };
}
