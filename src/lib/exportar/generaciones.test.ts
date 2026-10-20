/*
  Las descargas de Excel por usuario: el mismo pedido en curso se comparte, no
  más de dos activas hasta terminar de transferirse, no más de tres libros
  armándose en el proceso y un tope por minuto de libros nuevos y de peticiones.
  El libro compartido vence a su plazo aunque su trabajo no se detenga.
*/
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Admision } from "./generaciones";

vi.mock("server-only", () => ({}));
const { claveDeGeneracion, crearGeneraciones, DescargaVencida, ESPERA_S, GeneracionVencida, GENERACIONES_POR_VENTANA, GRACIA_MS, MAXIMO_ACTIVAS, MAXIMO_GENERANDO, PETICIONES_POR_VENTANA, PLAZO_GENERACION_MS, VENTANA_MS, VIDA_MAXIMA_MS } =
  await import("./generaciones");

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

  it("al vencer el plazo, el cupo vuelve y se avisa a quien entrega la respuesta", async () => {
    vi.useFakeTimers();
    const gen = crearGeneraciones();
    const listo = async () => 0;
    const a = admitida(gen.admitir("u1", "a", listo));
    const b = admitida(gen.admitir("u1", "b", listo));
    b.liberar();
    const c = admitida(gen.admitir("u1", "c", listo));
    // Ya armados, pero sus respuestas siguen enviándose.
    await Promise.all([a.resultado, c.resultado]);
    expect(gen.admitir("u1", "d", listo)).toMatchObject({ motivo: "activas" });
    vi.advanceTimersByTime(VIDA_MAXIMA_MS - 1);
    expect([a.plazo.aborted, c.plazo.aborted]).toEqual([false, false]);
    vi.advanceTimersByTime(1);
    expect([a.plazo.aborted, b.plazo.aborted, c.plazo.aborted]).toEqual([true, false, true]);
    expect(a.plazo.reason).toBeInstanceOf(DescargaVencida);
    expect(gen.admitir("u1", "d", listo).estado).toBe("nueva");
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

describe("plazo del libro compartido", () => {
  /** Se detiene al abortarse su señal, como la compresión y la espera a Clerk. */
  const atento = (senial: AbortSignal) => new Promise<never>((_, rechazar) => senial.addEventListener("abort", () => rechazar(senial.reason), { once: true }));

  it("al vencer, quien lo espera se entera, el trabajo recibe la señal y su lugar en el proceso vuelve al detenerse", async () => {
    vi.useFakeTimers();
    const gen = crearGeneraciones();
    const seniales: AbortSignal[] = [];
    const trabajo = (senial: AbortSignal) => {
      seniales.push(senial);
      return atento(senial);
    };
    const esperas = Array.from({ length: MAXIMO_GENERANDO }, (_, i) => admitida(gen.admitir(`u${i}`, `k${i}`, trabajo)));
    const repetida = admitida(gen.admitir("u0", "k0", trabajo));
    expect(repetida.estado).toBe("compartida");
    expect(gen.admitir("otro", "k", trabajo)).toMatchObject({ motivo: "servidor" });
    await vi.advanceTimersByTimeAsync(PLAZO_GENERACION_MS - 1);
    expect(seniales.some((s) => s.aborted)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seniales.map((s) => s.aborted)).toEqual(Array(MAXIMO_GENERANDO).fill(true));
    for (const a of [...esperas, repetida]) {
      await expect(a.resultado).rejects.toBeInstanceOf(GeneracionVencida);
      a.liberar();
    }
    // El mismo pedido ya no se comparte, y los trabajos detenidos dejaron lugar.
    expect(gen.admitir("u0", "k0", trabajo).estado).toBe("nueva");
    expect(gen.admitir("otro", "k", trabajo).estado).toBe("nueva");
  });

  it("un trabajo que no atiende la señal sigue ocupando su lugar en el proceso, y se registra", async () => {
    vi.useFakeTimers();
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const gen = crearGeneraciones();
      const sordo = () => new Promise<never>(() => {});
      const esperas = Array.from({ length: MAXIMO_GENERANDO }, (_, i) => admitida(gen.admitir(`u${i}`, `k${i}`, sordo)));
      await vi.advanceTimersByTimeAsync(PLAZO_GENERACION_MS);
      for (const a of esperas) {
        await expect(a.resultado).rejects.toBeInstanceOf(GeneracionVencida);
        a.liberar();
      }
      // Quien esperaba ya se enteró, pero los trabajos siguen: no cabe otro.
      expect(gen.admitir("u0", "k0", sordo)).toMatchObject({ motivo: "servidor" });
      expect(registro).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(GRACIA_MS);
      expect(registro).toHaveBeenCalledTimes(MAXIMO_GENERANDO);
      expect(registro).toHaveBeenCalledWith(`[exportar] el libro de usuario u0 sigue armándose ${GRACIA_MS / 1000} s después de su plazo y ocupa el cupo del proceso.`);
    } finally {
      registro.mockRestore();
    }
  });
});

describe("intento", () => {
  it(`cuenta cada intento, también los rechazados: el ${PETICIONES_POR_VENTANA + 1}.º del minuto responde con lo que falta`, () => {
    let t = 0;
    const gen = crearGeneraciones(() => t);
    for (let i = 0; i < PETICIONES_POR_VENTANA; i++) {
      expect(gen.intento("s1"), `#${i + 1}`).toBeNull();
      t += 100;
    }
    // Los últimos 30 empiezan en el de t = 100 ms: sale de la ventana a los 60.1 s.
    expect(gen.intento("s1")).toEqual({ estado: "limitada", motivo: "peticiones", reintentarEn: 58, avisar: true });
    expect(gen.intento("s2")).toBeNull();
    // Insistir también cuenta: cada rechazo recorre la espera.
    t = 4_000;
    expect(gen.intento("s1")).toMatchObject({ motivo: "peticiones", reintentarEn: 57, avisar: false });
    t = 4_000 + 56_000;
    expect(gen.intento("s1")).toMatchObject({ motivo: "peticiones" });
    // Quien deja de insistir y espera lo indicado vuelve a pasar.
    t = 60_000 + 57_000;
    expect(gen.intento("s1")).toBeNull();
  });
});
