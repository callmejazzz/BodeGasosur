/*
  Hoja de conteo y ajustes (contrato de la fase 7, §2.4 y §5.4) contra
  PostgreSQL real: existencias leídas por el servidor, revisión, hoja
  obsoleta, ajustes por signo, diferencia cero y reintentos.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../../pruebas/semilla-entradas";
import { sembrarCapa } from "../../../pruebas/semilla-inventario";
import { como as comoEn, descuadres, sembrarOperacion, SinPermisoDePrueba } from "../../../pruebas/semilla-operacion";
import type { EntornoSalidas } from "../../../pruebas/semilla-salidas";
import type { UsuarioSesion } from "../db";
import { deFechaDeBase, hoyEnMexico } from "../fechas";
import type { Permiso } from "../permisos";
import { abrirHoja, actualizarHoja, confirmarConteo, descartarHoja, guardarConteo, type RenglonCapturado } from "./conteos";

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
let compras: UsuarioSesion;

beforeAll(async () => {
  e = await sembrarOperacion(prisma);
  compras = e.usuarios.COMPRAS;
});
afterAll(() => prisma.$disconnect());

const como = <T>(u: UsuarioSesion, permiso: Permiso, fn: (tx: Prisma.TransactionClient) => Promise<T>) => comoEn(prisma, u, permiso, fn);
const capa = (bodegaId: string, articuloId: string, cantidad: number, fechaOriginal: string, costo: [string, string] | null = null) =>
  sembrarCapa(prisma, e, { bodegaId, articuloId, cantidad, fechaOriginal, costo });
const existencia = async (bodegaId: string, articuloId: string) =>
  (await prisma.existencia.findUnique({ where: { bodegaId_articuloId: { bodegaId, articuloId } } }))?.cantidad ?? 0;

/** Una bodega propia: la hoja lee todo lo que tenga, y así no se cruza con otras pruebas. */
const bodegaNueva = async () => (await prisma.bodega.create({ data: { nombre: `Conteo ${randomUUID().slice(0, 8)}` } })).id;

const abrir = (bodegaId: string, llave = randomUUID(), motivo = "Conteo mensual") =>
  como(compras, "ajustes:capturar", (tx) => abrirHoja(tx, compras, llave, { bodegaId, motivo }));
const guardar = (id: string, revision: number, renglones: RenglonCapturado[]) => como(compras, "ajustes:capturar", (tx) => guardarConteo(tx, compras, id, { revision, renglones }));
const confirmar = (id: string, revision: number, u = compras) => como(u, "ajustes:confirmar", (tx) => confirmarConteo(tx, u, id, revision));
const contado = (articuloId: string, cantidadContada: number | null): RenglonCapturado => ({ articuloId, cantidadContada });
const renglones = (hojaId: string) =>
  prisma.renglonConteo.findMany({ where: { hojaId }, orderBy: { orden: "asc" }, select: { articuloId: true, cantidadEsperada: true, cantidadContada: true } });

