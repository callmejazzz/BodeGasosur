/*
  Frontera SQL de la fase 7 (990-traspasos-devoluciones-conteo.sql,
  991-devolucion-a-su-bodega.sql y 995-entrada-con-sus-capas.sql) ante un
  escritor directo: entradas, traspasos, devoluciones, ajustes, reversas y
  hojas de conteo concilian con sus partidas al confirmar la transacción, o no
  se guarda nada. Los servicios no participan: se escribe fila por fila.
*/
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { aFechaDeBase, hoyEnMexico } from "../../src/lib/fechas";
import { URL_PRUEBAS } from "../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../pruebas/semilla-entradas";
import { sembrarCapa, sinDefensas } from "../../pruebas/semilla-inventario";
import { sembrarSalidas, type EntornoSalidas } from "../../pruebas/semilla-salidas";
import { firmarToken } from "../../pruebas/tokens";
import { crearCliente } from "../comun";

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
const hoy = aFechaDeBase(hoyEnMexico());

beforeAll(async () => {
  e = await sembrarSalidas(prisma);
});
afterAll(() => prisma.$disconnect());

type Tx = Prisma.TransactionClient;
const rechazo = (patron: RegExp) => expect.objectContaining({ message: expect.stringMatching(patron) });
const folio = (prefijo: string) => `${prefijo}-${randomUUID().slice(0, 12)}`;

const articulo = async () => (await articuloNuevo(prisma, e.unidadId, null)).id;
const capa = (bodegaId: string, articuloId: string, cantidad: number, fechaOriginal: string, costo: [string, string] | null = null) =>
  sembrarCapa(prisma, e, { bodegaId, articuloId, cantidad, fechaOriginal, costo });

type Datos = Partial<Prisma.MovimientoUncheckedCreateInput> & Pick<Prisma.MovimientoUncheckedCreateInput, "tipo">;

/** Un movimiento en borrador con sus partidas en unidades, como lo dejaría la captura. */
async function borrador(tx: Tx, datos: Datos, partidas: [string, number][]) {
  return tx.movimiento.create({
    data: {
      estatus: "BORRADOR", fecha: hoy, creadoPorId: e.usuarios.COMPRAS.id,
      llaveIdempotencia: datos.cancelaAId || datos.tipo === "AJUSTE" ? null : randomUUID(),
      ...datos,
      partidas: {
        create: partidas.map(([articuloId, cantidad], i) => ({
          orden: i + 1, articuloId, presentacionCapturada: "UNIDAD" as const, cantidadCapturada: cantidad, factorConversion: 1, cantidad,
        })),
      },
    },
    include: { partidas: true },
  });
}

const confirmar = (tx: Tx, id: string, prefijo = "X") =>
  tx.movimiento.update({ where: { id }, data: { estatus: "CONFIRMADO", folio: folio(prefijo), confirmadoPorId: e.usuarios.COMPRAS.id, confirmadoEn: new Date() } });

// El CHECK se evalúa sobre la fila propuesta aun si choca: descontar va por update.
const mover = (tx: Tx, bodegaId: string, articuloId: string, delta: number) =>
  delta < 0
    ? tx.existencia.update({ where: { bodegaId_articuloId: { bodegaId, articuloId } }, data: { cantidad: { increment: delta } } })
    : tx.existencia.upsert({
        where: { bodegaId_articuloId: { bodegaId, articuloId } },
        create: { bodegaId, articuloId, cantidad: delta },
        update: { cantidad: { increment: delta } },
      });

const consumir = async (tx: Tx, partidaId: string, capaId: string, cantidad: number) => {
  const c = await tx.capaCosto.update({ where: { id: capaId }, data: { cantidadRestante: { decrement: cantidad } } });
  return tx.consumoCapa.create({ data: { partidaId, capaId, cantidad, costoUnitario: c.costoUnitario, costoUnitarioConIva: c.costoUnitarioConIva } });
};

async function existencia(bodegaId: string, articuloId: string) {
  return (await prisma.existencia.findUnique({ where: { bodegaId_articuloId: { bodegaId, articuloId } } }))?.cantidad ?? 0;
}

/** Una salida retirada de `cantidad` piezas de la capa dada, escrita a mano y conciliada. */
async function salidaRetirada(articuloId: string, capaId: string, cantidad: number, estacionId = e.estacionId) {
  const s = await prisma.movimiento.create({
    data: {
      tipo: "SALIDA", estatus: "SOLICITADA", fecha: hoy, bodegaOrigenId: e.bodegaId, estacionId, esPrestamo: true,
      creadoPorId: e.usuarios.COMPRAS.id, llaveIdempotencia: randomUUID(),
      partidas: { create: [{ orden: 1, articuloId, presentacionCapturada: "UNIDAD", cantidadCapturada: cantidad, factorConversion: 1, cantidad }] },
    },
    include: { partidas: true },
  });
  await prisma.movimiento.update({ where: { id: s.id }, data: { estatus: "AUTORIZADA", autorizadoPorId: e.autorizadores.JEFE.id, autorizadoEn: new Date() } });
  await prisma.$transaction(async (tx) => {
    await consumir(tx, s.partidas[0].id, capaId, cantidad);
    await mover(tx, e.bodegaId, articuloId, -cantidad);
    await tx.movimiento.update({
      where: { id: s.id },
      data: { estatus: "RETIRADA", folio: folio("S"), entregadoA: "Mensajero", entregadoPorId: e.usuarios.COMPRAS.id, entregadoEn: new Date() },
    });
  });
  return { id: s.id, partidaId: s.partidas[0].id };
}

// ─────────────────────────────── Traspasos ──────────────────────────────────

/** El traspaso legítimo de A a B: consume, crea hijas con fecha original y costo, mueve existencias. */
async function traspasar(tx: Tx, articuloId: string, capas: { id: string; cantidad: number }[], cambios: { hija?: (i: number) => Partial<Prisma.CapaCostoUncheckedCreateInput> } = {}) {
  const total = capas.reduce((n, c) => n + c.cantidad, 0);
  const t = await borrador(tx, { tipo: "TRASPASO", bodegaOrigenId: e.bodegaId, bodegaDestinoId: e.otraBodegaId }, [[articuloId, total]]);
  for (const [i, c] of capas.entries()) {
    const k = await consumir(tx, t.partidas[0].id, c.id, c.cantidad);
    const origen = await tx.capaCosto.findUniqueOrThrow({ where: { id: c.id } });
    await tx.capaCosto.create({
      data: {
        bodegaId: e.otraBodegaId, articuloId, movimientoId: t.id, origenId: c.id, fecha: hoy, fechaOriginal: origen.fechaOriginal,
        cantidadInicial: c.cantidad, cantidadRestante: c.cantidad, costoUnitario: k.costoUnitario, costoUnitarioConIva: k.costoUnitarioConIva,
        ...cambios.hija?.(i),
      },
    });
  }
  await mover(tx, e.bodegaId, articuloId, -total);
  await mover(tx, e.otraBodegaId, articuloId, total);
  await confirmar(tx, t.id, "T");
  return t;
}

