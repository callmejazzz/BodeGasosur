import "server-only";
import type { Params } from "./descargas";

/*
  Las descargas de Excel en curso y su frecuencia. Una descarga está activa
  desde que se admite hasta que su respuesta termina de enviarse o se corta.
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
/** Un cupo que nadie libera —una respuesta que nunca se lee— vuelve solo. */
export const VIDA_MAXIMA_MS = 120_000;

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

export type Admision<T> =
  | { estado: "limitada"; motivo: Motivo; reintentarEn: number; /** El primer rechazo del usuario por ese motivo en la ventana. */ avisar: boolean }
  | { estado: "nueva" | "compartida"; resultado: Promise<T>; liberar: () => void };

export function crearGeneraciones(ahora: () => number = Date.now) {
  const enCurso = new Map<string, Promise<unknown>>();
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
  const limitada = (usuarioId: string, motivo: Motivo, reintentarEn: number, t: number): Admision<never> => {
    const clave = `${usuarioId}:${motivo}`;
    const avisar = (avisos.get(clave) ?? -Infinity) <= t - VENTANA_MS;
    if (avisar) avisos.set(clave, t);
    return { estado: "limitada", motivo, reintentarEn, avisar };
  };

  return {
    /**
     * Revisa los límites y comparte el libro si el mismo pedido ya se arma.
     * Sin await entre revisar y anotar: dos peticiones no se cuelan.
     */
    admitir<T>(usuarioId: string, clave: string, generar: () => Promise<T>): Admision<T> {
      const t = ahora();
      const suyas = activas.get(usuarioId) ?? new Set<symbol>();
      if (suyas.size >= MAXIMO_ACTIVAS) return limitada(usuarioId, "activas", ESPERA_S, t);
      const peticiones = recientes(pedidas, usuarioId, t);
      if (peticiones.length >= PETICIONES_POR_VENTANA) return limitada(usuarioId, "peticiones", faltan(peticiones, t), t);

      let resultado = enCurso.get(clave) as Promise<T> | undefined;
      const estado = resultado ? "compartida" : "nueva";
      if (!resultado) {
        if (enCurso.size >= MAXIMO_GENERANDO) return limitada(usuarioId, "servidor", ESPERA_S, t);
        const nuevas = recientes(generadas, usuarioId, t);
        if (nuevas.length >= GENERACIONES_POR_VENTANA) return limitada(usuarioId, "generaciones", faltan(nuevas, t), t);
        nuevas.push(t);
        const r = Promise.resolve().then(generar);
        enCurso.set(clave, r);
        const quitar = () => {
          if (enCurso.get(clave) === r) enCurso.delete(clave);
        };
        r.then(quitar, quitar);
        resultado = r;
      }

      peticiones.push(t);
      const ficha = Symbol();
      suyas.add(ficha);
      activas.set(usuarioId, suyas);
      const liberar = () => {
        clearTimeout(reloj);
        suyas.delete(ficha);
        if (suyas.size === 0 && activas.get(usuarioId) === suyas) activas.delete(usuarioId);
      };
      const reloj = setTimeout(liberar, VIDA_MAXIMA_MS);
      reloj.unref?.();
      return { estado, resultado, liberar };
    },

    /** Solo para pruebas. */
    reiniciar() {
      for (const m of [enCurso, activas, generadas, pedidas, avisos]) m.clear();
    },
  };
}

export const generaciones = crearGeneraciones();
