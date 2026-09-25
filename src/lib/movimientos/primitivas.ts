import type { Prisma, Presentacion, TipoMovimiento } from "@prisma/client";

// Primitivas que comparten los movimientos (11 §5, §9): bloqueo ordenado de
// artículos y existencias, folio y conversión a la unidad base.

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
