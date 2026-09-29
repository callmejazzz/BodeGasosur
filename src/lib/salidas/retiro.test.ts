/*
  Retiro con PEPS y confirmación de recepción (contrato de la fase 6, §5 y §7),
  contra PostgreSQL real: orden de capas, costos congelados, stock, rollback,
  concurrencia y el cierre en RECIBIDA. Cada prueba usa artículos propios
  para que las existencias no se crucen.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../../pruebas/semilla-entradas";
import { sembrarCapa, sinDefensas } from "../../../pruebas/semilla-inventario";
import { sembrarSalidas, type EntornoSalidas } from "../../../pruebas/semilla-salidas";
import type { UsuarioSesion } from "../db";
import { confirmarEntrada, crearBorrador } from "../entradas/servicio";
import { deFechaDeBase, hoyEnMexico } from "../fechas";
import { usuarioTienePermiso, type Permiso } from "../permisos";
import {
  autorizarSalida,
  cancelarSalida,
  confirmarRecepcion,
  rechazarSalida,
  retirarSalida,
  solicitarSalida,
  type DatosSolicitud,
} from "./servicio";

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
let compras: UsuarioSesion;
let jefe: UsuarioSesion;

beforeAll(async () => {
  e = await sembrarSalidas(prisma);
  compras = e.usuarios.COMPRAS;
  jefe = e.autorizadores.JEFE;
});
afterAll(() => prisma.$disconnect());

class SinPermiso extends Error {}

function como<T>(usuario: UsuarioSesion, permiso: Permiso, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (!usuarioTienePermiso(usuario, permiso)) return Promise.reject(new SinPermiso(permiso));
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.usuario_id', ${usuario.id}, true)`;
    return fn(tx);
  });
}

type Partidas = DatosSolicitud["partidas"];
const unidades = (articuloId: string, n: number): Partidas[number] => ({ articuloId, presentacion: "UNIDAD", cantidadCapturada: n });

async function solicitada(partidas: Partidas, bodegaId = e.bodegaId): Promise<string> {
  const d: DatosSolicitud = { encabezado: { bodegaOrigenId: bodegaId, estacionId: e.estacionId }, partidas };
  return (await como(compras, "salidas:capturar", (tx) => solicitarSalida(tx, compras, randomUUID(), d))).id;
}

async function autorizada(partidas: Partidas, bodegaId = e.bodegaId): Promise<string> {
  const id = await solicitada(partidas, bodegaId);
  await como(jefe, "salidas:autorizar", (tx) => autorizarSalida(tx, jefe, id));
  return id;
}

const retirar = (id: string, entregadoA = "Juan Pérez, mensajero", usuario = compras) =>
  como(usuario, "salidas:retirar", (tx) => retirarSalida(tx, usuario, id, entregadoA));
const recibir = (id: string, usuario = compras) => como(usuario, "salidas:recibir", (tx) => confirmarRecepcion(tx, usuario, id));

const capa = (articuloId: string, cantidad: number, fechaOriginal: string, costo: [string, string] | null, bodegaId = e.bodegaId) =>
  sembrarCapa(prisma, e, { bodegaId, articuloId, cantidad, fechaOriginal, costo });

async function existencia(articuloId: string, bodegaId = e.bodegaId) {
  const x = await prisma.existencia.findUnique({ where: { bodegaId_articuloId: { bodegaId, articuloId } } });
  return x?.cantidad ?? 0;
}

const restante = async (capaId: string) => (await prisma.capaCosto.findUniqueOrThrow({ where: { id: capaId } })).cantidadRestante;
const folioSalida = async () => (await prisma.folio.findUniqueOrThrow({ where: { tipo: "SALIDA" } })).siguiente;

/** [capaId, cantidad, costo, costo con IVA] de cada consumo de la salida, en orden PEPS. */
async function consumos(movimientoId: string) {
  const filas = await prisma.consumoCapa.findMany({
    where: { partida: { movimientoId } },
    include: { capa: true },
    orderBy: [{ capa: { fechaOriginal: "asc" } }, { capaId: "asc" }],
  });
  return filas.map((c) => [c.capaId, c.cantidad, c.costoUnitario?.toString() ?? null, c.costoUnitarioConIva?.toString() ?? null]);
}

