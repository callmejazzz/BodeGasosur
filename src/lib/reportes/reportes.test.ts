/*
  Los cinco reportes contra PostgreSQL real (contrato de la fase 8, §5). El
  escenario se arma con los servicios de cada movimiento y después se fecha a
  mano, sin triggers, para tener semanas pasadas. Los importes se comparan
  contra SQL de control escrito aparte, que redondea por renglón con round().
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { sembrarCapa, sinDefensas } from "../../../pruebas/semilla-inventario";
import { como, sembrarOperacion } from "../../../pruebas/semilla-operacion";
import type { EntornoSalidas } from "../../../pruebas/semilla-salidas";
import type { UsuarioSesion } from "../db";
import { hoyEnMexico } from "../fechas";
import { confirmarDevolucion, crearDevolucion } from "../inventario/devoluciones";
import { revertirMovimiento } from "../inventario/reversas";
import { confirmarTraspaso, crearTraspaso } from "../inventario/traspasos";
import { autorizarSalida, retirarSalida, solicitarSalida } from "../salidas/servicio";
import { leerFiltrosSemanal, semanaDe, viernesDeCorte } from "./filtros";

vi.mock("server-only", () => ({}));
const { filasSemanal, totalesPorArticulo, totalSemanal } = await import("./semanal");
const { filasExistencias, totalExistencias } = await import("./existencias");
const { filasKardex, resumenKardex } = await import("./kardex");
const { gastoPorArticulo, gastoPorEstacion, totalGasto } = await import("./gasto");
const { filasFrecuencia } = await import("./frecuencia");

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
let sufijo: string;
let articulo: { id: string; descripcion: string };
const ids: Record<string, string> = {};

const leer = <T>(fn: (db: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(async (db) => {
    await db.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return fn(db);
  });
const fechar = (id: string, fecha: string) =>
  sinDefensas(prisma, (tx) => tx.$executeRaw`UPDATE "Movimiento" SET fecha = ${fecha}::date WHERE id = ${id}::uuid`);
const unidades = (articuloId: string, n: number) => [{ articuloId, presentacion: "UNIDAD" as const, cantidadCapturada: n }];

async function salida(cantidad: number, opciones: { bodegaId?: string; esPrestamo?: boolean; retirar?: boolean } = {}) {
  const u = e.usuarios.COMPRAS;
  const { id } = await como(prisma, u, "salidas:capturar", (tx) =>
    solicitarSalida(tx, u, randomUUID(), {
      encabezado: { bodegaOrigenId: opciones.bodegaId ?? e.bodegaId, estacionId: e.estacionId, esPrestamo: opciones.esPrestamo ?? false },
      partidas: unidades(articulo.id, cantidad),
    }),
  );
  if (opciones.retirar === false) return id;
  await como(prisma, e.autorizadores.JEFE, "salidas:autorizar", (tx) => autorizarSalida(tx, e.autorizadores.JEFE, id));
  await como(prisma, u, "salidas:retirar", (tx) => retirarSalida(tx, u, id, "Mensajero"));
  return id;
}

async function devolucion(cantidad: number, bodegaDestinoId: string, salidaId: string | null) {
  const u = e.usuarios.COMPRAS;
  const { id } = await como(prisma, u, "devoluciones:capturar", (tx) =>
    crearDevolucion(tx, u, randomUUID(), { encabezado: { estacionId: e.estacionId, bodegaDestinoId, salidaId }, partidas: unidades(articulo.id, cantidad) }),
  );
  await como(prisma, u, "devoluciones:confirmar", (tx) => confirmarDevolucion(tx, u, id));
  return id;
}

async function reversa(id: string) {
  const admin: UsuarioSesion = e.usuarios.SUPERADMIN;
  return (await como(prisma, admin, "movimientos:revertir", (tx) => revertirMovimiento(tx, admin, id, "Prueba de reportes"))).id;
}

/*
  Artículo de la prueba, en la bodega A (e.bodegaId) y la B (e.otraBodegaId):
    08-20  entrada 10 a $10.00 ($11.60 con IVA) en A
    08-21  ajuste +4 sin costo en A
    09-07  S1: salida de 3 desde A                  (semana 05-11 sep)
    09-08  T1: traspaso de 9 de A a B: 7 con costo, 2 sin costo
    09-09  D1: devolución de 1 ligada a S1, vuelve a A con costo
    09-10  D2: devolución de 2 sin salida, a B, sin costo
    09-11  R1: reversa de D2
    09-15  P1: préstamo de 1 desde B                (semana 12-18 sep)
    09-16  S3: salida de 1 desde A, revertida el 09-17 (R3)
    hoy    S2: solicitada sin retirar
*/
beforeAll(async () => {
  e = await sembrarOperacion(prisma);
  sufijo = randomUUID().slice(0, 8);
  const a = await prisma.articulo.create({ data: { descripcion: `Reporte ${sufijo}`, unidadId: e.unidadId } });
  articulo = { id: a.id, descripcion: a.descripcion };

  await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: a.id, cantidad: 10, fechaOriginal: "2026-08-20", costo: ["10.0000", "11.6000"] });
  await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: a.id, cantidad: 4, fechaOriginal: "2026-08-21", costo: null });

  ids.S1 = await salida(3);
  await fechar(ids.S1, "2026-09-07");

  const u = e.usuarios.COMPRAS;
  const t = await como(prisma, u, "traspasos:capturar", (tx) =>
    crearTraspaso(tx, u, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, bodegaDestinoId: e.otraBodegaId }, partidas: unidades(a.id, 9) }),
  );
  await como(prisma, u, "traspasos:confirmar", (tx) => confirmarTraspaso(tx, u, t.id));
  ids.T1 = t.id;
  await fechar(ids.T1, "2026-09-08");

  ids.D1 = await devolucion(1, e.bodegaId, ids.S1);
  await fechar(ids.D1, "2026-09-09");
  ids.D2 = await devolucion(2, e.otraBodegaId, null);
  await fechar(ids.D2, "2026-09-10");
  ids.R1 = await reversa(ids.D2);
  await fechar(ids.R1, "2026-09-11");

  ids.P1 = await salida(1, { bodegaId: e.otraBodegaId, esPrestamo: true });
  await fechar(ids.P1, "2026-09-15");
  ids.S3 = await salida(1);
  await fechar(ids.S3, "2026-09-16");
  ids.R3 = await reversa(ids.S3);
  await fechar(ids.R3, "2026-09-17");

  ids.S2 = await salida(5, { retirar: false });
});
afterAll(() => prisma.$disconnect());

