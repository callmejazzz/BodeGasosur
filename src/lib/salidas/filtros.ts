import type { FiltroSalidas } from "./repo";
import type { EstatusSalida } from "./servicio";

// Los filtros de la lista de salidas viven en la URL: /salidas?q=…&estatus=…

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
  /** Folio, clave de bodega o número de estación (tolerante), alias, solicitante o quién retiró. */
  busqueda: string;
};

export const PARAMETRO: Record<keyof FiltrosDeLista, string> = { busqueda: "q", estatus: "estatus" };

export const SIN_FILTROS: FiltrosDeLista = { estatus: "todas", busqueda: "" };

/** Lo que llega en la URL, ya acotado: lo que no se reconoce cae al valor por omisión. */
export function leerFiltros(params: Record<string, string | string[] | undefined>): FiltrosDeLista {
  const texto = (clave: keyof FiltrosDeLista) => {
    const v = params[PARAMETRO[clave]];
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    estatus: ESTATUS.find((f) => f.valor === texto("estatus"))?.valor ?? "todas",
    busqueda: texto("busqueda").slice(0, 80),
  };
}

export function hayFiltros(f: FiltrosDeLista): boolean {
  return f.busqueda !== "" || f.estatus !== "todas";
}

export function aParametros(f: FiltrosDeLista): URLSearchParams {
  const p = new URLSearchParams();
  for (const clave of Object.keys(PARAMETRO) as (keyof FiltrosDeLista)[]) {
    if (f[clave] && f[clave] !== "todas") p.set(PARAMETRO[clave], f[clave]);
  }
  return p;
}

export function enlaceDeTramo(f: FiltrosDeLista, cursor?: string): string {
  const p = aParametros(f);
  if (cursor) p.set("cursor", cursor);
  return p.size ? `/salidas?${p}` : "/salidas";
}

/** La lista filtrada por un estatus: el enlace de la bandeja cuando no cabe todo. */
export function listaDeEstatus(estatus: EstatusSalida): string {
  const valor = ESTATUS.find((f) => f.estatus === estatus)?.valor ?? "todas";
  return `/salidas?${aParametros({ ...SIN_FILTROS, estatus: valor })}`;
}

export function aFiltroDeRepo(f: FiltrosDeLista): FiltroSalidas {
  return { estatus: ESTATUS.find((e) => e.valor === f.estatus)?.estatus ?? "todas", busqueda: f.busqueda };
}
