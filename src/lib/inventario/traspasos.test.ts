/*
  Traspasos (contrato de la fase 7, §2.1, §4 y §5.1–5.2) contra PostgreSQL
  real: alta idempotente, borrador, confirmación PEPS con capas hijas,
  valuación constante, stock, concurrencia y reintentos.
*/

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../../pruebas/semilla-entradas";
import { sembrarCapa } from "../../../pruebas/semilla-inventario";
import { como as comoEn, descuadres, sembrarOperacion, SinPermisoDePrueba, valuacion } from "../../../pruebas/semilla-operacion";
import type { EntornoSalidas } from "../../../pruebas/semilla-salidas";
import type { UsuarioSesion } from "../db";
import { deFechaDeBase, hoyEnMexico } from "../fechas";
import type { Permiso } from "../permisos";
import type { Prisma } from "@prisma/client";
import { confirmarTraspaso, crearTraspaso, descartarTraspaso, guardarTraspaso, type DatosTraspaso } from "./traspasos";

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
let compras: UsuarioSesion;

beforeAll(async () => {
  e = await sembrarOperacion(prisma);
  compras = e.usuarios.COMPRAS;
});
afterAll(() => prisma.$disconnect());

const como = <T>(u: UsuarioSesion, permiso: Permiso, fn: (tx: Prisma.TransactionClient) => Promise<T>) => comoEn(prisma, u, permiso, fn);
const unidades = (articuloId: string, n: number) => ({ articuloId, presentacion: "UNIDAD" as const, cantidadCapturada: n });
const datos = (partidas: DatosTraspaso["partidas"], origen = e.bodegaId, destino = e.otraBodegaId): DatosTraspaso => ({
  encabezado: { bodegaOrigenId: origen, bodegaDestinoId: destino },
  partidas,
});

const crear = (d: DatosTraspaso, llave = randomUUID(), u = compras) => como(u, "traspasos:capturar", (tx) => crearTraspaso(tx, u, llave, d));
const confirmar = (id: string, u = compras) => como(u, "traspasos:confirmar", (tx) => confirmarTraspaso(tx, u, id));
const capa = (articuloId: string, cantidad: number, fechaOriginal: string, costo: [string, string] | null = null, bodegaId = e.bodegaId) =>
  sembrarCapa(prisma, e, { bodegaId, articuloId, cantidad, fechaOriginal, costo });
const existencia = async (articuloId: string, bodegaId = e.bodegaId) =>
  (await prisma.existencia.findUnique({ where: { bodegaId_articuloId: { bodegaId, articuloId } } }))?.cantidad ?? 0;
const folioT = async () => (await prisma.folio.findUniqueOrThrow({ where: { tipo: "TRASPASO" } })).siguiente;

