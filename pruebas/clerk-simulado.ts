import { inject } from "vitest";
import { firmarToken } from "./tokens";

// El auth() de @clerk/nextjs/server en las pruebas: la sesión que fija cada
// prueba y un getToken que firma de verdad con la llave de la corrida, así la
// base verifica igual que en producción.

export type SesionSimulada = {
  userId: string | null;
  /** Para probar tokens alterados: recibe el userId y devuelve el token a usar. */
  token?: (userId: string) => string | null;
};

export function authSimulado(sesion: SesionSimulada) {
  return async () => ({
    userId: sesion.userId,
    getToken: async (opciones: { template?: string } = {}) => {
      if (!sesion.userId || opciones.template !== "bodegasosur-db") return null;
      return sesion.token ? sesion.token(sesion.userId) : firmarToken(inject("llavePruebas"), sesion.userId);
    },
  });
}
