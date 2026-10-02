import { describe, expect, it } from "vitest";
import { PERMISOS, rolTienePermiso, usuarioTienePermiso } from "./permisos";

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

describe("permisos de salidas", () => {
  it("Superadmin y Compras capturan, retiran y registran recepción; Jefe solo consulta", () => {
    for (const rol of ["SUPERADMIN", "COMPRAS"] as const) {
      for (const permiso of ["salidas:leer", "salidas:capturar", "salidas:retirar", "salidas:recibir"] as const) {
        expect(usuarioTienePermiso({ rol, puedeAutorizar: false }, permiso), `${rol}: ${permiso}`).toBe(true);
      }
    }
    expect(usuarioTienePermiso({ rol: "JEFE", puedeAutorizar: false }, "salidas:leer")).toBe(true);
    for (const permiso of ["salidas:capturar", "salidas:retirar", "salidas:recibir"] as const) {
      expect(usuarioTienePermiso({ rol: "JEFE", puedeAutorizar: true }, permiso), permiso).toBe(false);
    }
  });

  it("la bandera vigente decide la autorización independientemente del rol", () => {
    for (const rol of ["SUPERADMIN", "COMPRAS", "JEFE"] as const) {
      expect(usuarioTienePermiso({ rol, puedeAutorizar: false }, "salidas:autorizar"), rol).toBe(false);
      expect(usuarioTienePermiso({ rol, puedeAutorizar: true }, "salidas:autorizar"), rol).toBe(true);
    }
  });
});

describe("permisos de traspasos, devoluciones y conteo", () => {
  const OPERACION = ["traspasos", "devoluciones", "ajustes"] as const;

  it("Superadmin y Compras leen, capturan y confirman; Jefe solo lee, aun con la bandera", () => {
    for (const area of OPERACION) {
      for (const rol of ["SUPERADMIN", "COMPRAS"] as const) {
        for (const accion of ["leer", "capturar", "confirmar"] as const) {
          expect(rolTienePermiso(rol, `${area}:${accion}`), `${rol} ${area}:${accion}`).toBe(true);
        }
      }
      expect(rolTienePermiso("JEFE", `${area}:leer`)).toBe(true);
      for (const accion of ["capturar", "confirmar"] as const) {
        expect(usuarioTienePermiso({ rol: "JEFE", puedeAutorizar: true }, `${area}:${accion}`), `${area}:${accion}`).toBe(false);
      }
    }
  });

  it("solo el Superadmin revierte, y la bandera de autorizar no lo cambia", () => {
    expect(rolTienePermiso("SUPERADMIN", "movimientos:revertir")).toBe(true);
    for (const rol of ["COMPRAS", "JEFE"] as const) {
      expect(usuarioTienePermiso({ rol, puedeAutorizar: true }, "movimientos:revertir"), rol).toBe(false);
    }
  });
});
