/*
  Reversas (contrato de la fase 7, §2.5 y §5.5) contra PostgreSQL real, sobre
  movimientos confirmados por sus propios servicios: entradas, salidas,
  traspasos, devoluciones y ajustes de conteo.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../../pruebas/semilla-entradas";
import { sembrarCapa } from "../../../pruebas/semilla-inventario";
import { como as comoEn, descuadres, sembrarOperacion, SinPermisoDePrueba, valuacion } from "../../../pruebas/semilla-operacion";
import type { EntornoSalidas } from "../../../pruebas/semilla-salidas";
import type { UsuarioSesion } from "../db";
import { confirmarEntrada, crearBorrador } from "../entradas/servicio";
import type { Permiso } from "../permisos";
import { autorizarSalida, retirarSalida, solicitarSalida } from "../salidas/servicio";
import { abrirHoja, confirmarConteo, guardarConteo } from "./conteos";
import { confirmarDevolucion, crearDevolucion } from "./devoluciones";
import { saldoDeSalida } from "./primitivas";
import { revertirMovimiento } from "./reversas";
import { confirmarTraspaso, crearTraspaso } from "./traspasos";

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
let compras: UsuarioSesion;
let admin: UsuarioSesion;

beforeAll(async () => {
  e = await sembrarOperacion(prisma);
  compras = e.usuarios.COMPRAS;
  admin = e.usuarios.SUPERADMIN;
});
afterAll(() => prisma.$disconnect());

const como = <T>(u: UsuarioSesion, permiso: Permiso, fn: (tx: Prisma.TransactionClient) => Promise<T>) => comoEn(prisma, u, permiso, fn);
const unidades = (articuloId: string, n: number) => ({ articuloId, presentacion: "UNIDAD" as const, cantidadCapturada: n });
const capa = (articuloId: string, cantidad: number, fechaOriginal: string, costo: [string, string] | null = null, bodegaId = e.bodegaId) =>
  sembrarCapa(prisma, e, { bodegaId, articuloId, cantidad, fechaOriginal, costo });
const existencia = async (articuloId: string, bodegaId = e.bodegaId) =>
  (await prisma.existencia.findUnique({ where: { bodegaId_articuloId: { bodegaId, articuloId } } }))?.cantidad ?? 0;
const restante = async (capaId: string) => (await prisma.capaCosto.findUniqueOrThrow({ where: { id: capaId } })).cantidadRestante;
const revertir = (id: string, motivo = "Error de captura", u = admin) => como(u, "movimientos:revertir", (tx) => revertirMovimiento(tx, u, id, motivo));

async function entrada(articuloId: string, cantidad: number, costo = "10", bodegaId = e.bodegaId): Promise<string> {
  const { id } = await como(compras, "entradas:capturar", (tx) =>
    crearBorrador(tx, compras, randomUUID(), {
      encabezado: { proveedorId: e.proveedorId, bodegaDestinoId: bodegaId, fecha: "2026-09-01", moneda: "MXN" },
      partidas: [{ articuloId, presentacion: "UNIDAD", cantidadCapturada: cantidad, costoUnitarioCapturado: costo, tasaIva: "0.16" }],
    }),
  );
  await como(compras, "entradas:confirmar", (tx) => confirmarEntrada(tx, compras, id));
  return id;
}

async function salida(partidas: ReturnType<typeof unidades>[], bodegaId = e.bodegaId): Promise<string> {
  const { id } = await como(compras, "salidas:capturar", (tx) =>
    solicitarSalida(tx, compras, randomUUID(), { encabezado: { bodegaOrigenId: bodegaId, estacionId: e.estacionId, esPrestamo: true }, partidas }),
  );
  await como(e.autorizadores.JEFE, "salidas:autorizar", (tx) => autorizarSalida(tx, e.autorizadores.JEFE, id));
  await como(compras, "salidas:retirar", (tx) => retirarSalida(tx, compras, id, "Mensajero"));
  return id;
}

async function traspaso(partidas: ReturnType<typeof unidades>[], origen = e.bodegaId, destino = e.otraBodegaId): Promise<string> {
  const { id } = await como(compras, "traspasos:capturar", (tx) => crearTraspaso(tx, compras, randomUUID(), { encabezado: { bodegaOrigenId: origen, bodegaDestinoId: destino }, partidas }));
  await como(compras, "traspasos:confirmar", (tx) => confirmarTraspaso(tx, compras, id));
  return id;
}

async function devolucion(salidaId: string, partidas: ReturnType<typeof unidades>[]): Promise<string> {
  const { id } = await como(compras, "devoluciones:capturar", (tx) =>
    crearDevolucion(tx, compras, randomUUID(), { encabezado: { estacionId: e.estacionId, bodegaDestinoId: e.bodegaId, salidaId }, partidas }),
  );
  await como(compras, "devoluciones:confirmar", (tx) => confirmarDevolucion(tx, compras, id));
  return id;
}

const leer = (id: string) => prisma.movimiento.findUniqueOrThrow({ where: { id }, include: { partidas: true } });

describe("reversa de un ingreso", () => {
  it("una entrada: retira su capa completa con un AJUSTE ligado; el original no cambia y no se revierte dos veces", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const id = await entrada(x.id, 4);
    const original = await leer(id);
    const r = await revertir(id, "  Factura duplicada ");
    expect(r).toMatchObject({ repetido: false });
    expect(r.folio).toMatch(/^A-\d{6}$/);

    const reversa = await leer(r.id);
    expect(reversa).toMatchObject({
      tipo: "AJUSTE", estatus: "CONFIRMADO", cancelaAId: id, motivo: "Factura duplicada",
      bodegaOrigenId: e.bodegaId, bodegaDestinoId: null, creadoPorId: admin.id, confirmadoPorId: admin.id,
    });
    expect(reversa.partidas.map((p) => [p.articuloId, p.cantidad])).toEqual([[x.id, 4]]);
    const [capaDeEntrada] = await prisma.capaCosto.findMany({ where: { movimientoId: id } });
    expect(capaDeEntrada.cantidadRestante).toBe(0);
    await expect(existencia(x.id)).resolves.toBe(0);
    await expect(leer(id)).resolves.toEqual(original);

    await expect(revertir(id, "Factura duplicada")).resolves.toEqual({ id: r.id, tipo: "AJUSTE", folio: r.folio, revierteA: id, repetido: true });
    await expect(revertir(id, "Otro motivo")).rejects.toMatchObject({ codigo: "conflicto", message: expect.stringContaining(r.folio) });
    await expect(revertir(r.id)).rejects.toMatchObject({ codigo: "estado", message: "Una reversa no se revierte." });
    await expect(descuadres(prisma, [e.bodegaId])).resolves.toEqual([]);
  });

  it("si su capa ya salió, se bloquea y dice qué revertir antes; revertido eso, procede", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const id = await entrada(x.id, 5);
    const s = await salida([unidades(x.id, 2)]);
    const { folio } = await leer(s);
    await expect(revertir(id)).rejects.toMatchObject({ codigo: "dependientes", message: expect.stringContaining(folio!) });
    await expect(prisma.movimiento.count({ where: { cancelaAId: id } })).resolves.toBe(0);
    await revertir(s);
    await expect(revertir(id)).resolves.toMatchObject({ repetido: false });
    await expect(existencia(x.id)).resolves.toBe(0);
  });

  it("un traspaso: otro TRASPASO en sentido contrario que retira las hijas y restituye el origen; la valuación no cambia", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const vieja = await capa(x.id, 2, "2026-07-01", ["10.0000", "11.6000"]);
    const nueva = await capa(x.id, 3, "2026-08-01");
    const antes = await valuacion(prisma, x.id);
    const t = await traspaso([unidades(x.id, 4)]);
    const r = await revertir(t, "Bodega equivocada");
    expect(r.folio).toMatch(/^T-\d{6}$/);
    await expect(leer(r.id)).resolves.toMatchObject({ tipo: "TRASPASO", bodegaOrigenId: e.otraBodegaId, bodegaDestinoId: e.bodegaId, cancelaAId: t });
    await expect(Promise.all([restante(vieja.id), restante(nueva.id)])).resolves.toEqual([2, 3]);
    await expect(Promise.all([existencia(x.id), existencia(x.id, e.otraBodegaId)])).resolves.toEqual([5, 0]);
    await expect(valuacion(prisma, x.id)).resolves.toEqual(antes);
    await expect(prisma.restitucionCapa.count({ where: { partida: { movimientoId: r.id } } })).resolves.toBe(2);
  });

  it("un traspaso cuyas hijas ya se movieron a otra bodega no se revierte", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 3, "2026-08-01");
    const tercera = (await prisma.bodega.create({ data: { nombre: `Tercera ${randomUUID().slice(0, 8)}` } })).id;
    const t = await traspaso([unidades(x.id, 3)]);
    const siguiente = await traspaso([unidades(x.id, 1)], e.otraBodegaId, tercera);
    await expect(revertir(t)).rejects.toMatchObject({ codigo: "dependientes", message: expect.stringContaining((await leer(siguiente)).folio!) });
  });

  it("un ajuste positivo de conteo: retira la capa sin costo", async () => {
    const bodega = (await prisma.bodega.create({ data: { nombre: `Reversa conteo ${randomUUID().slice(0, 8)}` } })).id;
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const h = await como(compras, "ajustes:capturar", (tx) => abrirHoja(tx, compras, randomUUID(), { bodegaId: bodega, motivo: "Hallazgo" }));
    const g = await como(compras, "ajustes:capturar", (tx) => guardarConteo(tx, compras, h.id, { revision: 1, renglones: [{ articuloId: x.id, cantidadContada: 3 }] }));
    await como(compras, "ajustes:confirmar", (tx) => confirmarConteo(tx, compras, h.id, g.revision));
    const [ajuste] = await prisma.movimiento.findMany({ where: { conteoId: h.id } });
    await revertir(ajuste.id);
    await expect(existencia(x.id, bodega)).resolves.toBe(0);
    await expect(prisma.hojaConteo.findUniqueOrThrow({ where: { id: h.id } })).resolves.toMatchObject({ estatus: "CONFIRMADO" });
  });
});

describe("reversa de un egreso", () => {
  it("una salida: devuelve cada pieza a su capa exacta aunque después otra salida consumiera más", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const a = await capa(x.id, 2, "2026-07-01", ["1.0000", "1.1600"]);
    const b = await capa(x.id, 4, "2026-08-01", ["2.0000", "2.3200"]);
    const s1 = await salida([unidades(x.id, 3)]);
    await salida([unidades(x.id, 2)]);
    await expect(Promise.all([restante(a.id), restante(b.id)])).resolves.toEqual([0, 1]);

    const r = await revertir(s1, "Material no salió");
    await expect(leer(r.id)).resolves.toMatchObject({ tipo: "AJUSTE", bodegaDestinoId: e.bodegaId, bodegaOrigenId: null, cancelaAId: s1 });
    await expect(Promise.all([restante(a.id), restante(b.id)])).resolves.toEqual([2, 2]);
    await expect(existencia(x.id)).resolves.toBe(4);
    const restituciones = await prisma.restitucionCapa.findMany({ where: { partida: { movimientoId: r.id } }, orderBy: { capaId: "asc" } });
    expect(restituciones.map((k) => [k.capaId, k.cantidad, k.costoUnitario?.toString()])).toEqual(
      [[a.id, 2, "1"], [b.id, 1, "2"]].sort((p, q) => (p[0] < q[0] ? -1 : 1)),
    );
    await expect(leer(s1)).resolves.toMatchObject({ estatus: "RETIRADA" });
    await expect(descuadres(prisma, [e.bodegaId])).resolves.toEqual([]);
  });

  it("con devoluciones vigentes se bloquea; revertida la devolución, su saldo vuelve y la salida se revierte", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 5, "2026-08-01");
    const s = await salida([unidades(x.id, 4)]);
    const d = await devolucion(s, [unidades(x.id, 1)]);
    const saldo = () => prisma.$transaction((tx) => saldoDeSalida(tx, s));
    await expect(saldo()).resolves.toMatchObject([{ pendiente: 3 }]);
    await expect(revertir(s)).rejects.toMatchObject({ codigo: "dependientes", message: expect.stringContaining((await leer(d)).folio!) });

    await revertir(d, "Devolución duplicada");
    await expect(saldo()).resolves.toMatchObject([{ devuelto: 0, pendiente: 4 }]);
    await expect(existencia(x.id)).resolves.toBe(1);
    await revertir(s);
    await expect(existencia(x.id)).resolves.toBe(5);
  });

  it("no restituye en una bodega dada de baja", async () => {
    const bodega = (await prisma.bodega.create({ data: { nombre: `Baja ${randomUUID().slice(0, 8)}` } })).id;
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 2, "2026-08-01", null, bodega);
    const s = await salida([unidades(x.id, 2)], bodega);
    await prisma.bodega.update({ where: { id: bodega }, data: { activa: false } });
    await expect(revertir(s)).rejects.toMatchObject({ codigo: "catalogo" });
    await prisma.bodega.update({ where: { id: bodega }, data: { activa: true } });
    await expect(revertir(s)).resolves.toMatchObject({ repetido: false });
  });
});

describe("reglas generales", () => {
  it("solo el Superadmin revierte, con motivo, y solo lo que afectó el inventario", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const id = await entrada(x.id, 1);
    await expect(revertir(id, "x", compras)).rejects.toBeInstanceOf(SinPermisoDePrueba);
    await expect(revertir(id, "   ")).rejects.toMatchObject({ codigo: "datos" });

    const { id: borrador } = await como(compras, "traspasos:capturar", (tx) =>
      crearTraspaso(tx, compras, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, bodegaDestinoId: e.otraBodegaId }, partidas: [unidades(x.id, 1)] }),
    );
    await expect(revertir(borrador)).rejects.toMatchObject({ codigo: "estado", message: expect.stringContaining("se descarta") });
    const { id: solicitada } = await como(compras, "salidas:capturar", (tx) =>
      solicitarSalida(tx, compras, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, estacionId: e.estacionId }, partidas: [unidades(x.id, 1)] }),
    );
    await expect(revertir(solicitada)).rejects.toMatchObject({ codigo: "estado", message: expect.stringContaining("se cancela") });
    await expect(revertir(randomUUID())).rejects.toMatchObject({ codigo: "no-encontrado" });
  });

  it("dos reversas simultáneas del mismo movimiento: un asiento", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const id = await entrada(x.id, 2);
    const [a, b] = await Promise.all([revertir(id), revertir(id)]);
    expect(a.folio).toBe(b.folio);
    expect([a.repetido, b.repetido].sort()).toEqual([false, true]);
    await expect(prisma.movimiento.count({ where: { cancelaAId: id } })).resolves.toBe(1);
    await expect(existencia(x.id)).resolves.toBe(0);
  });

  it("reversa y retiro compitiendo por la misma capa: uno gana y nada queda a medias", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const id = await entrada(x.id, 3);
    const { id: s } = await como(compras, "salidas:capturar", (tx) =>
      solicitarSalida(tx, compras, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, estacionId: e.estacionId }, partidas: [unidades(x.id, 3)] }),
    );
    await como(e.autorizadores.JEFE, "salidas:autorizar", (tx) => autorizarSalida(tx, e.autorizadores.JEFE, s));
    const r = await Promise.allSettled([revertir(id), como(compras, "salidas:retirar", (tx) => retirarSalida(tx, compras, s, "Mensajero"))]);
    expect(r.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    await expect(existencia(x.id)).resolves.toBe(0);
    await expect(descuadres(prisma, [e.bodegaId])).resolves.toEqual([]);
  });

  it("la bitácora registra la reversa con el actor del Superadmin", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const r = await revertir(await entrada(x.id, 1));
    const renglones = await prisma.bitacora.findMany({ where: { tabla: "Movimiento", registroId: r.id } });
    expect(renglones.length).toBeGreaterThan(0);
    expect(renglones.every((b) => b.usuarioId === admin.id)).toBe(true);
  });
});
