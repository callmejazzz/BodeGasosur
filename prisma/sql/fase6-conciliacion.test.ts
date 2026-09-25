/*
  Conciliación de consumo, capa y existencia (85-conciliacion.sql) ante un
  escritor SQL directo: se comprueba al confirmar la transacción, y lo ya
  escrito de capas y consumos no se modifica.
*/
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aFechaDeBase, hoyEnMexico } from "../../src/lib/fechas";
import { URL_PRUEBAS } from "../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../pruebas/semilla-entradas";
import { sembrarCapa, sinDefensas } from "../../pruebas/semilla-inventario";
import { sembrarSalidas, type EntornoSalidas } from "../../pruebas/semilla-salidas";
import { crearCliente } from "../comun";

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;

beforeAll(async () => {
  e = await sembrarSalidas(prisma);
});
afterAll(() => prisma.$disconnect());

const BG606 = /concilia|no coincide|salida retirada/;
const rechazo = (patron: RegExp) => expect.objectContaining({ message: expect.stringMatching(patron) });

/** Artículo propio con una capa de 5 y una salida AUTORIZADA de `pedida` piezas sobre ella. */
async function escenario(pedida = 2) {
  const articulo = await articuloNuevo(prisma, e.unidadId, null);
  const capa = await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: articulo.id, cantidad: 5, fechaOriginal: "2026-09-01", costo: null });
  const salida = await prisma.movimiento.create({
    data: {
      tipo: "SALIDA", estatus: "SOLICITADA", fecha: aFechaDeBase(hoyEnMexico()),
      bodegaOrigenId: e.bodegaId, estacionId: e.estacionId, creadoPorId: e.usuarios.COMPRAS.id, llaveIdempotencia: randomUUID(),
      partidas: { create: [{ orden: 1, articuloId: articulo.id, presentacionCapturada: "UNIDAD", cantidadCapturada: pedida, factorConversion: 1, cantidad: pedida }] },
    },
    include: { partidas: true },
  });
  await prisma.movimiento.update({
    where: { id: salida.id },
    data: { estatus: "AUTORIZADA", autorizadoPorId: e.autorizadores.JEFE.id, autorizadoEn: new Date() },
  });
  return { articuloId: articulo.id, capaId: capa.id, salidaId: salida.id, partidaId: salida.partidas[0].id };
}

type Escenario = Awaited<ReturnType<typeof escenario>>;

const consumir = (tx: Prisma.TransactionClient, s: Escenario, n: number) =>
  tx.consumoCapa.create({ data: { partidaId: s.partidaId, capaId: s.capaId, cantidad: n } });
const descontarCapa = (tx: Prisma.TransactionClient, s: Escenario, n: number) =>
  tx.capaCosto.update({ where: { id: s.capaId }, data: { cantidadRestante: { decrement: n } } });
const descontarExistencia = (tx: Prisma.TransactionClient, s: Escenario, n: number) =>
  tx.existencia.update({ where: { bodegaId_articuloId: { bodegaId: e.bodegaId, articuloId: s.articuloId } }, data: { cantidad: { decrement: n } } });
const retirar = (tx: Prisma.TransactionClient, s: Escenario) =>
  tx.movimiento.update({
    where: { id: s.salidaId },
    data: { estatus: "RETIRADA", folio: `S-${randomUUID().slice(0, 8)}`, entregadoA: "Mensajero", entregadoPorId: e.usuarios.COMPRAS.id, entregadoEn: new Date() },
  });

async function estado(s: Escenario) {
  return {
    estatus: (await prisma.movimiento.findUniqueOrThrow({ where: { id: s.salidaId } })).estatus,
    consumos: await prisma.consumoCapa.count({ where: { partidaId: s.partidaId } }),
    capa: (await prisma.capaCosto.findUniqueOrThrow({ where: { id: s.capaId } })).cantidadRestante,
    existencia: (await prisma.existencia.findUniqueOrThrow({ where: { bodegaId_articuloId: { bodegaId: e.bodegaId, articuloId: s.articuloId } } })).cantidad,
  };
}

