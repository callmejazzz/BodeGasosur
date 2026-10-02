/*
  Entorno de la fase 7: el de salidas (dos bodegas, estación, autorizadores)
  más los consecutivos de traspaso, devolución y ajuste, y un ayudante que
  abre la transacción como la abriría accionProtegida() para ese usuario.
*/

import type { Prisma, PrismaClient } from "@prisma/client";
import type { UsuarioSesion } from "../src/lib/db";
import { usuarioTienePermiso, type Permiso } from "../src/lib/permisos";
import { sembrarSalidas, type EntornoSalidas } from "./semilla-salidas";

export async function sembrarOperacion(prisma: PrismaClient): Promise<EntornoSalidas> {
  const e = await sembrarSalidas(prisma);
  for (const [tipo, prefijo] of [["TRASPASO", "T"], ["DEVOLUCION", "D"], ["AJUSTE", "A"]] as const) {
    await prisma.folio.upsert({ where: { tipo }, update: {}, create: { tipo, prefijo } });
  }
  return e;
}

export class SinPermisoDePrueba extends Error {}

/** El servicio dentro de su transacción, con el permiso de la matriz y el actor declarado. */
export function como<T>(prisma: PrismaClient, usuario: UsuarioSesion, permiso: Permiso, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (!usuarioTienePermiso(usuario, permiso)) return Promise.reject(new SinPermisoDePrueba(permiso));
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.usuario_id', ${usuario.id}, true)`;
    return fn(tx);
  });
}

/** Invariante 9 y nada negativo en las bodegas dadas. */
export async function descuadres(prisma: PrismaClient, bodegaIds: string[]) {
  return prisma.$queryRaw<{ bodegaId: string; articuloId: string; existencia: number; capas: number }[]>`
    SELECT e."bodegaId", e."articuloId", e.cantidad AS existencia, coalesce(sum(c."cantidadRestante"), 0)::int AS capas
    FROM "Existencia" e
    LEFT JOIN "CapaCosto" c ON c."bodegaId" = e."bodegaId" AND c."articuloId" = e."articuloId"
    WHERE e."bodegaId" = ANY(${bodegaIds}::uuid[])
    GROUP BY e."bodegaId", e."articuloId", e.cantidad
    HAVING e.cantidad <> coalesce(sum(c."cantidadRestante"), 0) OR e.cantidad < 0`;
}

/** Valor de un artículo en todas las bodegas: con costo (sin y con IVA) y piezas sin costo. */
export async function valuacion(prisma: PrismaClient, articuloId: string) {
  const [v] = await prisma.$queryRaw<{ importe: string | null; conIva: string | null; sinCosto: number; piezas: number }[]>`
    SELECT sum(c."cantidadRestante" * c."costoUnitario")::text AS importe,
           sum(c."cantidadRestante" * c."costoUnitarioConIva")::text AS "conIva",
           coalesce(sum(c."cantidadRestante") FILTER (WHERE c."costoUnitario" IS NULL), 0)::int AS "sinCosto",
           coalesce(sum(c."cantidadRestante"), 0)::int AS piezas
    FROM "CapaCosto" c WHERE c."articuloId" = ${articuloId}::uuid`;
  return v;
}
