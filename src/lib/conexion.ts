import { unstable_rethrow } from "next/navigation";
import { SIN_CONEXION } from "@/lib/mensajes";

/**
 * Una Server Action que no llega al servidor rechaza su promesa y, sin esto, la pantalla
 * cae en error.tsx con lo capturado. Aquí se vuelve un resultado con el aviso de conexión.
 */
export async function llamarAlServidor<T>(llamada: () => Promise<T>, siNoLlega: (mensaje: string) => T): Promise<T> {
  try {
    return await llamada();
  } catch (error) {
    // Las redirecciones de Next también llegan como error
    unstable_rethrow(error);
    console.warn("No se pudo llamar al servidor:", error);
    return siNoLlega(SIN_CONEXION);
  }
}

/** La acción de un useActionState, con el aviso de conexión sobre el estado anterior. */
export function conConexion<S, A extends unknown[]>(accion: (previo: S, ...args: A) => Promise<S>, siNoLlega: (previo: S, mensaje: string) => S) {
  return (previo: S, ...args: A) => llamarAlServidor(() => accion(previo, ...args), (mensaje) => siNoLlega(previo, mensaje));
}

export const resultadoSinConexion = (mensaje: string) => ({ ok: false as const, mensaje });