describe("conciliación al confirmar", () => {
  it("un retiro que consume, descuenta capa y existencia y cambia de estatus junto se acepta", async () => {
    const s = await escenario();
    await prisma.$transaction(async (tx) => {
      await consumir(tx, s, 2);
      await descontarCapa(tx, s, 2);
      await descontarExistencia(tx, s, 2);
      await retirar(tx, s);
    });
    await expect(estado(s)).resolves.toEqual({ estatus: "RETIRADA", consumos: 1, capa: 3, existencia: 3 });
  });

  it("no se fabrica un retiro que omita descontar la capa o la existencia", async () => {
    const intentos: [string, (tx: Prisma.TransactionClient, s: Escenario) => Promise<unknown>][] = [
      ["sin descontar capa ni existencia", async (tx, s) => { await consumir(tx, s, 2); await retirar(tx, s); }],
      ["sin descontar existencia", async (tx, s) => { await consumir(tx, s, 2); await descontarCapa(tx, s, 2); await retirar(tx, s); }],
      ["descontando de más la capa", async (tx, s) => { await consumir(tx, s, 2); await descontarCapa(tx, s, 3); await descontarExistencia(tx, s, 3); await retirar(tx, s); }],
    ];
    for (const [nombre, intento] of intentos) {
      const s = await escenario();
      const antes = await estado(s);
      await expect(prisma.$transaction((tx) => intento(tx, s)), nombre).rejects.toEqual(rechazo(BG606));
      await expect(estado(s), nombre).resolves.toEqual(antes);
    }
  });

  it("un consumo solo existe en una salida retirada y cubre exacta su partida", async () => {
    const s = await escenario(2);
    // Conciliado en capa y existencia, pero la salida sigue AUTORIZADA.
    await expect(prisma.$transaction(async (tx) => {
      await consumir(tx, s, 2);
      await descontarCapa(tx, s, 2);
      await descontarExistencia(tx, s, 2);
    })).rejects.toEqual(rechazo(BG606));

    // Retirada correctamente, después se le agrega otro consumo conciliado.
    await prisma.$transaction(async (tx) => {
      await consumir(tx, s, 2);
      await descontarCapa(tx, s, 2);
      await descontarExistencia(tx, s, 2);
      await retirar(tx, s);
    });
    const otra = await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: s.articuloId, cantidad: 1, fechaOriginal: "2026-09-02", costo: null });
    await expect(prisma.$transaction(async (tx) => {
      await tx.consumoCapa.create({ data: { partidaId: s.partidaId, capaId: otra.id, cantidad: 1 } });
      await tx.capaCosto.update({ where: { id: otra.id }, data: { cantidadRestante: 0 } });
      await descontarExistencia(tx, s, 1);
    })).rejects.toEqual(rechazo(BG606));
    await expect(estado(s)).resolves.toMatchObject({ consumos: 1, existencia: 4 });
  });

  it("un consumo colgado de una partida de entrada se rechaza", async () => {
    const s = await escenario();
    const entrada = await prisma.movimiento.create({
      data: {
        tipo: "ENTRADA", estatus: "BORRADOR", fecha: aFechaDeBase("2026-09-10"), moneda: "MXN",
        proveedorId: e.proveedorId, bodegaDestinoId: e.bodegaId, creadoPorId: e.usuarios.COMPRAS.id, llaveIdempotencia: randomUUID(),
        partidas: { create: [{ orden: 1, articuloId: s.articuloId, presentacionCapturada: "UNIDAD", cantidadCapturada: 1, factorConversion: 1, cantidad: 1, costoUnitarioCapturado: "1", tasaIva: "0", costoUnitario: "1", costoUnitarioConIva: "1" }] },
      },
      include: { partidas: true },
    });
    await expect(prisma.$transaction(async (tx) => {
      await tx.consumoCapa.create({ data: { partidaId: entrada.partidas[0].id, capaId: s.capaId, cantidad: 1 } });
      await descontarCapa(tx, s, 1);
      await descontarExistencia(tx, s, 1);
    })).rejects.toEqual(rechazo(BG606));
  });

  it("la existencia no se mueve sola, ni se crea sin capas", async () => {
    const s = await escenario();
    await expect(descontarExistencia(prisma, s, 1)).rejects.toEqual(rechazo(BG606));
    await expect(descontarCapa(prisma, s, 1)).rejects.toEqual(rechazo(BG606));
    const otro = await articuloNuevo(prisma, e.unidadId, null);
    await expect(prisma.existencia.create({ data: { bodegaId: e.bodegaId, articuloId: otro.id, cantidad: 3 } })).rejects.toEqual(rechazo(BG606));
    // En cero, sin capas, sí: es lo que crea la confirmación antes de bloquear.
    await expect(prisma.existencia.create({ data: { bodegaId: e.bodegaId, articuloId: otro.id, cantidad: 0 } })).resolves.toMatchObject({ cantidad: 0 });
  });

  it("adelantar la comprobación no la evita", async () => {
    const s = await escenario();
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      await consumir(tx, s, 2);
    })).rejects.toEqual(rechazo(BG606));
  });
});

