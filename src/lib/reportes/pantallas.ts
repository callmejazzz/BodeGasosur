import "server-only";
import { Prisma } from "@prisma/client";
import { hoja, type Hoja } from "@/lib/exportar/hoja";
import { todasLasPaginas } from "@/lib/exportar/lotes";
import { formatearFecha, hoyEnMexico } from "@/lib/fechas";
import { paginaDe } from "@/lib/movimientos/lista";
import { leerPagina } from "@/lib/paginacion";
import { columnasExistencias, columnasFrecuencia, columnasGastoDetalle, columnasGastoEstacion, columnasKardex, columnasResumenKardex, columnasSemanal, columnasTotalesSemanal } from "./columnas";
import { filasExistencias, totalExistencias } from "./existencias";
import {
  leerFiltrosExistencias,
  leerFiltrosFrecuencia,
  leerFiltrosGasto,
  leerFiltrosKardex,
  leerFiltrosSemanal,
  semanaDe,
  type FiltrosFrecuencia,
  type FiltrosGasto,
  type FiltrosKardex,
} from "./filtros";
import { filasFrecuencia } from "./frecuencia";
import { gastoPorArticulo, gastoPorEstacion, totalGasto } from "./gasto";
import { coincideArticulo } from "./hechos";
import { articuloDeKardex, filasKardex, resumenKardex, type ArticuloDeKardex } from "./kardex";
import { filasSemanal, totalesPorArticulo, totalSemanal } from "./semanal";

// Lo que lee cada reporte para su pantalla y para su descarga. Corre dentro de
// consultar(), que ya comprobó sesión y permiso; la descarga usa los mismos
// filtros, consultas y columnas, sin limitarse a la página que se ve.

type Db = Prisma.TransactionClient;
const sql = Prisma.sql;
type Params = Record<string, string | string[] | undefined>;

export type Opcion = { id: string; nombre: string };

/** Todas, también las dadas de baja: la historia no se oculta. */
async function bodegas(db: Db): Promise<Opcion[]> {
  const filas = await db.bodega.findMany({ select: { id: true, clave: true, nombre: true, activa: true }, orderBy: { clave: "asc" } });
  return filas.map((b) => ({ id: b.id, nombre: `${b.clave} · ${b.nombre}${b.activa ? "" : " (dada de baja)"}` }));
}

async function estaciones(db: Db): Promise<Opcion[]> {
  const filas = await db.estacion.findMany({ select: { id: true, numero: true, alias: true, activa: true }, orderBy: { numero: "asc" } });
  return filas.map((s) => ({ id: s.id, nombre: `${s.numero} · ${s.alias}${s.activa ? "" : " (dada de baja)"}` }));
}

const nombreDe = (opciones: Opcion[], id: string, todas: string) => (id ? (opciones.find((o) => o.id === id)?.nombre ?? id) : todas);
const periodo = (desde: string, hasta: string) => `${formatearFecha(desde)} al ${formatearFecha(hasta)}`;
const etiquetaArticulo = (a: ArticuloDeKardex | null) => (a ? `${a.clave} · ${a.descripcion} (${a.unidad})` : "Todos");

async function articuloElegido(db: Db, id: string) {
  return id ? articuloDeKardex(db, id) : null;
}

// ───────────────────────────── Semanal (§3.1) ────────────────────────────────

async function contextoSemanal(db: Db, params: Params) {
  const hoy = hoyEnMexico();
  const filtros = leerFiltrosSemanal(params, hoy);
  const semana = semanaDe(filtros.viernes);
  const consulta = { ...semana, bodegaId: filtros.bodegaId, busqueda: filtros.busqueda };
  const opciones = await bodegas(db);
  const descripcion: [string, string][] = [
    ["Semana", `Sábado ${formatearFecha(semana.inicio)} al viernes ${formatearFecha(semana.corte)}`],
    ["Corte", filtros.viernes === hoy ? `${formatearFecha(semana.corte)}, provisional hasta que termine el día` : formatearFecha(semana.corte)],
    ["Bodega", nombreDe(opciones, filtros.bodegaId, "Todas")],
    ["Artículo", filtros.busqueda || "Todos"],
  ];
  return { filtros, semana, consulta, opciones, descripcion, provisional: filtros.viernes === hoy, hoy };
}

