/*
  Las generaciones de Excel por usuario: el mismo pedido en curso se comparte,
  no más de dos a la vez y no más de diez nuevas por minuto.
*/
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { claveDeGeneracion, crearGeneraciones, ESPERA_EN_CURSO_S, GENERACIONES_POR_VENTANA, MAXIMO_EN_CURSO, VENTANA_MS } = await import("./generaciones");

/** Un trabajo que no termina hasta soltarlo. */
function pendiente<T>(valor: T) {
  let soltar!: () => void;
  let fallar!: (e: Error) => void;
  const promesa = new Promise<T>((resolve, reject) => {
    soltar = () => resolve(valor);
    fallar = reject;
  });
  return { trabajo: vi.fn(() => promesa), soltar, fallar };
}

describe("clave de generación", () => {
  it("no depende del orden, los vacíos, los espacios ni la página", () => {
    const base = claveDeGeneracion("u1", "semanal", { bodega: "b1", q: "casco" });
    expect(claveDeGeneracion("u1", "semanal", { q: " casco ", pagina: "3", bajo: "", bodega: "b1" })).toBe(base);
    expect(claveDeGeneracion("u1", "semanal", { bodega: "b1", q: "casco", estacion: undefined })).toBe(base);
  });

  it("distingue usuario, tabla y filtros", () => {
    const base = claveDeGeneracion("u1", "semanal", { q: "casco" });
    expect(claveDeGeneracion("u2", "semanal", { q: "casco" })).not.toBe(base);
    expect(claveDeGeneracion("u1", "existencias", { q: "casco" })).not.toBe(base);
    expect(claveDeGeneracion("u1", "semanal", { q: "chaleco" })).not.toBe(base);
    expect(claveDeGeneracion("u1", "semanal", { "q\",\"x": "y" })).not.toBe(claveDeGeneracion("u1", "semanal", { q: "x\",\"y" }));
  });
});

describe("turno", () => {
  it("el mismo pedido en curso espera el mismo resultado sin otro trabajo", async () => {
    const g = crearGeneraciones();
    const p = pendiente("libro");
    const primero = g.turno("u1", "k", p.trabajo);
    const segundo = g.turno("u1", "k", p.trabajo);
    expect([primero.estado, segundo.estado]).toEqual(["nueva", "compartida"]);
    p.soltar();
    if (primero.estado === "limitada" || segundo.estado === "limitada") throw new Error("no debía limitarse");
    expect(await Promise.all([primero.resultado, segundo.resultado])).toEqual(["libro", "libro"]);
    expect(p.trabajo).toHaveBeenCalledTimes(1);
    // Ya terminado, el mismo pedido es una generación nueva.
    expect(g.turno("u1", "k", async () => "otro").estado).toBe("nueva");
  });

  it(`con ${MAXIMO_EN_CURSO} en curso rechaza una tercera, pero deja esperar a quien repite una de ellas`, async () => {
    const g = crearGeneraciones();
    const a = pendiente("a");
    const b = pendiente("b");
    g.turno("u1", "a", a.trabajo);
    g.turno("u1", "b", b.trabajo);
    expect(g.turno("u1", "c", async () => "c")).toEqual({ estado: "limitada", motivo: "en-curso", reintentarEn: ESPERA_EN_CURSO_S });
    expect(g.turno("u1", "a", a.trabajo).estado).toBe("compartida");
    expect(g.turno("u2", "c2", async () => "c").estado).toBe("nueva");
    a.soltar();
    await vi.waitFor(() => expect(g.turno("u1", "c", async () => "c").estado).toBe("nueva"));
    b.soltar();
  });

  it("un trabajo que falla lo comparte con quien esperaba y deja de estar en curso", async () => {
    const g = crearGeneraciones();
    const p = pendiente("x");
    const primero = g.turno("u1", "k", p.trabajo);
    const segundo = g.turno("u1", "k", p.trabajo);
    p.fallar(new Error("se cayó la base"));
    if (primero.estado === "limitada" || segundo.estado === "limitada") throw new Error("no debía limitarse");
    await expect(primero.resultado).rejects.toThrow("se cayó la base");
    await expect(segundo.resultado).rejects.toThrow("se cayó la base");
    expect(g.turno("u1", "k", async () => "x").estado).toBe("nueva");
  });

  it(`no más de ${GENERACIONES_POR_VENTANA} nuevas por minuto, con el tiempo que falta para la siguiente`, async () => {
    let t = 1_000_000;
    const g = crearGeneraciones(() => t);
    for (let i = 0; i < GENERACIONES_POR_VENTANA; i++) {
      const r = g.turno("u1", `k${i}`, async () => i);
      if (r.estado === "limitada") throw new Error(`se limitó la ${i + 1}`);
      await r.resultado;
      t += 1_000;
    }
    // La primera fue hace 10 s: faltan 50 para que salga de la ventana.
    expect(g.turno("u1", "otra", async () => 0)).toEqual({ estado: "limitada", motivo: "frecuencia", reintentarEn: 50 });
    expect(g.turno("u2", "otra-u2", async () => 0).estado).toBe("nueva");
    t = 1_000_000 + VENTANA_MS;
    expect(g.turno("u1", "otra", async () => 0).estado).toBe("nueva");
    expect(g.turno("u1", "una-mas", async () => 0)).toMatchObject({ estado: "limitada", reintentarEn: 1 });
  });

  it("esperar un pedido en curso no cuenta como generación nueva", async () => {
    const g = crearGeneraciones(() => 0);
    const p = pendiente("libro");
    const primero = g.turno("u1", "k", p.trabajo);
    for (let i = 0; i < GENERACIONES_POR_VENTANA * 2; i++) expect(g.turno("u1", "k", p.trabajo).estado).toBe("compartida");
    p.soltar();
    if (primero.estado === "limitada") throw new Error("no debía limitarse");
    await primero.resultado;
    expect(p.trabajo).toHaveBeenCalledTimes(1);
  });
});
