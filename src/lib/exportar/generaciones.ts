import "server-only";
import type { Params } from "./descargas";

/*
  Las descargas de Excel en curso y su frecuencia. Cada intento autenticado
  cuenta, aunque se rechace. Una descarga está activa desde que se admite
  hasta que su respuesta termina de enviarse, se corta o vence su plazo. El
  libro compartido tiene su propio plazo: al vencer deja de compartirse, quien
  lo espera se entera y el trabajo recibe la señal para detenerse.
  El estado vive en memoria porque la aplicación corre en una sola instancia
  (docs/05); si se escala, cada instancia llevaría su propia cuenta.
*/

/** Por usuario: armándose, esperando un libro en curso o transfiriéndose. */
export const MAXIMO_ACTIVAS = 2;
/** Libros armándose a la vez en el proceso. Con una CPU, más no arma más rápido; medido en el §6 del contrato. */
export const MAXIMO_GENERANDO = 3;
export const GENERACIONES_POR_VENTANA = 10;
export const PETICIONES_POR_VENTANA = 30;
export const VENTANA_MS = 60_000;
/** Lo sugerido cuando falta cupo: un libro tarda segundos. */
export const ESPERA_S = 5;
/** Plazo de una descarga activa: al vencer, el cupo vuelve y la respuesta se corta. */
export const VIDA_MAXIMA_MS = 120_000;
/** Plazo del libro compartido: más que los 60 s de la lectura, menos que el de cada descarga. */
export const PLAZO_GENERACION_MS = 90_000;
/** Un trabajo que sigue vivo tanto después de su plazo no atiende la señal: se registra. */
export const GRACIA_MS = 30_000;

export class DescargaVencida extends Error {
  constructor() {
    super("La descarga llegó a su plazo máximo.");
    this.name = "DescargaVencida";
  }
}

export class GeneracionVencida extends Error {
  constructor() {
    super("El libro no se terminó de armar en su plazo.");
    this.name = "GeneracionVencida";
  }
}