describe("lo ya escrito", () => {
  it("de una capa solo cambia lo que le queda, y no se borra", async () => {
    const s = await escenario();
    // Subir cantidadInicial "conciliaría" un consumo sin descontar nada.
    await expect(prisma.$transaction(async (tx) => {
      await consumir(tx, s, 2);
      await tx.capaCosto.update({ where: { id: s.capaId }, data: { cantidadInicial: 7 } });
      await retirar(tx, s);
    })).rejects.toEqual(rechazo(/solo cambia lo que le queda/));
    for (const data of [{ costoUnitario: "1", costoUnitarioConIva: "1" }, { fechaOriginal: aFechaDeBase("2020-01-01") }, { bodegaId: e.otraBodegaId }]) {
      await expect(prisma.capaCosto.update({ where: { id: s.capaId }, data }), JSON.stringify(data)).rejects.toEqual(rechazo(/solo cambia/));
    }
    await expect(prisma.capaCosto.delete({ where: { id: s.capaId } })).rejects.toEqual(rechazo(/no se borra/));
  });

  it("un consumo no se modifica ni se borra", async () => {
    const s = await escenario();
    await prisma.$transaction(async (tx) => {
      await consumir(tx, s, 2);
      await descontarCapa(tx, s, 2);
      await descontarExistencia(tx, s, 2);
      await retirar(tx, s);
    });
    const [consumo] = await prisma.consumoCapa.findMany({ where: { partidaId: s.partidaId } });
    await expect(prisma.consumoCapa.update({ where: { id: consumo.id }, data: { costoUnitario: "9", costoUnitarioConIva: "9" } })).rejects.toEqual(rechazo(/no se modifica/));
    await expect(prisma.consumoCapa.delete({ where: { id: consumo.id } })).rejects.toEqual(rechazo(/no se modifica/));
  });
});

describe("preflight: inventario_sin_conciliar()", () => {
  /** Qué problemas reporta el preflight para esta referencia. */
  async function problemas(referencia: string) {
    const filas = await prisma.$queryRaw<{ problema: string }[]>`
      SELECT problema FROM inventario_sin_conciliar() WHERE referencia = ${referencia}`;
    return filas.map((f) => f.problema).sort();
  }

  /** Datos históricos dañados: se escriben sin triggers ni llaves foráneas. */
  const danar = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => sinDefensas(prisma, fn);

  it("un retiro conciliado no aparece", async () => {
    const s = await escenario();
    await prisma.$transaction(async (tx) => {
      await consumir(tx, s, 2);
      await descontarCapa(tx, s, 2);
      await descontarExistencia(tx, s, 2);
      await retirar(tx, s);
    });
    const [consumo] = await prisma.consumoCapa.findMany({ where: { partidaId: s.partidaId } });
    for (const referencia of [s.capaId, s.partidaId, consumo.id, `${e.bodegaId}/${s.articuloId}`]) {
      await expect(problemas(referencia), referencia).resolves.toEqual([]);
    }
  });

  it("capa cuyo descuento no es la suma de sus consumos, y existencia que no es la suma de sus capas", async () => {
    const s = await escenario();
    await danar((tx) => tx.capaCosto.update({ where: { id: s.capaId }, data: { cantidadRestante: 4 } }));
    await expect(problemas(s.capaId)).resolves.toEqual(["capa"]);
    await expect(problemas(`${e.bodegaId}/${s.articuloId}`)).resolves.toEqual(["existencia"]);
  });

  it("partida de una salida retirada sin consumos, o con consumos que no la cubren", async () => {
    for (const consumida of [0, 1]) {
      const s = await escenario(2);
      await danar(async (tx) => {
        if (consumida) await consumir(tx, s, consumida);
        await retirar(tx, s);
      });
      await expect(problemas(s.partidaId), `consumida ${consumida}`).resolves.toEqual(["partida-retirada"]);
    }
  });

  it("consumo fuera de una salida retirada", async () => {
    const s = await escenario();
    const consumo = await danar((tx) => consumir(tx, s, 2));
    await expect(problemas(consumo.id)).resolves.toEqual(["consumo-fuera-de-salida"]);
  });

  it("consumo de una capa de otro artículo, de otra bodega o con otro par de costos", async () => {
    const otroArticulo = await articuloNuevo(prisma, e.unidadId, null);
    const casos: [string, (s: Escenario) => Promise<string>][] = [
      ["otro artículo", async () => (await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: otroArticulo.id, cantidad: 5, fechaOriginal: "2026-09-01", costo: null })).id],
      ["otra bodega", async (s) => (await sembrarCapa(prisma, e, { bodegaId: e.otraBodegaId, articuloId: s.articuloId, cantidad: 5, fechaOriginal: "2026-09-01", costo: null })).id],
      ["otro costo", async (s) => s.capaId],
    ];
    for (const [nombre, capaDe] of casos) {
      const s = await escenario(2);
      const capaId = await capaDe(s);
      const consumo = await danar(async (tx) => {
        const c = await tx.consumoCapa.create({
          data: { partidaId: s.partidaId, capaId, cantidad: 2, ...(nombre === "otro costo" ? { costoUnitario: "1", costoUnitarioConIva: "1" } : {}) },
        });
        await retirar(tx, s);
        return c;
      });
      await expect(problemas(consumo.id), nombre).resolves.toEqual(["consumo-de-otra-capa"]);
    }
  });
});
