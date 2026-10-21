import { describe, expect, it } from "vitest";
import { acotarPagina } from "../paginacion";
import { completa, DemasiadasFilas, LOTE, MAXIMO_DE_FILAS, todasLasPaginas } from "./lotes";

/** Una lista de `total` números servida por páginas, como paginaDe(). */
const lista = (total: number, pierde = 0) => async (pedida: number, tamano: number) => {
  const pagina = acotarPagina(pedida, total, tamano);
  const desde = (pagina.actual - 1) * tamano;
  const filas = Array.from({ length: Math.max(0, Math.min(tamano, total - desde) - (pagina.actual === pagina.ultima ? pierde : 0)) }, (_, i) => desde + i);
  return { filas, pagina };
};

describe("lectura por lotes", () => {
  it("junta todas las páginas en orden", async () => {
    const filas = await todasLasPaginas(lista(LOTE * 2 + 7));
    expect(filas).toHaveLength(LOTE * 2 + 7);
    expect(filas.every((n, i) => n === i)).toBe(true);
    await expect(todasLasPaginas(lista(0))).resolves.toEqual([]);
  });

  it("lo que no cabe se rechaza antes de leerlo, con un mensaje para acotar filtros", async () => {
    await expect(todasLasPaginas(lista(MAXIMO_DE_FILAS + 1))).rejects.toThrow(DemasiadasFilas);
    await expect(todasLasPaginas(lista(MAXIMO_DE_FILAS))).resolves.toHaveLength(MAXIMO_DE_FILAS);
    expect(() => completa(Array.from({ length: MAXIMO_DE_FILAS + 1 }))).toThrow(/Acota los filtros/);
  });

  it("si faltan filas no entrega un archivo truncado", async () => {
    await expect(todasLasPaginas(lista(LOTE + 5, 2))).rejects.toThrow(/la descarga se cancela/);
  });
});