describe("traspasos", () => {
  it("un traspaso de varias capas conserva fecha original y costos, y concilia en ambas bodegas", async () => {
    const x = await articulo();
    const vieja = await capa(e.bodegaId, x, 3, "2026-08-01", ["10.0000", "11.6000"]);
    const nueva = await capa(e.bodegaId, x, 4, "2026-09-01");
    const t = await prisma.$transaction((tx) => traspasar(tx, x, [{ id: vieja.id, cantidad: 3 }, { id: nueva.id, cantidad: 1 }]));
    const hijas = await prisma.capaCosto.findMany({ where: { movimientoId: t.id }, orderBy: { fechaOriginal: "asc" } });
    expect(hijas.map((h) => [h.origenId, h.bodegaId, h.fechaOriginal.toISOString().slice(0, 10), h.cantidadInicial, h.costoUnitario?.toString() ?? null])).toEqual([
      [vieja.id, e.otraBodegaId, "2026-08-01", 3, "10"],
      [nueva.id, e.otraBodegaId, "2026-09-01", 1, null],
    ]);
    await expect(existencia(e.bodegaId, x)).resolves.toBe(3);
    await expect(existencia(e.otraBodegaId, x)).resolves.toBe(4);
  });

  it("una capa hija que cambia fecha, costo, bodega o cantidad no se confirma", async () => {
    const cambios: [string, Partial<Prisma.CapaCostoUncheckedCreateInput>][] = [
      ["fecha original", { fechaOriginal: aFechaDeBase("2026-09-20") }],
      ["costo", { costoUnitario: "1", costoUnitarioConIva: "1" }],
      ["bodega", { bodegaId: e.bodegaId }],
      ["cantidad", { cantidadInicial: 3, cantidadRestante: 3 }],
      ["sin origen", { origenId: null }],
    ];
    for (const [nombre, cambio] of cambios) {
      const x = await articulo();
      const c = await capa(e.bodegaId, x, 5, "2026-08-01", ["2.0000", "2.3200"]);
      await expect(prisma.$transaction((tx) => traspasar(tx, x, [{ id: c.id, cantidad: 2 }], { hija: () => cambio })), nombre).rejects.toEqual(
        rechazo(/no concilia|no coincide|concilia/),
      );
      await expect(existencia(e.bodegaId, x), nombre).resolves.toBe(5);
      await expect(existencia(e.otraBodegaId, x), nombre).resolves.toBe(0);
    }
  });

  it("sin hijas, sin consumos o con origen y destino iguales no hay traspaso", async () => {
    const x = await articulo();
    const c = await capa(e.bodegaId, x, 5, "2026-08-01");
    // Descontar en origen sin crear nada en destino.
    await expect(prisma.$transaction(async (tx) => {
      const t = await borrador(tx, { tipo: "TRASPASO", bodegaOrigenId: e.bodegaId, bodegaDestinoId: e.otraBodegaId }, [[x, 2]]);
      await consumir(tx, t.partidas[0].id, c.id, 2);
      await mover(tx, e.bodegaId, x, -2);
      await confirmar(tx, t.id);
    })).rejects.toEqual(rechazo(/crea en destino una capa por cada capa consumida/));
    // Confirmar sin mover nada.
    await expect(prisma.$transaction(async (tx) => {
      const t = await borrador(tx, { tipo: "TRASPASO", bodegaOrigenId: e.bodegaId, bodegaDestinoId: e.otraBodegaId }, [[x, 2]]);
      await confirmar(tx, t.id);
    })).rejects.toEqual(rechazo(/no cubren exactamente/));
    await expect(prisma.$transaction((tx) => borrador(tx, { tipo: "TRASPASO", bodegaOrigenId: e.bodegaId, bodegaDestinoId: e.bodegaId }, [[x, 1]]))).rejects.toThrow(
      /movimiento_traspaso_ck/,
    );
    await expect(existencia(e.bodegaId, x)).resolves.toBe(5);
  });

  it("un traspaso capturado lleva llave; confirmado no se edita ni se borra", async () => {
    const x = await articulo();
    await expect(prisma.$transaction((tx) => borrador(tx, { tipo: "TRASPASO", bodegaOrigenId: e.bodegaId, bodegaDestinoId: e.otraBodegaId, llaveIdempotencia: null }, [[x, 1]]))).rejects.toThrow(
      /movimiento_captura_llave_ck/,
    );
    const c = await capa(e.bodegaId, x, 2, "2026-08-01");
    const t = await prisma.$transaction((tx) => traspasar(tx, x, [{ id: c.id, cantidad: 2 }]));
    await expect(prisma.movimiento.update({ where: { id: t.id }, data: { observaciones: "cambio" } })).rejects.toThrow(/ya no se edita/);
    await expect(prisma.movimiento.update({ where: { id: t.id }, data: { estatus: "CANCELADO", canceladoPorId: e.usuarios.COMPRAS.id, canceladoEn: new Date(), motivoCancelacion: "x" } })).rejects.toThrow(/ya no se edita/);
    await expect(prisma.movimientoPartida.update({ where: { id: t.partidas[0].id }, data: { cantidad: 1, cantidadCapturada: 1 } })).rejects.toThrow(/no se modifican/);
    await expect(prisma.movimiento.delete({ where: { id: t.id } })).rejects.toThrow(/no se borra/);
  });
});

// ────────────────────────────── Devoluciones ────────────────────────────────

