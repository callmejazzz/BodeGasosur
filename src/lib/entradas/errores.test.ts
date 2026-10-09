/*
  El traductor falla cerrado (11 §11): todo error de Prisma/PostgreSQL se
  convierte en ErrorDeDominio con mensaje seguro; solo los códigos BG propios
  conservan su texto. El original queda en `cause`.
*/

import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { sembrarEntorno, type Entorno } from "../../../pruebas/semilla-entradas";
import { aFechaDeBase } from "../fechas";
import { ErrorDeDominio, traducirErrorDeBase } from "./errores";

const prisma = crearCliente(URL_PRUEBAS);
let e: Entorno;

beforeAll(async () => {
  e = await sembrarEntorno(prisma);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => prisma.$disconnect());

/** Ejecuta, atrapa y traduce; devuelve el ErrorDeDominio resultante. */
async function traducido(fn: () => Promise<unknown>): Promise<ErrorDeDominio> {
  try {
    await fn();
  } catch (original) {
    try {
      traducirErrorDeBase(original);
    } catch (t) {
      expect(t).toBeInstanceOf(ErrorDeDominio);
      expect((t as ErrorDeDominio).cause).toBe(original);
      return t as ErrorDeDominio;
    }
  }
  throw new Error("no lanzó");
}

const SIN_INTERNOS = /prisma|SELECT|UPDATE|INSERT|constraint|relation|Movimiento"|_ck|uuid|numeric/i;

describe("traducirErrorDeBase", () => {
  it("UUID inválido: mensaje seguro, sin SQL", async () => {
    const t = await traducido(() => prisma.$queryRaw`SELECT ${"no-soy-uuid"}::uuid`);
    expect(t.codigo).toBe("base-de-datos");
    expect(t.message).not.toMatch(SIN_INTERNOS);
  });

  it("desbordamiento numérico: mensaje seguro", async () => {
    const t = await traducido(() => prisma.$queryRaw`SELECT ${"99999999999"}::numeric(14,4)`);
    expect(t.codigo).toBe("base-de-datos");
    expect(t.message).not.toMatch(SIN_INTERNOS);
  });

  it("SQLSTATE desconocido (división entre cero): mensaje seguro", async () => {
    const t = await traducido(() => prisma.$queryRaw`SELECT 1 / ${0}::int`);
    expect(t.codigo).toBe("base-de-datos");
    expect(t.message).not.toMatch(SIN_INTERNOS);
  });

  it("un 23514 de CHECK, no reconocido: texto fijo sin el nombre de la restricción", async () => {
    const t = await traducido(() =>
      prisma.movimiento.create({
        data: {
          tipo: "ENTRADA",
          estatus: "BORRADOR",
          fecha: aFechaDeBase("1999-12-31"),
          moneda: "MXN",
          bodegaDestinoId: e.bodegaId,
          proveedorId: e.proveedorId,
          creadoPorId: e.usuarios.COMPRAS.id,
          llaveIdempotencia: randomUUID(),
        },
      }),
    );
    expect(t.codigo).toBe("invariante");
    expect(t.message).toBe("Los datos no cumplen una regla del inventario.");
    expect(t.message).not.toMatch(/movimiento_fecha_minima_ck/);
  });

  it("un RAISE propio (BG501) conserva su texto y su código de dominio", async () => {
    const m = await prisma.movimiento.create({
      data: {
        tipo: "ENTRADA",
        estatus: "BORRADOR",
        fecha: aFechaDeBase("2026-09-10"),
        moneda: "MXN",
        bodegaDestinoId: e.bodegaId,
        proveedorId: e.proveedorId,
        creadoPorId: e.usuarios.COMPRAS.id,
        llaveIdempotencia: randomUUID(),
        partidas: {
          create: [
            { orden: 1, articuloId: e.articuloSueltoId, presentacionCapturada: "UNIDAD", cantidadCapturada: 1, factorConversion: 1, cantidad: 1,
              costoUnitarioCapturado: "1", tasaIva: "0", costoUnitario: "1", costoUnitarioConIva: "1" },
          ],
        },
      },
    });
    // Confirmada como la deja la recepción: con su capa y su existencia.
    await prisma.$transaction(async (tx) => {
      await tx.capaCosto.create({
        data: { bodegaId: e.bodegaId, articuloId: e.articuloSueltoId, movimientoId: m.id, fecha: m.fecha, fechaOriginal: m.fecha, cantidadInicial: 1, cantidadRestante: 1, costoUnitario: "1", costoUnitarioConIva: "1" },
      });
      await tx.existencia.upsert({
        where: { bodegaId_articuloId: { bodegaId: e.bodegaId, articuloId: e.articuloSueltoId } },
        create: { bodegaId: e.bodegaId, articuloId: e.articuloSueltoId, cantidad: 1 },
        update: { cantidad: { increment: 1 } },
      });
      await tx.movimiento.update({
        where: { id: m.id },
        data: { estatus: "CONFIRMADO", folio: `E-${randomUUID().slice(0, 6)}`, confirmadoPorId: e.usuarios.COMPRAS.id, confirmadoEn: new Date(), subtotal: "1", iva: "0", total: "1" },
      });
    });
    const t = await traducido(() => prisma.movimiento.update({ where: { id: m.id }, data: { referencia: "x" } }));
    expect(t.codigo).toBe("ya-confirmado");
    expect(t.message).toMatch(/ya no se edita/);
    expect(t.message).not.toMatch(/prisma|SELECT|UPDATE/i);
  });

  it("los errores de validación de Prisma también salen seguros", () => {
    const original = new Prisma.PrismaClientValidationError("Invalid `prisma.movimiento.create()` invocation", { clientVersion: "x" });
    expect(() => traducirErrorDeBase(original)).toThrow(ErrorDeDominio);
    try {
      traducirErrorDeBase(original);
    } catch (t) {
      expect((t as ErrorDeDominio).message).not.toMatch(/prisma/i);
      expect((t as ErrorDeDominio).cause).toBe(original);
    }
  });

  it("lo que no es de la base se relanza tal cual", () => {
    const propio = new ErrorDeDominio("fecha", "x");
    expect(() => traducirErrorDeBase(propio)).toThrow(propio);
    const ajeno = new TypeError("bug");
    expect(() => traducirErrorDeBase(ajeno)).toThrow(ajeno);
  });
});
