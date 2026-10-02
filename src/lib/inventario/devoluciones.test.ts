/*
  Devoluciones y saldo de préstamos (contrato de la fase 7, §2.2, §2.3 y
  §5.3) contra PostgreSQL real, sobre salidas retiradas por el servicio de la
  fase 6.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../../pruebas/semilla-entradas";
import { sembrarCapa } from "../../../pruebas/semilla-inventario";
import { como as comoEn, descuadres, sembrarOperacion } from "../../../pruebas/semilla-operacion";
import type { EntornoSalidas } from "../../../pruebas/semilla-salidas";
import type { UsuarioSesion } from "../db";
import { deFechaDeBase, hoyEnMexico } from "../fechas";
import type { Permiso } from "../permisos";
import { autorizarSalida, retirarSalida, solicitarSalida } from "../salidas/servicio";
import { confirmarDevolucion, crearDevolucion, descartarDevolucion, guardarDevolucion, type DatosDevolucion } from "./devoluciones";
import { saldoDeSalida } from "./primitivas";

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
const capa = (articuloId: string, cantidad: number, fechaOriginal: string, costo: [string, string] | null = null) =>
  sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId, cantidad, fechaOriginal, costo });
const existencia = async (articuloId: string, bodegaId = e.bodegaId) =>
  (await prisma.existencia.findUnique({ where: { bodegaId_articuloId: { bodegaId, articuloId } } }))?.cantidad ?? 0;

/** Una salida retirada por el servicio de la fase 6. */
async function retirada(partidas: ReturnType<typeof unidades>[], estacionId = e.estacionId, esPrestamo = true): Promise<string> {
  const { id } = await como(compras, "salidas:capturar", (tx) =>
    solicitarSalida(tx, compras, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, estacionId, esPrestamo }, partidas }),
  );
  await como(e.autorizadores.JEFE, "salidas:autorizar", (tx) => autorizarSalida(tx, e.autorizadores.JEFE, id));
  await como(compras, "salidas:retirar", (tx) => retirarSalida(tx, compras, id, "Mensajero"));
  return id;
}

const datos = (partidas: DatosDevolucion["partidas"], salidaId: string | null, bodegaDestinoId = e.bodegaId, estacionId = e.estacionId): DatosDevolucion => ({
  encabezado: { estacionId, bodegaDestinoId, salidaId },
  partidas,
});
const crear = (d: DatosDevolucion, llave = randomUUID()) => como(compras, "devoluciones:capturar", (tx) => crearDevolucion(tx, compras, llave, d));
const confirmar = (id: string) => como(compras, "devoluciones:confirmar", (tx) => confirmarDevolucion(tx, compras, id));
const devolver = async (d: DatosDevolucion) => confirmar((await crear(d)).id);
const saldo = (salidaId: string) => prisma.$transaction((tx) => saldoDeSalida(tx, salidaId));

