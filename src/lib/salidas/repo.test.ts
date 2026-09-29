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
const { bandejaDeSalidas, cargarOpcionesDeCaptura, contarPendientes, existenciasDeSalida, listarSalidas, obtenerSalida, TOPE_LISTA, valuarSalida } =
  await import("./repo");

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
  it("recorre 251 salidas sin omitir las intermedias ni repetir una fila con fechas iguales", async () => {
    const marca = `Paginación ${randomUUID().slice(0, 8)}`;
    const persona = await prisma.persona.create({ data: { nombre: marca } });
    const ids = Array.from({ length: TOPE_LISTA + 51 }, () => randomUUID());
    await enTx(e.usuarios.COMPRAS.id, async (tx) => {
      await tx.movimiento.createMany({ data: ids.map((id, i) => ({
        id,
        tipo: "SALIDA",
        estatus: "SOLICITADA",
        fecha: new Date("2026-09-01"),
        createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, Math.floor(i / 2))),
        bodegaOrigenId: e.bodegaId,
        estacionId: e.estacionId,
        solicitadoPorId: persona.id,
        creadoPorId: e.usuarios.COMPRAS.id,
        llaveIdempotencia: randomUUID(),
      })) });
      await tx.movimientoPartida.createMany({ data: ids.map((movimientoId) => ({
        movimientoId,
        articuloId,
        orden: 1,
        cantidad: 1,
        presentacionCapturada: "UNIDAD",
        cantidadCapturada: 1,
        factorConversion: 1,
      })) });
    });

    const filtro = { estatus: "SOLICITADA" as const, busqueda: marca };
    const primera = await prisma.$transaction((tx) => listarSalidas(tx, filtro));
    expect(primera.filas).toHaveLength(TOPE_LISTA);
    expect(primera.hayMas).toBe(true);
    expect(primera.cursorActual).toBeNull();
    expect(primera.cursorSiguiente).toBe(primera.filas.at(-1)?.id);

    const segunda = await prisma.$transaction((tx) => listarSalidas(tx, { ...filtro, cursor: primera.cursorSiguiente! }));
    expect(segunda.filas).toHaveLength(51);
    expect(segunda.hayMas).toBe(false);
    expect(segunda.cursorActual).toBe(primera.cursorSiguiente);
    expect(segunda.cursorSiguiente).toBeNull();
    const esperados = ids.map((id, i) => ({ id, instante: Math.floor(i / 2) }))
      .sort((a, b) => b.instante - a.instante || b.id.localeCompare(a.id)).map((s) => s.id);
    expect([...primera.filas, ...segunda.filas].map((s) => s.id)).toEqual(esperados);

    const ajeno = await prisma.$transaction((tx) => listarSalidas(tx, { ...filtro, cursor: randomUUID() }));
    expect(ajeno.cursorActual).toBeNull();
    expect(ajeno.filas.map((s) => s.id)).toEqual(primera.filas.map((s) => s.id));
  });

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