/** Una devolución a la bodega del entorno: capas hijas de los consumos de la salida, o sin costo si no hay salida. */
async function devolver(
  tx: Tx,
  articuloId: string,
  cantidad: number,
  salida: { id: string } | null,
  hijas: { capaId: string; cantidad: number; costo?: [string, string] | null }[] = [],
  bodegaId = e.bodegaId,
) {
  const d = await borrador(tx, { tipo: "DEVOLUCION", bodegaDestinoId: bodegaId, estacionId: e.estacionId, devuelveAId: salida?.id ?? null }, [[articuloId, cantidad]]);
  if (salida) {
    for (const h of hijas) {
      const origen = await tx.capaCosto.findUniqueOrThrow({ where: { id: h.capaId } });
      await tx.capaCosto.create({
        data: {
          bodegaId, articuloId, movimientoId: d.id, origenId: h.capaId, fecha: hoy, fechaOriginal: origen.fechaOriginal,
          cantidadInicial: h.cantidad, cantidadRestante: h.cantidad,
          costoUnitario: h.costo === undefined ? origen.costoUnitario : (h.costo?.[0] ?? null),
          costoUnitarioConIva: h.costo === undefined ? origen.costoUnitarioConIva : (h.costo?.[1] ?? null),
        },
      });
    }
  } else {
    await tx.capaCosto.create({
      data: { bodegaId, articuloId, movimientoId: d.id, fecha: hoy, fechaOriginal: hoy, cantidadInicial: cantidad, cantidadRestante: cantidad },
    });
  }
  await mover(tx, bodegaId, articuloId, cantidad);
  await confirmar(tx, d.id, "D");
  return d;
}

// ──────────────────────────────── Entradas ──────────────────────────────────

type PartidaEntrada = { articuloId: string; cantidad: number };
const COSTO = ["10.0000", "11.6000"] as const;

/** Una entrada en borrador con costo y tasa en cada partida, como la deja la captura. */
const entradaEnBorrador = (tx: Tx, partidas: PartidaEntrada[]) =>
  tx.movimiento.create({
    data: {
      tipo: "ENTRADA", estatus: "BORRADOR", fecha: hoy, moneda: "MXN", proveedorId: e.proveedorId, bodegaDestinoId: e.bodegaId,
      creadoPorId: e.usuarios.COMPRAS.id, llaveIdempotencia: randomUUID(),
      partidas: {
        create: partidas.map((p, i) => ({
          orden: i + 1, articuloId: p.articuloId, presentacionCapturada: "UNIDAD" as const, cantidadCapturada: p.cantidad, factorConversion: 1, cantidad: p.cantidad,
          costoUnitarioCapturado: COSTO[0], tasaIva: "0.1600", costoUnitario: COSTO[0], costoUnitarioConIva: COSTO[1],
        })),
      },
    },
  });

/** La capa que la recepción crea para una partida, con su existencia; `cambios` la aparta de la partida. */
async function recibir(tx: Tx, entradaId: string, p: PartidaEntrada, cambios: Partial<Prisma.CapaCostoUncheckedCreateInput> = {}) {
  const capa = await tx.capaCosto.create({
    data: {
      bodegaId: e.bodegaId, articuloId: p.articuloId, movimientoId: entradaId, fecha: hoy, fechaOriginal: hoy,
      cantidadInicial: p.cantidad, cantidadRestante: p.cantidad, costoUnitario: COSTO[0], costoUnitarioConIva: COSTO[1], ...cambios,
    },
  });
  await mover(tx, capa.bodegaId, capa.articuloId, capa.cantidadRestante);
}

const confirmarEntrada = (tx: Tx, id: string) =>
  tx.movimiento.update({
    where: { id },
    data: { estatus: "CONFIRMADO", folio: folio("E"), confirmadoPorId: e.usuarios.COMPRAS.id, confirmadoEn: new Date(), subtotal: "0", iva: "0", total: "0" },
  });

describe("entradas", () => {
  const sinCapas = rechazo(/una capa por partida/);
  const dos = async (): Promise<[PartidaEntrada, PartidaEntrada]> => [{ articuloId: await articulo(), cantidad: 3 }, { articuloId: await articulo(), cantidad: 2 }];

  it("con una capa por partida, igual a ella, se confirma y la existencia sube lo recibido", async () => {
    const [p, q] = await dos();
    await prisma.$transaction(async (tx) => {
      const m = await entradaEnBorrador(tx, [p, q]);
      await recibir(tx, m.id, p);
      await recibir(tx, m.id, q);
      await confirmarEntrada(tx, m.id);
    });
    await expect(existencia(e.bodegaId, p.articuloId)).resolves.toBe(3);
    await expect(existencia(e.bodegaId, q.articuloId)).resolves.toBe(2);
  });

  it("no se confirma sin capas ni existencia, ni con capas de menos", async () => {
    const [p, q] = await dos();
    const m = await entradaEnBorrador(prisma, [p, q]);
    await expect(prisma.$transaction((tx) => confirmarEntrada(tx, m.id))).rejects.toEqual(sinCapas);
    await expect(prisma.$transaction(async (tx) => {
      await recibir(tx, m.id, p);
      await confirmarEntrada(tx, m.id);
    })).rejects.toEqual(sinCapas);
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id: m.id } })).resolves.toMatchObject({ estatus: "BORRADOR", folio: null });
    await expect(existencia(e.bodegaId, p.articuloId)).resolves.toBe(0);
  });

  it("ni con una capa distinta de su partida o de más", async () => {
    const otraFecha = aFechaDeBase("2026-01-01");
    const variantes: [string, (p: PartidaEntrada) => Partial<Prisma.CapaCostoUncheckedCreateInput>][] = [
      ["más piezas", () => ({ cantidadInicial: 4, cantidadRestante: 4 })],
      ["otro costo", () => ({ costoUnitario: "9.0000", costoUnitarioConIva: "10.4400" })],
      ["sin costo", () => ({ costoUnitario: null, costoUnitarioConIva: null })],
      ["otra fecha original", () => ({ fechaOriginal: otraFecha })],
      ["otra bodega", () => ({ bodegaId: e.otraBodegaId })],
    ];
    for (const [nombre, cambios] of variantes) {
      const [p] = await dos();
      await expect(prisma.$transaction(async (tx) => {
        const m = await entradaEnBorrador(tx, [p]);
        await recibir(tx, m.id, p, cambios(p));
        await confirmarEntrada(tx, m.id);
      }), nombre).rejects.toEqual(rechazo(/no concilia/));
    }
    const [p, q] = await dos();
    await expect(prisma.$transaction(async (tx) => {
      const m = await entradaEnBorrador(tx, [p]);
      await recibir(tx, m.id, p);
      await recibir(tx, m.id, q);
      await confirmarEntrada(tx, m.id);
    }), "artículo ajeno").rejects.toEqual(sinCapas);
  });

  it("adelantar la comprobación no la evita", async () => {
    const [p] = await dos();
    const m = await entradaEnBorrador(prisma, [p]);
    await expect(prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      await confirmarEntrada(tx, m.id);
    })).rejects.toEqual(sinCapas);
  });

  it("el preflight encuentra la entrada que ya se confirmó sin capas", async () => {
    const [p] = await dos();
    const m = await entradaEnBorrador(prisma, [p]);
    await sinDefensas(prisma, (tx) => confirmarEntrada(tx, m.id));
    await expect(prisma.$queryRaw`SELECT problema FROM movimientos_sin_conciliar() WHERE movimiento = ${m.id}::uuid`).resolves.toEqual([
      { problema: expect.stringMatching(/una capa por partida/) },
    ]);
  });

  it("la migración es copia fiel de prisma/sql/despues", () => {
    const RAIZ = join(import.meta.dirname, "../..");
    const migracion = readFileSync(join(RAIZ, "prisma/migrations/20261008100000_entrada_con_sus_capas/migration.sql"), "utf8");
    expect(migracion).toContain(readFileSync(join(RAIZ, "prisma/sql/despues/995-entrada-con-sus-capas.sql"), "utf8"));
  });
});

