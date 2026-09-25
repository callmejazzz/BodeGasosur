"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";
import { accionProtegida, SinAcceso, SinPermiso, type UsuarioSesion } from "@/lib/db";
import { ErrorDeDominio, traducida } from "@/lib/entradas/errores";
import {
  erroresDe,
  erroresDeAlta,
  esquemaAlta,
  esquemaDescarte,
  esquemaGuardado,
  esquemaId,
  leerAlta,
  leerGuardado,
  type ErroresFormulario,
  type EstadoEntrada,
} from "@/lib/entradas/formulario";
import * as servicio from "@/lib/entradas/servicio";
import type { Permiso } from "@/lib/permisos";

// Las cuatro acciones de entradas. Cada una: sesión y permiso
// (accionProtegida) → lectura y forma de los datos (Zod) → servicio. Sin
// sesión, la respuesta es la negativa de acceso antes de abrir el FormData. El usuario sale
// de la sesión; ningún id de usuario viaja en el formulario (11 §3, §11).

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

const crear = protegida("entradas:capturar", esquemaAlta, (tx, u, d) => servicio.crearBorrador(tx, u, d.llaveIdempotencia, d.borrador), {
  leer: leerAlta,
  errores: erroresDeAlta,
});
const guardar = protegida("entradas:capturar", esquemaGuardado, (tx, u, d) => servicio.guardarBorrador(tx, u, d.id, d.borrador).then(() => d), {
  leer: leerGuardado,
  errores: erroresDeAlta,
});
const descartar = protegida("entradas:capturar", esquemaDescarte, (tx, u, d) => servicio.descartarBorrador(tx, u, d.id, d.motivo).then(() => d));
const confirmar = protegida("entradas:confirmar", esquemaId, (tx, u, d) => servicio.confirmarEntrada(tx, u, d.id));

/** Resultado de una acción sin formulario (confirmar, descartar): la pantalla lo muestra tal cual. */
export type ResultadoAccion = { ok: true } | { ok: false; mensaje: string };

function mensajeSeguro(error: unknown): string {
  if (error instanceof SinAcceso || error instanceof SinPermiso) return "No tienes permiso para esta operación.";
  if (error instanceof DatosInvalidos) {
    return error.errores.id ? "La entrada no existe." : (Object.values(error.errores)[0] ?? "Datos inválidos.");
  }
  if (error instanceof ErrorDeDominio) return error.message;
  console.error("[entradas]", error);
  return "No se pudo completar la operación. Inténtalo de nuevo.";
}

/** Para los formularios: los campos inválidos van marcados; un id inválido es una entrada que no existe. */
function estadoDeError(error: unknown): EstadoEntrada {
  if (error instanceof DatosInvalidos && !error.errores.id) return { errores: error.errores, mensaje: "Revisa los campos marcados." };
  return { errores: {}, mensaje: mensajeSeguro(error) };
}

function refrescar(id: string) {
  revalidatePath("/entradas");
  revalidatePath("/");
  revalidatePath(`/entradas/${id}`);
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

export async function crearEntrada(_previo: EstadoEntrada, formData: FormData): Promise<EstadoEntrada> {
  let id: string;
  try {
    ({ id } = await crear(formData));
  } catch (error) {
    return estadoDeError(error);
  }
  refrescar(id);
  redirect(`/entradas/${id}`);
}

export async function guardarEntrada(id: string, _previo: EstadoEntrada, formData: FormData): Promise<EstadoEntrada> {
  let guardada: string;
  try {
    ({ id: guardada } = await guardar({ id, formData }));
  } catch (error) {
    return estadoDeError(error);
  }
  refrescar(guardada);
  return { errores: {}, mensaje: null };
}

export async function confirmarRecepcion(id: string): Promise<ResultadoAccion> {
  return ejecutar(confirmar, { id });
}

export async function descartarEntrada(id: string, motivo: string): Promise<ResultadoAccion> {
  return ejecutar(descartar, { id, motivo });
}
