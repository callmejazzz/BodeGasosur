/*
  Prisma 7 con el adaptador de pg carga las relaciones hermanas de un select
  en paralelo sobre la única conexión de una transacción. pg 8 lo encola con
  una DeprecationWarning; pg 9 lo rechazará. relationJoins (schema.prisma) lo
  evita al traerlas en una sola sentencia; esta prueba avisa si deja de ser así.
*/

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { URL_PRUEBAS } from "../pruebas/base-de-pruebas";
import { sembrarEntorno } from "../pruebas/semilla-entradas";
import { crearCliente } from "./comun";

const prisma = crearCliente(URL_PRUEBAS);
const advertencias: string[] = [];
const escuchar = (w: Error) => advertencias.push(w.message);

beforeAll(() => process.on("warning", escuchar));
afterAll(async () => {
  process.off("warning", escuchar);
  await prisma.$disconnect();
});

describe("relaciones dentro de una transacción", () => {
  it("un select con varias relaciones hermanas no encola consultas en la misma conexión", async () => {
    const entorno = await sembrarEntorno(prisma);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.articulo.findUnique({
        where: { id: entorno.articuloCajaId },
        select: {
          unidad: { select: { clave: true } },
          existencias: { select: { cantidad: true } },
          partidas: { select: { id: true, movimiento: { select: { estatus: true } } } },
          _count: { select: { partidas: true } },
        },
      });
    });
    // El aviso llega de forma asíncrona: se le da un turno.
    await new Promise((r) => setImmediate(r));
    expect(advertencias.filter((m) => m.includes("already executing a query"))).toEqual([]);
  });
});
