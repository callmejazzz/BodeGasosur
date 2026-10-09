import type { FiltroSalidas } from "./repo";
import type { EstatusSalida } from "./servicio";

// Los filtros de la lista de salidas viven en la URL: /salidas?q=…&estatus=…&prestamo=1

export type FiltroEstatus = "todas" | "solicitadas" | "autorizadas" | "rechazadas" | "retiradas" | "recibidas" | "canceladas";

export const ESTATUS: { valor: FiltroEstatus; etiqueta: string; estatus?: EstatusSalida }[] = [
  { valor: "todas", etiqueta: "Todas" },
  { valor: "solicitadas", etiqueta: "Solicitadas", estatus: "SOLICITADA" },
  { valor: "autorizadas", etiqueta: "Autorizadas", estatus: "AUTORIZADA" },
  { valor: "rechazadas", etiqueta: "Rechazadas", estatus: "RECHAZADA" },
  { valor: "retiradas", etiqueta: "Retiradas", estatus: "RETIRADA" },
  { valor: "recibidas", etiqueta: "Recibidas", estatus: "RECIBIDA" },
  { valor: "canceladas", etiqueta: "Canceladas", estatus: "CANCELADO" },
];

export type FiltrosDeLista = {
  estatus: FiltroEstatus;
  /** Folio, clave de bodega o número de estación (tolerante); bodega, alias, solicitante o quién retiró. */
  busqueda: string;
  /** Solo las marcadas como préstamo. */
  prestamo: boolean;
};

export const PARAMETRO: Record<keyof FiltrosDeLista, string> = { busqueda: "q", estatus: "estatus", prestamo: "prestamo" };

export const SIN_FILTROS: FiltrosDeLista = { estatus: "todas", busqueda: "", prestamo: false };

/** Lo que llega en la URL, ya acotado: lo que no se reconoce cae al valor por omisión. */
export function leerFiltros(params: Record<string, string | string[] | undefined>): FiltrosDeLista {
  const texto = (clave: keyof FiltrosDeLista) => {
    const v = params[PARAMETRO[clave]];
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    estatus: ESTATUS.find((f) => f.valor === texto("estatus"))?.valor ?? "todas",
    busqueda: texto("busqueda").slice(0, 80),
    prestamo: texto("prestamo") === "1",
  };
}

export function hayFiltros(f: FiltrosDeLista): boolean {
  return f.busqueda !== "" || f.estatus !== "todas" || f.prestamo;
}

export function aParametros(f: FiltrosDeLista): URLSearchParams {
  const p = new URLSearchParams();
  if (f.busqueda) p.set(PARAMETRO.busqueda, f.busqueda);
  if (f.estatus !== "todas") p.set(PARAMETRO.estatus, f.estatus);
  if (f.prestamo) p.set(PARAMETRO.prestamo, "1");
  return p;
}

export function aFiltroDeRepo(f: FiltrosDeLista): FiltroSalidas {
  return { estatus: ESTATUS.find((e) => e.valor === f.estatus)?.estatus ?? "todas", busqueda: f.busqueda, soloPrestamos: f.prestamo };
}
