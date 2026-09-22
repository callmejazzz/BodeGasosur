"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accionProtegida, SinAcceso, SinPermiso } from "@/lib/db";
import { ErrorDeDominio } from "@/lib/entradas/errores";
import {
  erroresDe,
  esquemaAlta,
  esquemaBorrador,
  esquemaDescarte,
  leerAlta,
  leerFormulario,
  uuid,
  type EstadoEntrada,
} from "@/lib/entradas/formulario";
import { confirmarEntrada, crearBorrador, descartarBorrador, guardarBorrador } from "@/lib/entradas/servicio";

// Las cuatro acciones de entradas. Cada una: Zod → puerta (accionProtegida)
// → servicio. El usuario sale de la sesión; ningún id de usuario viaja en el
// formulario (11 §3, §11).

const crear = accionProtegida("entradas:capturar", crearBorrador);
const guardar = accionProtegida("entradas:capturar", guardarBorrador);
const descartar = accionProtegida("entradas:capturar", descartarBorrador);
const confirmar = accionProtegida("entradas:confirmar", confirmarEntrada);

/** Resultado de una acción sin formulario (confirmar, descartar): la pantalla lo muestra tal cual. */
export type ResultadoAccion = { ok: true } | { ok: false; mensaje: string };

function mensajeSeguro(error: unknown): string {
  if (error instanceof SinAcceso || error instanceof SinPermiso) return "No tienes permiso para esta operación.";
  if (error instanceof ErrorDeDominio) return error.message;
  console.error("[entradas]", error);
  return "No se pudo completar la operación. Inténtalo de nuevo.";
}

function refrescar(id?: string) {
  revalidatePath("/entradas");
  revalidatePath("/");
  if (id) revalidatePath(`/entradas/${id}`);
}

export async function crearEntrada(_previo: EstadoEntrada, formData: FormData): Promise<EstadoEntrada> {
  const r = esquemaAlta.safeParse(leerAlta(formData));
  if (!r.success) return { errores: erroresDe(r.error), mensaje: "Revisa los campos marcados." };

  let id: string;
  try {
    ({ id } = await crear(r.data.llaveIdempotencia, r.data.borrador));
  } catch (error) {
    return { errores: {}, mensaje: mensajeSeguro(error) };
  }
  refrescar(id);
  redirect(`/entradas/${id}`);
}

export async function guardarEntrada(id: string, _previo: EstadoEntrada, formData: FormData): Promise<EstadoEntrada> {
  const idValido = uuid.safeParse(id);
  const r = esquemaBorrador.safeParse(leerFormulario(formData));
  if (!idValido.success) return { errores: {}, mensaje: "La entrada no existe." };
  if (!r.success) return { errores: erroresDe(r.error), mensaje: "Revisa los campos marcados." };

  try {
    await guardar(idValido.data, r.data);
  } catch (error) {
    return { errores: {}, mensaje: mensajeSeguro(error) };
  }
  refrescar(idValido.data);
  return { errores: {}, mensaje: null };
}

export async function confirmarRecepcion(id: string): Promise<ResultadoAccion> {
  const idValido = uuid.safeParse(id);
  if (!idValido.success) return { ok: false, mensaje: "La entrada no existe." };
  try {
    await confirmar(idValido.data);
  } catch (error) {
    return { ok: false, mensaje: mensajeSeguro(error) };
  }
  refrescar(idValido.data);
  return { ok: true };
}

export async function descartarEntrada(id: string, motivo: string): Promise<ResultadoAccion> {
  const r = esquemaDescarte.safeParse({ id, motivo });
  if (!r.success) return { ok: false, mensaje: Object.values(erroresDe(r.error))[0] ?? "Datos inválidos." };
  try {
    await descartar(r.data.id, r.data.motivo);
  } catch (error) {
    return { ok: false, mensaje: mensajeSeguro(error) };
  }
  refrescar(r.data.id);
  return { ok: true };
}
