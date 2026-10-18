/*
  Las descargas de Excel por usuario: el mismo pedido en curso se comparte, no
  más de dos activas hasta terminar de transferirse, no más de tres libros
  armándose en el proceso y un tope por minuto de libros nuevos y de peticiones.
*/
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Admision } from "./generaciones";

vi.mock("server-only", () => ({}));
const { claveDeGeneracion, crearGeneraciones, ESPERA_S, GENERACIONES_POR_VENTANA, MAXIMO_ACTIVAS, MAXIMO_GENERANDO, PETICIONES_POR_VENTANA, VENTANA_MS, VIDA_MAXIMA_MS } = await import("./generaciones");

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

function admitida<T>(a: Admision<T>) {
  if (a.estado === "limitada") throw new Error(`limitada por ${a.motivo}`);
  return a;
}

afterEach(() => vi.useRealTimers());

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

describe("admitir", () => {
  it("el mismo pedido en curso espera el mismo resultado sin otro trabajo", async () => {
    const gen = crearGeneraciones();
    const p = pendiente("libro");
    const primero = admitida(gen.admitir("u1", "k", p.trabajo));
    const segundo = admitida(gen.admitir("u1", "k", p.trabajo));
    expect([primero.estado, segundo.estado]).toEqual(["nueva", "compartida"]);
    p.soltar();
    expect(await Promise.all([primero.resultado, segundo.resultado])).toEqual(["libro", "libro"]);
    expect(p.trabajo).toHaveBeenCalledTimes(1);
    primero.liberar();
    segundo.liberar();
    // Ya terminado, el mismo pedido es una generación nueva.
    expect(gen.admitir("u1", "k", async () => "otro").estado).toBe("nueva");
  });

  it(`${MAXIMO_ACTIVAS} activas por usuario hasta terminar de transferirse, también si comparten libro`, async () => {
    const gen = crearGeneraciones();
    const p = pendiente("a");
    const a = admitida(gen.admitir("u1", "a", p.trabajo));
    const repetida = admitida(gen.admitir("u1", "a", p.trabajo));
    const limitada = { estado: "limitada", motivo: "activas", reintentarEn: ESPERA_S };
    expect(gen.admitir("u1", "a", p.trabajo)).toMatchObject(limitada);
    expect(gen.admitir("u1", "b", async () => "b")).toMatchObject(limitada);
    expect(gen.admitir("u2", "b2", async () => "b").estado).toBe("nueva");
    // El libro ya está armado, pero las dos respuestas siguen enviándose.
    p.soltar();
    await a.resultado;
    expect(gen.admitir("u1", "b", async () => "b")).toMatchObject(limitada);
    a.liberar();
    a.liberar();
    admitida(gen.admitir("u1", "b", async () => "b"));
    expect(gen.admitir("u1", "c", async () => "c")).toMatchObject(limitada);
    repetida.liberar();
    expect(gen.admitir("u1", "c", async () => "c").estado).toBe("nueva");
  });

  it(`no más de ${MAXIMO_GENERANDO} libros armándose en el proceso, de cualquier usuario`, async () => {
    const gen = crearGeneraciones();
    const trabajos = Array.from({ length: MAXIMO_GENERANDO }, (_, i) => pendiente(i));
    trabajos.forEach((p, i) => admitida(gen.admitir(`u${i}`, `k${i}`, p.trabajo)));
    expect(gen.admitir("otro", "k", async () => 0)).toMatchObject({ estado: "limitada", motivo: "servidor", reintentarEn: ESPERA_S });
    // Esperar uno que ya se arma no ocupa otro lugar.
    expect(gen.admitir("u0", "k0", trabajos[0].trabajo).estado).toBe("compartida");
    trabajos[1].soltar();
    await vi.waitFor(() => expect(gen.admitir("otro", "k", async () => 0).estado).toBe("nueva"));
  });

  it(`no más de ${GENERACIONES_POR_VENTANA} libros nuevos por minuto, con el tiempo que falta`, async () => {
    let t = 1_000_000;
    const gen = crearGeneraciones(() => t);
    for (let i = 0; i < GENERACIONES_POR_VENTANA; i++) {
      const a = admitida(gen.admitir("u1", `k${i}`, async () => i));
      await a.resultado;
      a.liberar();
      t += 1_000;
    }
    // El primero fue hace 10 s: faltan 50 para que salga de la ventana.
    expect(gen.admitir("u1", "otra", async () => 0)).toMatchObject({ estado: "limitada", motivo: "generaciones", reintentarEn: 50 });
    expect(gen.admitir("u2", "otra-u2", async () => 0).estado).toBe("nueva");
    t = 1_000_000 + VENTANA_MS;
    admitida(gen.admitir("u1", "otra", async () => 0)).liberar();
    expect(gen.admitir("u1", "una-mas", async () => 0)).toMatchObject({ motivo: "generaciones", reintentarEn: 1 });
  });

  it(`no más de ${PETICIONES_POR_VENTANA} peticiones por minuto, aunque compartan libro`, () => {
    let t = 0;
    const gen = crearGeneraciones(() => t);
    const p = pendiente("libro");
    for (let i = 0; i < PETICIONES_POR_VENTANA; i++) {
      admitida(gen.admitir("u1", "k", p.trabajo)).liberar();
      t += 100;
    }
    expect(p.trabajo).toHaveBeenCalledTimes(0);
    expect(gen.admitir("u1", "k", p.trabajo)).toMatchObject({ estado: "limitada", motivo: "peticiones", reintentarEn: 57 });
    p.soltar();
  });

  it("avisa el primer rechazo de cada motivo por ventana, no cada uno", () => {
    let t = 0;
    const gen = crearGeneraciones(() => t);
    const p = pendiente(0);
    gen.admitir("u1", "a", p.trabajo);
    gen.admitir("u1", "b", p.trabajo);
    expect(gen.admitir("u1", "c", p.trabajo)).toMatchObject({ motivo: "activas", avisar: true });
    t += 1_000;
    expect(gen.admitir("u1", "c", p.trabajo)).toMatchObject({ motivo: "activas", avisar: false });
    expect(gen.admitir("u2", "c", p.trabajo).estado).toBe("nueva");
    t += VENTANA_MS;
    expect(gen.admitir("u1", "c", p.trabajo)).toMatchObject({ motivo: "activas", avisar: true });
    p.soltar();
  });

  it("un cupo que nadie libera vuelve solo", () => {
    vi.useFakeTimers();
    const gen = crearGeneraciones();
    const p = pendiente(0);
    gen.admitir("u1", "a", p.trabajo);
    gen.admitir("u1", "b", p.trabajo);
    expect(gen.admitir("u1", "c", p.trabajo).estado).toBe("limitada");
    vi.advanceTimersByTime(VIDA_MAXIMA_MS);
    expect(gen.admitir("u1", "c", p.trabajo).estado).not.toBe("limitada");
    p.soltar();
  });

  it("un trabajo que falla lo comparte con quien esperaba y deja de estar en curso", async () => {
    const gen = crearGeneraciones();
    const p = pendiente("x");
    const primero = admitida(gen.admitir("u1", "k", p.trabajo));
    const segundo = admitida(gen.admitir("u1", "k", p.trabajo));
    p.fallar(new Error("se cayó la base"));
    await expect(primero.resultado).rejects.toThrow("se cayó la base");
    await expect(segundo.resultado).rejects.toThrow("se cayó la base");
    primero.liberar();
    segundo.liberar();
    expect(gen.admitir("u1", "k", async () => "x").estado).toBe("nueva");
  });
});