describe("abrir y capturar", () => {
  it("abre con las existencias que lee el servidor; la llave la hace idempotente", async () => {
    const bodega = await bodegaNueva();
    const [x, y] = [await articuloNuevo(prisma, e.unidadId, null), await articuloNuevo(prisma, e.unidadId, null)];
    await capa(bodega, x.id, 4, "2026-08-01");
    await capa(bodega, y.id, 2, "2026-08-01");
    const llave = randomUUID();
    const h = await abrir(bodega, llave);
    expect(h).toMatchObject({ revision: 1, repetido: false });
    await expect(renglones(h.id)).resolves.toEqual([
      { articuloId: x.id, cantidadEsperada: 4, cantidadContada: null },
      { articuloId: y.id, cantidadEsperada: 2, cantidadContada: null },
    ]);
    await expect(abrir(bodega, llave)).resolves.toEqual({ id: h.id, revision: 1, repetido: true });
    await expect(abrir(bodega, llave, "Otro motivo")).rejects.toMatchObject({ codigo: "conflicto-idempotencia" });
    await expect(abrir(bodega, randomUUID(), "   ")).rejects.toMatchObject({ codigo: "datos" });
  });

  it("guardar exige la revisión abierta, agrega artículos con la existencia leída y sube la revisión", async () => {
    const bodega = await bodegaNueva();
    const [x, nuevo] = [await articuloNuevo(prisma, e.unidadId, null), await articuloNuevo(prisma, e.unidadId, null)];
    await capa(bodega, x.id, 4, "2026-08-01");
    const h = await abrir(bodega);
    const g = await guardar(h.id, 1, [contado(x.id, 3), contado(nuevo.id, 2)]);
    expect(g.revision).toBe(2);
    await expect(renglones(h.id)).resolves.toEqual([
      { articuloId: x.id, cantidadEsperada: 4, cantidadContada: 3 },
      { articuloId: nuevo.id, cantidadEsperada: 0, cantidadContada: 2 },
    ]);
    await expect(guardar(h.id, 1, [contado(x.id, 1)])).rejects.toMatchObject({ codigo: "conflicto" });
    await expect(guardar(h.id, 2, [contado(x.id, -1)])).rejects.toMatchObject({ codigo: "partidas" });
    await expect(guardar(h.id, 2, [contado(x.id, 1), contado(x.id, 2)])).rejects.toMatchObject({ codigo: "partidas" });
    await expect(renglones(h.id)).resolves.toMatchObject([{ cantidadContada: 3 }, { cantidadContada: 2 }]);
  });

  it("Jefe no abre, no guarda ni confirma", async () => {
    await expect(como(e.usuarios.JEFE, "ajustes:capturar", (tx) => abrirHoja(tx, e.usuarios.JEFE, randomUUID(), { bodegaId: e.bodegaId, motivo: "x" }))).rejects.toBeInstanceOf(
      SinPermisoDePrueba,
    );
  });
});