/** Mismo usuario, tabla y filtros, sin importar su orden, los vacíos ni la página. */
export function claveDeGeneracion(usuarioId: string, tabla: string, params: Params): string {
  const filtros = Object.entries(params)
    .filter(([nombre]) => nombre !== "pagina")
    .map(([nombre, valor]) => [nombre, (Array.isArray(valor) ? valor : [valor]).map((v) => (v ?? "").trim()).filter(Boolean)] as const)
    .filter(([, valores]) => valores.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([usuarioId, tabla, filtros]);
}

export type Motivo = "activas" | "peticiones" | "servidor" | "generaciones";

export type Limitada = { estado: "limitada"; motivo: Motivo; reintentarEn: number; /** El primer rechazo por ese motivo en la ventana. */ avisar: boolean };

export type Admision<T> =
  | Limitada
  | { estado: "nueva" | "compartida"; resultado: Promise<T>; liberar: () => void; /** Se aborta al vencer el plazo. */ plazo: AbortSignal };

export function crearGeneraciones(ahora: () => number = Date.now) {
  /** Libros que se pueden compartir, por clave; salen al terminar o al vencer. */
  const enCurso = new Map<string, Promise<unknown>>();
  /** Trabajos que siguen corriendo, vencidos o no: ocupan el cupo del proceso. */
  const vivos = new Set<symbol>();
  const activas = new Map<string, Set<symbol>>();
  const generadas = new Map<string, number[]>();
  const pedidas = new Map<string, number[]>();
  const avisos = new Map<string, number>();

  const recientes = (marcas: Map<string, number[]>, usuarioId: string, t: number) => {
    const r = (marcas.get(usuarioId) ?? []).filter((i) => i > t - VENTANA_MS);
    marcas.set(usuarioId, r);
    return r;
  };
  const faltan = (r: number[], t: number) => Math.max(1, Math.ceil((r[0] + VENTANA_MS - t) / 1000));
  const limitada = (quien: string, motivo: Motivo, reintentarEn: number, t: number): Limitada => {
    const clave = `${quien}:${motivo}`;
    const avisar = (avisos.get(clave) ?? -Infinity) <= t - VENTANA_MS;
    if (avisar) avisos.set(clave, t);
    return { estado: "limitada", motivo, reintentarEn, avisar };
  };

  /**
   * Arma el libro con su propio plazo. Quien lo espera se entera al vencer; el
   * lugar en el cupo del proceso vuelve cuando el trabajo termina de verdad.
   */
  const generacion = <T>(usuarioId: string, generar: (senial: AbortSignal) => Promise<T>): Promise<T> => {
    const ficha = Symbol();
    vivos.add(ficha);
    const control = new AbortController();
    let aviso: ReturnType<typeof setTimeout> | undefined;
    const reloj = setTimeout(() => {
      control.abort(new GeneracionVencida());
      aviso = setTimeout(() => {
        if (vivos.has(ficha)) console.error(`[exportar] el libro de usuario ${usuarioId} sigue armándose ${GRACIA_MS / 1000} s después de su plazo y ocupa el cupo del proceso.`);
      }, GRACIA_MS);
      aviso.unref?.();
    }, PLAZO_GENERACION_MS);
    reloj.unref?.();

    const trabajo = Promise.resolve().then(() => generar(control.signal));
    const fin = () => {
      vivos.delete(ficha);
      clearTimeout(reloj);
      clearTimeout(aviso);
    };
    trabajo.then(fin, fin);
    const vencida = new Promise<never>((_, rechazar) => control.signal.addEventListener("abort", () => rechazar(control.signal.reason), { once: true }));
    vencida.catch(() => {});
    return Promise.race([trabajo, vencida]);
  };

  return {
    /**
     * Cuenta el intento, también si se rechaza, antes de revisar cupos o leer
     * la base. De cada sesión guarda solo los últimos que caben en la ventana.
     */
    intento(identidad: string): Limitada | null {
      const t = ahora();
      const previos = (pedidas.get(identidad) ?? []).filter((i) => i > t - VENTANA_MS);
      const marcas = [...previos, t].slice(-PETICIONES_POR_VENTANA);
      pedidas.set(identidad, marcas);
      // Vuelve a pasar cuando el más antiguo de esos últimos sale de la ventana.
      return previos.length >= PETICIONES_POR_VENTANA ? limitada(identidad, "peticiones", faltan(marcas, t), t) : null;
    },

    /**
     * Revisa los límites y comparte el libro si el mismo pedido ya se arma.
     * Sin await entre revisar y anotar: dos peticiones no se cuelan.
     */
    admitir<T>(usuarioId: string, clave: string, generar: (senial: AbortSignal) => Promise<T>): Admision<T> {
      const t = ahora();
      const suyas = activas.get(usuarioId) ?? new Set<symbol>();
      if (suyas.size >= MAXIMO_ACTIVAS) return limitada(usuarioId, "activas", ESPERA_S, t);

      let resultado = enCurso.get(clave) as Promise<T> | undefined;
      const estado = resultado ? "compartida" : "nueva";
      if (!resultado) {
        if (vivos.size >= MAXIMO_GENERANDO) return limitada(usuarioId, "servidor", ESPERA_S, t);
        const nuevas = recientes(generadas, usuarioId, t);
        if (nuevas.length >= GENERACIONES_POR_VENTANA) return limitada(usuarioId, "generaciones", faltan(nuevas, t), t);
        nuevas.push(t);
        const r = generacion(usuarioId, generar);
        enCurso.set(clave, r);
        const quitar = () => {
          if (enCurso.get(clave) === r) enCurso.delete(clave);
        };
        r.then(quitar, quitar);
        resultado = r;
      }

      const ficha = Symbol();
      suyas.add(ficha);
      activas.set(usuarioId, suyas);
      const plazo = new AbortController();
      const liberar = () => {
        clearTimeout(reloj);
        suyas.delete(ficha);
        if (suyas.size === 0 && activas.get(usuarioId) === suyas) activas.delete(usuarioId);
      };
      const reloj = setTimeout(() => {
        liberar();
        plazo.abort(new DescargaVencida());
      }, VIDA_MAXIMA_MS);
      reloj.unref?.();
      return { estado, resultado, liberar, plazo: plazo.signal };
    },

    /** Solo para pruebas. */
    reiniciar() {
      for (const m of [enCurso, vivos, activas, generadas, pedidas, avisos]) m.clear();
    },
  };
}

export const generaciones = crearGeneraciones();
