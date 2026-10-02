/*
  Inventario sembrado para las pruebas: capas con fecha, costo y desempate
  controlados, siempre con su existencia en la misma transacción, porque la
  base concilia ambas al confirmar (85-conciliacion.sql) y exige que cada capa
  nazca de un ingreso confirmado que la explique (990-…).
*/

import type { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { aFechaDeBase } from "../src/lib/fechas";

/** Lo que la semilla necesita del entorno: quién captura y, para capas con costo, un proveedor. */
export type Sembrador = { usuarios: { COMPRAS: { id: string } }; proveedorId?: string };

/**
 * Una capa viva con su existencia, como la dejaría un movimiento confirmado.
 * `costo` nulo es inventario sin valuar y nace de un AJUSTE positivo; con
 * costo nace de una ENTRADA. Ambos con la fecha original pedida.
 */
export function sembrarCapa(
  prisma: PrismaClient,
  e: Sembrador,
  opciones: { bodegaId: string; articuloId: string; cantidad: number; fechaOriginal: string; costo: [string, string] | null },
) {
  const fecha = aFechaDeBase(opciones.fechaOriginal);
  const { bodegaId, articuloId, cantidad, costo } = opciones;
  if (costo && !e.proveedorId) throw new Error("Una capa con costo nace de una entrada: falta el proveedor.");
  return prisma.$transaction(async (tx) => {
    const origen = await tx.movimiento.create({
      data: costo
        ? {
            tipo: "ENTRADA", estatus: "BORRADOR", fecha, bodegaDestinoId: bodegaId, proveedorId: e.proveedorId!,
            moneda: "MXN", llaveIdempotencia: randomUUID(), creadoPorId: e.usuarios.COMPRAS.id,
          }
        : { tipo: "AJUSTE", estatus: "BORRADOR", fecha, bodegaDestinoId: bodegaId, motivo: "Semilla de prueba", creadoPorId: e.usuarios.COMPRAS.id },
    });
    await tx.movimientoPartida.create({
      data: {
        movimientoId: origen.id, articuloId, orden: 1, presentacionCapturada: "UNIDAD", cantidadCapturada: cantidad, factorConversion: 1, cantidad,
        ...(costo ? { costoUnitarioCapturado: costo[0], tasaIva: costo[1] === costo[0] ? "0" : "0.16", costoUnitario: costo[0], costoUnitarioConIva: costo[1] } : {}),
      },
    });
    const capa = await tx.capaCosto.create({
      data: {
        bodegaId, articuloId, movimientoId: origen.id, fecha, fechaOriginal: fecha,
        cantidadInicial: cantidad, cantidadRestante: cantidad,
        costoUnitario: costo?.[0] ?? null, costoUnitarioConIva: costo?.[1] ?? null,
      },
    });
    await tx.existencia.upsert({
      where: { bodegaId_articuloId: { bodegaId, articuloId } },
      create: { bodegaId, articuloId, cantidad },
      update: { cantidad: { increment: cantidad } },
    });
    await tx.movimiento.update({
      where: { id: origen.id },
      data: {
        estatus: "CONFIRMADO", folio: `${costo ? "E" : "A"}-semilla-${randomUUID().slice(0, 13)}`,
        confirmadoPorId: e.usuarios.COMPRAS.id, confirmadoEn: new Date(),
        ...(costo ? { subtotal: "0", iva: "0", total: "0" } : {}),
      },
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
