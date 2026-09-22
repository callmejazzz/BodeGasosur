import { describe, expect, it } from "vitest";
import { decimalEnTexto } from "./utils";

describe("decimalEnTexto", () => {
  it("muestra dos decimales y los demás solo cuando no son cero", () => {
    expect(decimalEnTexto("36")).toBe("36.00");
    expect(decimalEnTexto("36.0000")).toBe("36.00");
    expect(decimalEnTexto("12.5")).toBe("12.50");
    expect(decimalEnTexto("0.3350")).toBe("0.335");
    expect(decimalEnTexto("17.500000")).toBe("17.50");
    expect(decimalEnTexto("17.123456")).toBe("17.123456");
    expect(decimalEnTexto({ toString: () => "1037.1" })).toBe("1037.10");
  });

  it("vacío para nulo y sin tocar lo que no es decimal", () => {
    expect(decimalEnTexto(null)).toBe("");
    expect(decimalEnTexto(undefined)).toBe("");
    expect(decimalEnTexto("abc")).toBe("abc");
  });
});
