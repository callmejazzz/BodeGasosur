import type { Prisma } from "@prisma/client";
import { ErrorDeDominio } from "./errores";

// Primitivas de PostgreSQL propias de la confirmación de entradas (11 §9).
// Las compartidas con salidas viven en @/lib/movimientos/primitivas.

type Tx = Prisma.TransactionClient;

// ─────────────────────────────── Existencia ──────────────────────────────────

export async function verificarCapacidadDeExistencias(tx: Tx, movimientoId: string, bodegaId: string): Promise<void> {
  const fuera = await tx.$queryRaw<{ clave: string; existencia: number; entra: number }[]>`
    SELECT a.clave, e.cantidad AS existencia, p.cantidad AS entra
    FROM "MovimientoPartida" p
    JOIN "Existencia" e ON e."bodegaId" = ${bodegaId}::uuid AND e."articuloId" = p."articuloId"
    JOIN "Articulo" a ON a.id = p."articuloId"
    WHERE p."movimientoId" = ${movimientoId}::uuid
      AND e.cantidad::bigint + p.cantidad > 2147483647
    ORDER BY a.clave LIMIT 1`;
  if (fuera[0]) {
    throw new ErrorDeDominio(
      "partidas",
      `${fuera[0].clave}: la existencia (${fuera[0].existencia}) más esta entrada (${fuera[0].entra}) rebasa lo que el sistema puede registrar.`,
    );
  }
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

// ─────────────────────────── Proveedor y bodega ──────────────────────────────

/**
 * FOR SHARE sobre las contrapartes del encabezado, siempre proveedor y luego
 * bodega: nadie las da de baja mientras se confirma. Van después del
 * encabezado y antes de los artículos.
 */
export async function bloquearContrapartes(tx: Tx, proveedorId: string, bodegaId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Proveedor" WHERE id = ${proveedorId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Bodega" WHERE id = ${bodegaId}::uuid FOR SHARE`;
}

// ───────────────────────────────── Dinero ────────────────────────────────────

export type CosteoDePartida = {
  costoUnitarioCapturado: string;
  tasaIva: string;
  factorConversion: number;
};

const COSTO_FUERA_DE_RANGO = "El costo por unidad excede lo que el sistema puede registrar.";
const IMPORTE_FUERA_DE_RANGO = "Los importes de la entrada exceden lo que el sistema puede registrar.";

/**
 * Los dos costos canónicos, en MXN y por unidad base, calculados en la base,
 * y comprobados ahí mismo contra el tope de numeric(14,4) antes de escribirse.
 */
export async function calcularCostosBase(
  tx: Tx,
  tipoCambio: string | null,
  partidas: readonly CosteoDePartida[],
): Promise<{ costoUnitario: string; costoUnitarioConIva: string }[]> {
  if (partidas.length === 0) return [];
  const filas = await tx.$queryRaw<{ sin: string; con: string; cabe: boolean }[]>`
    SELECT
      costo_base_mxn(p.costo, ${tipoCambio}::numeric, p.factor)::text        AS sin,
      costo_base_mxn(p.costo, ${tipoCambio}::numeric, p.factor, p.tasa)::text AS con,
      cabe_en_costo(costo_base_mxn(p.costo, ${tipoCambio}::numeric, p.factor, p.tasa)) AS cabe
    FROM unnest(
      ${partidas.map((p) => p.costoUnitarioCapturado)}::numeric[],
      ${partidas.map((p) => p.tasaIva)}::numeric[],
      ${partidas.map((p) => p.factorConversion)}::int[]
    ) WITH ORDINALITY AS p(costo, tasa, factor, n)
    ORDER BY p.n`;
  if (filas.some((f) => !f.cabe)) throw new ErrorDeDominio("partidas", COSTO_FUERA_DE_RANGO);
  return filas.map((f) => ({ costoUnitario: f.sin, costoUnitarioConIva: f.con }));
}

// Congela el dinero del movimiento a partir de lo capturado (11 §6). Antes de
// escribir, la misma base comprueba que cada resultado cabe en su columna.
export async function recalcularCostosYTotales(tx: Tx, movimientoId: string): Promise<void> {
  const [rango] = await tx.$queryRaw<{ costos: boolean; importes: boolean }[]>`
    SELECT
      coalesce(bool_and(cabe_en_costo(costo_base_mxn(p."costoUnitarioCapturado", m."tipoCambio", p."factorConversion", p."tasaIva"))), true) AS costos,
      cabe_en_importe(
        coalesce(sum(importe_renglon(p."cantidadCapturada", p."costoUnitarioCapturado")), 0)
        + coalesce(sum(round(importe_renglon(p."cantidadCapturada", p."costoUnitarioCapturado") * p."tasaIva", 2)), 0)
      ) AS importes
    FROM "Movimiento" m
    LEFT JOIN "MovimientoPartida" p
      ON p."movimientoId" = m.id AND p."costoUnitarioCapturado" IS NOT NULL AND p."tasaIva" IS NOT NULL
    WHERE m.id = ${movimientoId}::uuid`;
  if (rango && !rango.costos) throw new ErrorDeDominio("partidas", COSTO_FUERA_DE_RANGO);
  if (rango && !rango.importes) throw new ErrorDeDominio("partidas", IMPORTE_FUERA_DE_RANGO);

  await tx.$executeRaw`
    UPDATE "MovimientoPartida" p
    SET "costoUnitario"       = costo_base_mxn(p."costoUnitarioCapturado", m."tipoCambio", p."factorConversion"),
        "costoUnitarioConIva" = costo_base_mxn(p."costoUnitarioCapturado", m."tipoCambio", p."factorConversion", p."tasaIva")
    FROM "Movimiento" m
    WHERE m.id = ${movimientoId}::uuid AND p."movimientoId" = m.id
      AND p."costoUnitarioCapturado" IS NOT NULL AND p."tasaIva" IS NOT NULL`;

  await tx.$executeRaw`
    UPDATE "Movimiento" m
    SET subtotal = t.subtotal, iva = t.iva, total = t.subtotal + t.iva
    FROM (
      SELECT
        coalesce(sum(importe_renglon(p."cantidadCapturada", p."costoUnitarioCapturado")), 0) AS subtotal,
        coalesce(sum(round(importe_renglon(p."cantidadCapturada", p."costoUnitarioCapturado") * p."tasaIva", 2)), 0) AS iva
      FROM "MovimientoPartida" p WHERE p."movimientoId" = ${movimientoId}::uuid
    ) t
    WHERE m.id = ${movimientoId}::uuid`;
}

// ─────────────────────────────── Capas de costo ──────────────────────────────

/**
 * Una capa por partida (11 §9.8): cantidadInicial = cantidadRestante = cantidad,
 * fechaOriginal = fecha del movimiento, costos ya en MXN por unidad base.
 */
export async function crearCapasDeEntrada(tx: Tx, movimientoId: string): Promise<number> {
  return tx.$executeRaw`
    INSERT INTO "CapaCosto"
      (id, "bodegaId", "articuloId", "movimientoId", fecha, "fechaOriginal",
       "cantidadInicial", "cantidadRestante", "costoUnitario", "costoUnitarioConIva")
    SELECT uuid_generate_v7(), m."bodegaDestinoId", p."articuloId", m.id, m.fecha, m.fecha,
           p.cantidad, p.cantidad, p."costoUnitario", p."costoUnitarioConIva"
    FROM "MovimientoPartida" p
    JOIN "Movimiento" m ON m.id = p."movimientoId"
    WHERE m.id = ${movimientoId}::uuid
    ORDER BY p."articuloId"`;
}