const SEMANA_1 = { inicio: "2026-09-05", corte: "2026-09-11" };
const SEMANA_2 = { inicio: "2026-09-12", corte: "2026-09-18" };
const semanal = (semana: { inicio: string; corte: string }, bodegaId = "") =>
  leer((db) => filasSemanal(db, { ...semana, bodegaId, busqueda: articulo.descripcion }));
const enBodega = <F extends { bodegaId: string }>(filas: F[], bodegaId: string) => filas.find((f) => f.bodegaId === bodegaId);
const enId = <F extends { id: string }>(filas: F[], id: string) => filas.find((f) => f.id === id);

const cuadra = (f: { inicial: number; compras: number; salidas: number; recibidos: number; enviados: number; devoluciones: number; ajustesMas: number; ajustesMenos: number; reversasMas: number; reversasMenos: number; final: number }) =>
  f.inicial + f.compras - f.salidas + f.recibidos - f.enviados + f.devoluciones + f.ajustesMas - f.ajustesMenos + f.reversasMas - f.reversasMenos === f.final;

describe("semana del viernes", () => {
  it("el corte es el viernes del día o el anterior, y la semana empieza el sábado previo", () => {
    expect(viernesDeCorte("2026-10-09")).toBe("2026-10-09");
    expect(viernesDeCorte("2026-10-10")).toBe("2026-10-09");
    expect(viernesDeCorte("2026-10-15")).toBe("2026-10-09");
    expect(viernesDeCorte("2026-10-16")).toBe("2026-10-16");
    expect(semanaDe("2026-10-09")).toEqual({ inicio: "2026-10-03", corte: "2026-10-09" });
    expect(leerFiltrosSemanal({}, "2026-10-15").viernes).toBe("2026-10-09");
    expect(leerFiltrosSemanal({ viernes: "2026-10-16" }, "2026-10-15").viernes).toBe("2026-10-09");
    expect(leerFiltrosSemanal({ viernes: "2026-09-08", bodega: "no-es-uuid" }, "2026-10-15")).toEqual({ viernes: "2026-09-04", bodegaId: "", busqueda: "" });
  });
});

