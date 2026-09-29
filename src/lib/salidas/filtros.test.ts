import { describe, expect, it } from "vitest";
import { aFiltroDeRepo, aParametros, enlaceDeTramo, hayFiltros, leerFiltros, listaDeEstatus, SIN_FILTROS } from "./filtros";

describe("filtros de la lista de salidas en la URL", () => {
  it("lee lo reconocido y descarta lo demás", () => {
    expect(leerFiltros({ q: "  s12 ", estatus: "retiradas" })).toEqual({ busqueda: "s12", estatus: "retiradas" });
    expect(leerFiltros({ estatus: "RETIRADA", q: ["s12"] })).toEqual(SIN_FILTROS);
    expect(leerFiltros({ q: "a".repeat(100) }).busqueda).toHaveLength(80);
  });

  it("solo escribe en la URL lo que se aparta del valor por omisión", () => {
    expect(aParametros(SIN_FILTROS).toString()).toBe("");
    expect(aParametros({ estatus: "canceladas", busqueda: "gerente" }).toString()).toBe("q=gerente&estatus=canceladas");
    expect(enlaceDeTramo(SIN_FILTROS)).toBe("/salidas");
    expect(enlaceDeTramo({ estatus: "autorizadas", busqueda: "caja" }, "c0556ba8-6b55-42a5-a89e-dedac3fb3298"))
      .toBe("/salidas?q=caja&estatus=autorizadas&cursor=c0556ba8-6b55-42a5-a89e-dedac3fb3298");
    expect(hayFiltros(SIN_FILTROS)).toBe(false);
    expect(hayFiltros({ ...SIN_FILTROS, estatus: "recibidas" })).toBe(true);
  });

  it("traduce al estatus de la base y de vuelta", () => {
    expect(aFiltroDeRepo({ estatus: "canceladas", busqueda: "x" })).toEqual({ estatus: "CANCELADO", busqueda: "x" });
    expect(aFiltroDeRepo(SIN_FILTROS)).toEqual({ estatus: "todas", busqueda: "" });
    expect(listaDeEstatus("AUTORIZADA")).toBe("/salidas?estatus=autorizadas");
    expect(leerFiltros(Object.fromEntries(new URL(listaDeEstatus("SOLICITADA"), "http://x").searchParams))).toMatchObject({ estatus: "solicitadas" });
  });
});