export async function datosSemanal(db: Db, params: Params) {
  const c = await contextoSemanal(db, params);
  return {
    ...c,
    lista: await filasSemanal(db, c.consulta, leerPagina(params.pagina)),
    // Con una sola bodega, cada fila ya es el total de su artículo.
    porArticulo: c.filtros.bodegaId ? null : await totalesPorArticulo(db, c.consulta, leerPagina(params.articulos)),
    total: await totalSemanal(db, c.consulta),
  };
}

export async function hojasSemanal(db: Db, params: Params): Promise<Hoja<unknown>[]> {
  const c = await contextoSemanal(db, params);
  const hojas = [
    hoja({ nombre: "Semanal", titulo: "Reporte semanal por artículo y bodega", filtros: c.descripcion, columnas: columnasSemanal(c.semana), filas: await todasLasPaginas((n, t) => filasSemanal(db, c.consulta, n, t)) }),
  ];
  if (!c.filtros.bodegaId) {
    hojas.push(hoja({ nombre: "Por artículo", titulo: "Totales por artículo, todas las bodegas", filtros: c.descripcion, columnas: columnasTotalesSemanal(c.semana), filas: await todasLasPaginas((n, t) => totalesPorArticulo(db, c.consulta, n, t)) }));
  }
  return hojas;
}

// ─────────────────────────── Existencias (§3.2) ──────────────────────────────

async function contextoExistencias(db: Db, params: Params) {
  const filtros = leerFiltrosExistencias(params);
  const opciones = await bodegas(db);
  const descripcion: [string, string][] = [
    ["Corte", "Existencia actual"],
    ["Bodega", nombreDe(opciones, filtros.bodegaId, "Todas")],
    ["Artículo", filtros.busqueda || "Todos"],
    ["Solo bajo mínimo", filtros.bajoMinimo ? "Sí" : "No"],
  ];
  return { filtros, opciones, descripcion, hoy: hoyEnMexico() };
}

export async function datosExistencias(db: Db, params: Params) {
  const c = await contextoExistencias(db, params);
  return { ...c, lista: await filasExistencias(db, c.filtros, leerPagina(params.pagina)), total: await totalExistencias(db, c.filtros) };
}

export async function hojasExistencias(db: Db, params: Params): Promise<Hoja<unknown>[]> {
  const c = await contextoExistencias(db, params);
  const filas = await todasLasPaginas((n, t) => filasExistencias(db, c.filtros, n, t));
  return [hoja({ nombre: "Existencias", titulo: "Existencias por bodega y mínimo", filtros: c.descripcion, columnas: columnasExistencias(c.hoy), filas })];
}

// ───────────────────────────── Kardex (§3.3) ─────────────────────────────────

async function contextoKardex(db: Db, params: Params) {
  const filtros: FiltrosKardex = leerFiltrosKardex(params);
  const articulo = await articuloElegido(db, filtros.articuloId);
  const opciones = await bodegas(db);
  const descripcion: [string, string][] = [
    ["Artículo", etiquetaArticulo(articulo)],
    ["Bodega", nombreDe(opciones, filtros.bodegaId, "Todas, cada una con su saldo")],
    ["Periodo", periodo(filtros.desde, filtros.hasta)],
  ];
  // Sin un artículo que exista no hay kardex: el filtro se ignora.
  return { filtros: articulo ? filtros : { ...filtros, articuloId: "" }, articulo, opciones, descripcion };
}

export async function datosKardex(db: Db, params: Params) {
  const c = await contextoKardex(db, params);
  if (!c.articulo) return { ...c, lista: null, resumen: null };
  return { ...c, lista: await filasKardex(db, c.filtros, leerPagina(params.pagina)), resumen: await resumenKardex(db, c.filtros, leerPagina(params.bodegas)) };
}

export async function hojasKardex(db: Db, params: Params): Promise<Hoja<unknown>[] | null> {
  const c = await contextoKardex(db, params);
  if (!c.articulo) return null;
  return [
    hoja({ nombre: "Kardex", titulo: `Kardex de ${c.articulo.clave}`, filtros: c.descripcion, columnas: columnasKardex, filas: await todasLasPaginas((n, t) => filasKardex(db, c.filtros, n, t)) }),
    hoja({ nombre: "Por bodega", titulo: `Saldos de ${c.articulo.clave} por bodega`, filtros: c.descripcion, columnas: columnasResumenKardex, filas: await todasLasPaginas((n, t) => resumenKardex(db, c.filtros, n, t)) }),
  ];
}