describe("reporte semanal", () => {
  it("cada fila cuadra: saldo inicial + altas − bajas = saldo final, en la bodega correcta", async () => {
    const { filas } = await semanal(SEMANA_1);
    expect(filas).toHaveLength(2);
    for (const f of filas) expect(cuadra(f), f.bodega).toBe(true);
    expect(enBodega(filas, e.bodegaId)).toMatchObject({
      inicial: 14, compras: 0, salidas: 3, recibidos: 0, enviados: 9, devoluciones: 1, ajustesMas: 0, ajustesMenos: 0, reversasMas: 0, reversasMenos: 0, final: 3,
      importe: "10.00", importeConIva: "11.60", sinCosto: 2,
    });
    expect(enBodega(filas, e.otraBodegaId)).toMatchObject({
      inicial: 0, recibidos: 9, enviados: 0, devoluciones: 2, reversasMas: 0, reversasMenos: 2, final: 9,
      importe: "70.00", importeConIva: "81.20", sinCosto: 2,
    });
  });

  it("el traspaso no crea stock: lo que sale de una bodega entra en la otra", async () => {
    const { filas } = await semanal(SEMANA_1);
    expect(filas.reduce((n, f) => n + f.recibidos - f.enviados, 0)).toBe(0);
    const { filas: [total] } = await leer((db) => totalesPorArticulo(db, { ...SEMANA_1, bodegaId: "", busqueda: articulo.descripcion }));
    expect(total).toMatchObject({ inicial: 14, recibidos: 9, enviados: 9, final: 12, importe: "80.00", importeConIva: "92.80", sinCosto: 4 });
  });

  it("la reversa suma en su fecha y la salida original sigue en la suya; la solicitud sin retiro no cuenta", async () => {
    const { filas } = await semanal(SEMANA_2);
    expect(enBodega(filas, e.bodegaId)).toMatchObject({ inicial: 3, salidas: 1, reversasMas: 1, final: 3 });
    expect(enBodega(filas, e.otraBodegaId)).toMatchObject({ inicial: 9, salidas: 1, final: 8 });
    for (const f of filas) expect(cuadra(f)).toBe(true);
  });

  it("al corte de hoy el saldo es Existencia y el valor es el de las capas restantes, por renglón", async () => {
    const hoy = hoyEnMexico();
    const { filas } = await leer((db) => filasSemanal(db, { inicio: hoy, corte: hoy, bodegaId: "", busqueda: articulo.descripcion }));
    const control = await prisma.$queryRaw<{ bodegaId: string; cantidad: number; restante: number; importe: string | null; conIva: string | null; sinCosto: number }[]>`
      SELECT e."bodegaId", e.cantidad,
             (SELECT coalesce(sum(c."cantidadRestante"), 0)::int FROM "CapaCosto" c WHERE c."bodegaId" = e."bodegaId" AND c."articuloId" = e."articuloId") AS restante,
             (SELECT sum(round(c."cantidadRestante" * c."costoUnitario", 2))::text FROM "CapaCosto" c WHERE c."bodegaId" = e."bodegaId" AND c."articuloId" = e."articuloId" AND c."cantidadRestante" > 0) AS importe,
             (SELECT sum(round(c."cantidadRestante" * c."costoUnitarioConIva", 2))::text FROM "CapaCosto" c WHERE c."bodegaId" = e."bodegaId" AND c."articuloId" = e."articuloId" AND c."cantidadRestante" > 0) AS "conIva",
             (SELECT coalesce(sum(c."cantidadRestante"), 0)::int FROM "CapaCosto" c WHERE c."bodegaId" = e."bodegaId" AND c."articuloId" = e."articuloId" AND c."costoUnitario" IS NULL) AS "sinCosto"
      FROM "Existencia" e WHERE e."articuloId" = ${articulo.id}::uuid AND e.cantidad <> 0`;
    expect(control).toHaveLength(2);
    for (const c of control) {
      expect(c.cantidad).toBe(c.restante);
      expect(enBodega(filas, c.bodegaId)).toMatchObject({ final: c.cantidad, importe: c.importe, importeConIva: c.conIva, sinCosto: c.sinCosto });
    }
  });

  it("costo desconocido es cantidad sin valuar, nunca cero: el total avisa cuántas filas la tienen", async () => {
    const t = await leer((db) => totalSemanal(db, { ...SEMANA_1, bodegaId: "", busqueda: articulo.descripcion }));
    expect(t).toEqual({ importe: "80.00", importeConIva: "92.80", filas: 2, filasSinCosto: 2 });
    const soloSinCosto = await leer((db) => filasSemanal(db, { inicio: "2026-08-21", corte: "2026-08-21", bodegaId: e.bodegaId, busqueda: articulo.descripcion }));
    expect(soloSinCosto.filas[0]).toMatchObject({ inicial: 10, ajustesMas: 4, final: 14, importe: "100.00", sinCosto: 4 });
    const vacio = await leer((db) => filasSemanal(db, { inicio: "2026-08-01", corte: "2026-08-07", bodegaId: "", busqueda: articulo.descripcion }));
    expect(vacio.filas).toEqual([]);
  });

  it("filtros sin coincidencias no devuelven filas ni totales inventados", async () => {
    const c = { ...SEMANA_1, bodegaId: "", busqueda: `nada-${sufijo}` };
    await expect(leer((db) => filasSemanal(db, c))).resolves.toMatchObject({ filas: [], pagina: { total: 0 } });
    await expect(leer((db) => totalSemanal(db, c))).resolves.toEqual({ importe: null, importeConIva: null, filas: 0, filasSinCosto: 0 });
  });
});

