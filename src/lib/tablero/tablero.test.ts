/*
  Tablero de inicio contra PostgreSQL real (contrato fase 9, §4, §5 y prueba 21):
  cada tarjeta sale de su pantalla leída con los filtros de su enlace, todos los
  roles ven lo mismo y una tarjeta sin su permiso no se consulta. El gasto se
  fecha en un mes propio para conocer el orden exacto.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { sembrarCapa, sinDefensas } from "../../../pruebas/semilla-inventario";
import { como, sembrarOperacion } from "../../../pruebas/semilla-operacion";
import type { EntornoSalidas } from "../../../pruebas/semilla-salidas";
import { leerFiltros as filtrosDeEntradas } from "../entradas/filtros";
import { aFechaDeBase } from "../fechas";
import { confirmarDevolucion, crearDevolucion } from "../inventario/devoluciones";
import type { EstadoPrestamo } from "../inventario/repo";
import { usuarioTienePermiso, type Permiso } from "../permisos";
import { leerFiltrosExistencias, leerFiltrosGasto } from "../reportes/filtros";
import { aFiltroDeRepo, leerFiltros as filtrosDeSalidas } from "../salidas/filtros";
import { autorizarSalida, retirarSalida, solicitarSalida } from "../salidas/servicio";

vi.mock("server-only", () => ({}));
const { ENLACES, FILAS, leerTablero } = await import("./repo");
const { contarArticulosBajoMinimo, filasExistencias, totalExistencias } = await import("../reportes/existencias");
const { estacionesDeMayorGasto, gastoPorEstacion } = await import("../reportes/gasto");
const { listarPrestamos } = await import("../inventario/repo");
const { listarSalidas, salidasEnCurso } = await import("../salidas/repo");
const { borradoresMasAntiguos, listarEntradas } = await import("../entradas/repo");
const { todasLasPaginas } = await import("../exportar/lotes");

const prisma = crearCliente(URL_PRUEBAS);
afterAll(() => prisma.$disconnect());

const HOY = "2041-03-20";
let e: EntornoSalidas;
const est: string[] = [];
const enCurso = { S: "", A1: "", A2: "" };
const borradores: Record<string, string> = {};

const leer = <T>(fn: (db: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(async (db) => {
    await db.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return fn(db);
  });
const fechar = (id: string, fecha: string) =>
  sinDefensas(prisma, (tx) => tx.$executeRaw`UPDATE "Movimiento" SET fecha = ${fecha}::date WHERE id = ${id}::uuid`);
const unidades = (articuloId: string, n: number) => [{ articuloId, presentacion: "UNIDAD" as const, cantidadCapturada: n }];
const parametros = (href: string) => Object.fromEntries(new URL(href, "http://localhost").searchParams);
const todo = () => true;
const sinTotal = (fila: object) => Object.fromEntries(Object.entries(fila).filter(([clave]) => clave !== "total_de_la_lista"));
const porFecha = <T extends { id: string; fecha: Date; createdAt: Date }>(filas: T[]) =>
  [...filas].sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));

async function salida(estacionId: string, articuloId: string, n: number, opciones: { hasta?: "solicitar" | "autorizar"; esPrestamo?: boolean; fecha?: string } = {}) {
  const u = e.usuarios.COMPRAS;
  const { id } = await como(prisma, u, "salidas:capturar", (tx) =>
    solicitarSalida(tx, u, randomUUID(), {
      encabezado: { bodegaOrigenId: e.bodegaId, estacionId, esPrestamo: opciones.esPrestamo ?? false },
      partidas: unidades(articuloId, n),
    }),
  );
  if (opciones.hasta !== "solicitar") {
    await como(prisma, e.autorizadores.JEFE, "salidas:autorizar", (tx) => autorizarSalida(tx, e.autorizadores.JEFE, id));
    if (opciones.hasta !== "autorizar") await como(prisma, u, "salidas:retirar", (tx) => retirarSalida(tx, u, id, "Mensajero"));
  }
  if (opciones.fecha) await fechar(id, opciones.fecha);
  return id;
}

/*
  Gasto de marzo de 2041, a $10.00 la pieza:
    E1 3 ($30)   E2 1 ($10)   E3 5 ($50)   E4 2 ($20)   E5 2 ($20, empata con E4)
    E6 1 y la devuelve ($0: no aparece)   E7 1 sin costo (aparece al final)   E8 1 ($10, empata con E2)
  Además: un préstamo abierto, salidas solicitadas y autorizadas y borradores de
  entrada capturados en otro orden que su fecha, y artículos bajo mínimo en todas
  las bodegas activas; de cada uno hay más que las FILAS de su tarjeta.
*/
beforeAll(async () => {
  e = await sembrarOperacion(prisma);
  const sufijo = randomUUID().slice(0, 8);
  const [costeado, sinCosto] = await Promise.all([
    prisma.articulo.create({ data: { descripcion: `Tablero ${sufijo}`, unidadId: e.unidadId } }),
    prisma.articulo.create({ data: { descripcion: `Tablero sin costo ${sufijo}`, unidadId: e.unidadId } }),
    ...Array.from({ length: FILAS }, (_, i) =>
      prisma.articulo.create({ data: { descripcion: `Tablero mínimo ${i + 1} ${sufijo}`, unidadId: e.unidadId, stockMinimo: 5 } }),
    ),
  ]);
  await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: costeado.id, cantidad: 30, fechaOriginal: "2026-01-05", costo: ["10.00", "11.60"] });
  await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: sinCosto.id, cantidad: 1, fechaOriginal: "2026-01-05", costo: null });

  const empresa = await prisma.empresa.create({ data: { razonSocial: `Empresa tablero ${sufijo}` } });
  for (let i = 1; i <= 8; i++) {
    const s = await prisma.estacion.create({ data: { numero: `TB${sufijo}-${i}`, alias: `Estación tablero ${i}`, empresaId: empresa.id } });
    est.push(s.id);
  }
  const [E1, E2, E3, E4, E5, E6, E7, E8] = est;
  for (const [estacion, n] of [[E1, 3], [E2, 1], [E3, 5], [E4, 2], [E5, 2], [E8, 1]] as const) {
    await salida(estacion, costeado.id, n, { fecha: "2041-03-05" });
  }
  await salida(E7, sinCosto.id, 1, { fecha: "2041-03-06" });
  const devuelta = await salida(E6, costeado.id, 1, { fecha: "2041-03-07" });
  const u = e.usuarios.COMPRAS;
  const { id: devolucion } = await como(prisma, u, "devoluciones:capturar", (tx) =>
    crearDevolucion(tx, u, randomUUID(), { encabezado: { estacionId: E6, bodegaDestinoId: e.bodegaId, salidaId: devuelta }, partidas: unidades(costeado.id, 1) }),
  );
  await como(prisma, u, "devoluciones:confirmar", (tx) => confirmarDevolucion(tx, u, devolucion));
  await fechar(devolucion, "2041-03-08");

  await salida(E1, costeado.id, 1, { esPrestamo: true });
  enCurso.S = await salida(E2, costeado.id, 1, { hasta: "solicitar", fecha: "2000-01-02" });
  enCurso.A2 = await salida(E3, costeado.id, 1, { hasta: "autorizar", fecha: "2000-01-03" });
  enCurso.A1 = await salida(E3, costeado.id, 1, { hasta: "autorizar", fecha: "2000-01-01" });
  for (let i = 3; i <= FILAS; i++) await salida(E4, costeado.id, 1, { hasta: "solicitar", fecha: "2000-01-04" });

  const borrador = async (fecha: string) => {
    const { id } = await prisma.movimiento.create({
      data: {
        tipo: "ENTRADA", estatus: "BORRADOR", fecha: aFechaDeBase(fecha), bodegaDestinoId: e.bodegaId, proveedorId: e.proveedorId,
        moneda: "MXN", llaveIdempotencia: randomUUID(), creadoPorId: e.usuarios.COMPRAS.id,
      },
    });
    return id;
  };
  for (const fecha of ["2000-01-03", "2000-01-01", "2000-01-02"]) borradores[fecha] = await borrador(fecha);
  for (let i = 3; i <= FILAS; i++) await borrador("2000-01-04");
});

