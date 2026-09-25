/*
  Inventario sembrado para las pruebas: capas con fecha, costo y desempate
  controlados, siempre con su existencia en la misma transacción, porque la
  base concilia ambas al confirmar (85-conciliacion.sql).
*/

import type { Prisma, PrismaClient } from "@prisma/client";
import { aFechaDeBase } from "../src/lib/fechas";
import type { Entorno } from "./semilla-entradas";

/**
 * Una capa viva con su existencia, como la dejaría un movimiento confirmado.
 * `costo` nulo es inventario sin valuar. Se cuelga de un AJUSTE en borrador
 * solo para satisfacer la llave foránea.
 */
export function sembrarCapa(
  prisma: PrismaClient,
  e: Entorno,
  opciones: { bodegaId: string; articuloId: string; cantidad: number; fechaOriginal: string; costo: [string, string] | null },
) {
  const fecha = aFechaDeBase(opciones.fechaOriginal);
  return prisma.$transaction(async (tx) => {
    const origen = await tx.movimiento.create({
      data: {
        tipo: "AJUSTE",
        estatus: "BORRADOR",
        fecha,
        bodegaDestinoId: opciones.bodegaId,
        motivo: "Semilla de prueba",
        creadoPorId: e.usuarios.COMPRAS.id,
      },
    });
    const capa = await tx.capaCosto.create({
      data: {
        bodegaId: opciones.bodegaId,
        articuloId: opciones.articuloId,
        movimientoId: origen.id,
        fecha,
        fechaOriginal: fecha,
        cantidadInicial: opciones.cantidad,
        cantidadRestante: opciones.cantidad,
        costoUnitario: opciones.costo?.[0] ?? null,
        costoUnitarioConIva: opciones.costo?.[1] ?? null,
      },
    });
    await tx.existencia.upsert({
      where: { bodegaId_articuloId: { bodegaId: opciones.bodegaId, articuloId: opciones.articuloId } },
      create: { bodegaId: opciones.bodegaId, articuloId: opciones.articuloId, cantidad: opciones.cantidad },
      update: { cantidad: { increment: opciones.cantidad } },
    });
    return capa;
  });
}

/**
 * Escribe sin triggers ni llaves foráneas (session_replication_role = replica,
 * solo superusuario): simula inventario ya dañado para probar las defensas del
 * servicio. Solo para pruebas.
 */
export function sinDefensas<T>(prisma: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    return fn(tx);
  });
}