describe("kardex", () => {
  const filtros = (desde = "2026-09-01", hasta = "2026-09-30", bodegaId = "") => ({ articuloId: articulo.id, bodegaId, desde, hasta });

  it("cada fila lleva el saldo corrido de su bodega, desde el saldo anterior al rango", async () => {
    const { filas } = await leer((db) => filasKardex(db, filtros()));
    const resumen = filas.map((f) => [f.movimientoId, f.bodega.split(" · ")[0], f.entra, f.sale, f.saldo]);
    const clave = async (id: string) => (await prisma.bodega.findUniqueOrThrow({ where: { id } })).clave;
    const [A, B] = [await clave(e.bodegaId), await clave(e.otraBodegaId)];
    const traspaso = resumen.filter((r) => r[0] === ids.T1);
    expect(traspaso).toEqual(expect.arrayContaining([[ids.T1, A, 0, 9, 2], [ids.T1, B, 9, 0, 9]]));
    expect(resumen.filter((r) => r[0] !== ids.T1)).toEqual([
      [ids.S1, A, 0, 3, 11],
      [ids.D1, A, 1, 0, 3],
      [ids.D2, B, 2, 0, 11],
      [ids.R1, B, 0, 2, 9],
      [ids.P1, B, 0, 1, 8],
      [ids.S3, A, 0, 1, 2],
      [ids.R3, A, 1, 0, 3],
    ]);
  });

  it("importes por fragmento y piezas sin costo aparte; la reversa se enlaza con su original", async () => {
    const { filas } = await leer((db) => filasKardex(db, filtros()));
    const de = (id: string) => filas.find((f) => f.movimientoId === id);
    expect(de(ids.S1)).toMatchObject({ importe: "-30.00", importeConIva: "-34.80", sinCosto: 0, tipo: "Salida" });
    expect(filas.filter((f) => f.movimientoId === ids.T1).map((f) => [f.importe, f.sinCosto]).sort()).toEqual([["-70.00", 2], ["70.00", 2]]);
    expect(de(ids.D2)).toMatchObject({ importe: null, sinCosto: 2, tipo: "Devolución", referencia: "Sin salida vinculada" });
    const original = await prisma.movimiento.findUniqueOrThrow({ where: { id: ids.D2 }, select: { folio: true } });
    expect(de(ids.R1)).toMatchObject({ tipo: `Reversa de ${original.folio}`, originalId: ids.D2, originalTipo: "DEVOLUCION", importe: null, sinCosto: 2 });
    expect(de(ids.P1)).toMatchObject({ tipo: "Salida (préstamo)", importe: "-10.00" });
  });

  it("el resumen por bodega cuadra con sus filas", async () => {
    const { filas } = await leer((db) => resumenKardex(db, filtros()));
    expect(filas).toHaveLength(2);
    expect(enId(filas, e.bodegaId)).toMatchObject({ inicial: 14, entradas: 2, salidas: 13, final: 3 });
    expect(enId(filas, e.otraBodegaId)).toMatchObject({ inicial: 0, entradas: 11, salidas: 3, final: 8 });
  });

  it("filtrar una bodega deja solo sus filas y su saldo", async () => {
    const { filas } = await leer((db) => filasKardex(db, filtros("2026-09-12", "2026-09-30", e.bodegaId)));
    expect(filas.map((f) => [f.movimientoId, f.saldo])).toEqual([[ids.S3, 2], [ids.R3, 3]]);
  });
});