describe("devoluciones", () => {
  it("parciales heredan costo y fecha original hasta completar lo retirado, nunca más", async () => {
    const x = await articulo();
    const c = await capa(e.bodegaId, x, 10, "2026-08-01", ["4.0000", "4.6400"]);
    const s = await salidaRetirada(x, c.id, 5);
    await prisma.$transaction((tx) => devolver(tx, x, 2, s, [{ capaId: c.id, cantidad: 2 }]));
    await prisma.$transaction((tx) => devolver(tx, x, 3, s, [{ capaId: c.id, cantidad: 3 }]));
    await expect(prisma.$transaction((tx) => devolver(tx, x, 1, s, [{ capaId: c.id, cantidad: 1 }]))).rejects.toEqual(rechazo(/exceden lo que salió/));
    await expect(existencia(e.bodegaId, x)).resolves.toBe(10);
  });

  it("dos escritores que juntos exceden lo retirado: el segundo en confirmar se rechaza", async () => {
    const x = await articulo();
    const c = await capa(e.bodegaId, x, 5, "2026-08-01");
    const s = await salidaRetirada(x, c.id, 5);
    // Las dos regresan a la bodega de la salida: la existencia las forma y la segunda ve las capas de la primera.
    const escribir = () => prisma.$transaction((tx) => devolver(tx, x, 3, s, [{ capaId: c.id, cantidad: 3 }]));
    const resultados = await Promise.allSettled([escribir(), escribir()]);
    expect(resultados.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((resultados.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toEqual(rechazo(/exceden lo que salió/));
    await expect(existencia(e.bodegaId, x)).resolves.toBe(3);
  });

  it("vinculada regresa a la bodega de la que salió; sin salida, a cualquiera", async () => {
    const x = await articulo();
    const c = await capa(e.bodegaId, x, 3, "2026-08-01");
    const s = await salidaRetirada(x, c.id, 3);
    const aOtra = rechazo(/regresa a la bodega de la que salió/);
    await expect(prisma.$transaction((tx) => devolver(tx, x, 1, s, [{ capaId: c.id, cantidad: 1 }], e.otraBodegaId))).rejects.toEqual(aOtra);

    const libre = await prisma.$transaction((tx) => borrador(tx, { tipo: "DEVOLUCION", bodegaDestinoId: e.otraBodegaId, estacionId: e.estacionId }, [[x, 1]]));
    await expect(prisma.movimiento.update({ where: { id: libre.id }, data: { devuelveAId: s.id } })).rejects.toEqual(aOtra);
    const ligada = await prisma.movimiento.update({ where: { id: libre.id }, data: { devuelveAId: s.id, bodegaDestinoId: e.bodegaId } });
    await expect(prisma.movimiento.update({ where: { id: ligada.id }, data: { bodegaDestinoId: e.otraBodegaId } })).rejects.toEqual(aOtra);
    await expect(prisma.$transaction((tx) => devolver(tx, x, 1, null, [], e.otraBodegaId))).resolves.toBeTruthy();
    await expect(existencia(e.otraBodegaId, x)).resolves.toBe(1);
  });

  it("una devolución revertida deja de contar para el saldo", async () => {
    const x = await articulo();
    const c = await capa(e.bodegaId, x, 4, "2026-08-01");
    const s = await salidaRetirada(x, c.id, 4);
    const d = await prisma.$transaction((tx) => devolver(tx, x, 4, s, [{ capaId: c.id, cantidad: 4 }]));
    await prisma.$transaction((tx) => revertirIngreso(tx, d.id, x, 4, e.bodegaId));
    await expect(prisma.$transaction((tx) => devolver(tx, x, 4, s, [{ capaId: c.id, cantidad: 4 }]))).resolves.toBeTruthy();
  });

  it("vinculada exige salida retirada de la misma estación, sin reversa, y capas que hereden de sus consumos", async () => {
    const x = await articulo();
    const c = await capa(e.bodegaId, x, 10, "2026-08-01", ["4.0000", "4.6400"]);
    const otra = await capa(e.bodegaId, x, 1, "2026-08-02");
    const s = await salidaRetirada(x, c.id, 3);
    const solicitada = await prisma.movimiento.create({
      data: {
        tipo: "SALIDA", estatus: "SOLICITADA", fecha: hoy, bodegaOrigenId: e.bodegaId, estacionId: e.estacionId,
        creadoPorId: e.usuarios.COMPRAS.id, llaveIdempotencia: randomUUID(),
      },
    });
    await expect(prisma.$transaction((tx) => devolver(tx, x, 1, solicitada, [{ capaId: c.id, cantidad: 1 }]))).rejects.toEqual(rechazo(/salida retirada o recibida/));
    await expect(prisma.$transaction((tx) => devolver(tx, x, 1, s, [{ capaId: c.id, cantidad: 1, costo: ["9.0000", "9.0000"] }]))).rejects.toEqual(rechazo(/no heredan/));
    await expect(prisma.$transaction((tx) => devolver(tx, x, 1, s, [{ capaId: otra.id, cantidad: 1 }]))).rejects.toEqual(rechazo(/no heredan/));
    await expect(prisma.$transaction((tx) => devolver(tx, x, 2, s, [{ capaId: c.id, cantidad: 1 }]))).rejects.toEqual(rechazo(/no heredan/));

    const empresa = await prisma.empresa.create({ data: { razonSocial: `Empresa ${randomUUID().slice(0, 8)}` } });
    const lejana = await prisma.estacion.create({ data: { numero: `EL${randomUUID().slice(0, 8)}`, alias: "Lejana", empresaId: empresa.id } });
    const ajena = await salidaRetirada(x, c.id, 1, lejana.id);
    await expect(prisma.$transaction((tx) => devolver(tx, x, 1, ajena, [{ capaId: c.id, cantidad: 1 }]))).rejects.toEqual(rechazo(/misma estación/));
    await expect(existencia(e.bodegaId, x)).resolves.toBe(7);
  });

  it("sin salida entra sin costo y con su propia fecha", async () => {
    const x = await articulo();
    await prisma.$transaction((tx) => devolver(tx, x, 2, null));
    await expect(existencia(e.bodegaId, x)).resolves.toBe(2);
    await expect(prisma.$transaction(async (tx) => {
      const d = await borrador(tx, { tipo: "DEVOLUCION", bodegaDestinoId: e.bodegaId, estacionId: e.estacionId }, [[x, 1]]);
      await tx.capaCosto.create({
        data: { bodegaId: e.bodegaId, articuloId: x, movimientoId: d.id, fecha: hoy, fechaOriginal: aFechaDeBase("2026-01-01"), cantidadInicial: 1, cantidadRestante: 1 },
      });
      await mover(tx, e.bodegaId, x, 1);
      await confirmar(tx, d.id);
    })).rejects.toEqual(rechazo(/capa sin costo por partida/));
  });
});

// ──────────────────────────────── Ajustes ───────────────────────────────────

describe("ajustes", () => {
  it("el positivo crea capa sin costo; el negativo consume y no crea capas", async () => {
    const x = await articulo();
    await expect(prisma.$transaction(async (tx) => {
      const a = await borrador(tx, { tipo: "AJUSTE", bodegaDestinoId: e.bodegaId, motivo: "Conteo" }, [[x, 3]]);
      await tx.capaCosto.create({
        data: { bodegaId: e.bodegaId, articuloId: x, movimientoId: a.id, fecha: hoy, fechaOriginal: hoy, cantidadInicial: 3, cantidadRestante: 3, costoUnitario: "1", costoUnitarioConIva: "1" },
      });
      await mover(tx, e.bodegaId, x, 3);
      await confirmar(tx, a.id, "A");
    })).rejects.toEqual(rechazo(/capa sin costo por partida/));

    const c = await capa(e.bodegaId, x, 5, "2026-08-01");
    await expect(prisma.$transaction(async (tx) => {
      const a = await borrador(tx, { tipo: "AJUSTE", bodegaOrigenId: e.bodegaId, motivo: "Merma" }, [[x, 2]]);
      await consumir(tx, a.partidas[0].id, c.id, 2);
      await mover(tx, e.bodegaId, x, -2);
      await confirmar(tx, a.id, "A");
    })).resolves.toBeUndefined();
    await expect(existencia(e.bodegaId, x)).resolves.toBe(3);
  });

  it("un ajuste necesita motivo y un conteo solo cuelga de un ajuste", async () => {
    const x = await articulo();
    await expect(prisma.$transaction((tx) => borrador(tx, { tipo: "AJUSTE", bodegaDestinoId: e.bodegaId, motivo: "  " }, [[x, 1]]))).rejects.toThrow(/movimiento_motivo_ck/);
    await expect(prisma.$transaction((tx) => borrador(tx, { tipo: "DEVOLUCION", bodegaDestinoId: e.bodegaId, estacionId: e.estacionId, motivo: "x" }, [[x, 1]]))).rejects.toThrow(
      /movimiento_motivo_ck/,
    );
  });
});

// ──────────────────────────────── Reversas ──────────────────────────────────

/** Reversa de un ingreso: consume completas las capas que creó el original. */
async function revertirIngreso(tx: Tx, originalId: string, articuloId: string, cantidad: number, bodegaId: string) {
  const r = await borrador(tx, { tipo: "AJUSTE", bodegaOrigenId: bodegaId, motivo: "Error de captura", cancelaAId: originalId }, [[articuloId, cantidad]]);
  for (const k of await tx.capaCosto.findMany({ where: { movimientoId: originalId } })) {
    await consumir(tx, r.partidas[0].id, k.id, k.cantidadInicial);
  }
  await mover(tx, bodegaId, articuloId, -cantidad);
  await confirmar(tx, r.id, "A");
  return r;
}

/** Reversa de un egreso: restituye cada consumo del original a su capa exacta. */
async function revertirEgreso(tx: Tx, originalId: string, articuloId: string, cantidad: number, bodegaId: string, omitir = 0) {
  const r = await borrador(tx, { tipo: "AJUSTE", bodegaDestinoId: bodegaId, motivo: "Error de captura", cancelaAId: originalId }, [[articuloId, cantidad]]);
  const consumos = await tx.consumoCapa.findMany({ where: { partida: { movimientoId: originalId } } });
  for (const k of consumos.slice(omitir)) {
    await tx.restitucionCapa.create({
      data: { partidaId: r.partidas[0].id, consumoId: k.id, capaId: k.capaId, cantidad: k.cantidad, costoUnitario: k.costoUnitario, costoUnitarioConIva: k.costoUnitarioConIva },
    });
    await tx.capaCosto.update({ where: { id: k.capaId }, data: { cantidadRestante: { increment: k.cantidad } } });
  }
  await mover(tx, bodegaId, articuloId, cantidad);
  await confirmar(tx, r.id, "A");
  return r;
}

describe("reversas", () => {
  it("la de una salida restituye las capas exactas; el original no cambia y no se revierte dos veces", async () => {
    const x = await articulo();
    const c = await capa(e.bodegaId, x, 6, "2026-08-01", ["3.0000", "3.4800"]);
    const s = await salidaRetirada(x, c.id, 4);
    const antes = await prisma.movimiento.findUniqueOrThrow({ where: { id: s.id } });
    await prisma.$transaction((tx) => revertirEgreso(tx, s.id, x, 4, e.bodegaId));
    await expect(prisma.capaCosto.findUniqueOrThrow({ where: { id: c.id } })).resolves.toMatchObject({ cantidadRestante: 6 });
    await expect(existencia(e.bodegaId, x)).resolves.toBe(6);
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id: s.id } })).resolves.toEqual(antes);
    await expect(prisma.$transaction((tx) => revertirEgreso(tx, s.id, x, 4, e.bodegaId))).rejects.toMatchObject({ code: "P2002" });
  });

  it("restituir de menos, dejar la reversa en borrador o revertir una reversa no se guarda", async () => {
    const x = await articulo();
    const c1 = await capa(e.bodegaId, x, 2, "2026-08-01");
    const c2 = await capa(e.bodegaId, x, 2, "2026-08-02");
    const s = await prisma.movimiento.create({
      data: {
        tipo: "SALIDA", estatus: "SOLICITADA", fecha: hoy, bodegaOrigenId: e.bodegaId, estacionId: e.estacionId,
        creadoPorId: e.usuarios.COMPRAS.id, llaveIdempotencia: randomUUID(),
        partidas: { create: [{ orden: 1, articuloId: x, presentacionCapturada: "UNIDAD", cantidadCapturada: 3, factorConversion: 1, cantidad: 3 }] },
      },
      include: { partidas: true },
    });
    await prisma.movimiento.update({ where: { id: s.id }, data: { estatus: "AUTORIZADA", autorizadoPorId: e.autorizadores.JEFE.id, autorizadoEn: new Date() } });
    await prisma.$transaction(async (tx) => {
      await consumir(tx, s.partidas[0].id, c1.id, 2);
      await consumir(tx, s.partidas[0].id, c2.id, 1);
      await mover(tx, e.bodegaId, x, -3);
      await tx.movimiento.update({ where: { id: s.id }, data: { estatus: "RETIRADA", folio: folio("S"), entregadoA: "M", entregadoPorId: e.usuarios.COMPRAS.id, entregadoEn: new Date() } });
    });
    await expect(prisma.$transaction((tx) => revertirEgreso(tx, s.id, x, 3, e.bodegaId, 1))).rejects.toEqual(rechazo(/restituye exactamente|no concilia|no coincide/));
    await expect(prisma.$transaction((tx) => borrador(tx, { tipo: "AJUSTE", bodegaDestinoId: e.bodegaId, motivo: "x", cancelaAId: s.id }, [[x, 3]]))).rejects.toEqual(
      rechazo(/misma operación/),
    );
    const r = await prisma.$transaction((tx) => revertirEgreso(tx, s.id, x, 3, e.bodegaId));
    await expect(prisma.$transaction((tx) => revertirIngreso(tx, r.id, x, 3, e.bodegaId))).rejects.toEqual(rechazo(/no se revierte|mismas bodegas/));
    await expect(prisma.$transaction(async (tx) => {
      const rr = await borrador(tx, { tipo: "AJUSTE", bodegaOrigenId: e.bodegaId, motivo: "x", cancelaAId: r.id }, [[x, 3]]);
      await confirmar(tx, rr.id);
    })).rejects.toEqual(rechazo(/Una reversa no se revierte/));
    await expect(existencia(e.bodegaId, x)).resolves.toBe(4);
  });

  it("la de un ingreso exige sus capas intactas: si otra salida ya las consumió, se bloquea", async () => {
    const x = await articulo();
    const a = await prisma.$transaction(async (tx) => {
      const m = await borrador(tx, { tipo: "AJUSTE", bodegaDestinoId: e.bodegaId, motivo: "Conteo" }, [[x, 5]]);
      await tx.capaCosto.create({ data: { bodegaId: e.bodegaId, articuloId: x, movimientoId: m.id, fecha: hoy, fechaOriginal: hoy, cantidadInicial: 5, cantidadRestante: 5 } });
      await mover(tx, e.bodegaId, x, 5);
      await confirmar(tx, m.id, "A");
      return m;
    });
    const [k] = await prisma.capaCosto.findMany({ where: { movimientoId: a.id } });
    const s = await salidaRetirada(x, k.id, 1);
    await expect(prisma.$transaction((tx) => revertirIngreso(tx, a.id, x, 5, e.bodegaId))).rejects.toThrow(/capa_restante_ck|no concilia/);
    // Revertida la salida, la capa vuelve a estar completa y el ajuste ya se revierte.
    await prisma.$transaction((tx) => revertirEgreso(tx, s.id, x, 1, e.bodegaId));
    await prisma.$transaction((tx) => revertirIngreso(tx, a.id, x, 5, e.bodegaId));
    await expect(existencia(e.bodegaId, x)).resolves.toBe(0);
  });

  it("una salida con devoluciones vigentes no se revierte", async () => {
    const x = await articulo();
    const c = await capa(e.bodegaId, x, 5, "2026-08-01");
    const s = await salidaRetirada(x, c.id, 3);
    await prisma.$transaction((tx) => devolver(tx, x, 1, s, [{ capaId: c.id, cantidad: 1 }]));
    await expect(prisma.$transaction((tx) => revertirEgreso(tx, s.id, x, 3, e.bodegaId))).rejects.toEqual(rechazo(/devoluciones vigentes/));
  });

  it("la de un traspaso es otro traspaso: retira las hijas y restituye el origen", async () => {
    const x = await articulo();
    const c = await capa(e.bodegaId, x, 5, "2026-08-01", ["1.0000", "1.1600"]);
    const t = await prisma.$transaction((tx) => traspasar(tx, x, [{ id: c.id, cantidad: 5 }]));
    await expect(prisma.$transaction(async (tx) => {
      const r = await borrador(tx, { tipo: "AJUSTE", bodegaOrigenId: e.otraBodegaId, motivo: "x", cancelaAId: t.id }, [[x, 5]]);
      await confirmar(tx, r.id);
    })).rejects.toEqual(rechazo(/mismas bodegas/));

    await prisma.$transaction(async (tx) => {
      const r = await borrador(tx, { tipo: "TRASPASO", bodegaOrigenId: e.otraBodegaId, bodegaDestinoId: e.bodegaId, motivo: "Destino equivocado", cancelaAId: t.id }, [[x, 5]]);
      const [hija] = await tx.capaCosto.findMany({ where: { movimientoId: t.id } });
      await consumir(tx, r.partidas[0].id, hija.id, 5);
      const [k] = await tx.consumoCapa.findMany({ where: { partida: { movimientoId: t.id } } });
      await tx.restitucionCapa.create({ data: { partidaId: r.partidas[0].id, consumoId: k.id, capaId: k.capaId, cantidad: 5, costoUnitario: k.costoUnitario, costoUnitarioConIva: k.costoUnitarioConIva } });
      await tx.capaCosto.update({ where: { id: c.id }, data: { cantidadRestante: 5 } });
      await mover(tx, e.otraBodegaId, x, -5);
      await mover(tx, e.bodegaId, x, 5);
      await confirmar(tx, r.id, "T");
    });
    await expect(existencia(e.bodegaId, x)).resolves.toBe(5);
    await expect(existencia(e.otraBodegaId, x)).resolves.toBe(0);
    await expect(prisma.capaCosto.findUniqueOrThrow({ where: { id: c.id } })).resolves.toMatchObject({ cantidadRestante: 5 });
  });

  it("una restitución no se modifica ni se borra", async () => {
    const x = await articulo();
    const c = await capa(e.bodegaId, x, 2, "2026-08-01");
    const s = await salidaRetirada(x, c.id, 2);
    await prisma.$transaction((tx) => revertirEgreso(tx, s.id, x, 2, e.bodegaId));
    const [r] = await prisma.restitucionCapa.findMany({ where: { capaId: c.id } });
    await expect(prisma.restitucionCapa.update({ where: { id: r.id }, data: { cantidad: 1 } })).rejects.toThrow(/no se modifica/);
    await expect(prisma.restitucionCapa.delete({ where: { id: r.id } })).rejects.toThrow(/no se modifica/);
  });
});

