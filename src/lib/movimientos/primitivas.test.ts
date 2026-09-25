/* La conversión a unidad base que comparten entradas y salidas (11 §5). */

import { describe, expect, it } from "vitest";
import { aUnidadBase, TOPE_ENTERO } from "./primitivas";

describe("aUnidadBase", () => {
  it("UNIDAD usa factor 1; CAJA, las piezas por caja del catálogo", () => {
    expect(aUnidadBase("ART-1", "UNIDAD", 5, 12)).toEqual({ factorConversion: 1, cantidad: 5 });
    expect(aUnidadBase("ART-1", "CAJA", 3, 12)).toEqual({ factorConversion: 12, cantidad: 36 });
  });

  it("rechaza caja sin piezas por caja, presentación desconocida y cantidades no enteras o no positivas", () => {
    expect(aUnidadBase("ART-1", "CAJA", 1, null)).toEqual({ error: expect.stringContaining("no se maneja por caja") });
    expect(aUnidadBase("ART-1", "PAQUETE" as "UNIDAD", 1, 12)).toEqual({ error: expect.stringContaining("UNIDAD o CAJA") });
    for (const n of [0, -1, 1.5, Number.NaN]) {
      expect(aUnidadBase("ART-1", "UNIDAD", n, null), String(n)).toEqual({ error: expect.stringContaining("entero positivo") });
    }
  });

  it("no rebasa el entero de la base", () => {
    expect(aUnidadBase("ART-1", "CAJA", 1, TOPE_ENTERO)).toEqual({ factorConversion: TOPE_ENTERO, cantidad: TOPE_ENTERO });
    expect(aUnidadBase("ART-1", "CAJA", 2, TOPE_ENTERO)).toEqual({ error: expect.stringContaining("demasiado grande") });
  });
});