describe("gasto por estación", () => {
  const f = (desde: string, hasta: string) => ({ desde, hasta, estacionId: e.estacionId, articuloId: articulo.id, detalle: true });

  it("es consumo neto: descuenta la devolución ligada, ignora la que no tiene salida y deja fuera los préstamos", async () => {
    const { filas } = await leer((db) => gastoPorArticulo(db, f("2026-09-01", "2026-09-30")));
    expect(filas).toEqual([expect.objectContaining({ retirado: 3, devuelto: 1, neto: 2, importe: "20.00", importeConIva: "23.20", sinCosto: 0 })]);
  });

  it("la reversa compensa en su fecha: un periodo corto puede quedar negativo", async () => {
    await expect(leer((db) => gastoPorArticulo(db, f("2026-09-16", "2026-09-16")))).resolves.toMatchObject({ filas: [{ retirado: 1, neto: 1, importe: "10.00" }] });
    await expect(leer((db) => gastoPorArticulo(db, f("2026-09-17", "2026-09-17")))).resolves.toMatchObject({ filas: [{ retirado: -1, neto: -1, importe: "-10.00" }] });
    await expect(leer((db) => gastoPorArticulo(db, f("2026-09-15", "2026-09-15")))).resolves.toMatchObject({ filas: [] });
  });

  it("los importes coinciden con un control que redondea por consumo y por capa devuelta", async () => {
    const [control] = await prisma.$queryRaw<{ importe: string }[]>`
      SELECT ((SELECT sum(round(k.cantidad * k."costoUnitario", 2)) FROM "ConsumoCapa" k JOIN "MovimientoPartida" p ON p.id = k."partidaId"
                WHERE p."movimientoId" = ANY(${[ids.S1, ids.S3]}::uuid[]))
            - (SELECT sum(round(r.cantidad * r."costoUnitario", 2)) FROM "RestitucionCapa" r JOIN "MovimientoPartida" p ON p.id = r."partidaId"
                WHERE p."movimientoId" = ${ids.R3}::uuid)
            - (SELECT sum(round(c."cantidadInicial" * c."costoUnitario", 2)) FROM "CapaCosto" c WHERE c."movimientoId" = ${ids.D1}::uuid))::text AS importe`;
    const t = await leer((db) => totalGasto(db, f("2026-09-01", "2026-09-30")));
    expect(t).toEqual({ importe: control.importe, importeConIva: "23.20", conPiezasSinCosto: false });
    const { filas } = await leer((db) => gastoPorEstacion(db, f("2026-09-01", "2026-09-30")));
    expect(filas).toEqual([expect.objectContaining({ id: e.estacionId, articulos: 1, importe: control.importe, articulosSinCosto: 0 })]);
  });
});

describe("frecuencia de consumo", () => {
  it("cuenta salidas retiradas por artículo, separa préstamos y no cuenta revertidas ni solicitudes", async () => {
    const { filas } = await leer((db) => filasFrecuencia(db, { desde: "2026-09-01", hasta: "2026-09-30", estacionId: e.estacionId, bodegaId: "", busqueda: articulo.descripcion }));
    expect(filas).toEqual([expect.objectContaining({ id: articulo.id, retiros: 2, prestamos: 1, unidades: 4 })]);
    expect(filas[0].ultimo.toISOString().slice(0, 10)).toBe("2026-09-15");
    const soloA = await leer((db) => filasFrecuencia(db, { desde: "2026-09-01", hasta: "2026-09-30", estacionId: "", bodegaId: e.bodegaId, busqueda: articulo.descripcion }));
    expect(soloA.filas).toEqual([expect.objectContaining({ retiros: 1, prestamos: 0, unidades: 3 })]);
  });
});