describe("confirmar", () => {
  it("diferencias positivas crean capa sin costo, negativas consumen PEPS y cero no genera asiento", async () => {
    const bodega = await bodegaNueva();
    const [mas, menos, igual] = [await articuloNuevo(prisma, e.unidadId, null), await articuloNuevo(prisma, e.unidadId, null), await articuloNuevo(prisma, e.unidadId, null)];
    await capa(bodega, mas.id, 2, "2026-08-01", ["3.0000", "3.4800"]);
    const vieja = await capa(bodega, menos.id, 2, "2026-07-01", ["1.0000", "1.1600"]);
    const nueva = await capa(bodega, menos.id, 5, "2026-08-01", ["2.0000", "2.3200"]);
    await capa(bodega, igual.id, 1, "2026-08-01");
    const h = await abrir(bodega);
    const { revision } = await guardar(h.id, 1, [contado(mas.id, 5), contado(menos.id, 4), contado(igual.id, 1)]);

    const r = await confirmar(h.id, revision);
    expect(r.repetido).toBe(false);
    expect(r.ajustes).toHaveLength(2);
    const ajustes = await prisma.movimiento.findMany({ where: { conteoId: h.id }, include: { partidas: { include: { consumos: true } }, capas: true } });
    const negativo = ajustes.find((a) => a.bodegaOrigenId)!;
    const positivo = ajustes.find((a) => a.bodegaDestinoId)!;
    expect(negativo).toMatchObject({ tipo: "AJUSTE", estatus: "CONFIRMADO", motivo: "Conteo mensual", bodegaOrigenId: bodega, confirmadoPorId: compras.id });
    expect(negativo.partidas.map((p) => [p.articuloId, p.cantidad])).toEqual([[menos.id, 3]]);
    expect(negativo.partidas[0].consumos.map((k) => [k.capaId, k.cantidad]).sort()).toEqual([[vieja.id, 2], [nueva.id, 1]].sort());
    expect(negativo.capas).toEqual([]);
    expect(positivo.partidas.map((p) => [p.articuloId, p.cantidad])).toEqual([[mas.id, 3]]);
    expect(positivo.capas.map((c) => [c.cantidadInicial, c.costoUnitario, deFechaDeBase(c.fechaOriginal)])).toEqual([[3, null, hoyEnMexico()]]);
    await expect(Promise.all([existencia(bodega, mas.id), existencia(bodega, menos.id), existencia(bodega, igual.id)])).resolves.toEqual([5, 4, 1]);
    await expect(prisma.hojaConteo.findUniqueOrThrow({ where: { id: h.id } })).resolves.toMatchObject({ estatus: "CONFIRMADO", confirmadoPorId: compras.id });
    await expect(descuadres(prisma, [bodega])).resolves.toEqual([]);

    // Reintento: los mismos folios, sin otro asiento.
    await expect(confirmar(h.id, revision)).resolves.toEqual({ id: h.id, ajustes: [...r.ajustes].sort(), repetido: true });
    await expect(confirmar(h.id, revision + 1)).rejects.toMatchObject({ codigo: "conflicto" });
    await expect(guardar(h.id, revision, [contado(mas.id, 1)])).rejects.toMatchObject({ codigo: "estado" });
    await expect(prisma.movimiento.count({ where: { conteoId: h.id } })).resolves.toBe(2);
  });

  it("sin diferencias se confirma sin ajustes; sin nada contado no se confirma", async () => {
    const bodega = await bodegaNueva();
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(bodega, x.id, 3, "2026-08-01");
    const h = await abrir(bodega);
    await expect(confirmar(h.id, 1)).rejects.toMatchObject({ codigo: "partidas" });
    const { revision } = await guardar(h.id, 1, [contado(x.id, 3)]);
    await expect(confirmar(h.id, revision)).resolves.toEqual({ id: h.id, ajustes: [], repetido: false });
    await expect(existencia(bodega, x.id)).resolves.toBe(3);
  });

  it("una hoja obsoleta no confirma; al actualizarla se revisan las diferencias actuales", async () => {
    const bodega = await bodegaNueva();
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(bodega, x.id, 10, "2026-08-01");
    const h = await abrir(bodega);
    const { revision } = await guardar(h.id, 1, [contado(x.id, 7)]);
    // Mientras se contaba, entró material.
    await capa(bodega, x.id, 2, "2026-09-01");
    await expect(confirmar(h.id, revision)).rejects.toMatchObject({ codigo: "conteo-obsoleto", message: expect.stringContaining("se leyó 10, hay 12") });
    await expect(prisma.movimiento.count({ where: { conteoId: h.id } })).resolves.toBe(0);
    await expect(existencia(bodega, x.id)).resolves.toBe(12);

    const act = await como(compras, "ajustes:capturar", (tx) => actualizarHoja(tx, compras, h.id, revision));
    await expect(renglones(h.id)).resolves.toEqual([{ articuloId: x.id, cantidadEsperada: 12, cantidadContada: 7 }]);
    await expect(confirmar(h.id, revision)).rejects.toMatchObject({ codigo: "conflicto" });
    const r = await confirmar(h.id, act.revision);
    expect(r.ajustes).toHaveLength(1);
    await expect(existencia(bodega, x.id)).resolves.toBe(7);
  });

  it("actualizar agrega los artículos que aparecieron con existencia", async () => {
    const bodega = await bodegaNueva();
    const [x, y] = [await articuloNuevo(prisma, e.unidadId, null), await articuloNuevo(prisma, e.unidadId, null)];
    await capa(bodega, x.id, 1, "2026-08-01");
    const h = await abrir(bodega);
    await capa(bodega, y.id, 4, "2026-08-01");
    await como(compras, "ajustes:capturar", (tx) => actualizarHoja(tx, compras, h.id, 1));
    await expect(renglones(h.id)).resolves.toEqual([
      { articuloId: x.id, cantidadEsperada: 1, cantidadContada: null },
      { articuloId: y.id, cantidadEsperada: 4, cantidadContada: null },
    ]);
  });

  it("dos confirmaciones simultáneas de la misma revisión: un juego de ajustes", async () => {
    const bodega = await bodegaNueva();
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(bodega, x.id, 5, "2026-08-01");
    const h = await abrir(bodega);
    const { revision } = await guardar(h.id, 1, [contado(x.id, 2)]);
    const [a, b] = await Promise.all([confirmar(h.id, revision), confirmar(h.id, revision)]);
    expect(a.ajustes).toEqual(b.ajustes);
    expect([a.repetido, b.repetido].sort()).toEqual([false, true]);
    await expect(existencia(bodega, x.id)).resolves.toBe(2);
  });

  it("un ingreso que confirma mientras el conteo espera la existencia vuelve obsoleta la hoja", async () => {
    const bodega = await bodegaNueva();
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(bodega, x.id, 5, "2026-08-01");
    const h = await abrir(bodega);
    const { revision } = await guardar(h.id, 1, [contado(x.id, 5)]);
    let conteo!: Promise<unknown>;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "Existencia" WHERE "bodegaId" = ${bodega}::uuid AND "articuloId" = ${x.id}::uuid FOR UPDATE`;
      conteo = confirmar(h.id, revision).catch((error: unknown) => error);
      await new Promise((r) => setTimeout(r, 200));
      // Un ajuste positivo de 1, conciliado, confirmado mientras el conteo espera.
      const a = await tx.movimiento.create({
        data: {
          tipo: "AJUSTE", estatus: "BORRADOR", fecha: new Date(`${hoyEnMexico()}T00:00:00Z`), bodegaDestinoId: bodega, motivo: "Hallazgo", creadoPorId: compras.id,
          partidas: { create: [{ orden: 1, articuloId: x.id, presentacionCapturada: "UNIDAD", cantidadCapturada: 1, factorConversion: 1, cantidad: 1 }] },
        },
      });
      await tx.capaCosto.create({ data: { bodegaId: bodega, articuloId: x.id, movimientoId: a.id, fecha: a.fecha, fechaOriginal: a.fecha, cantidadInicial: 1, cantidadRestante: 1 } });
      await tx.existencia.update({ where: { bodegaId_articuloId: { bodegaId: bodega, articuloId: x.id } }, data: { cantidad: { increment: 1 } } });
      await tx.movimiento.update({ where: { id: a.id }, data: { estatus: "CONFIRMADO", folio: `A-h-${randomUUID().slice(0, 8)}`, confirmadoPorId: compras.id, confirmadoEn: new Date() } });
    });
    await expect(conteo).resolves.toMatchObject({ codigo: "conteo-obsoleto", message: expect.stringContaining("se leyó 5, hay 6") });
    await expect(existencia(bodega, x.id)).resolves.toBe(6);
  });

  it("descartar con motivo es terminal e idempotente", async () => {
    const bodega = await bodegaNueva();
    const h = await abrir(bodega);
    await expect(como(compras, "ajustes:capturar", (tx) => descartarHoja(tx, compras, h.id, "Error"))).resolves.toEqual({ id: h.id, repetido: false });
    await expect(como(compras, "ajustes:capturar", (tx) => descartarHoja(tx, compras, h.id, "Error"))).resolves.toEqual({ id: h.id, repetido: true });
    await expect(como(compras, "ajustes:capturar", (tx) => descartarHoja(tx, compras, h.id, "Otro"))).rejects.toMatchObject({ codigo: "conflicto" });
    await expect(confirmar(h.id, 1)).rejects.toMatchObject({ codigo: "estado" });
  });
});