describe("captura", () => {
  it("la misma llave y captura devuelven el mismo borrador; otra captura, otro usuario o una salida con esa llave son conflicto", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, 12);
    const llave = randomUUID();
    const d = datos([{ articuloId: x.id, presentacion: "CAJA", cantidadCapturada: 2, observaciones: "  frágil " }]);
    const r1 = await crear(d, llave);
    expect(r1.repetido).toBe(false);
    // Espacios y mayúsculas del id no cambian la captura.
    await expect(crear({ ...d, partidas: [{ ...d.partidas[0], articuloId: x.id.toUpperCase(), observaciones: "frágil" }] }, llave)).resolves.toEqual({ id: r1.id, repetido: true });
    await expect(crear(datos([unidades(x.id, 3)]), llave)).rejects.toMatchObject({ codigo: "conflicto-idempotencia" });
    await expect(crear(d, llave, e.usuarios.SUPERADMIN)).rejects.toMatchObject({ codigo: "conflicto-idempotencia" });

    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id: r1.id }, include: { partidas: true } });
    expect(m).toMatchObject({ tipo: "TRASPASO", estatus: "BORRADOR", folio: null, creadoPorId: compras.id, llaveIdempotencia: llave });
    expect(m.partidas[0]).toMatchObject({ presentacionCapturada: "CAJA", factorConversion: 12, cantidad: 24, observaciones: "frágil" });
  });

  it("dos altas simultáneas con la misma llave crean uno solo", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const llave = randomUUID();
    const [a, b] = await Promise.all([crear(datos([unidades(x.id, 1)]), llave), crear(datos([unidades(x.id, 1)]), llave)]);
    expect(a.id).toBe(b.id);
    expect([a.repetido, b.repetido].sort()).toEqual([false, true]);
  });

  it("rechaza bodegas iguales o dadas de baja, artículos repetidos o inactivos y cajas sin piezas por caja", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await expect(crear(datos([unidades(x.id, 1)], e.bodegaId, e.bodegaId))).rejects.toMatchObject({ codigo: "datos" });
    await expect(crear(datos([unidades(x.id, 1), unidades(x.id, 2)]))).rejects.toMatchObject({ codigo: "partidas" });
    await expect(crear(datos([{ articuloId: x.id, presentacion: "CAJA", cantidadCapturada: 1 }]))).rejects.toMatchObject({ codigo: "partidas" });
    await expect(crear(datos([]))).rejects.toMatchObject({ codigo: "partidas" });
    const baja = await prisma.bodega.create({ data: { nombre: `Baja ${randomUUID().slice(0, 8)}`, activa: false } });
    await expect(crear(datos([unidades(x.id, 1)], e.bodegaId, baja.id))).rejects.toMatchObject({ codigo: "catalogo" });
    const inactivo = await prisma.articulo.create({ data: { descripcion: `Inactivo ${randomUUID().slice(0, 8)}`, unidadId: e.unidadId, activo: false } });
    await expect(crear(datos([unidades(inactivo.id, 1)]))).rejects.toMatchObject({ codigo: "catalogo" });
  });

  it("el borrador se corrige y se descarta con motivo; descartado ya no se confirma ni se edita", async () => {
    const [x, y] = [await articuloNuevo(prisma, e.unidadId, null), await articuloNuevo(prisma, e.unidadId, null)];
    const { id } = await crear(datos([unidades(x.id, 1)]));
    await como(compras, "traspasos:capturar", (tx) => guardarTraspaso(tx, compras, id, datos([unidades(y.id, 4), unidades(x.id, 2)])));
    const guardado = await prisma.movimientoPartida.findMany({ where: { movimientoId: id }, orderBy: { orden: "asc" } });
    expect(guardado.map((p) => [p.articuloId, p.cantidad, p.orden])).toEqual([[y.id, 4, 1], [x.id, 2, 2]]);

    await expect(como(compras, "traspasos:capturar", (tx) => descartarTraspaso(tx, compras, id, "  "))).rejects.toMatchObject({ codigo: "datos" });
    await expect(como(compras, "traspasos:capturar", (tx) => descartarTraspaso(tx, compras, id, "Ya no"))).resolves.toEqual({ id, repetido: false });
    await expect(como(compras, "traspasos:capturar", (tx) => descartarTraspaso(tx, compras, id, " Ya no "))).resolves.toEqual({ id, repetido: true });
    await expect(como(compras, "traspasos:capturar", (tx) => descartarTraspaso(tx, compras, id, "Otro"))).rejects.toMatchObject({ codigo: "conflicto" });
    await expect(confirmar(id)).rejects.toMatchObject({ codigo: "estado" });
    await expect(como(compras, "traspasos:capturar", (tx) => guardarTraspaso(tx, compras, id, datos([unidades(x.id, 1)])))).rejects.toMatchObject({ codigo: "estado" });
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ estatus: "CANCELADO", motivoCancelacion: "Ya no", canceladoPorId: compras.id });
  });

  it("Jefe no captura ni confirma, y un id de otro tipo responde como inexistente", async () => {
    await expect(crear(datos([]), randomUUID(), e.usuarios.JEFE)).rejects.toBeInstanceOf(SinPermisoDePrueba);
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const salida = await prisma.movimiento.create({
      data: {
        tipo: "SALIDA", estatus: "SOLICITADA", fecha: new Date(), bodegaOrigenId: e.bodegaId, estacionId: e.estacionId,
        creadoPorId: compras.id, llaveIdempotencia: randomUUID(),
      },
    });
    await expect(confirmar(salida.id)).rejects.toMatchObject({ codigo: "no-encontrado", message: "El traspaso no existe." });
    await expect(confirmar(randomUUID())).rejects.toMatchObject({ codigo: "no-encontrado" });
    await expect(crear(datos([unidades(x.id, 1)]))).resolves.toMatchObject({ repetido: false });
  });
});