describe("existencias por bodega y mínimo", () => {
  let bajo: string;
  let cero: string;
  let inactivo: string;
  let baja: string;

  beforeAll(async () => {
    const nuevo = (descripcion: string, stockMinimo: number) => prisma.articulo.create({ data: { descripcion: `${descripcion} ${sufijo}`, unidadId: e.unidadId, stockMinimo } });
    bajo = (await nuevo("Mínimo cinco", 5)).id;
    cero = (await nuevo("Mínimo cero", 0)).id;
    inactivo = (await nuevo("Dado de baja", 5)).id;
    await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: bajo, cantidad: 2, fechaOriginal: "2026-09-01", costo: ["1.0000", "1.1600"] });
    await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: inactivo, cantidad: 1, fechaOriginal: "2026-09-01", costo: null });
    await prisma.articulo.update({ where: { id: inactivo }, data: { activo: false } });
    // Una bodega dada de baja con existencia solo se logra sin defensas.
    baja = (await prisma.bodega.create({ data: { nombre: `Bodega baja ${sufijo}` } })).id;
    await sembrarCapa(prisma, e, { bodegaId: baja, articuloId: bajo, cantidad: 1, fechaOriginal: "2026-09-01", costo: null });
    await sinDefensas(prisma, (tx) => tx.$executeRaw`UPDATE "Bodega" SET activa = false WHERE id = ${baja}::uuid`);
  });

  const existencias = (bodegaId: string, busqueda = sufijo, bajoMinimo = false) => leer((db) => filasExistencias(db, { bodegaId, busqueda, bajoMinimo }));

  it("bajo mínimo se compara en cada bodega; mínimo cero sin existencia no lo es ni aparece sin buscarlo", async () => {
    const { filas } = await existencias(e.otraBodegaId);
    expect(filas.find((f) => f.articuloId === bajo)).toMatchObject({ existencia: 0, minimo: 5, diferencia: -5, bajoMinimo: true });
    expect(filas.find((f) => f.articuloId === cero)).toMatchObject({ existencia: 0, minimo: 0, bajoMinimo: false });
    const sinBuscar = await leer((db) => filasExistencias(db, { bodegaId: e.otraBodegaId, busqueda: "", bajoMinimo: false }));
    expect(sinBuscar.filas.some((f) => f.articuloId === cero)).toBe(false);
    expect(sinBuscar.filas.some((f) => f.articuloId === bajo)).toBe(true);
  });

  it("lo bajo mínimo va primero, con su valor y piezas sin costo separadas", async () => {
    const { filas } = await existencias(e.bodegaId);
    expect(filas[0]).toMatchObject({ articuloId: bajo, existencia: 2, bajoMinimo: true, importe: "2.00", importeConIva: "2.32", sinCosto: 0 });
    expect(filas.find((f) => f.articuloId === inactivo)).toMatchObject({ existencia: 1, articuloActivo: false, bajoMinimo: false, importe: null, sinCosto: 1 });
  });

  it("una bodega o un artículo inactivos con existencia siguen visibles, sin indicador", async () => {
    const { filas } = await existencias(baja);
    expect(filas).toEqual([expect.objectContaining({ articuloId: bajo, bodegaActiva: false, existencia: 1, bajoMinimo: false })]);
    const solo = await existencias(baja, sufijo, true);
    expect(solo.filas).toEqual([]);
  });

  it("el total suma el valor conocido y cuenta lo bajo mínimo", async () => {
    await expect(leer((db) => totalExistencias(db, { bodegaId: e.bodegaId, busqueda: sufijo, bajoMinimo: false }))).resolves.toMatchObject({
      bajoMinimo: 1,
      filasSinCosto: 2,
    });
  });
});

describe("histórico recalculado", () => {
  it("una entrada capturada después con fecha anterior cambia el semanal y el kardex al volver a consultarlos", async () => {
    await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: articulo.id, cantidad: 5, fechaOriginal: "2026-08-01", costo: ["20.0000", "23.2000"] });
    const { filas } = await semanal(SEMANA_1, e.bodegaId);
    expect(filas[0]).toMatchObject({ inicial: 19, final: 8, importe: "110.00", sinCosto: 2 });
    expect(cuadra(filas[0])).toBe(true);
    const kardex = await leer((db) => filasKardex(db, { articuloId: articulo.id, bodegaId: e.bodegaId, desde: "2026-09-01", hasta: "2026-09-30" }));
    expect(kardex.filas[0]).toMatchObject({ movimientoId: ids.S1, saldo: 16 });
  });
});
