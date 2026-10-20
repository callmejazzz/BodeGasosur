import type { Pagina } from "@/lib/paginacion";

// Una descarga lee la tabla entera por lotes, con la misma consulta y el mismo
// orden que la pantalla. Lo que no cabe se rechaza completo: nunca se entrega
// un archivo truncado.

export const MAXIMO_DE_FILAS = 20_000;
export const LOTE = 1_000;

export class DemasiadasFilas extends Error {
  constructor(readonly filas: number) {
    super(`La tabla tiene ${filas.toLocaleString("es-MX")} filas; se descargan hasta ${MAXIMO_DE_FILAS.toLocaleString("es-MX")}. Acota los filtros y vuelve a intentarlo.`);
    this.name = "DemasiadasFilas";
  }
}

/** Todas las páginas de una lista, leídas dentro de la misma instantánea. */
export async function todasLasPaginas<T>(leer: (pagina: number, tamano: number) => Promise<{ filas: T[]; pagina: Pagina }>): Promise<T[]> {
  const primera = await leer(1, LOTE);
  const { total, ultima } = primera.pagina;
  if (total > MAXIMO_DE_FILAS) throw new DemasiadasFilas(total);
  const filas = [...primera.filas];
  for (let n = 2; n <= ultima; n++) filas.push(...(await leer(n, LOTE)).filas);
  if (filas.length !== total) throw new Error(`Se leyeron ${filas.length} de ${total} filas: la descarga se cancela.`);
  return filas;
}

/** Una lista que ya se leyó completa, con el mismo tope. */
export function completa<T>(filas: T[]): T[] {
  if (filas.length > MAXIMO_DE_FILAS) throw new DemasiadasFilas(filas.length);
  return filas;
}