// ─────────────────────────────── Conteo ────────────────────────────────────

async function hoja(renglones: [string, number, number | null][], bodegaId = e.bodegaId) {
  return prisma.hojaConteo.create({
    data: {
      bodegaId, estatus: "BORRADOR", motivo: "Conteo mensual", llaveIdempotencia: randomUUID(), creadoPorId: e.usuarios.COMPRAS.id,
      renglones: { create: renglones.map(([articuloId, cantidadEsperada, cantidadContada], i) => ({ orden: i + 1, articuloId, cantidadEsperada, cantidadContada })) },
    },
  });
}

const confirmarHoja = (tx: Tx, id: string) =>
  tx.hojaConteo.update({ where: { id }, data: { estatus: "CONFIRMADO", confirmadoPorId: e.usuarios.COMPRAS.id, confirmadoEn: new Date() } });

describe("hoja de conteo", () => {
  it("confirmada, sus ajustes son sus diferencias y la existencia queda en lo contado", async () => {
    const [mas, menos, igual] = [await articulo(), await articulo(), await articulo()];
    await capa(e.bodegaId, mas, 2, "2026-08-01");
    const c = await capa(e.bodegaId, menos, 5, "2026-08-01");
    await capa(e.bodegaId, igual, 1, "2026-08-01");
    const h = await hoja([[mas, 2, 3], [menos, 5, 4], [igual, 1, 1]]);
    await prisma.$transaction(async (tx) => {
      const positivo = await borrador(tx, { tipo: "AJUSTE", bodegaDestinoId: e.bodegaId, motivo: "Conteo mensual", conteoId: h.id }, [[mas, 1]]);
      await tx.capaCosto.create({ data: { bodegaId: e.bodegaId, articuloId: mas, movimientoId: positivo.id, fecha: hoy, fechaOriginal: hoy, cantidadInicial: 1, cantidadRestante: 1 } });
      await mover(tx, e.bodegaId, mas, 1);
      await confirmar(tx, positivo.id, "A");
      const negativo = await borrador(tx, { tipo: "AJUSTE", bodegaOrigenId: e.bodegaId, motivo: "Conteo mensual", conteoId: h.id }, [[menos, 1]]);
      await consumir(tx, negativo.partidas[0].id, c.id, 1);
      await mover(tx, e.bodegaId, menos, -1);
      await confirmar(tx, negativo.id, "A");
      await confirmarHoja(tx, h.id);
    });
    await expect(Promise.all([existencia(e.bodegaId, mas), existencia(e.bodegaId, menos), existencia(e.bodegaId, igual)])).resolves.toEqual([3, 4, 1]);
    await expect(prisma.renglonConteo.updateMany({ where: { hojaId: h.id }, data: { cantidadContada: 9 } })).rejects.toThrow(/no cambian/);
    await expect(prisma.hojaConteo.update({ where: { id: h.id }, data: { motivo: "otro" } })).rejects.toThrow(/no cambia/);
    await expect(prisma.hojaConteo.delete({ where: { id: h.id } })).rejects.toThrow(/no se borra/);
  });

  it("una hoja obsoleta no deja la existencia en lo contado, y se rechaza entera", async () => {
    const x = await articulo();
    await capa(e.bodegaId, x, 4, "2026-08-01");
    // Se leyó con 3 y se contaron 5: el ajuste de +2 dejaría 6, no 5.
    const h = await hoja([[x, 3, 5]]);
    await expect(prisma.$transaction(async (tx) => {
      const a = await borrador(tx, { tipo: "AJUSTE", bodegaDestinoId: e.bodegaId, motivo: "Conteo mensual", conteoId: h.id }, [[x, 2]]);
      await tx.capaCosto.create({ data: { bodegaId: e.bodegaId, articuloId: x, movimientoId: a.id, fecha: hoy, fechaOriginal: hoy, cantidadInicial: 2, cantidadRestante: 2 } });
      await mover(tx, e.bodegaId, x, 2);
      await confirmar(tx, a.id, "A");
      await confirmarHoja(tx, h.id);
    })).rejects.toEqual(rechazo(/no quedó igual a lo contado/));
    await expect(existencia(e.bodegaId, x)).resolves.toBe(4);
    await expect(prisma.hojaConteo.findUniqueOrThrow({ where: { id: h.id } })).resolves.toMatchObject({ estatus: "BORRADOR" });
  });

  it("ajustes que no son las diferencias, o colgados de una hoja sin confirmar, no se guardan", async () => {
    const x = await articulo();
    await capa(e.bodegaId, x, 2, "2026-08-01");
    const h = await hoja([[x, 2, 2]]);
    const positivo = (tx: Tx, conteoId: string) => borrador(tx, { tipo: "AJUSTE", bodegaDestinoId: e.bodegaId, motivo: "Conteo mensual", conteoId }, [[x, 1]]).then(async (a) => {
      await tx.capaCosto.create({ data: { bodegaId: e.bodegaId, articuloId: x, movimientoId: a.id, fecha: hoy, fechaOriginal: hoy, cantidadInicial: 1, cantidadRestante: 1 } });
      await mover(tx, e.bodegaId, x, 1);
      await confirmar(tx, a.id, "A");
    });
    await expect(prisma.$transaction(async (tx) => {
      await positivo(tx, h.id);
      await confirmarHoja(tx, h.id);
    })).rejects.toEqual(rechazo(/no son las diferencias/));
    await expect(prisma.$transaction((tx) => positivo(tx, h.id))).rejects.toEqual(rechazo(/hoja confirmada/));
    // Confirmada sin diferencias, sin ajustes; después nadie le cuelga uno.
    await prisma.$transaction((tx) => confirmarHoja(tx, h.id));
    await expect(prisma.$transaction((tx) => positivo(tx, h.id))).rejects.toEqual(rechazo(/no son las diferencias/));
    await expect(existencia(e.bodegaId, x)).resolves.toBe(2);
  });

  it("nace en borrador, no se confirma sin nada contado y su bodega no cambia", async () => {
    const x = await articulo();
    await expect(prisma.hojaConteo.create({
      data: { bodegaId: e.bodegaId, estatus: "CONFIRMADO", motivo: "x", llaveIdempotencia: randomUUID(), creadoPorId: e.usuarios.COMPRAS.id, confirmadoPorId: e.usuarios.COMPRAS.id, confirmadoEn: new Date() },
    })).rejects.toThrow(/nace en borrador/);
    const h = await hoja([[x, 0, null]]);
    await expect(prisma.$transaction((tx) => confirmarHoja(tx, h.id))).rejects.toThrow(/ningún artículo contado/);
    await expect(prisma.hojaConteo.update({ where: { id: h.id }, data: { bodegaId: e.otraBodegaId } })).rejects.toThrow(/no cambia/);
    await expect(prisma.hojaConteo.update({ where: { id: h.id }, data: { estatus: "CANCELADO", canceladoPorId: e.usuarios.COMPRAS.id, canceladoEn: new Date() } })).rejects.toThrow(
      /conteo_estado_datos_ck/,
    );
  });
});

