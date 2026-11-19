import "server-only";
import type { Prisma } from "@prisma/client";
import { aParametros as aParametrosEntradas, SIN_FILTROS as SIN_FILTROS_ENTRADAS, type FiltroEntradas } from "@/lib/entradas/filtros";
import { borradoresMasAntiguos, type EntradaResumen } from "@/lib/entradas/repo";
import { hoyEnMexico, inicioDeMes } from "@/lib/fechas";
import { listarPrestamos, type Prestamo } from "@/lib/inventario/repo";
import type { Permiso } from "@/lib/permisos";
import { filasExistencias, type FilaExistencia } from "@/lib/reportes/existencias";
import { aParametrosExistencias, aParametrosGasto, type FiltrosExistencias, type FiltrosGasto } from "@/lib/reportes/filtros";
import { estacionesDeMayorGasto, type FilaGastoEstacion } from "@/lib/reportes/gasto";
import { salidasEnCurso, type SalidaResumen } from "@/lib/salidas/repo";

type Db = Prisma.TransactionClient;

export type Tablero = {
  existencias: FilaExistencia[] | null;
  salidas: SalidaResumen[] | null;
  prestamos: Prestamo[] | null;
  entradas: EntradaResumen[] | null;
  gasto: { filtros: FiltrosGasto; estaciones: FilaGastoEstacion[] } | null;
};

export const FILAS = 5;

export const BAJO_MINIMO: FiltrosExistencias = { bodegaId: "", busqueda: "", bajoMinimo: true };
export const BORRADORES: FiltroEntradas = { ...SIN_FILTROS_ENTRADAS, estatus: "borradores" };
export const gastoDelMes = (hoy: string): FiltrosGasto => ({ desde: inicioDeMes(hoy), hasta: hoy, estacionId: "", articuloId: "", detalle: false });

export const ENLACES = {
  existencias: `/reportes/existencias?${aParametrosExistencias(BAJO_MINIMO)}`,
  salidas: "/salidas",
  prestamos: "/prestamos?estado=abiertos",
  entradas: `/entradas?${aParametrosEntradas(BORRADORES)}`,
  gasto: (f: FiltrosGasto) => `/reportes/gasto?${aParametrosGasto(f)}`,
};

export async function leerTablero(db: Db, puede: (permiso: Permiso) => boolean, hoy = hoyEnMexico()): Promise<Tablero> {
  // Secuencial: dentro de una transacción hay una sola conexión
  const existencias = puede("reportes:leer") ? (await filasExistencias(db, BAJO_MINIMO, 1, FILAS)).filas : null;

  // Sin filtrar por usuario, a diferencia de bandejaDeSalidas: todos ven lo mismo
  const salidas = puede("salidas:leer") ? await salidasEnCurso(db, FILAS) : null;

  // Igual que el listado de préstamos, que pide los dos permisos
  const prestamos = puede("devoluciones:leer") && puede("salidas:leer") ? (await listarPrestamos(db, "abiertos", 1, FILAS)).filas : null;

  const entradas = puede("entradas:leer") ? await borradoresMasAntiguos(db, FILAS) : null;

  let gasto: Tablero["gasto"] = null;
  if (puede("reportes:leer")) {
    const filtros = gastoDelMes(hoy);
    gasto = { filtros, estaciones: (await estacionesDeMayorGasto(db, filtros, FILAS)).filas };
  }

  return { existencias, salidas, prestamos, entradas, gasto };
}
