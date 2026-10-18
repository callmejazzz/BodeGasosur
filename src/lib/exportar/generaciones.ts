import "server-only";
import type { Params } from "./descargas";

/*
  Cuántos libros arma cada usuario a la vez y qué tan seguido. El estado vive
  en memoria porque la aplicación corre en una sola instancia (docs/05); si se
  escala, cada instancia llevaría su propia cuenta.
*/

export const MAXIMO_EN_CURSO = 2;
export const GENERACIONES_POR_VENTANA = 10;
export const VENTANA_MS = 60_000;
/** Lo sugerido cuando ya hay dos en curso: un libro tarda segundos. */
export const ESPERA_EN_CURSO_S = 5;

/** Mismo usuario, tabla y filtros, sin importar su orden, los vacíos ni la página. */
export function claveDeGeneracion(usuarioId: string, tabla: string, params: Params): string {
  const filtros = Object.entries(params)
    .filter(([nombre]) => nombre !== "pagina")
    .map(([nombre, valor]) => [nombre, (Array.isArray(valor) ? valor : [valor]).map((v) => (v ?? "").trim()).filter(Boolean)] as const)
    .filter(([, valores]) => valores.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([usuarioId, tabla, filtros]);
}

export type Turno<T> =
  | { estado: "nueva" | "compartida"; resultado: Promise<T> }
  | { estado: "limitada"; motivo: "en-curso" | "frecuencia"; reintentarEn: number };

export function crearGeneraciones(ahora: () => number = Date.now) {
  const enCurso = new Map<string, { usuarioId: string; resultado: Promise<unknown> }>();
  const inicios = new Map<string, number[]>();

  return {
    /**
     * La misma clave en curso se comparte; si no, se revisan los límites y se
     * arranca. Sin await entre revisar y anotar: dos peticiones no se cuelan.
     */
    turno<T>(usuarioId: string, clave: string, generar: () => Promise<T>): Turno<T> {
      const previa = enCurso.get(clave);
      if (previa) return { estado: "compartida", resultado: previa.resultado as Promise<T> };

      let activas = 0;
      for (const g of enCurso.values()) if (g.usuarioId === usuarioId) activas++;
      if (activas >= MAXIMO_EN_CURSO) return { estado: "limitada", motivo: "en-curso", reintentarEn: ESPERA_EN_CURSO_S };

      const t = ahora();
      const recientes = (inicios.get(usuarioId) ?? []).filter((i) => i > t - VENTANA_MS);
      if (recientes.length >= GENERACIONES_POR_VENTANA) {
        inicios.set(usuarioId, recientes);
        return { estado: "limitada", motivo: "frecuencia", reintentarEn: Math.max(1, Math.ceil((recientes[0] + VENTANA_MS - t) / 1000)) };
      }
      inicios.set(usuarioId, [...recientes, t]);

      const resultado = Promise.resolve().then(generar);
      enCurso.set(clave, { usuarioId, resultado });
      const quitar = () => {
        if (enCurso.get(clave)?.resultado === resultado) enCurso.delete(clave);
      };
      resultado.then(quitar, quitar);
      return { estado: "nueva", resultado };
    },

    /** Solo para pruebas. */
    reiniciar() {
      enCurso.clear();
      inicios.clear();
    },
  };
}

export const generaciones = crearGeneraciones();
