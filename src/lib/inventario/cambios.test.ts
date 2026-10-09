import { describe, expect, it } from "vitest";
import { editar, guardado, haySinGuardar, SIN_CAMBIOS } from "./cambios";

describe("cambios sin guardar", () => {
  it("una edición marca la captura y solo un guardado confirmado la limpia", () => {
    const editada = editar(SIN_CAMBIOS);
    expect(haySinGuardar(SIN_CAMBIOS)).toBe(false);
    expect(haySinGuardar(editada)).toBe(true);
    // Enviar no limpia nada: si el servidor rechaza, no hay guardado que aplicar.
    expect(haySinGuardar(guardado(editada, editada.hechas))).toBe(false);
  });

  it("lo editado mientras el guardado viajaba sigue pendiente", () => {
    const enviada = editar(editar(SIN_CAMBIOS));
    const despues = editar(enviada);
    expect(haySinGuardar(guardado(despues, enviada.hechas))).toBe(true);
  });

  it("una respuesta vieja no deshace un guardado más reciente", () => {
    const primera = editar(SIN_CAMBIOS);
    const segunda = editar(primera);
    const conSegunda = guardado(segunda, segunda.hechas);
    expect(guardado(conSegunda, primera.hechas)).toEqual(conSegunda);
    expect(haySinGuardar(guardado(conSegunda, primera.hechas))).toBe(false);
  });
});