describe("tablero de inicio (prueba 21)", () => {
  it("cada tarjeta sale de su pantalla, leída con los filtros de su enlace", async () => {
    const { t, p } = await leer(async (db) => {
      const t = await leerTablero(db, todo, HOY);
      const fe = leerFiltrosExistencias(parametros(ENLACES.existencias));
      const fs = aFiltroDeRepo(filtrosDeSalidas(parametros(ENLACES.salidas)));
      const fen = filtrosDeEntradas(parametros(ENLACES.entradas));
      const fg = leerFiltrosGasto(parametros(ENLACES.gasto(t.gasto!.filtros)), HOY);
      const p = {
        reporte: await todasLasPaginas((n, tam) => filasExistencias(db, fe, n, tam)),
        existencias: await totalExistencias(db, fe),
        primeraPagina: (await filasExistencias(db, fe, 1)).filas,
        navegacion: await contarArticulosBajoMinimo(db),
        prestamos: (await listarPrestamos(db, parametros(ENLACES.prestamos).estado as EstadoPrestamo, 1)).filas,
        salidas: await todasLasPaginas((n, tam) => listarSalidas(db, fs, n, tam)),
        entradas: await todasLasPaginas((n, tam) => listarEntradas(db, fen, n, tam)),
        estaciones: await todasLasPaginas((n, tam) => gastoPorEstacion(db, fg, n, tam)),
      };
      return { t, p };
    });

    // Existencias y préstamos: los primeros de su pantalla, en su orden
    expect(t.existencias).toStrictEqual(p.primeraPagina.slice(0, FILAS));
    expect(t.existencias).toHaveLength(FILAS);
    expect(t.prestamos).toStrictEqual(p.prestamos.slice(0, FILAS));
    expect(t.prestamos!.length).toBeGreaterThan(0);

    // N de la navegación cuenta artículos distintos: el artículo bajo mínimo falta en varias bodegas
    const n = new Set(p.reporte.map((f) => f.articuloId)).size;
    expect(p.reporte.length).toBeGreaterThan(n);
    expect(p.existencias.articulosBajoMinimo).toBe(n);
    expect(p.navegacion).toBe(n);

    // Salidas y entradas: lo abierto de su pantalla, la fecha más antigua primero
    const abiertas = p.salidas.filter((s) => s.estatus === "SOLICITADA" || s.estatus === "AUTORIZADA");
    expect(t.salidas).toStrictEqual(porFecha(abiertas).slice(0, FILAS));
    expect(t.salidas).toHaveLength(FILAS);
    expect(t.entradas).toStrictEqual(porFecha(p.entradas).slice(0, FILAS));
    expect(t.entradas).toHaveLength(FILAS);

    expect(t.gasto!.filtros).toMatchObject({ desde: "2041-03-01", hasta: HOY });
    // paginaDe deja en cada fila el total de su propia lista: no es dato de la estación
    for (const s of t.gasto!.estaciones) expect(sinTotal(s)).toStrictEqual(sinTotal(p.estaciones.find((f) => f.id === s.id)!));
  });

  it("salidas y entradas van por fecha, no por estatus ni por orden de captura", async () => {
    const { salidas, entradas } = await leer(async (db) => ({ salidas: await salidasEnCurso(db, 1_000_000), entradas: await borradoresMasAntiguos(db, 1_000_000) }));
    const orden = (filas: { id: string }[], ids: string[]) => filas.map((f) => f.id).filter((id) => ids.includes(id));
    expect(orden(salidas, Object.values(enCurso))).toEqual([enCurso.A1, enCurso.S, enCurso.A2]);
    expect(orden(entradas, Object.values(borradores))).toEqual([borradores["2000-01-01"], borradores["2000-01-02"], borradores["2000-01-03"]]);
  });

  it(`el gasto da como máximo ${FILAS} estaciones, de mayor a menor importe y por número al empatar; sin gasto no aparece`, async () => {
    const [E1, E2, E3, E4, E5, E6, E7, E8] = est;
    const orden = [E3, E1, E4, E5, E2, E8, E7];
    const t = await leer((db) => leerTablero(db, todo, HOY));
    expect(t.gasto!.estaciones.map((s) => s.id)).toEqual(orden.slice(0, FILAS));

    const todas = await leer((db) => estacionesDeMayorGasto(db, t.gasto!.filtros, 10));
    expect(todas.filas.map((s) => s.id)).toEqual(orden);
    expect(todas.filas.at(-1)).toMatchObject({ importe: null, articulosSinCosto: 1 });
    const enElReporte = await leer((db) => gastoPorEstacion(db, t.gasto!.filtros));
    expect(enElReporte.filas.find((s) => s.id === E6)).toMatchObject({ importe: "0.00", articulosSinCosto: 0 });
  });

  it("Superadmin, Compras y un Jefe con y sin puedeAutorizar ven lo mismo", async () => {
    const sujetos = [e.usuarios.SUPERADMIN, e.usuarios.COMPRAS, e.usuarios.JEFE, e.autorizadores.JEFE];
    expect(e.usuarios.JEFE.puedeAutorizar).toBe(false);
    const vistas = await leer(async (db) => {
      const v = [];
      for (const u of sujetos) v.push(await leerTablero(db, (permiso) => usuarioTienePermiso(u, permiso), HOY));
      return v;
    });
    for (const tarjeta of Object.values(vistas[0])) expect(tarjeta).not.toBeNull();
    for (const vista of vistas.slice(1)) expect(vista).toStrictEqual(vistas[0]);
  });

  it("una tarjeta sin su permiso de lectura no se consulta", async () => {
    const sin = (falta: Permiso) => leer((db) => leerTablero(db, (permiso) => permiso !== falta, HOY));
    expect(await sin("reportes:leer")).toMatchObject({ existencias: null, gasto: null, prestamos: expect.anything(), salidas: expect.anything(), entradas: expect.anything() });
    expect(await sin("devoluciones:leer")).toMatchObject({ prestamos: null, salidas: expect.anything() });
    expect(await sin("salidas:leer")).toMatchObject({ prestamos: null, salidas: null });
    expect(await sin("entradas:leer")).toMatchObject({ entradas: null });

    // Sin ningún permiso no toca la base
    const sinBase = new Proxy({}, { get: () => { throw new Error("consultó la base"); } }) as Prisma.TransactionClient;
    await expect(leerTablero(sinBase, () => false, HOY)).resolves.toStrictEqual({ existencias: null, prestamos: null, salidas: null, entradas: null, gasto: null });
  });
});