// ──────────────────────────── Preflight y privilegios ───────────────────────

describe("preflight y usuario de ejecución", () => {
  it("lo conciliado no aparece; una capa de traspaso dañada sí", async () => {
    const x = await articulo();
    const c = await capa(e.bodegaId, x, 3, "2026-08-01");
    const t = await prisma.$transaction((tx) => traspasar(tx, x, [{ id: c.id, cantidad: 3 }]));
    const problemas = async () => prisma.$queryRaw<{ movimiento: string }[]>`SELECT movimiento::text FROM movimientos_sin_conciliar() WHERE movimiento = ${t.id}::uuid`;
    await expect(problemas()).resolves.toEqual([]);
    const [hija] = await prisma.capaCosto.findMany({ where: { movimientoId: t.id } });
    await sinDefensas(prisma, (tx) => tx.$executeRaw`UPDATE "CapaCosto" SET "fechaOriginal" = DATE '2026-09-01' WHERE id = ${hija.id}::uuid`);
    await expect(problemas()).resolves.toHaveLength(1);
  });

  it("la aplicación, con su actor ligado, dispara la conciliación sin privilegios de más", async () => {
    const app = new Client({ connectionString: inject("urlEjecucionPruebas") });
    await app.connect();
    try {
      const u = await prisma.usuario.findUniqueOrThrow({ where: { id: e.usuarios.COMPRAS.id } });
      const x = await articulo();
      await app.query("BEGIN");
      await app.query("SELECT seguridad.fijar_actor($1)", [firmarToken(inject("llavePruebas"), u.clerkUserId)]);
      const { rows: [m] } = await app.query<{ id: string }>(
        `INSERT INTO "Movimiento" (id, tipo, estatus, fecha, "bodegaDestinoId", motivo, "creadoPorId", "updatedAt")
         VALUES (uuid_generate_v7(), 'AJUSTE', 'BORRADOR', $1, $2, 'Conteo', $3, now()) RETURNING id`,
        [hoyEnMexico(), e.bodegaId, u.id],
      );
      await app.query(
        `INSERT INTO "MovimientoPartida" (id, "movimientoId", "articuloId", orden, cantidad, "presentacionCapturada", "cantidadCapturada", "factorConversion")
         VALUES (uuid_generate_v7(), $1, $2, 1, 2, 'UNIDAD', 2, 1)`,
        [m.id, x],
      );
      await app.query(
        `INSERT INTO "CapaCosto" (id, "bodegaId", "articuloId", "movimientoId", fecha, "fechaOriginal", "cantidadInicial", "cantidadRestante")
         VALUES (uuid_generate_v7(), $1, $2, $3, $4, $4, 2, 2)`,
        [e.bodegaId, x, m.id, hoyEnMexico()],
      );
      await app.query(`INSERT INTO "Existencia" ("bodegaId", "articuloId", cantidad, "actualizadoEn") VALUES ($1, $2, 2, now())`, [e.bodegaId, x]);
      await app.query(`UPDATE "Movimiento" SET estatus = 'CONFIRMADO', folio = $2, "confirmadoPorId" = $3, "confirmadoEn" = now() WHERE id = $1`, [m.id, folio("A"), u.id]);
      await app.query("COMMIT");
      await expect(existencia(e.bodegaId, x)).resolves.toBe(2);
      for (const sql of [`SELECT movimientos_sin_conciliar()`, `SELECT seguridad.columnas_de_actor_conteo()`]) {
        await expect(app.query(sql).catch((error: { code?: string }) => error.code)).resolves.toBe("42501");
      }
    } finally {
      await app.end();
    }
  });

  it("la migración es copia fiel de prisma/sql/despues", () => {
    const RAIZ = join(import.meta.dirname, "../..");
    const migracion = readFileSync(join(RAIZ, "prisma/migrations/20260929120000_traspasos_devoluciones_conteo/migration.sql"), "utf8");
    expect(migracion).toContain(readFileSync(join(RAIZ, "prisma/sql/despues/990-traspasos-devoluciones-conteo.sql"), "utf8"));
  });
});
