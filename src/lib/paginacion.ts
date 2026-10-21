// Las listas muestran hasta 100 registros por página; el 101 abre la segunda.
// La página vive en la URL junto a los filtros: /entradas?q=…&pagina=2

export const POR_PAGINA = 100;
export const PARAMETRO_PAGINA = "pagina";

/** Ya acotada a las que hay: `actual` nunca pasa de `ultima`. */
export type Pagina = { actual: number; ultima: number; total: number };

/** Lo que llega en la URL: lo que no es un entero positivo es la primera. */
export function leerPagina(valor: unknown): number {
  return typeof valor === "string" && /^[1-9]\d{0,5}$/.test(valor) ? Number(valor) : 1;
}

/** Pasada la última, la última: un enlace viejo o un filtro más estrecho no deja la lista en blanco. */
export function acotarPagina(pedida: number, total: number): Pagina {
  const ultima = Math.max(1, Math.ceil(total / POR_PAGINA));
  return { actual: Math.min(Math.max(1, pedida), ultima), ultima, total };
}

/** Cuántos registros se saltan para llegar a la página. */
export const saltoDe = (p: Pagina) => (p.actual - 1) * POR_PAGINA;

/** La página de un arreglo que ya se leyó completo. */
export function paginar<T>(filas: readonly T[], pedida: number): { filas: T[]; pagina: Pagina } {
  const pagina = acotarPagina(pedida, filas.length);
  return { filas: filas.slice(saltoDe(pagina), saltoDe(pagina) + POR_PAGINA), pagina };
}

/** Del registro … al …, contando desde 1; en una lista vacía, 0 y 0. */
export function rangoDe(p: Pagina): { desde: number; hasta: number } {
  return p.total === 0 ? { desde: 0, hasta: 0 } : { desde: saltoDe(p) + 1, hasta: Math.min(p.actual * POR_PAGINA, p.total) };
}

/** La URL de la página `n` con los demás parámetros de la lista; la primera no lleva número. */
export function enlaceDePagina(ruta: string, parametros: URLSearchParams, n: number, parametro = PARAMETRO_PAGINA): string {
  const p = new URLSearchParams(parametros);
  if (n > 1) p.set(parametro, String(n));
  else p.delete(parametro);
  return p.size ? `${ruta}?${p}` : ruta;
}

/** Las páginas vigentes de las listas de una pantalla: cada enlace conserva las de las otras. */
export function parametrosDePaginas(paginas: Record<string, Pagina | null | undefined>): URLSearchParams {
  return new URLSearchParams(Object.entries(paginas).flatMap(([clave, p]) => (p && p.actual > 1 ? [[clave, String(p.actual)]] : [])));
}

/** La página de la fila `i` de una lista que se edita, contando desde 0. */
export const paginaDeFila = (i: number) => Math.floor(i / POR_PAGINA) + 1;

/** Las páginas con errores del servidor en sus partidas (`partidas.3.cantidadCapturada`). */
export const paginasConError = (errores: Record<string, string>) =>
  Object.keys(errores).flatMap((k) => {
    const m = /^partidas\.(\d+)\./.exec(k);
    return m ? [paginaDeFila(Number(m[1]))] : [];
  });
