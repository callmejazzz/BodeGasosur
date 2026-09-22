import { describe, expect, it } from "vitest";
import { aParametros, hayFiltros, leerFiltros, SIN_FILTROS } from "./filtros";

describe("filtros de la lista en la URL", () => {
  it("lee lo reconocido y descarta lo demás", () => {
    expect(leerFiltros({ q: "  e1 ", estatus: "borradores", ref: "sin", desde: "2026-09-01", hasta: "2026-09-30" }, "2026-09-30")).toEqual({
      busqueda: "e1",
      estatus: "borradores",
      referencia: "sin",
      desde: "2026-09-01",
      hasta: "2026-09-30",
    });
    expect(leerFiltros({ estatus: "x", ref: ["con"], desde: "2026-02-30", hasta: "ayer" })).toEqual(SIN_FILTROS);
    // Fuera de lo operativo se descarta; al revés se intercambia.
    expect(leerFiltros({ desde: "1999-12-31", hasta: "2026-09-22" }, "2026-09-21")).toMatchObject({ desde: "", hasta: "" });
    expect(leerFiltros({ desde: "2026-09-20", hasta: "2026-09-01" }, "2026-09-21")).toMatchObject({ desde: "2026-09-01", hasta: "2026-09-20" });
    expect(leerFiltros({ q: "a".repeat(100) }).busqueda).toHaveLength(80);
  });

  it("solo escribe en la URL lo que se aparta del valor por omisión", () => {
    expect(aParametros(SIN_FILTROS).toString()).toBe("");
    expect(aParametros({ ...SIN_FILTROS, referencia: "con", desde: "2026-09-01" }).toString()).toBe("ref=con&desde=2026-09-01");
    expect(hayFiltros(SIN_FILTROS)).toBe(false);
    expect(hayFiltros({ ...SIN_FILTROS, hasta: "2026-09-30" })).toBe(true);
  });
});