/** Invariante 9 y nada negativo en la bodega. */
async function cuadra(bodegaId = e.bodegaId) {
  const filas = await prisma.$queryRaw<{ articuloId: string; existencia: number; capas: number; negativas: number }[]>`
    SELECT e."articuloId", e.cantidad AS existencia,
           coalesce(sum(c."cantidadRestante"), 0)::int AS capas,
           count(*) FILTER (WHERE c."cantidadRestante" < 0)::int AS negativas
    FROM "Existencia" e
    LEFT JOIN "CapaCosto" c ON c."bodegaId" = e."bodegaId" AND c."articuloId" = e."articuloId"
    WHERE e."bodegaId" = ${bodegaId}::uuid
    GROUP BY e."articuloId", e.cantidad`;
  for (const f of filas) {
    expect(f.capas, f.articuloId).toBe(f.existencia);
    expect(f.existencia, f.articuloId).toBeGreaterThanOrEqual(0);
    expect(f.negativas, f.articuloId).toBe(0);
  }
}

/** Lo que no debe cambiar cuando un retiro falla. */
async function fotografia(id: string, articuloIds: string[], capaIds: string[]) {
  return {
    salida: await prisma.movimiento.findUniqueOrThrow({ where: { id }, select: { estatus: true, folio: true, entregadoPorId: true, fecha: true } }),
    consumos: await prisma.consumoCapa.count({ where: { partida: { movimientoId: id } } }),
    existencias: await Promise.all(articuloIds.map((a) => existencia(a))),
    capas: await Promise.all(capaIds.map(restante)),
    folio: await folioSalida(),
  };
}

describe("PEPS", () => {
  it("consume por fechaOriginal, congela el costo de cada capa y descuenta una sola vez", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    // La capa nueva se siembra primero: el orden lo da fechaOriginal, no la creación.
    const nueva = await capa(x.id, 5, "2026-09-05", ["12.0000", "13.9200"]);
    const vieja = await capa(x.id, 3, "2026-09-01", ["10.0000", "11.6000"]);
    const id = await autorizada([unidades(x.id, 5)]);
    const folioAntes = await folioSalida();

    const r = await retirar(id, "  Juan Pérez  ");
    expect(r).toMatchObject({ id, repetido: false });
    expect(r.folio).toMatch(/^S-\d{6}$/);
    await expect(folioSalida()).resolves.toBe(folioAntes + 1);

    await expect(consumos(id)).resolves.toEqual([
      [vieja.id, 3, "10", "11.6"],
      [nueva.id, 2, "12", "13.92"],
    ]);
    await expect(restante(vieja.id)).resolves.toBe(0);
    await expect(restante(nueva.id)).resolves.toBe(3);
    await expect(existencia(x.id)).resolves.toBe(3);

    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id }, include: { partidas: true } });
    expect(m).toMatchObject({ estatus: "RETIRADA", folio: r.folio, entregadoA: "Juan Pérez", entregadoPorId: compras.id });
    expect(m.entregadoEn).not.toBeNull();
    expect(deFechaDeBase(m.fecha)).toBe(hoyEnMexico());
    // La partida no inventa un costo único: el valor vive en los consumos.
    expect(m.partidas[0].costoUnitario).toBeNull();
    await cuadra();
  });

  it("con la misma fechaOriginal desempata el id de la capa", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const a = await capa(x.id, 2, "2026-09-03", ["1.0000", "1.1600"]);
    const b = await capa(x.id, 2, "2026-09-03", ["2.0000", "2.3200"]);
    const [primera, segunda] = [a, b].sort((p, q) => (p.id < q.id ? -1 : 1));
    const id = await autorizada([unidades(x.id, 3)]);
    await retirar(id);
    const hechos = await consumos(id);
    expect(hechos.map(([capaId, cantidad]) => [capaId, cantidad])).toEqual([
      [primera.id, 2],
      [segunda.id, 1],
    ]);
  });

  it("una capa sin costo produce consumo con ambos costos nulos", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const sinCosto = await capa(x.id, 2, "2026-08-01", null);
    const conCosto = await capa(x.id, 4, "2026-09-01", ["5.0000", "5.8000"]);
    const id = await autorizada([unidades(x.id, 3)]);
    await retirar(id);
    await expect(consumos(id)).resolves.toEqual([
      [sinCosto.id, 2, null, null],
      [conCosto.id, 1, "5", "5.8"],
    ]);
    await cuadra();
  });

  it("una caja se retira en piezas: 2 cajas de 12 consumen 24", async () => {
    const caja = await articuloNuevo(prisma, e.unidadId, 12);
    await capa(caja.id, 30, "2026-09-01", ["1.0000", "1.1600"]);
    const id = await autorizada([{ articuloId: caja.id, presentacion: "CAJA", cantidadCapturada: 2 }]);
    await retirar(id);
    await expect(existencia(caja.id)).resolves.toBe(6);
  });

  it("una entrada confirmada por el servicio es la capa que después consume la salida", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const entrada = await como(compras, "entradas:capturar", (tx) =>
      crearBorrador(tx, compras, randomUUID(), {
        encabezado: { proveedorId: e.proveedorId, bodegaDestinoId: e.bodegaId, fecha: "2026-09-02", moneda: "MXN" },
        partidas: [{ articuloId: x.id, presentacion: "UNIDAD", cantidadCapturada: 4, costoUnitarioCapturado: "7.5", tasaIva: "0.16" }],
      }),
    );
    await como(compras, "entradas:confirmar", (tx) => confirmarEntrada(tx, compras, entrada.id));
    const id = await autorizada([unidades(x.id, 4)]);
    await retirar(id);
    const [[, cantidad, costo, conIva]] = await consumos(id);
    expect([cantidad, costo, conIva]).toEqual([4, "7.5", "8.7"]);
    await expect(existencia(x.id)).resolves.toBe(0);
    await cuadra();
  });
});

