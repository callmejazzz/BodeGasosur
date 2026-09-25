/*
  El traductor falla cerrado: los RAISE propios de salidas (BG601–BG605)
  conservan su texto; todo lo demás de la base sale con un mensaje fijo, sin
  SQL, nombres de restricciones ni identificadores. El original va en `cause`.
*/

import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { sembrarSalidas, type EntornoSalidas } from "../../../pruebas/semilla-salidas";
import { aFechaDeBase, hoyEnMexico } from "../fechas";
import { ErrorDeDominio, traducirErrorDeBase } from "./errores";

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;

beforeAll(async () => {
  e = await sembrarSalidas(prisma);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => prisma.$disconnect());

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

const SIN_INTERNOS = /prisma|SELECT|UPDATE|INSERT|constraint|relation|Movimiento"|_ck|numeric|[0-9a-f]{8}-[0-9a-f]{4}-/i;

async function solicitud(conPartida = true) {
  return prisma.movimiento.create({
    data: {
      tipo: "SALIDA",
      estatus: "SOLICITADA",
      fecha: aFechaDeBase(hoyEnMexico()),
      bodegaOrigenId: e.bodegaId,
      estacionId: e.estacionId,
      creadoPorId: e.usuarios.COMPRAS.id,
      llaveIdempotencia: randomUUID(),
      partidas: conPartida
        ? { create: [{ orden: 1, articuloId: e.articuloSueltoId, presentacionCapturada: "UNIDAD", cantidadCapturada: 1, factorConversion: 1, cantidad: 1 }] }
        : undefined,
    },
  });
}

const autorizar = (id: string) =>
  prisma.movimiento.update({ where: { id }, data: { estatus: "AUTORIZADA", autorizadoPorId: e.autorizadores.JEFE.id, autorizadoEn: new Date() } });

describe("traducirErrorDeBase de salidas", () => {
  it("BG601: una transición fuera de la máquina conserva su texto como error de estado", async () => {
    const m = await solicitud();
    const t = await traducido(() =>
      prisma.movimiento.update({
        where: { id: m.id },
        data: { estatus: "RETIRADA", folio: `S-${randomUUID().slice(0, 6)}`, entregadoA: "x", entregadoPorId: e.usuarios.COMPRAS.id, entregadoEn: new Date() },
      }),
    );
    expect(t).toMatchObject({ codigo: "estado", message: expect.stringMatching(/Transición de salida no permitida/) });
    await expect(traducido(() => prisma.movimiento.delete({ where: { id: m.id } }))).resolves.toMatchObject({ codigo: "estado" });
  });

  it("BG602, BG603 y BG604 conservan su texto", async () => {
    const vacia = await solicitud(false);
    await expect(traducido(() => autorizar(vacia.id))).resolves.toMatchObject({ codigo: "partidas", message: expect.stringMatching(/sin partidas/) });

    const m = await solicitud();
    await autorizar(m.id);
    await expect(
      traducido(() => prisma.movimiento.update({ where: { id: m.id }, data: { estatus: "CANCELADO", canceladoPorId: e.usuarios.COMPRAS.id, canceladoEn: new Date(), motivoCancelacion: "x", observaciones: "colada" } })),
    ).resolves.toMatchObject({ codigo: "invariante", message: expect.stringMatching(/no se modifican/) });
    await expect(
      traducido(() => prisma.movimientoPartida.updateMany({ where: { movimientoId: m.id }, data: { cantidadCapturada: 2, cantidad: 2 } })),
    ).resolves.toMatchObject({ codigo: "estado", message: expect.stringMatching(/no se modifican/) });
  });

  it("BG605: retirar sin consumir es un invariante con texto propio", async () => {
    const m = await solicitud();
    await autorizar(m.id);
    const t = await traducido(() =>
      prisma.movimiento.update({
        where: { id: m.id },
        data: { estatus: "RETIRADA", folio: `S-${randomUUID().slice(0, 6)}`, entregadoA: "x", entregadoPorId: e.usuarios.COMPRAS.id, entregadoEn: new Date() },
      }),
    );
    expect(t).toMatchObject({ codigo: "invariante", message: expect.stringMatching(/consumir todas sus partidas/) });
  });

  it("un autorizador sin facultad (23514) sale con texto fijo, sin su identificador", async () => {
    const m = await solicitud();
    const t = await traducido(() =>
      prisma.movimiento.update({ where: { id: m.id }, data: { estatus: "AUTORIZADA", autorizadoPorId: e.usuarios.COMPRAS.id, autorizadoEn: new Date() } }),
    );
    expect(t).toMatchObject({ codigo: "invariante", message: "Los datos no cumplen una regla del inventario." });
    expect(t.message).not.toMatch(SIN_INTERNOS);
  });

  it("errores sin código propio salen seguros", async () => {
    for (const fn of [() => prisma.$queryRaw`SELECT ${"no-soy-uuid"}::uuid`, () => prisma.$queryRaw`SELECT 1 / ${0}::int`]) {
      const t = await traducido(fn);
      expect(t.codigo).toBe("base-de-datos");
      expect(t.message).not.toMatch(SIN_INTERNOS);
    }
    const validacion = new Prisma.PrismaClientValidationError("Invalid `prisma.movimiento.update()` invocation", { clientVersion: "x" });
    expect(() => traducirErrorDeBase(validacion)).toThrow(ErrorDeDominio);
  });

  it("lo que no es de la base se relanza tal cual", () => {
    const propio = new ErrorDeDominio("estado", "x");
    expect(() => traducirErrorDeBase(propio)).toThrow(propio);
    const ajeno = new TypeError("bug");
    expect(() => traducirErrorDeBase(ajeno)).toThrow(ajeno);
  });
});
