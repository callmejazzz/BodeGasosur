import type { EstatusMovimiento } from "@prisma/client";
import { hoyEnMexico, leerRangoDeFechas } from "@/lib/fechas";

// Los filtros de las listas de traspasos, devoluciones, ajustes y conteos
// viven en la URL: /traspasos?q=…&estatus=…; las hojas de conteo además
// filtran por el día en que se abrieron: /conteos?desde=…&hasta=…

export type FiltroEstatus = "todos" | "borradores" | "confirmados" | "descartados";

export const ESTATUS: { valor: FiltroEstatus; etiqueta: string; estatus?: Extract<EstatusMovimiento, "BORRADOR" | "CONFIRMADO" | "CANCELADO"> }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "borradores", etiqueta: "Borradores", estatus: "BORRADOR" },
  { valor: "confirmados", etiqueta: "Confirmados", estatus: "CONFIRMADO" },
  { valor: "descartados", etiqueta: "Descartados", estatus: "CANCELADO" },
];

export type FiltrosDeLista = { estatus: FiltroEstatus; busqueda: string; desde?: string; hasta?: string };
export type FiltrosDeHojas = FiltrosDeLista & { desde: string; hasta: string };

export const SIN_FILTROS: FiltrosDeLista = { estatus: "todos", busqueda: "" };
export const SIN_FILTROS_DE_HOJAS: FiltrosDeHojas = { ...SIN_FILTROS, desde: "", hasta: "" };

/** Lo que llega en la URL, ya acotado: lo que no se reconoce cae al valor por omisión. */
export function leerFiltros(params: Record<string, string | string[] | undefined>): FiltrosDeLista {
  const texto = (clave: string) => (typeof params[clave] === "string" ? (params[clave] as string).trim() : "");
  return {
    estatus: ESTATUS.find((f) => f.valor === texto("estatus"))?.valor ?? "todos",
    busqueda: texto("q").slice(0, 80),
  };
}

export function leerFiltrosDeHojas(params: Record<string, string | string[] | undefined>, hoy = hoyEnMexico()): FiltrosDeHojas {
  return { ...leerFiltros(params), busqueda: "", ...leerRangoDeFechas(params.desde, params.hasta, hoy) };
}

export function hayFiltros(f: FiltrosDeLista): boolean {
  return f.busqueda !== "" || f.estatus !== "todos" || !!f.desde || !!f.hasta;
}

export function aParametros(f: FiltrosDeLista): URLSearchParams {
  const p = new URLSearchParams();
  if (f.busqueda) p.set("q", f.busqueda);
  if (f.estatus !== "todos") p.set("estatus", f.estatus);
  if (f.desde) p.set("desde", f.desde);
  if (f.hasta) p.set("hasta", f.hasta);
  return p;
}

export const estatusDeFiltro = (f: FiltrosDeLista) => ESTATUS.find((e) => e.valor === f.estatus)?.estatus ?? "todos";