describe("lo que impide retirar no deja rastro", () => {
  it("stock insuficiente: ni consumo, ni descuento, ni folio", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const c = await capa(x.id, 2, "2026-09-01", ["1.0000", "1.1600"]);
    const id = await autorizada([unidades(x.id, 3)]);
    const antes = await fotografia(id, [x.id], [c.id]);
    await expect(retirar(id)).rejects.toMatchObject({ codigo: "existencia", message: expect.stringContaining("hay 2") });
    await expect(fotografia(id, [x.id], [c.id])).resolves.toEqual(antes);
    expect(antes.salida).toMatchObject({ estatus: "AUTORIZADA", folio: null });
  });

  it("existencia sin capas o que no cuadra con ellas es un descuadre, no un retiro", async () => {
    // La base ya impide escribir un descuadre; se fabrica sin defensas para probar
    // la del servicio. Bodega propia: no debe verse en las demás pruebas.
    const bodega = await prisma.bodega.create({ data: { nombre: `Bodega descuadre ${randomUUID().slice(0, 8)}` } });
    const sinCapas = await articuloNuevo(prisma, e.unidadId, null);
    await sinDefensas(prisma, (tx) => tx.existencia.create({ data: { bodegaId: bodega.id, articuloId: sinCapas.id, cantidad: 5 } }));
    const a = await autorizada([unidades(sinCapas.id, 1)], bodega.id);
    await expect(retirar(a)).rejects.toMatchObject({ codigo: "invariante" });

    const descuadre = await articuloNuevo(prisma, e.unidadId, null);
    const c = await capa(descuadre.id, 5, "2026-09-01", null, bodega.id);
    await sinDefensas(prisma, (tx) =>
      tx.existencia.update({ where: { bodegaId_articuloId: { bodegaId: bodega.id, articuloId: descuadre.id } }, data: { cantidad: 4 } }),
    );
    const b = await autorizada([unidades(descuadre.id, 1)], bodega.id);
    const antes = {
      salida: await prisma.movimiento.findUniqueOrThrow({ where: { id: b }, select: { estatus: true, folio: true } }),
      existencia: await existencia(descuadre.id, bodega.id),
      capa: await restante(c.id),
    };
    await expect(retirar(b)).rejects.toMatchObject({ codigo: "invariante" });
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id: b }, select: { estatus: true, folio: true } })).resolves.toEqual(antes.salida);
    await expect(existencia(descuadre.id, bodega.id)).resolves.toBe(antes.existencia);
    await expect(restante(c.id)).resolves.toBe(antes.capa);

    // Sin existencia ni capas: simplemente no hay qué retirar.
    const nada = await articuloNuevo(prisma, e.unidadId, null);
    await expect(retirar(await autorizada([unidades(nada.id, 1)]))).rejects.toMatchObject({ codigo: "existencia" });
  });

  it("si el factor de la caja cambió desde la autorización, se cancela y se vuelve a pedir", async () => {
    const caja = await articuloNuevo(prisma, e.unidadId, 12);
    const c = await capa(caja.id, 48, "2026-09-01", null);
    const id = await autorizada([{ articuloId: caja.id, presentacion: "CAJA", cantidadCapturada: 1 }]);
    await prisma.articulo.update({ where: { id: caja.id }, data: { piezasPorCaja: 24 } });
    const antes = await fotografia(id, [caja.id], [c.id]);
    await expect(retirar(id)).rejects.toMatchObject({ codigo: "factor-desactualizado" });
    await expect(fotografia(id, [caja.id], [c.id])).resolves.toEqual(antes);
  });

  it("bodega, estación, área, solicitante o artículo dados de baja detienen el retiro", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 10, "2026-09-01", null);
    const sufijo = randomUUID().slice(0, 8);
    const area = await prisma.area.create({ data: { nombre: `Área ${sufijo}` } });
    const persona = await prisma.persona.create({ data: { nombre: `Persona ${sufijo}` } });
    const empresa = await prisma.empresa.create({ data: { razonSocial: `Empresa ${sufijo}` } });
    const estacion = await prisma.estacion.create({ data: { numero: `EB${sufijo}`, alias: "Baja", empresaId: empresa.id } });

    const conDatos = async (extra: Partial<DatosSolicitud["encabezado"]>) => {
      const d: DatosSolicitud = { encabezado: { bodegaOrigenId: e.bodegaId, estacionId: e.estacionId, ...extra }, partidas: [unidades(x.id, 1)] };
      const { id } = await como(compras, "salidas:capturar", (tx) => solicitarSalida(tx, compras, randomUUID(), d));
      await como(jefe, "salidas:autorizar", (tx) => autorizarSalida(tx, jefe, id));
      return id;
    };
    const bajas: [string, Partial<DatosSolicitud["encabezado"]>, () => Promise<unknown>, () => Promise<unknown>][] = [
      ["área", { areaId: area.id }, () => prisma.area.update({ where: { id: area.id }, data: { activa: false } }), () => prisma.area.update({ where: { id: area.id }, data: { activa: true } })],
      ["solicitante", { solicitadoPorId: persona.id }, () => prisma.persona.update({ where: { id: persona.id }, data: { activa: false } }), () => prisma.persona.update({ where: { id: persona.id }, data: { activa: true } })],
      ["estación", { estacionId: estacion.id }, () => prisma.estacion.update({ where: { id: estacion.id }, data: { activa: false } }), () => prisma.estacion.update({ where: { id: estacion.id }, data: { activa: true } })],
      ["artículo", {}, () => prisma.articulo.update({ where: { id: x.id }, data: { activo: false } }), () => prisma.articulo.update({ where: { id: x.id }, data: { activo: true } })],
    ];
    for (const [nombre, extra, baja, alta] of bajas) {
      const id = await conDatos(extra);
      await baja();
      await expect(retirar(id), nombre).rejects.toMatchObject({ codigo: "catalogo" });
      await alta();
      await expect(retirar(id), nombre).resolves.toMatchObject({ repetido: false });
    }

    // Una bodega vacía sí se puede dar de baja; su salida autorizada ya no sale.
    const bodega = await prisma.bodega.create({ data: { nombre: `Bodega baja ${sufijo}` } });
    const id = await autorizada([unidades(x.id, 1)], bodega.id);
    await prisma.bodega.update({ where: { id: bodega.id }, data: { activa: false } });
    await expect(retirar(id)).rejects.toMatchObject({ codigo: "catalogo" });
  });

  it("no se retira lo que no está autorizado, y quien se lo lleva es obligatorio", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 10, "2026-09-01", null);
    const solicitadaId = await solicitada([unidades(x.id, 1)]);
    await expect(retirar(solicitadaId)).rejects.toMatchObject({ codigo: "estado" });

    const rechazada = await solicitada([unidades(x.id, 1)]);
    await como(jefe, "salidas:autorizar", (tx) => rechazarSalida(tx, jefe, rechazada, "No procede"));
    await expect(retirar(rechazada)).rejects.toMatchObject({ codigo: "estado" });

    const cancelada = await autorizada([unidades(x.id, 1)]);
    await como(compras, "salidas:capturar", (tx) => cancelarSalida(tx, compras, cancelada, "Ya no"));
    await expect(retirar(cancelada)).rejects.toMatchObject({ codigo: "estado" });

    const id = await autorizada([unidades(x.id, 1)]);
    await expect(retirar(id, "   ")).rejects.toMatchObject({ codigo: "datos" });
    await expect(retirar(id, "Juan", jefe)).rejects.toBeInstanceOf(SinPermiso);
    await expect(existencia(x.id)).resolves.toBe(10);
  });

  it("una falla entre el consumo y el folio revierte todo", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const c = await capa(x.id, 5, "2026-09-01", ["1.0000", "1.1600"]);
    const id = await autorizada([unidades(x.id, 2)]);
    const antes = await fotografia(id, [x.id], [c.id]);
    // Sin consecutivo, tomarFolio falla después de consumir y descontar.
    const folio = await prisma.folio.findUniqueOrThrow({ where: { tipo: "SALIDA" } });
    await prisma.folio.delete({ where: { tipo: "SALIDA" } });
    try {
      await expect(retirar(id)).rejects.toThrow(/consecutivo/);
    } finally {
      await prisma.folio.create({ data: folio });
    }
    await expect(fotografia(id, [x.id], [c.id])).resolves.toEqual(antes);
    await expect(retirar(id)).resolves.toMatchObject({ repetido: false });
    await cuadra();
  });
});

