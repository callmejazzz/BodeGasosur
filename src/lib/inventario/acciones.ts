import "server-only";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { accionProtegida, SinAcceso, SinPermiso, type UsuarioSesion } from "@/lib/db";
import { erroresDe, type ErroresFormulario } from "@/lib/movimientos/formulario";
import type { Permiso } from "@/lib/permisos";
import { ErrorDeDominio, traducida } from "./errores";
import type { EstadoFormulario } from "./formulario";

// La puerta de las Server Actions de traspasos, devoluciones, conteos y
// reversas: sesión y permiso (accionProtegida) → lectura y Zod → servicio.
// Sin sesión o sin permiso, la negativa llega antes de abrir el FormData.

/** Datos con otra forma, ya con la sesión y el permiso comprobados. */
export class DatosInvalidos extends Error {
  constructor(readonly errores: ErroresFormulario) {
    super("Datos inválidos.");
  }
}

type Opciones<I> = {
  /** Cómo se lee la entrada (el FormData, por ejemplo): ya dentro de la puerta. */
  leer?: (entrada: I) => unknown;
  errores?: (error: z.ZodError) => ErroresFormulario;
};

export function protegida<E extends z.ZodType, T, I = unknown>(
  permiso: Permiso,
  esquema: E,
  fn: (tx: Prisma.TransactionClient, usuario: UsuarioSesion, datos: z.output<E>) => Promise<T>,
  { leer = (entrada) => entrada, errores = erroresDe }: Opciones<I> = {},
): (entrada: I) => Promise<T> {
  return traducida(
    accionProtegida(permiso, (tx, usuario, entrada: I) => {
      const r = esquema.safeParse(leer(entrada));
      if (!r.success) throw new DatosInvalidos(errores(r.error));
      return fn(tx, usuario, r.data);
    }),
  );
}

/** Resultado de una acción sin formulario: la pantalla lo muestra tal cual y relee el detalle. */
export type ResultadoAccion = { ok: true; href?: string } | { ok: false; mensaje: string };

export const SIN_PERMISO = "No tienes permiso para esta operación.";

/** Lo único que ve la persona: la negativa, el error del dato o del dominio, o uno genérico. */
export function mensajeSeguro(error: unknown, noExiste: string): string {
  if (error instanceof SinAcceso || error instanceof SinPermiso) return SIN_PERMISO;
  if (error instanceof DatosInvalidos) return error.errores.id ? noExiste : (Object.values(error.errores)[0] ?? "Datos inválidos.");
  if (error instanceof ErrorDeDominio) return error.message;
  console.error("[inventario]", error);
  return "No se pudo completar la operación. Inténtalo de nuevo.";
}

/** Una acción sin formulario: el resultado seguro y, si salió bien, el refresco de sus pantallas. */
export async function ejecutar<T extends { id: string }>(
  accion: () => Promise<T>,
  noExiste: string,
  refrescar: (resultado: T) => void,
  href?: (resultado: T) => string,
): Promise<ResultadoAccion> {
  let resultado: T;
  try {
    resultado = await accion();
  } catch (error) {
    return { ok: false, mensaje: mensajeSeguro(error, noExiste) };
  }
  refrescar(resultado);
  return href ? { ok: true, href: href(resultado) } : { ok: true };
}

/**
 * Una acción de formulario: los errores de Zod regresan por campo; los demás,
 * como mensaje. La llave no tiene campo en pantalla: si no es válida, el
 * formulario es otro o está alterado.
 */
export async function enviarFormulario<T>(
  accion: () => Promise<T>,
  noExiste: string,
): Promise<{ ok: true; resultado: T } | { ok: false; estado: EstadoFormulario }> {
  try {
    return { ok: true, resultado: await accion() };
  } catch (error) {
    if (error instanceof DatosInvalidos) {
      if (error.errores.llaveIdempotencia) {
        return { ok: false, estado: { errores: {}, mensaje: "El formulario ya no es válido. Recarga la página y vuelve a capturar." } };
      }
      if (error.errores.id || error.errores.revision) return { ok: false, estado: { errores: {}, mensaje: noExiste } };
      return { ok: false, estado: { errores: error.errores, mensaje: "Revisa los campos marcados." } };
    }
    return { ok: false, estado: { errores: {}, mensaje: mensajeSeguro(error, noExiste) } };
  }
}