// ──────────────────────── Gasto por estación (§3.4) ──────────────────────────

async function contextoGasto(db: Db, params: Params) {
  const filtros: FiltrosGasto = leerFiltrosGasto(params);
  const articulo = await articuloElegido(db, filtros.articuloId);
  const opciones = await estaciones(db);
  const descripcion: [string, string][] = [
    ["Periodo", periodo(filtros.desde, filtros.hasta)],
    ["Estación", nombreDe(opciones, filtros.estacionId, "Todas")],
    ["Artículo", etiquetaArticulo(articulo)],
    ["Vista", filtros.detalle ? "Por estación y artículo" : "Por estación"],
  ];
  return { filtros: articulo ? filtros : { ...filtros, articuloId: "" }, articulo, opciones, descripcion };
}

export async function datosGasto(db: Db, params: Params) {
  const c = await contextoGasto(db, params);
  const pagina = leerPagina(params.pagina);
  return {
    ...c,
    detalle: c.filtros.detalle ? await gastoPorArticulo(db, c.filtros, pagina) : null,
    estaciones: c.filtros.detalle ? null : await gastoPorEstacion(db, c.filtros, pagina),
    total: await totalGasto(db, c.filtros),
  };
}

export async function hojasGasto(db: Db, params: Params): Promise<Hoja<unknown>[]> {
  const c = await contextoGasto(db, params);
  const titulo = "Gasto acumulado por estación";
  if (c.filtros.detalle) {
    return [hoja({ nombre: "Gasto por artículo", titulo, filtros: c.descripcion, columnas: columnasGastoDetalle, filas: await todasLasPaginas((n, t) => gastoPorArticulo(db, c.filtros, n, t)) })];
  }
  return [hoja({ nombre: "Gasto por estación", titulo, filtros: c.descripcion, columnas: columnasGastoEstacion, filas: await todasLasPaginas((n, t) => gastoPorEstacion(db, c.filtros, n, t)) })];
}

// ─────────────────────── Frecuencia de consumo (§3.5) ────────────────────────

async function contextoFrecuencia(db: Db, params: Params) {
  const filtros: FiltrosFrecuencia = leerFiltrosFrecuencia(params);
  const [opcionesEstaciones, opcionesBodegas] = [await estaciones(db), await bodegas(db)];
  const descripcion: [string, string][] = [
    ["Periodo", periodo(filtros.desde, filtros.hasta)],
    ["Estación", nombreDe(opcionesEstaciones, filtros.estacionId, "Todas")],
    ["Bodega de salida", nombreDe(opcionesBodegas, filtros.bodegaId, "Todas")],
    ["Artículo", filtros.busqueda || "Todos"],
  ];
  return { filtros, estaciones: opcionesEstaciones, bodegas: opcionesBodegas, descripcion };
}

export async function datosFrecuencia(db: Db, params: Params) {
  const c = await contextoFrecuencia(db, params);
  return { ...c, lista: await filasFrecuencia(db, c.filtros, leerPagina(params.pagina)) };
}

export async function hojasFrecuencia(db: Db, params: Params): Promise<Hoja<unknown>[]> {
  const c = await contextoFrecuencia(db, params);
  const filas = await todasLasPaginas((n, t) => filasFrecuencia(db, c.filtros, n, t));
  return [hoja({ nombre: "Frecuencia", titulo: "Frecuencia de consumo", filtros: c.descripcion, columnas: columnasFrecuencia(c.filtros), filas })];
}

// ─────────────────────────── Selector de artículos ───────────────────────────

export type OpcionArticulo = { id: string; clave: string; descripcion: string; unidad: string; activo: boolean };

/** Una página de artículos para el selector del kardex y del gasto: también los dados de baja, que tienen historia. */
export function articulosDelSelector(db: Db, texto: string, pagina: number) {
  return paginaDe<OpcionArticulo>(
    db,
    sql`SELECT a.id::text AS id, a.clave, a.descripcion, u.clave AS unidad, a.activo
        FROM "Articulo" a JOIN "UnidadMedida" u ON u.id = a."unidadId" WHERE ${coincideArticulo(texto.slice(0, 40))}`,
    sql`clave, id`,
    pagina,
  );
}
