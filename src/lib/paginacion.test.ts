import { describe, expect, it } from "vitest";
import { acotarPagina, enlaceDePagina, leerPagina, paginaDeFila, paginar, paginasConError, parametrosDePaginas, rangoDe } from "./paginacion";

describe("paginación", () => {
  it("lee de la URL solo enteros positivos razonables", () => {
    expect(leerPagina("2")).toBe(2);
    expect(leerPagina("999999")).toBe(999999);
    for (const raro of [undefined, "", "0", "-1", "1.5", "02", "1e3", "1000000", " 2", ["2"], "abc"]) {
      expect(leerPagina(raro), String(raro)).toBe(1);
    }
  });

  it("100 por página: el registro 101 abre la segunda", () => {
    expect(acotarPagina(1, 100)).toEqual({ actual: 1, ultima: 1, total: 100 });
    expect(acotarPagina(2, 101)).toEqual({ actual: 2, ultima: 2, total: 101 });
    expect(rangoDe(acotarPagina(2, 101))).toEqual({ desde: 101, hasta: 101 });
    expect(rangoDe(acotarPagina(1, 250))).toEqual({ desde: 1, hasta: 100 });
    expect(rangoDe(acotarPagina(3, 250))).toEqual({ desde: 201, hasta: 250 });
  });

  it("pasada la última se queda en la última; sin registros, una página vacía", () => {
    expect(acotarPagina(9, 250)).toEqual({ actual: 3, ultima: 3, total: 250 });
    expect(acotarPagina(4, 0)).toEqual({ actual: 1, ultima: 1, total: 0 });
    expect(rangoDe(acotarPagina(1, 0))).toEqual({ desde: 0, hasta: 0 });
  });

  it("parte un arreglo ya leído", () => {
    const filas = Array.from({ length: 205 }, (_, i) => i + 1);
    expect(paginar(filas, 3)).toEqual({ filas: [201, 202, 203, 204, 205], pagina: { actual: 3, ultima: 3, total: 205 } });
    expect(paginar(filas, 2).filas).toHaveLength(100);
  });

  it("el enlace conserva los filtros y omite la primera página", () => {
    const filtros = new URLSearchParams({ q: "bodega norte", estatus: "confirmados", pagina: "5" });
    expect(enlaceDePagina("/traspasos", filtros, 2)).toBe("/traspasos?q=bodega+norte&estatus=confirmados&pagina=2");
    expect(enlaceDePagina("/traspasos", filtros, 1)).toBe("/traspasos?q=bodega+norte&estatus=confirmados");
    expect(enlaceDePagina("/conteos", new URLSearchParams(), 1)).toBe("/conteos");
    expect(enlaceDePagina("/salidas/pendientes", new URLSearchParams({ porRetirar: "2" }), 3, "porAutorizar")).toBe("/salidas/pendientes?porRetirar=2&porAutorizar=3");
    // Los parámetros originales no se tocan.
    expect(filtros.get("pagina")).toBe("5");
  });

  it("varias listas en una pantalla: cada enlace conserva la página de las otras", () => {
    const paginas = parametrosDePaginas({ partidas: acotarPagina(2, 150), saldo: acotarPagina(1, 150), devoluciones: null });
    expect(paginas.toString()).toBe("partidas=2");
    expect(enlaceDePagina("/salidas/x", paginas, 2, "saldo")).toBe("/salidas/x?partidas=2&saldo=2");
    expect(enlaceDePagina("/salidas/x", paginas, 1, "partidas")).toBe("/salidas/x");
  });

  it("en una lista que se edita, la fila 101 está en la segunda página, y ahí se señalan sus errores", () => {
    expect([0, 99, 100, 199, 200].map(paginaDeFila)).toEqual([1, 1, 2, 2, 3]);
    expect(paginasConError({ "partidas.3.articuloId": "x", "partidas.150.cantidadCapturada": "y", "encabezado.bodegaId": "z", partidas: "w" })).toEqual([1, 2]);
  });
});
