/*
  Lecturas de salidas contra PostgreSQL real: lista con búsqueda tolerante,
  detalle con consumos PEPS, valuación en numeric, bandeja de pendientes y
  catálogo para capturar.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../../pruebas/semilla-entradas";
import { sembrarCapa } from "../../../pruebas/semilla-inventario";
import { sembrarSalidas, type EntornoSalidas } from "../../../pruebas/semilla-salidas";
import { autorizarSalida, confirmarRecepcion, retirarSalida, solicitarSalida } from "./servicio";

vi.mock("server-only", () => ({}));
const { bandejaDeSalidas, cargarOpcionesDeCaptura, listarSalidas, obtenerSalida, valuarSalida } = await import("./repo");

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
let articuloId: string;
let solicitada: string;
let autorizada: string;
let retirada: string;
let recibida: string;
let folioRetirada: string;

const enTx = <T>(usuarioId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.usuario_id', ${usuarioId}, true)`;
    return fn(tx);
  });

/** Una salida de `cantidad` piezas llevada hasta el estatus pedido. */
async function nueva(cantidad: number, hasta: "SOLICITADA" | "AUTORIZADA" | "RETIRADA" | "RECIBIDA"): Promise<string> {
  const compras = e.usuarios.COMPRAS;
  const jefe = e.autorizadores.JEFE;
  const { id } = await enTx(compras.id, (tx) =>
    solicitarSalida(tx, compras, randomUUID(), {
      encabezado: { bodegaOrigenId: e.bodegaId, estacionId: e.estacionId, solicitadoPorId: e.personaId },
      partidas: [{ articuloId, presentacion: "UNIDAD", cantidadCapturada: cantidad }],
    }),
  );
  if (hasta === "SOLICITADA") return id;
  await enTx(jefe.id, (tx) => autorizarSalida(tx, jefe, id));
  if (hasta === "AUTORIZADA") return id;
  await enTx(compras.id, (tx) => retirarSalida(tx, compras, id, "Mensajería Rápida"));
  if (hasta === "RECIBIDA") await enTx(compras.id, (tx) => confirmarRecepcion(tx, compras, id));
  return id;
}

const lista = (filtro: Parameters<typeof listarSalidas>[1]) => prisma.$transaction((tx) => listarSalidas(tx, filtro)).then((r) => r.filas);

beforeAll(async () => {
  e = await sembrarSalidas(prisma);
  articuloId = (await articuloNuevo(prisma, e.unidadId, null)).id;
  // PEPS: 2 piezas sin costo y después 10 a $3.3333 (con IVA $3.8666).
  await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId, cantidad: 2, fechaOriginal: "2026-08-01", costo: null });
  await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId, cantidad: 10, fechaOriginal: "2026-09-01", costo: ["3.3333", "3.8666"] });
  solicitada = await nueva(1, "SOLICITADA");
  autorizada = await nueva(1, "AUTORIZADA");
  retirada = await nueva(5, "RETIRADA");
  recibida = await nueva(1, "RECIBIDA");
  folioRetirada = (await prisma.movimiento.findUniqueOrThrow({ where: { id: retirada } })).folio!;
});
afterAll(() => prisma.$disconnect());

describe("listarSalidas", () => {
  it("filtra por estatus", async () => {
    const ids = async (estatus: Parameters<typeof listarSalidas>[1]["estatus"]) => (await lista({ estatus, busqueda: "" })).map((f) => f.id);
    await expect(ids("SOLICITADA")).resolves.toContain(solicitada);
    await expect(ids("SOLICITADA")).resolves.not.toContain(autorizada);
    await expect(ids("AUTORIZADA")).resolves.toContain(autorizada);
    await expect(ids("RETIRADA")).resolves.toContain(retirada);
    await expect(ids("RECIBIDA")).resolves.toContain(recibida);
    await expect(ids("todas")).resolves.toEqual(expect.arrayContaining([solicitada, autorizada, retirada, recibida]));
  });

  it("encuentra por folio sin guiones ni ceros, por estación, solicitante y quién retiró", async () => {
    const numero = Number(folioRetirada.slice(2));
    for (const q of [folioRetirada, `s${numero}`, `S-${numero}`]) {
      await expect(lista({ estatus: "todas", busqueda: q }).then((f) => f.map((x) => x.id)), q).resolves.toContain(retirada);
    }
    const estacion = await prisma.estacion.findUniqueOrThrow({ where: { id: e.estacionId } });
    const persona = await prisma.persona.findUniqueOrThrow({ where: { id: e.personaId } });
    for (const q of [estacion.numero.toLowerCase(), estacion.alias, persona.nombre.toUpperCase(), "mensajería"]) {
      await expect(lista({ estatus: "todas", busqueda: q }).then((f) => f.map((x) => x.id)), q).resolves.toContain(retirada);
    }
  });

  it("no incluye movimientos de otro tipo", async () => {
    const { filas } = await prisma.$transaction((tx) => listarSalidas(tx, { estatus: "todas", busqueda: "" }));
    const tipos = await prisma.movimiento.findMany({ where: { id: { in: filas.map((f) => f.id) } }, select: { tipo: true } });
    expect(new Set(tipos.map((t) => t.tipo))).toEqual(new Set(["SALIDA"]));
  });
});

