import { describe, expect, it } from "vitest";
import { PERMISOS, rolTienePermiso } from "./permisos";

describe("permisos de entradas", () => {
  it("Superadmin y Compras leen, capturan y confirman", () => {
    for (const rol of ["SUPERADMIN", "COMPRAS"] as const) {
      expect(rolTienePermiso(rol, "entradas:leer"), rol).toBe(true);
      expect(rolTienePermiso(rol, "entradas:capturar"), rol).toBe(true);
      expect(rolTienePermiso(rol, "entradas:confirmar"), rol).toBe(true);
    }
  });

  it("Jefe solo consulta", () => {
    expect(rolTienePermiso("JEFE", "entradas:leer")).toBe(true);
    expect(rolTienePermiso("JEFE", "entradas:capturar")).toBe(false);
    expect(rolTienePermiso("JEFE", "entradas:confirmar")).toBe(false);
  });

  it("ningún rol tiene permisos repetidos", () => {
    for (const [rol, permisos] of Object.entries(PERMISOS)) {
      expect(new Set(permisos).size, rol).toBe(permisos.length);
    }
  });
});