describe("concurrencia", () => {
  it("dos salidas por el último stock: una retira, la otra recibe error de existencia", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 5, "2026-09-01", ["1.0000", "1.1600"]);
    const [a, b] = [await autorizada([unidades(x.id, 5)]), await autorizada([unidades(x.id, 5)])];
    const folioAntes = await folioSalida();
    const resultados = await Promise.allSettled([retirar(a), retirar(b)]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [fallo] = resultados.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fallo.reason).toMatchObject({ codigo: "existencia" });
    await expect(existencia(x.id)).resolves.toBe(0);
    await expect(folioSalida()).resolves.toBe(folioAntes + 1);
    await expect(prisma.consumoCapa.count({ where: { partida: { articuloId: x.id } } })).resolves.toBe(1);
    await cuadra();
  });

  it("doble clic: el mismo folio, sin duplicar consumos ni descuentos", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 3, "2026-09-01", null);
    await capa(x.id, 3, "2026-09-02", null);
    const id = await autorizada([unidades(x.id, 4)]);
    const [r1, r2] = await Promise.all([retirar(id), retirar(id)]);
    expect(r1.folio).toBe(r2.folio);
    expect([r1.repetido, r2.repetido].sort()).toEqual([false, true]);
    // Mismo «entregado a» (sin importar espacios): mismo folio. Otro: conflicto, sin reescribir nada.
    await expect(retirar(id, "  Juan Pérez, mensajero ")).resolves.toEqual({ id, folio: r1.folio, repetido: true });
    await expect(retirar(id, "Otra persona")).rejects.toMatchObject({
      codigo: "conflicto",
      message: `Ya se retiró (${r1.folio}) y se lo llevó Juan Pérez, mensajero.`,
    });
    await expect(prisma.consumoCapa.count({ where: { partida: { movimientoId: id } } })).resolves.toBe(2);
    await expect(existencia(x.id)).resolves.toBe(2);
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ entregadoA: "Juan Pérez, mensajero" });
    await cuadra();
  });

  it("partidas en orden inverso no se interbloquean", async () => {
    const bodega = await prisma.bodega.create({ data: { nombre: `Bodega cruce ${randomUUID().slice(0, 8)}` } });
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const y = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 20, "2026-09-01", null, bodega.id);
    await capa(y.id, 20, "2026-09-01", null, bodega.id);
    const pares = await Promise.all(
      Array.from({ length: 3 }, async () => [
        await autorizada([unidades(x.id, 1), unidades(y.id, 2)], bodega.id),
        await autorizada([unidades(y.id, 3), unidades(x.id, 4)], bodega.id),
      ]),
    );
    const folios = (await Promise.all(pares.flat().map((id) => retirar(id)))).map((r) => r.folio);
    expect(new Set(folios).size).toBe(6);
    await expect(existencia(x.id, bodega.id)).resolves.toBe(20 - 3 * 5);
    await expect(existencia(y.id, bodega.id)).resolves.toBe(20 - 3 * 5);
    await cuadra(bodega.id);
  });

  it("una capa ocupada se espera, no se salta: PEPS no cambia por un candado", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const vieja = await capa(x.id, 2, "2026-09-01", null);
    const nueva = await capa(x.id, 5, "2026-09-02", null);
    const id = await autorizada([unidades(x.id, 2)]);
    let retiro!: Promise<string>;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CapaCosto" WHERE id = ${vieja.id}::uuid FOR UPDATE`;
      retiro = retirar(id).then(() => "retirada");
      const espera = new Promise<string>((r) => setTimeout(() => r("bloqueada"), 300));
      await expect(Promise.race([retiro, espera])).resolves.toBe("bloqueada");
    });
    await expect(retiro).resolves.toBe("retirada");
    await expect(consumos(id)).resolves.toEqual([[vieja.id, 2, null, null]]);
    await expect(restante(nueva.id)).resolves.toBe(5);
  });

  it("una entrada retroactiva que confirma durante el retiro entra completa al PEPS", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const posterior = await capa(x.id, 2, "2026-09-10", ["20.0000", "23.2000"]);
    const id = await autorizada([unidades(x.id, 4)]);
    const entrada = await como(compras, "entradas:capturar", (tx) =>
      crearBorrador(tx, compras, randomUUID(), {
        encabezado: { proveedorId: e.proveedorId, bodegaDestinoId: e.bodegaId, fecha: "2026-09-01", moneda: "MXN" },
        partidas: [{ articuloId: x.id, presentacion: "UNIDAD", cantidadCapturada: 3, costoUnitarioCapturado: "10", tasaIva: "0.16" }],
      }),
    );

    let retiro!: Promise<string>;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.usuario_id', ${compras.id}, true)`;
      await confirmarEntrada(tx, compras, entrada.id);
      // Con solo 2 piezas el retiro fallaría; espera el candado de la existencia.
      retiro = retirar(id).then((r) => r.folio);
      const espera = new Promise<string>((r) => setTimeout(() => r("bloqueada"), 300));
      await expect(Promise.race([retiro, espera])).resolves.toBe("bloqueada");
    });
    await expect(retiro).resolves.toMatch(/^S-/);
    const retro = await prisma.capaCosto.findFirstOrThrow({ where: { movimientoId: entrada.id } });
    await expect(consumos(id)).resolves.toEqual([
      [retro.id, 3, "10", "11.6"],
      [posterior.id, 1, "20", "23.2"],
    ]);
    await cuadra();
  });

  it("retiro y cancelación simultáneos: gana uno y el otro se rechaza", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 5, "2026-09-01", null);
    const id = await autorizada([unidades(x.id, 1)]);
    const [retiro, cancelacion] = await Promise.allSettled([
      retirar(id),
      como(compras, "salidas:capturar", (tx) => cancelarSalida(tx, compras, id, "Ya no")),
    ]);
    expect([retiro.status, cancelacion.status].sort()).toEqual(["fulfilled", "rejected"]);
    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id } });
    await expect(existencia(x.id)).resolves.toBe(m.estatus === "RETIRADA" ? 4 : 5);
    await cuadra();
  });
});