describe("bandeja", () => {
  it("ordena cada cola por la fecha que muestra como inicio de la espera", async () => {
    const ordenes: unknown[] = [];
    const db = {
      movimiento: {
        findMany: async (args: { orderBy: unknown }) => (ordenes.push(args.orderBy), []),
        count: async () => 0,
      },
    } as unknown as Prisma.TransactionClient;
    await bandejaDeSalidas(db, e.autorizadores.SUPERADMIN);
    expect(ordenes).toEqual([
      [{ createdAt: "asc" }, { id: "asc" }],
      [{ autorizadoEn: "asc" }, { id: "asc" }],
      [{ entregadoEn: "asc" }, { id: "asc" }],
    ]);
  });

  it("agrupa lo que espera autorización, retiro o recepción, la más antigua primero", async () => {
    // Otras pruebas comparten la base: se comprueban propiedades, no posiciones.
    const b = await prisma.$transaction((tx) => bandejaDeSalidas(tx, e.autorizadores.SUPERADMIN));
    expect(b.map((s) => [s.clave, s.estatus])).toEqual([
      ["porAutorizar", "SOLICITADA"],
      ["porRetirar", "AUTORIZADA"],
      ["porRecibir", "RETIRADA"],
    ]);
    const nuestras = { SOLICITADA: solicitada, AUTORIZADA: autorizada, RETIRADA: retirada } as Record<string, string>;
    for (const { estatus, filas, total } of b) {
      expect(total, estatus).toBe(await prisma.movimiento.count({ where: { tipo: "SALIDA", estatus } }));
      expect(filas.length, estatus).toBe(Math.min(total, 50));
      expect(filas.every((f) => f.estatus === estatus), estatus).toBe(true);
      const fechas = filas.map((f) => f.createdAt.getTime());
      expect(fechas, estatus).toEqual([...fechas].sort((x, y) => x - y));
      if (total <= 50) expect(filas.map((f) => f.id), estatus).toContain(nuestras[estatus]);
    }
    expect(b.flatMap((s) => s.filas.map((f) => f.id))).not.toContain(recibida);
  });

  it("cada quien ve solo las secciones en las que puede actuar", async () => {
    const claves = async (u: (typeof e.usuarios)["JEFE"]) => (await prisma.$transaction((tx) => bandejaDeSalidas(tx, u))).map((s) => s.clave);
    await expect(claves(e.usuarios.JEFE)).resolves.toEqual([]);
    await expect(claves(e.autorizadores.JEFE)).resolves.toEqual(["porAutorizar"]);
    await expect(claves(e.usuarios.COMPRAS)).resolves.toEqual(["porRetirar", "porRecibir"]);
    await expect(claves(e.autorizadores.COMPRAS)).resolves.toEqual(["porAutorizar", "porRetirar", "porRecibir"]);
  });

  it("no consulta las secciones ajenas: ni filas ni conteo", async () => {
    const espia = () => {
      const estatus: unknown[] = [];
      const anotar = async (args: { where: { estatus: unknown } }) => {
        estatus.push(args.where.estatus);
        return [];
      };
      const db = { movimiento: { findMany: vi.fn(anotar), count: vi.fn(async (args: { where: { estatus: unknown } }) => (await anotar(args), 0)) } };
      return { db: db as unknown as Prisma.TransactionClient, estatus, llamadas: () => db.movimiento.findMany.mock.calls.length + db.movimiento.count.mock.calls.length };
    };

    const jefe = espia();
    await expect(bandejaDeSalidas(jefe.db, e.usuarios.JEFE)).resolves.toEqual([]);
    await expect(contarPendientes(jefe.db, e.usuarios.JEFE)).resolves.toBeNull();
    expect(jefe.llamadas()).toBe(0);

    const autorizador = espia();
    await bandejaDeSalidas(autorizador.db, e.autorizadores.JEFE);
    await contarPendientes(autorizador.db, e.autorizadores.JEFE);
    expect(autorizador.estatus).toEqual(["SOLICITADA", "SOLICITADA", { in: ["SOLICITADA"] }]);
  });

  it("cuenta los pendientes de las secciones propias", async () => {
    const cuenta = (estatus: ("AUTORIZADA" | "RETIRADA")[]) => prisma.movimiento.count({ where: { tipo: "SALIDA", estatus: { in: estatus } } });
    await expect(prisma.$transaction((tx) => contarPendientes(tx, e.usuarios.COMPRAS))).resolves.toBe(await cuenta(["AUTORIZADA", "RETIRADA"]));
  });
});

describe("existencias y opciones de captura", () => {
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

  it("las opciones traen la existencia por bodega y artículo, sin los ceros", async () => {
    const vacio = (await articuloNuevo(prisma, e.unidadId, null)).id;
    const o = await prisma.$transaction((tx) => cargarOpcionesDeCaptura(tx));
    const hay = await prisma.existencia.findUniqueOrThrow({ where: { bodegaId_articuloId: { bodegaId: e.bodegaId, articuloId } } });
    expect(o.existencias[e.bodegaId][articuloId]).toBe(hay.cantidad);
    expect(o.existencias[e.bodegaId][vacio]).toBeUndefined();
  });

  it("la salida trae lo que hay de cada artículo en su bodega de origen", async () => {
    const hay = await prisma.existencia.findUniqueOrThrow({ where: { bodegaId_articuloId: { bodegaId: e.bodegaId, articuloId } } });
    await expect(prisma.$transaction((tx) => existenciasDeSalida(tx, autorizada))).resolves.toEqual({ [articuloId]: hay.cantidad });
    // Otro tipo de movimiento no es una salida.
    const entrada = await prisma.movimiento.findFirstOrThrow({ where: { tipo: "ENTRADA" }, select: { id: true } });
    await expect(prisma.$transaction((tx) => existenciasDeSalida(tx, entrada.id))).resolves.toEqual({});
  });
});
