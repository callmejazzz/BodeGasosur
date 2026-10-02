/*
  Las primitivas de PostgreSQL de la confirmación (11 §9), una por una y con
  concurrencia real: transacciones paralelas sobre la misma conexión de pool.
*/

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { sembrarEntorno, type Entorno } from "../../../pruebas/semilla-entradas";
import { aFechaDeBase } from "../fechas";
import { asegurarYBloquearExistencias, incrementarExistencias, tomarFolio } from "../movimientos/primitivas";
import { calcularCostosBase, crearCapasDeEntrada, recalcularCostosYTotales } from "./primitivas";

const prisma = crearCliente(URL_PRUEBAS);
let e: Entorno;

beforeAll(async () => {
  e = await sembrarEntorno(prisma);
});
afterAll(() => prisma.$disconnect());

describe("dinero en numeric", () => {
  it("costo_base_mxn: una caja de 12 a $120 son $10.0000 la pieza, $11.6000 con IVA", async () => {
    await expect(calcularCostosBase(prisma, null, [{ costoUnitarioCapturado: "120", tasaIva: "0.16", factorConversion: 12 }]))
      .resolves.toEqual([{ costoUnitario: "10.0000", costoUnitarioConIva: "11.6000" }]);
  });

  it("en USD aplica el tipo de cambio; en MXN el factor es 1", async () => {
    await expect(calcularCostosBase(prisma, "17.5", [{ costoUnitarioCapturado: "10", tasaIva: "0", factorConversion: 1 }]))
      .resolves.toEqual([{ costoUnitario: "175.0000", costoUnitarioConIva: "175.0000" }]);
  });

  it("redondea a cuatro decimales, medio hacia arriba, y conserva el orden", async () => {
    const filas = await calcularCostosBase(prisma, null, [
      { costoUnitarioCapturado: "100", tasaIva: "0.16", factorConversion: 3 }, // 33.3333… / 38.6666…
      { costoUnitarioCapturado: "0.00005", tasaIva: "0", factorConversion: 1 }, // 0.00005 → 0.0001
      { costoUnitarioCapturado: "1", tasaIva: "0.08", factorConversion: 7 }, // 0.142857… / 0.154285…
    ]);
    expect(filas).toEqual([
      { costoUnitario: "33.3333", costoUnitarioConIva: "38.6667" },
      { costoUnitario: "0.0001", costoUnitarioConIva: "0.0001" },
      { costoUnitario: "0.1429", costoUnitarioConIva: "0.1543" },
    ]);
  });

  it("importe_renglon: dos decimales, medio hacia arriba, por renglón", async () => {
    const [fila] = await prisma.$queryRaw<{ a: string; b: string; c: string }[]>`
      SELECT importe_renglon(3, 33.335)::text AS a,
             importe_renglon(1, 0.005)::text  AS b,
             importe_renglon(7, 14.2857)::text AS c`;
    expect(fila).toEqual({ a: "100.01", b: "0.01", c: "100.00" });
  });
});

describe("folio", () => {
  it("es consecutivo y no deja huecos si la transacción falla", async () => {
    const primero = await prisma.$transaction((tx) => tomarFolio(tx, "ENTRADA"));
    await expect(
      prisma.$transaction(async (tx) => {
        await tomarFolio(tx, "ENTRADA");
        throw new Error("se revierte");
      }),
    ).rejects.toThrow("se revierte");
    const segundo = await prisma.$transaction((tx) => tomarFolio(tx, "ENTRADA"));
    expect(primero).toMatch(/^E-\d{6}$/);
    expect(Number(segundo.slice(2))).toBe(Number(primero.slice(2)) + 1);
  });

  it("diez confirmaciones simultáneas reciben diez números distintos", async () => {
    const folios = await Promise.all(
      Array.from({ length: 10 }, () => prisma.$transaction((tx) => tomarFolio(tx, "ENTRADA"))),
    );
    expect(new Set(folios).size).toBe(10);
  });
});

