/*
  El candado de capas del retiro, aislado: espera la capa ocupada en lugar de
  saltarla (sin SKIP LOCKED), para que la verificación de stock y el reparto
  PEPS lean lo que dejó quien la tenía.
*/

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../../pruebas/semilla-entradas";
import { sembrarCapa, sinDefensas } from "../../../pruebas/semilla-inventario";
import { sembrarSalidas, type EntornoSalidas } from "../../../pruebas/semilla-salidas";
import { bloquearCapasVivas } from "../movimientos/primitivas";

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;

beforeAll(async () => {
  e = await sembrarSalidas(prisma);
});
afterAll(() => prisma.$disconnect());

describe("bloquearCapasVivas", () => {
  it("espera a que se libere la capa más antigua; no la salta", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const vieja = await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: x.id, cantidad: 1, fechaOriginal: "2026-09-01", costo: null });
    await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: x.id, cantidad: 1, fechaOriginal: "2026-09-02", costo: null });

    let segunda!: Promise<string>;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CapaCosto" WHERE id = ${vieja.id}::uuid FOR UPDATE`;
      segunda = prisma.$transaction((tx2) => bloquearCapasVivas(tx2, e.bodegaId, [x.id])).then(() => "pasó");
      const espera = new Promise<string>((r) => setTimeout(() => r("bloqueada"), 300));
      await expect(Promise.race([segunda, espera])).resolves.toBe("bloqueada");
    });
    await expect(segunda).resolves.toBe("pasó");
  });

  it("no toma capas agotadas ni de otra bodega", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const agotada = await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: x.id, cantidad: 1, fechaOriginal: "2026-09-01", costo: null });
    await sinDefensas(prisma, (tx) => tx.capaCosto.update({ where: { id: agotada.id }, data: { cantidadRestante: 0 } }));
    const ajena = await sembrarCapa(prisma, e, { bodegaId: e.otraBodegaId, articuloId: x.id, cantidad: 1, fechaOriginal: "2026-09-01", costo: null });

    let segunda!: Promise<string>;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CapaCosto" WHERE id = ANY(${[agotada.id, ajena.id]}::uuid[]) FOR UPDATE`;
      segunda = prisma.$transaction((tx2) => bloquearCapasVivas(tx2, e.bodegaId, [x.id])).then(() => "pasó");
      await expect(segunda).resolves.toBe("pasó");
    });
  });
});