describe("detalle y valuación", () => {
  it("el detalle trae partidas y consumos en orden PEPS, con el costo de cada capa", async () => {
    const d = await prisma.$transaction((tx) => obtenerSalida(tx, retirada));
    expect(d).toMatchObject({ estatus: "RETIRADA", folio: folioRetirada, entregadoA: "Mensajería Rápida" });
    expect(d!.partidas).toHaveLength(1);
    expect(d!.partidas[0].consumos.map((c) => [c.cantidad, c.costoUnitario?.toString() ?? null])).toEqual([
      [2, null],
      [3, "3.3333"],
    ]);
    expect(d!.entregadoPor?.correo).toBeTruthy();
    expect(d!.autorizadoPor?.correo).toBeTruthy();
  });

  it("valúa sumando consumos redondeados por renglón, y cuenta aparte las piezas sin costo", async () => {
    // 3 × 3.3333 = 9.9999 → 10.00; 3 × 3.8666 = 11.5998 → 11.60.
    await expect(prisma.$transaction((tx) => valuarSalida(tx, retirada))).resolves.toEqual({
      importe: "10.00",
      importeConIva: "11.60",
      piezasSinCosto: 2,
    });
    await expect(prisma.$transaction((tx) => valuarSalida(tx, solicitada))).resolves.toEqual({
      importe: null,
      importeConIva: null,
      piezasSinCosto: 0,
    });
  });

  it("un id de otro tipo de movimiento no es una salida", async () => {
    const entrada = await prisma.movimiento.create({
      data: {
        tipo: "ENTRADA", estatus: "BORRADOR", fecha: new Date("2026-09-10"), moneda: "MXN",
        proveedorId: e.proveedorId, bodegaDestinoId: e.bodegaId, creadoPorId: e.usuarios.COMPRAS.id, llaveIdempotencia: randomUUID(),
      },
    });
    await expect(prisma.$transaction((tx) => obtenerSalida(tx, entrada.id))).resolves.toBeNull();
    await expect(prisma.$transaction((tx) => valuarSalida(tx, entrada.id))).resolves.toMatchObject({ importe: null, piezasSinCosto: 0 });
  });
});

describe("bandeja y opciones de captura", () => {
  it("la bandeja agrupa lo que espera autorización, retiro o recepción, la más antigua primero", async () => {
    // Otras pruebas comparten la base: se comprueban propiedades, no posiciones.
    const b = await prisma.$transaction((tx) => bandejaDeSalidas(tx));
    const grupos = [
      [b.porAutorizar, "SOLICITADA", solicitada],
      [b.porRetirar, "AUTORIZADA", autorizada],
      [b.porRecibir, "RETIRADA", retirada],
    ] as const;
    for (const [p, estatus, nuestra] of grupos) {
      expect(p.total, estatus).toBe(await prisma.movimiento.count({ where: { tipo: "SALIDA", estatus } }));
      expect(p.filas.length, estatus).toBe(Math.min(p.total, 50));
      expect(p.filas.every((f) => f.estatus === estatus), estatus).toBe(true);
      const fechas = p.filas.map((f) => f.createdAt.getTime());
      expect(fechas, estatus).toEqual([...fechas].sort((x, y) => x - y));
      if (p.total <= 50) expect(p.filas.map((f) => f.id), estatus).toContain(nuestra);
    }
    const todas = grupos.flatMap(([p]) => p.filas.map((f) => f.id));
    expect(todas).not.toContain(recibida);
  });

  it("las opciones solo ofrecen catálogo activo", async () => {
    const sufijo = randomUUID().slice(0, 8);
    const area = await prisma.area.create({ data: { nombre: `Área inactiva ${sufijo}`, activa: false } });
    const persona = await prisma.persona.create({ data: { nombre: `Persona inactiva ${sufijo}`, activa: false } });
    const o = await prisma.$transaction((tx) => cargarOpcionesDeCaptura(tx));
    expect(o.areas.map((a) => a.id)).toContain(e.areaId);
    expect(o.areas.map((a) => a.id)).not.toContain(area.id);
    expect(o.personas.map((p) => p.id)).not.toContain(persona.id);
    expect(o.estaciones.map((s) => s.id)).toContain(e.estacionId);
    expect(o.articulos.find((a) => a.id === e.articuloCajaId)).toMatchObject({ piezasPorCaja: 12 });
  });
});