describe("recepción", () => {
  async function retirada() {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const c = await capa(x.id, 5, "2026-09-01", ["1.0000", "1.1600"]);
    const id = await autorizada([unidades(x.id, 2)]);
    const { folio } = await retirar(id);
    return { id, folio, articuloId: x.id, capaId: c.id };
  }

  it("RETIRADA → RECIBIDA guarda actor e instante sin volver a tocar inventario", async () => {
    const { id, folio, articuloId, capaId } = await retirada();
    const antes = await fotografia(id, [articuloId], [capaId]);
    const consumosAntes = await consumos(id);
    await expect(recibir(id)).resolves.toEqual({ id, estatus: "RECIBIDA", repetido: false });

    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id } });
    expect(m).toMatchObject({ estatus: "RECIBIDA", recibidoPorId: compras.id, folio });
    expect(m.recibidoEn).not.toBeNull();
    await expect(consumos(id)).resolves.toEqual(consumosAntes);
    const despues = await fotografia(id, [articuloId], [capaId]);
    expect({ ...despues, salida: undefined }).toEqual({ ...antes, salida: undefined });
    expect(despues.salida).toMatchObject({ folio: antes.salida.folio, fecha: antes.salida.fecha });
  });

  it("repetir devuelve lo guardado sin reescribir quién ni cuándo", async () => {
    const { id } = await retirada();
    const [r1, r2] = await Promise.all([recibir(id), recibir(id)]);
    expect([r1.repetido, r2.repetido].sort()).toEqual([false, true]);
    const original = await prisma.movimiento.findUniqueOrThrow({ where: { id } });
    await expect(recibir(id, e.usuarios.SUPERADMIN)).resolves.toEqual({ id, estatus: "RECIBIDA", repetido: true });
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({
      recibidoPorId: original.recibidoPorId,
      recibidoEn: original.recibidoEn,
    });
  });

  it("RECIBIDA es terminal; retirar de nuevo solo devuelve el folio", async () => {
    const { id, folio, articuloId } = await retirada();
    await recibir(id);
    await expect(como(compras, "salidas:capturar", (tx) => cancelarSalida(tx, compras, id, "tarde"))).rejects.toMatchObject({ codigo: "estado" });
    await expect(como(jefe, "salidas:autorizar", (tx) => rechazarSalida(tx, jefe, id, "tarde"))).rejects.toMatchObject({ codigo: "estado" });
    await expect(como(jefe, "salidas:autorizar", (tx) => autorizarSalida(tx, jefe, id))).resolves.toMatchObject({ repetido: true });
    await expect(retirar(id)).resolves.toEqual({ id, folio, repetido: true });
    await expect(retirar(id, "Otra persona")).rejects.toMatchObject({ codigo: "conflicto" });
    await expect(existencia(articuloId)).resolves.toBe(3);
    await expect(prisma.movimiento.update({ where: { id }, data: { recibidoPorId: jefe.id } })).rejects.toThrow();
  });

  it("solo se confirma lo retirado, y JEFE no confirma", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const id = await autorizada([unidades(x.id, 1)]);
    await expect(recibir(id)).rejects.toMatchObject({ codigo: "estado" });
    await expect(recibir((await retirada()).id, jefe)).rejects.toBeInstanceOf(SinPermiso);
  });

  it("la bitácora conserva autorización, retiro y recepción con su actor", async () => {
    const { id } = await retirada();
    await recibir(id);
    const renglones = await prisma.bitacora.findMany({ where: { tabla: "Movimiento", registroId: id, accion: "ACTUALIZAR" }, orderBy: { ocurridoEn: "asc" } });
    expect(renglones.map((r) => [(r.despues as { estatus: string }).estatus, r.usuarioId])).toEqual([
      ["AUTORIZADA", jefe.id],
      ["RETIRADA", compras.id],
      ["RECIBIDA", compras.id],
    ]);
  });
});
