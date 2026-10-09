import { describe, expect, it } from "vitest";
import { aFiltroDeRepo, aParametros, hayFiltros, leerFiltros, SIN_FILTROS } from "./filtros";

describe("filtros de la lista de salidas en la URL", () => {
  it("lee lo reconocido y descarta lo demás", () => {
    expect(leerFiltros({ q: "  s12 ", estatus: "retiradas" })).toEqual({ busqueda: "s12", estatus: "retiradas", prestamo: false });
    expect(leerFiltros({ estatus: "RETIRADA", q: ["s12"], prestamo: "si" })).toEqual(SIN_FILTROS);
    expect(leerFiltros({ prestamo: "1" })).toEqual({ ...SIN_FILTROS, prestamo: true });
    expect(leerFiltros({ q: "a".repeat(100) }).busqueda).toHaveLength(80);
  });

  it("solo escribe en la URL lo que se aparta del valor por omisión", () => {
    expect(aParametros(SIN_FILTROS).toString()).toBe("");
    expect(aParametros({ estatus: "canceladas", busqueda: "gerente", prestamo: false }).toString()).toBe("q=gerente&estatus=canceladas");
    expect(aParametros({ estatus: "autorizadas", busqueda: "caja", prestamo: true }).toString()).toBe("q=caja&estatus=autorizadas&prestamo=1");
    expect(hayFiltros(SIN_FILTROS)).toBe(false);
    expect(hayFiltros({ ...SIN_FILTROS, estatus: "recibidas" })).toBe(true);
    expect(hayFiltros({ ...SIN_FILTROS, prestamo: true })).toBe(true);
  });

  it("traduce al estatus de la base y de vuelta", () => {
    expect(aFiltroDeRepo({ estatus: "canceladas", busqueda: "x", prestamo: true })).toEqual({ estatus: "CANCELADO", busqueda: "x", soloPrestamos: true });
    expect(aFiltroDeRepo(SIN_FILTROS)).toEqual({ estatus: "todas", busqueda: "", soloPrestamos: false });
  });
});