describe("existencia", () => {
  it("asegura la fila en cero, en orden, y no duplica", async () => {
    const ids = [e.articuloSueltoId, e.articuloCajaId];
    const filas = await prisma.$transaction((tx) => asegurarYBloquearExistencias(tx, e.otraBodegaId, ids));
    expect(filas.map((f) => f.articuloId)).toEqual([...ids].sort());
    expect(filas.every((f) => f.cantidad === 0)).toBe(true);
    await prisma.$transaction((tx) => asegurarYBloquearExistencias(tx, e.otraBodegaId, ids));
    await expect(prisma.existencia.count({ where: { bodegaId: e.otraBodegaId } })).resolves.toBe(2);
  });

  it("la segunda transacción espera a que la primera suelte el candado", async () => {
    let segunda!: Promise<string>;
    await prisma.$transaction(async (tx) => {
      await asegurarYBloquearExistencias(tx, e.bodegaId, [e.articuloCajaId]);
      segunda = prisma
        .$transaction((tx2) => asegurarYBloquearExistencias(tx2, e.bodegaId, [e.articuloCajaId]))
        .then(() => "pasó");
      const espera = new Promise<string>((r) => setTimeout(() => r("bloqueada"), 300));
      await expect(Promise.race([segunda, espera])).resolves.toBe("bloqueada");
    });
    await expect(segunda).resolves.toBe("pasó");
  });
});

describe("recalcular dinero y crear capas al confirmar un borrador", () => {
  it("congela costos por partida, totales por renglón, y una capa por partida", async () => {
    const m = await prisma.movimiento.create({
      data: {
        tipo: "ENTRADA",
        estatus: "BORRADOR",
        fecha: aFechaDeBase("2026-09-14"),
        moneda: "USD",
        tipoCambio: "17.500000",
        bodegaDestinoId: e.bodegaId,
        proveedorId: e.proveedorId,
        creadoPorId: e.usuarios.COMPRAS.id,
        llaveIdempotencia: randomUUID(),
        partidas: {
          create: [
            // 2 cajas de 12 a 12.50 USD la caja, IVA 16 %: renglón 25.00 USD, IVA 4.00
            { orden: 1, articuloId: e.articuloCajaId, presentacionCapturada: "CAJA", cantidadCapturada: 2, factorConversion: 12, cantidad: 24,
              costoUnitarioCapturado: "12.5000", tasaIva: "0.1600", costoUnitario: "0", costoUnitarioConIva: "0" },
            // 3 piezas a 0.335 USD, IVA 0: renglón 1.005 → 1.01 USD
            { orden: 2, articuloId: e.articuloSueltoId, presentacionCapturada: "UNIDAD", cantidadCapturada: 3, factorConversion: 1, cantidad: 3,
              costoUnitarioCapturado: "0.3350", tasaIva: "0", costoUnitario: "0", costoUnitarioConIva: "0" },
          ],
        },
      },
    });

    await prisma.$transaction(async (tx) => {
      await recalcularCostosYTotales(tx, m.id);
      await expect(crearCapasDeEntrada(tx, m.id)).resolves.toBe(2);
      await asegurarYBloquearExistencias(tx, e.bodegaId, [e.articuloCajaId, e.articuloSueltoId]);
      await expect(incrementarExistencias(tx, m.id, e.bodegaId)).resolves.toBe(2);
      // La base solo acepta capas de una entrada confirmada en la misma transacción.
      await tx.movimiento.update({
        where: { id: m.id },
        data: { estatus: "CONFIRMADO", folio: `E-${randomUUID().slice(0, 8)}`, confirmadoPorId: e.usuarios.COMPRAS.id, confirmadoEn: new Date() },
      });
    });

    const leido = await prisma.movimiento.findUniqueOrThrow({
      where: { id: m.id },
      include: { partidas: { orderBy: { cantidad: "desc" } }, capas: { orderBy: { cantidadInicial: "desc" } } },
    });
    expect([leido.subtotal, leido.iva, leido.total].map(String)).toEqual(["26.01", "4", "30.01"]);
    // 12.50 USD × 17.5 / 12 = 18.229166… → 18.2292; con IVA 21.145833… → 21.1458
    expect(String(leido.partidas[0].costoUnitario)).toBe("18.2292");
    expect(String(leido.partidas[0].costoUnitarioConIva)).toBe("21.1458");
    // 0.335 × 17.5 = 5.8625
    expect(String(leido.partidas[1].costoUnitario)).toBe("5.8625");
    expect(leido.capas.map((c) => [c.cantidadInicial, c.cantidadRestante, String(c.costoUnitario)])).toEqual([
      [24, 24, "18.2292"],
      [3, 3, "5.8625"],
    ]);
    expect(leido.capas.every((c) => c.fechaOriginal.getTime() === leido.fecha.getTime())).toBe(true);

    const existencias = await prisma.existencia.findMany({ where: { bodegaId: e.bodegaId }, orderBy: { cantidad: "desc" } });
    expect(existencias.map((x) => x.cantidad)).toEqual([24, 3]);
  });
});
