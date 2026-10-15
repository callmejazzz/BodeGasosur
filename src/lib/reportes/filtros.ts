import { diaDeLaSemana, esFechaOperativa, hoyEnMexico, inicioDeAño, inicioDeMes, leerRangoDeFechas, sumarDias } from "@/lib/fechas";
import { uuid } from "@/lib/movimientos/formulario";

// Los filtros de los reportes viven en la URL, ya normalizados: lo que no se
// reconoce cae al valor por omisión. La descarga lee los mismos parámetros.

type Params = Record<string, string | string[] | undefined>;

const texto = (p: Params, clave: string) => (typeof p[clave] === "string" ? (p[clave] as string).trim() : "");
/** Un catálogo elegido; vacío es «todos». */
const id = (p: Params, clave: string) => {
  const r = uuid.safeParse(texto(p, clave));
  return r.success ? r.data : "";
};
const busqueda = (p: Params) => texto(p, "q").slice(0, 80);

function parametros(valores: Record<string, string | boolean>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [clave, valor] of Object.entries(valores)) {
    if (valor === true) p.set(clave, "1");
    else if (typeof valor === "string" && valor) p.set(clave, valor);
  }
  return p;
}

/** Rango inclusivo; lo que falte se completa: hasta hoy y desde el inicio que diga el reporte. */
function rango(p: Params, hoy: string, inicio: (hasta: string) => string) {
  const r = leerRangoDeFechas(p.desde, p.hasta, hoy);
  const hasta = r.hasta || hoy;
  const desde = r.desde || inicio(hasta);
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

// ───────────────────────────── Semanal (§3.1) ────────────────────────────────

/** El viernes de ese día o, si es otro día, el anterior: la semana va del sábado previo al viernes. */
export const viernesDeCorte = (dia: string) => sumarDias(dia, -((diaDeLaSemana(dia) + 2) % 7));

export type FiltrosSemanal = { viernes: string; bodegaId: string; busqueda: string };

export function leerFiltrosSemanal(p: Params, hoy = hoyEnMexico()): FiltrosSemanal {
  const pedido = texto(p, "viernes");
  return { viernes: viernesDeCorte(esFechaOperativa(pedido, hoy) ? pedido : hoy), bodegaId: id(p, "bodega"), busqueda: busqueda(p) };
}

export const semanaDe = (viernes: string) => ({ inicio: sumarDias(viernes, -6), corte: viernes });

export const aParametrosSemanal = (f: FiltrosSemanal) => parametros({ viernes: f.viernes, bodega: f.bodegaId, q: f.busqueda });

// ─────────────────────────── Existencias (§3.2) ──────────────────────────────

export type FiltrosExistencias = { bodegaId: string; busqueda: string; bajoMinimo: boolean };

export function leerFiltrosExistencias(p: Params): FiltrosExistencias {
  return { bodegaId: id(p, "bodega"), busqueda: busqueda(p), bajoMinimo: texto(p, "bajo") === "1" };
}

export const aParametrosExistencias = (f: FiltrosExistencias) => parametros({ bodega: f.bodegaId, q: f.busqueda, bajo: f.bajoMinimo });

// ───────────────────────────── Kardex (§3.3) ─────────────────────────────────

export type FiltrosKardex = { articuloId: string; bodegaId: string; desde: string; hasta: string };

/** Por omisión, el mes en curso hasta hoy. */
export function leerFiltrosKardex(p: Params, hoy = hoyEnMexico()): FiltrosKardex {
  return { articuloId: id(p, "articulo"), bodegaId: id(p, "bodega"), ...rango(p, hoy, inicioDeMes) };
}

export const aParametrosKardex = (f: FiltrosKardex) => parametros({ articulo: f.articuloId, bodega: f.bodegaId, desde: f.desde, hasta: f.hasta });

// ──────────────────────── Gasto por estación (§3.4) ──────────────────────────

export type FiltrosGasto = { desde: string; hasta: string; estacionId: string; articuloId: string; detalle: boolean };

/** Por omisión, del 1 de enero hasta hoy. */
export function leerFiltrosGasto(p: Params, hoy = hoyEnMexico()): FiltrosGasto {
  return { ...rango(p, hoy, inicioDeAño), estacionId: id(p, "estacion"), articuloId: id(p, "articulo"), detalle: texto(p, "detalle") === "1" };
}

export const aParametrosGasto = (f: FiltrosGasto) =>
  parametros({ desde: f.desde, hasta: f.hasta, estacion: f.estacionId, articulo: f.articuloId, detalle: f.detalle });

// ─────────────────────── Frecuencia de consumo (§3.5) ────────────────────────

export type FiltrosFrecuencia = { desde: string; hasta: string; estacionId: string; bodegaId: string; busqueda: string };

export function leerFiltrosFrecuencia(p: Params, hoy = hoyEnMexico()): FiltrosFrecuencia {
  return { ...rango(p, hoy, inicioDeAño), estacionId: id(p, "estacion"), bodegaId: id(p, "bodega"), busqueda: busqueda(p) };
}

export const aParametrosFrecuencia = (f: FiltrosFrecuencia) =>
  parametros({ desde: f.desde, hasta: f.hasta, estacion: f.estacionId, bodega: f.bodegaId, q: f.busqueda });
