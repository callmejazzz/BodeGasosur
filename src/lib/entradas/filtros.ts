import { hoyEnMexico, leerRangoDeFechas } from "@/lib/fechas";

// Los filtros de la lista de entradas viven en la URL:
// /entradas?q=…&estatus=…&ref=…&desde=…&hasta=…

export type FiltroEstatus = "todas" | "borradores" | "confirmadas" | "descartadas";
export type FiltroReferencia = "todas" | "con" | "sin";

export type FiltroEntradas = {
  estatus: FiltroEstatus;
  referencia: FiltroReferencia;
  /** Folio o clave de bodega (tolerante), referencia, proveedor o nombre de bodega. */
  busqueda: string;
  /** Fechas calendario ya validadas, o vacías. */
  desde: string;
  hasta: string;
};

export const ESTATUS: { valor: FiltroEstatus; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas" },
  { valor: "borradores", etiqueta: "Borradores" },
  { valor: "confirmadas", etiqueta: "Confirmadas" },
  { valor: "descartadas", etiqueta: "Descartadas" },
];

export const REFERENCIA: { valor: FiltroReferencia; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Con o sin referencia" },
  { valor: "con", etiqueta: "Con referencia" },
  { valor: "sin", etiqueta: "Sin referencia" },
];

export const PARAMETRO: Record<keyof FiltroEntradas, string> = {
  busqueda: "q",
  estatus: "estatus",
  referencia: "ref",
  desde: "desde",
  hasta: "hasta",
};

export const SIN_FILTROS: FiltroEntradas = { estatus: "todas", referencia: "todas", busqueda: "", desde: "", hasta: "" };

/**
 * Lo que llega en la URL, ya acotado: lo que no se reconoce cae al valor por
 * omisión. El rango se normaliza: fechas calendario dentro de lo operativo
 * (2000-01-01 … hoy en México) y, si vienen al revés, se intercambian.
 */
export function leerFiltros(params: Record<string, string | string[] | undefined>, hoy = hoyEnMexico()): FiltroEntradas {
  const texto = (clave: keyof FiltroEntradas) => {
    const v = params[PARAMETRO[clave]];
    return typeof v === "string" ? v.trim() : "";
  };
  return {
    estatus: ESTATUS.find((f) => f.valor === texto("estatus"))?.valor ?? "todas",
    referencia: REFERENCIA.find((f) => f.valor === texto("referencia"))?.valor ?? "todas",
    busqueda: texto("busqueda").slice(0, 80),
    ...leerRangoDeFechas(params[PARAMETRO.desde], params[PARAMETRO.hasta], hoy),
  };
}

export function hayFiltros(f: FiltroEntradas): boolean {
  return f.busqueda !== "" || f.estatus !== "todas" || f.referencia !== "todas" || f.desde !== "" || f.hasta !== "";
}

export function aParametros(f: FiltroEntradas): URLSearchParams {
  const p = new URLSearchParams();
  for (const clave of Object.keys(PARAMETRO) as (keyof FiltroEntradas)[]) {
    if (f[clave] && f[clave] !== "todas") p.set(PARAMETRO[clave], f[clave]);
  }
  return p;
}
