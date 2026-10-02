import type { Prisma } from "@prisma/client";
import { existenciasParaEgreso } from "@/lib/movimientos/primitivas";
import { ErrorDeDominio } from "./errores";

// Primitivas de PostgreSQL del retiro. Orden de bloqueo: encabezado →
// contrapartes → artículos → existencias → capas → folio. Las de artículos,
// existencias, capas, PEPS y folio son compartidas (@/lib/movimientos/primitivas).

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
 * Antes de descontar: por cada partida, la existencia alcanza y coincide con
 * lo que queda en sus capas (invariante 9). Un descuadre se reporta primero,
 * porque con él la existencia no es confiable.
 */
export async function verificarExistencias(tx: Tx, movimientoId: string, bodegaId: string): Promise<void> {
  const filas = await existenciasParaEgreso(tx, movimientoId, bodegaId);

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
