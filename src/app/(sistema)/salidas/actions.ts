"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { accionProtegida, SinAcceso, SinPermiso, type UsuarioSesion } from "@/lib/db";
import { erroresDe, type ErroresFormulario } from "@/lib/movimientos/formulario";
import type { Permiso } from "@/lib/permisos";
import { ErrorDeDominio, traducida } from "@/lib/salidas/errores";
import {
  erroresDeAlta,
  esquemaAlta,
  esquemaCancelacion,
  esquemaId,
  esquemaRechazo,
  esquemaRetiro,
  leerAlta,
  type EstadoSalida,
} from "@/lib/salidas/formulario";
import * as servicio from "@/lib/salidas/servicio";

// Las acciones de salidas. Cada una: sesión y permiso (accionProtegida) →
// lectura y forma de los datos (Zod) → servicio. Sin sesión, la respuesta es
// la negativa de acceso antes de abrir siquiera el FormData. El actor sale de la sesión y
// cada acción devuelve solo lo que la pantalla muestra.

/** Datos con otra forma, ya con la sesión y el permiso comprobados. */
class DatosInvalidos extends Error {
  constructor(readonly errores: ErroresFormulario) {
    super("Datos inválidos.");
  }
}

type Opciones<I> = {
  /** Cómo se lee la entrada (el FormData, por ejemplo): ya dentro de la puerta. */
  leer?: (entrada: I) => unknown;
  errores?: (error: z.ZodError) => ErroresFormulario;
};

/** Sesión → lectura y Zod → servicio, con la traducción de errores alrededor de todo, confirmación incluida. */
function protegida<E extends z.ZodType, T, I = unknown>(
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

const solicitar = protegida("salidas:capturar", esquemaAlta, (tx, u, d) => servicio.solicitarSalida(tx, u, d.llaveIdempotencia, d.solicitud), {
  leer: leerAlta,
  errores: erroresDeAlta,
});
const autorizar = protegida("salidas:autorizar", esquemaId, (tx, u, d) => servicio.autorizarSalida(tx, u, d.id));
const rechazar = protegida("salidas:autorizar", esquemaRechazo, (tx, u, d) => servicio.rechazarSalida(tx, u, d.id, d.motivo));
const cancelar = protegida("salidas:capturar", esquemaCancelacion, (tx, u, d) => servicio.cancelarSalida(tx, u, d.id, d.motivo));
const retirar = protegida("salidas:retirar", esquemaRetiro, (tx, u, d) => servicio.retirarSalida(tx, u, d.id, d.entregadoA));
const recibir = protegida("salidas:recibir", esquemaId, (tx, u, d) => servicio.confirmarRecepcion(tx, u, d.id));

/** Resultado de una acción sin formulario: la pantalla lo muestra tal cual y relee el detalle. */
export type ResultadoAccion = { ok: true } | { ok: false; mensaje: string };

function mensajeSeguro(error: unknown): string {
  if (error instanceof SinAcceso || error instanceof SinPermiso) return "No tienes permiso para esta operación.";
  if (error instanceof DatosInvalidos) {
    return error.errores.id ? "La salida no existe." : (Object.values(error.errores)[0] ?? "Datos inválidos.");
  }
  if (error instanceof ErrorDeDominio) return error.message;
  console.error("[salidas]", error);
  return "No se pudo completar la operación. Inténtalo de nuevo.";
}

function refrescar(id: string) {
  revalidatePath("/salidas");
  revalidatePath("/");
  revalidatePath(`/salidas/${id}`);
}

async function ejecutar(accion: (crudo: unknown) => Promise<{ id: string }>, crudo: unknown): Promise<ResultadoAccion> {
  let id: string;
  try {
    ({ id } = await accion(crudo));
  } catch (error) {
    return { ok: false, mensaje: mensajeSeguro(error) };
  }
  refrescar(id);
  return { ok: true };
}

export async function crearSalida(_previo: EstadoSalida, formData: FormData): Promise<EstadoSalida> {
  let id: string;
  try {
    ({ id } = await solicitar(formData));
  } catch (error) {
    if (error instanceof DatosInvalidos) {
      // La llave no se ve en el formulario: si no es válida, el formulario es otro o está alterado.
      const mensaje = error.errores.llaveIdempotencia ? "El formulario ya no es válido. Recarga la página y vuelve a capturar." : "Revisa los campos marcados.";
      return { errores: error.errores, mensaje };
    }
    return { errores: {}, mensaje: mensajeSeguro(error) };
  }
  refrescar(id);
  redirect(`/salidas/${id}`);
}

export async function autorizarSalida(id: string): Promise<ResultadoAccion> {
  return ejecutar(autorizar, { id });
}

export async function rechazarSalida(id: string, motivo: string): Promise<ResultadoAccion> {
  return ejecutar(rechazar, { id, motivo });
}

export async function cancelarSalida(id: string, motivo: string): Promise<ResultadoAccion> {
  return ejecutar(cancelar, { id, motivo });
}

export async function retirarSalida(id: string, entregadoA: string): Promise<ResultadoAccion> {
  return ejecutar(retirar, { id, entregadoA });
}

export async function confirmarRecepcion(id: string): Promise<ResultadoAccion> {
  return ejecutar(recibir, { id });
}