describe("confirmación", () => {
  it("varias capas: consume PEPS, crea hijas con fecha original y costo, conserva la valuación y concilia", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const nueva = await capa(x.id, 5, "2026-09-05", ["12.0000", "13.9200"]);
    const vieja = await capa(x.id, 3, "2026-08-01", ["10.0000", "11.6000"]);
    const sinCosto = await capa(x.id, 2, "2026-07-01");
    const antes = await valuacion(prisma, x.id);
    const { id } = await crear(datos([unidades(x.id, 7)]));
    const folioAntes = await folioT();

    const r = await confirmar(id);
    expect(r).toMatchObject({ id, repetido: false });
    expect(r.folio).toMatch(/^T-\d{6}$/);
    await expect(folioT()).resolves.toBe(folioAntes + 1);

    const hijas = await prisma.capaCosto.findMany({ where: { movimientoId: id }, orderBy: { fechaOriginal: "asc" } });
    expect(hijas.map((h) => [h.origenId, h.bodegaId, deFechaDeBase(h.fechaOriginal), h.cantidadInicial, h.costoUnitario?.toString() ?? null, h.costoUnitarioConIva?.toString() ?? null])).toEqual([
      [sinCosto.id, e.otraBodegaId, "2026-07-01", 2, null, null],
      [vieja.id, e.otraBodegaId, "2026-08-01", 3, "10", "11.6"],
      [nueva.id, e.otraBodegaId, "2026-09-05", 2, "12", "13.92"],
    ]);
    expect(hijas.every((h) => deFechaDeBase(h.fecha) === hoyEnMexico())).toBe(true);
    await expect(Promise.all([existencia(x.id), existencia(x.id, e.otraBodegaId)])).resolves.toEqual([3, 7]);
    await expect(valuacion(prisma, x.id)).resolves.toEqual(antes);

    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id } });
    expect(m).toMatchObject({ estatus: "CONFIRMADO", folio: r.folio, confirmadoPorId: compras.id });
    expect(deFechaDeBase(m.fecha)).toBe(hoyEnMexico());
    await expect(descuadres(prisma, [e.bodegaId, e.otraBodegaId])).resolves.toEqual([]);

    // Reintento y doble clic: el mismo folio, sin volver a mover nada.
    await expect(confirmar(id)).resolves.toEqual({ id, folio: r.folio, repetido: true });
    await expect(como(compras, "traspasos:capturar", (tx) => guardarTraspaso(tx, compras, id, datos([unidades(x.id, 1)])))).rejects.toMatchObject({ codigo: "estado" });
    await expect(Promise.all([existencia(x.id), existencia(x.id, e.otraBodegaId)])).resolves.toEqual([3, 7]);
  });

  it("doble clic simultáneo: un folio, un consumo por capa y un movimiento de existencias", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 4, "2026-08-01");
    const { id } = await crear(datos([unidades(x.id, 4)]));
    const [a, b] = await Promise.all([confirmar(id), confirmar(id)]);
    expect(a.folio).toBe(b.folio);
    expect([a.repetido, b.repetido].sort()).toEqual([false, true]);
    await expect(prisma.consumoCapa.count({ where: { partida: { movimientoId: id } } })).resolves.toBe(1);
    await expect(prisma.capaCosto.count({ where: { movimientoId: id } })).resolves.toBe(1);
    await expect(Promise.all([existencia(x.id), existencia(x.id, e.otraBodegaId)])).resolves.toEqual([0, 4]);
  });

  it("sin stock suficiente no deja rastro: ni consumo, ni capa, ni folio", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 2, "2026-08-01");
    const { id } = await crear(datos([unidades(x.id, 3)]));
    const folioAntes = await folioT();
    await expect(confirmar(id)).rejects.toMatchObject({ codigo: "existencia", message: expect.stringContaining("hay 2") });
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ estatus: "BORRADOR", folio: null });
    await expect(prisma.capaCosto.count({ where: { movimientoId: id } })).resolves.toBe(0);
    await expect(folioT()).resolves.toBe(folioAntes);
    await expect(Promise.all([existencia(x.id), existencia(x.id, e.otraBodegaId)])).resolves.toEqual([2, 0]);
  });

  it("dos traspasos por el último stock: uno confirma y el otro recibe error de existencia", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 5, "2026-08-01");
    const [a, b] = [await crear(datos([unidades(x.id, 5)])), await crear(datos([unidades(x.id, 5)]))];
    const folioAntes = await folioT();
    const r = await Promise.allSettled([confirmar(a.id), confirmar(b.id)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ codigo: "existencia" });
    await expect(folioT()).resolves.toBe(folioAntes + 1);
    await expect(Promise.all([existencia(x.id), existencia(x.id, e.otraBodegaId)])).resolves.toEqual([0, 5]);
  });

  it("traspasos cruzados, con artículos en orden inverso, terminan sin interbloqueo", async () => {
    const [x, y] = [await articuloNuevo(prisma, e.unidadId, null), await articuloNuevo(prisma, e.unidadId, null)];
    for (const bodega of [e.bodegaId, e.otraBodegaId]) {
      await capa(x.id, 20, "2026-08-01", null, bodega);
      await capa(y.id, 20, "2026-08-01", null, bodega);
    }
    const ida = await Promise.all(Array.from({ length: 3 }, () => crear(datos([unidades(x.id, 1), unidades(y.id, 2)]))));
    const vuelta = await Promise.all(Array.from({ length: 3 }, () => crear(datos([unidades(y.id, 3), unidades(x.id, 4)], e.otraBodegaId, e.bodegaId))));
    const folios = (await Promise.all([...ida, ...vuelta].map((t) => confirmar(t.id)))).map((r) => r.folio);
    expect(new Set(folios).size).toBe(6);
    await expect(Promise.all([existencia(x.id), existencia(y.id)])).resolves.toEqual([20 - 3 + 12, 20 - 6 + 9]);
    await expect(descuadres(prisma, [e.bodegaId, e.otraBodegaId])).resolves.toEqual([]);
  });

  it("el factor de caja que cambió y la bodega dada de baja detienen la confirmación", async () => {
    const caja = await articuloNuevo(prisma, e.unidadId, 12);
    await capa(caja.id, 48, "2026-08-01");
    const { id } = await crear(datos([{ articuloId: caja.id, presentacion: "CAJA", cantidadCapturada: 1 }]));
    await prisma.articulo.update({ where: { id: caja.id }, data: { piezasPorCaja: 24 } });
    await expect(confirmar(id)).rejects.toMatchObject({ codigo: "factor-desactualizado" });
    await prisma.articulo.update({ where: { id: caja.id }, data: { piezasPorCaja: 12 } });

    const destino = await prisma.bodega.create({ data: { nombre: `Destino ${randomUUID().slice(0, 8)}` } });
    const t = await crear(datos([unidades(caja.id, 1)], e.bodegaId, destino.id));
    await prisma.bodega.update({ where: { id: destino.id }, data: { activa: false } });
    await expect(confirmar(t.id)).rejects.toMatchObject({ codigo: "catalogo" });
    await expect(confirmar(id)).resolves.toMatchObject({ repetido: false });
    await expect(existencia(caja.id)).resolves.toBe(36);
  });

  it("la bitácora conserva la captura y la confirmación con su actor", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 1, "2026-08-01");
    const { id } = await crear(datos([unidades(x.id, 1)]));
    await confirmar(id, e.usuarios.SUPERADMIN);
    const renglones = await prisma.bitacora.findMany({ where: { tabla: "Movimiento", registroId: id }, orderBy: { ocurridoEn: "asc" } });
    expect(renglones.map((b) => [b.accion, b.usuarioId])).toEqual([
      ["INSERTAR", compras.id],
      ["ACTUALIZAR", e.usuarios.SUPERADMIN.id],
    ]);
  });
});