describe("devolución vinculada", () => {
  it("parciales heredan costo y fecha original de los consumos en orden PEPS; el saldo baja y nunca se excede", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const vieja = await capa(x.id, 2, "2026-07-01", ["10.0000", "11.6000"]);
    const nueva = await capa(x.id, 5, "2026-08-01", ["20.0000", "23.2000"]);
    const s = await retirada([unidades(x.id, 6)]);
    await expect(saldo(s)).resolves.toMatchObject([{ articuloId: x.id, retirado: 6, devuelto: 0, pendiente: 6 }]);

    const primera = await devolver(datos([unidades(x.id, 3)], s));
    expect(primera.folio).toMatch(/^D-\d{6}$/);
    const capas1 = await prisma.capaCosto.findMany({ where: { movimientoId: primera.id }, orderBy: { fechaOriginal: "asc" } });
    expect(capas1.map((c) => [c.origenId, deFechaDeBase(c.fechaOriginal), c.cantidadInicial, c.costoUnitario?.toString()])).toEqual([
      [vieja.id, "2026-07-01", 2, "10"],
      [nueva.id, "2026-08-01", 1, "20"],
    ]);
    expect(capas1.every((c) => deFechaDeBase(c.fecha) === hoyEnMexico())).toBe(true);
    await expect(saldo(s)).resolves.toMatchObject([{ devuelto: 3, pendiente: 3 }]);

    // La segunda sigue donde se quedó la primera: el saldo es por consumo.
    const segunda = await devolver(datos([unidades(x.id, 2)], s));
    const capas2 = await prisma.capaCosto.findMany({ where: { movimientoId: segunda.id } });
    expect(capas2.map((c) => [c.origenId, c.cantidadInicial])).toEqual([[nueva.id, 2]]);

    await expect(crear(datos([unidades(x.id, 2)], s))).rejects.toMatchObject({ codigo: "saldo", message: expect.stringContaining("faltan por volver 1") });
    await expect(devolver(datos([unidades(x.id, 1)], s))).resolves.toMatchObject({ repetido: false });
    await expect(saldo(s)).resolves.toMatchObject([{ devuelto: 6, pendiente: 0 }]);
    await expect(existencia(x.id)).resolves.toBe(1 + 6);
    await expect(descuadres(prisma, [e.bodegaId])).resolves.toEqual([]);
  });

  it("dos borradores válidos por separado que juntos exceden: el segundo en confirmar se rechaza", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 5, "2026-08-01");
    const s = await retirada([unidades(x.id, 4)]);
    const [a, b] = [await crear(datos([unidades(x.id, 3)], s)), await crear(datos([unidades(x.id, 3)], s))];
    const r = await Promise.allSettled([confirmar(a.id), confirmar(b.id)]);
    expect(r.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ codigo: "saldo" });
    await expect(saldo(s)).resolves.toMatchObject([{ devuelto: 3, pendiente: 1 }]);
  });

  it("regresa a la bodega de la que salió, con el costo de la salida; otra bodega se rechaza al capturar y al guardar", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 3, "2026-08-01", ["5.0000", "5.8000"]);
    const s = await retirada([unidades(x.id, 3)]);
    const aOtra = { codigo: "datos", message: expect.stringContaining("regresa a la bodega de la que salió") };
    await expect(crear(datos([unidades(x.id, 3)], s, e.otraBodegaId))).rejects.toMatchObject(aOtra);

    // Sin salida cualquier bodega vale; al vincularla, solo la de origen.
    const { id } = await crear(datos([unidades(x.id, 3)], null, e.otraBodegaId));
    const guardar = (d: DatosDevolucion) => como(compras, "devoluciones:capturar", (tx) => guardarDevolucion(tx, compras, id, d));
    await expect(guardar(datos([unidades(x.id, 3)], s, e.otraBodegaId))).rejects.toMatchObject(aOtra);
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ devuelveAId: null, bodegaDestinoId: e.otraBodegaId });
    await guardar(datos([unidades(x.id, 3)], s));
    await expect(confirmar(id)).resolves.toMatchObject({ repetido: false });
    const devuelta = await prisma.capaCosto.findFirstOrThrow({ where: { movimientoId: id } });
    expect(devuelta).toMatchObject({ bodegaId: e.bodegaId, cantidadInicial: 3 });
    expect(Number(devuelta.costoUnitario)).toBe(5);
    await expect(existencia(x.id)).resolves.toBe(3);
    await expect(existencia(x.id, e.otraBodegaId)).resolves.toBe(0);
  });

  it("exige salida retirada de la misma estación y artículos que salieron en ella", async () => {
    const [x, y] = [await articuloNuevo(prisma, e.unidadId, null), await articuloNuevo(prisma, e.unidadId, null)];
    await capa(x.id, 10, "2026-08-01");
    const s = await retirada([unidades(x.id, 2)]);
    await expect(crear(datos([unidades(y.id, 1)], s))).rejects.toMatchObject({ codigo: "saldo" });

    const empresa = await prisma.empresa.create({ data: { razonSocial: `Empresa ${randomUUID().slice(0, 8)}` } });
    const otra = await prisma.estacion.create({ data: { numero: `EO${randomUUID().slice(0, 8)}`, alias: "Otra", empresaId: empresa.id } });
    await expect(crear(datos([unidades(x.id, 1)], s, e.bodegaId, otra.id))).rejects.toMatchObject({ codigo: "datos", message: expect.stringContaining("otra estación") });

    const { id: solicitada } = await como(compras, "salidas:capturar", (tx) =>
      solicitarSalida(tx, compras, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, estacionId: e.estacionId }, partidas: [unidades(x.id, 1)] }),
    );
    await expect(crear(datos([unidades(x.id, 1)], solicitada))).rejects.toMatchObject({ codigo: "estado" });
    await expect(crear(datos([unidades(x.id, 1)], randomUUID()))).rejects.toMatchObject({ codigo: "datos" });
  });

  it("confirmar y descartar son idempotentes; descartada no suma nada", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 3, "2026-08-01");
    const s = await retirada([unidades(x.id, 3)]);
    const { id } = await crear(datos([unidades(x.id, 1)], s));
    const [a, b] = await Promise.all([confirmar(id), confirmar(id)]);
    expect(a.folio).toBe(b.folio);
    await expect(prisma.capaCosto.count({ where: { movimientoId: id } })).resolves.toBe(1);

    const otra = await crear(datos([unidades(x.id, 1)], s));
    await como(compras, "devoluciones:capturar", (tx) => descartarDevolucion(tx, compras, otra.id, "Duplicada"));
    await expect(como(compras, "devoluciones:capturar", (tx) => descartarDevolucion(tx, compras, otra.id, "Duplicada"))).resolves.toEqual({ id: otra.id, repetido: true });
    await expect(confirmar(otra.id)).rejects.toMatchObject({ codigo: "estado" });
    await expect(saldo(s)).resolves.toMatchObject([{ devuelto: 1, pendiente: 2 }]);
    await expect(existencia(x.id)).resolves.toBe(1);
  });

  it("guardar puede cambiar de salida o quitarla, con las mismas reglas", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    await capa(x.id, 4, "2026-08-01");
    const s = await retirada([unidades(x.id, 2)]);
    const { id } = await crear(datos([unidades(x.id, 5)], null));
    await expect(como(compras, "devoluciones:capturar", (tx) => guardarDevolucion(tx, compras, id, datos([unidades(x.id, 5)], s)))).rejects.toMatchObject({ codigo: "saldo" });
    await como(compras, "devoluciones:capturar", (tx) => guardarDevolucion(tx, compras, id, datos([unidades(x.id, 2)], s)));
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ devuelveAId: s });
    await expect(confirmar(id)).resolves.toMatchObject({ repetido: false });
    await expect(saldo(s)).resolves.toMatchObject([{ pendiente: 0 }]);
  });
});

describe("devolución sin salida", () => {
  it("entra sin costo, con la fecha de hoy, y no toca ningún préstamo", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, 6);
    await capa(x.id, 6, "2026-08-01");
    const s = await retirada([unidades(x.id, 6)]);
    const d = await devolver(datos([{ articuloId: x.id, presentacion: "CAJA", cantidadCapturada: 1 }], null));
    const [c] = await prisma.capaCosto.findMany({ where: { movimientoId: d.id } });
    expect(c).toMatchObject({ origenId: null, costoUnitario: null, costoUnitarioConIva: null, cantidadInicial: 6 });
    expect(deFechaDeBase(c.fechaOriginal)).toBe(hoyEnMexico());
    await expect(saldo(s)).resolves.toMatchObject([{ devuelto: 0, pendiente: 6 }]);
    await expect(existencia(x.id)).resolves.toBe(6);
  });
});
