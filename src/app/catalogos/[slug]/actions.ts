"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { campoSeCaptura, catalogoPorSlug, esquemaDe } from "@/lib/catalogos/definiciones";
import type { EstadoFormulario, ValoresFormulario } from "@/lib/catalogos/formulario";
import { REPOS } from "@/lib/catalogos/repos";

/** Traduce las violaciones de índice único a un mensaje que se entienda. */
function mensajeDeError(error: unknown, singular: string): string {
  if (error && typeof error === "object" && "code" in error) {
    const codigo = (error as { code?: string }).code;
    if (codigo === "P2002") {
      return `Ya existe ${singular === "área" ? "un" : "otro"} registro con ese valor único (clave, número, nombre o RFC repetido).`;
    }
    if (codigo === "P2003") {
      return "El registro hace referencia a un dato que ya no existe.";
    }
  }
  console.error(error);
  return "No se pudo guardar. Revisa los datos e inténtalo de nuevo.";
}

export async function guardarCatalogo(
  slug: string,
  id: string | null,
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const def = catalogoPorSlug(slug);
  const repo = REPOS[slug];
  if (!def || !repo) {
    return { errores: {}, mensaje: "Catálogo desconocido." };
  }

  const modo = id ? "edicion" : "alta";
  const crudo = Object.fromEntries(formData.entries());
  const resultado = esquemaDe(def, modo).safeParse(crudo);

  // Se conserva la captura para poder devolverla si algo falla. Los campos que
  // no se capturan —clave generada, clave de negocio ya dada de alta— no vienen
  // en el FormData y los repuebla la página desde la base.
  const enviados: ValoresFormulario = {};
  for (const campo of def.campos) {
    if (!campoSeCaptura(campo, modo)) continue;
    enviados[campo.nombre] =
      campo.tipo === "booleano" ? crudo[campo.nombre] === "on" : String(crudo[campo.nombre] ?? "");
  }

  if (!resultado.success) {
    const errores: Record<string, string> = {};
    for (const issue of resultado.error.issues) {
      const campo = String(issue.path[0] ?? "");
      if (campo && !errores[campo]) errores[campo] = issue.message;
    }
    return { errores, mensaje: "Revisa los campos marcados.", valores: enviados };
  }

  try {
    if (id) {
      await repo.actualizar(id, resultado.data);
    } else {
      await repo.crear(resultado.data);
    }
  } catch (error) {
    return { errores: {}, mensaje: mensajeDeError(error, def.singular), valores: enviados };
  }

  revalidatePath(`/catalogos/${slug}`);
  revalidatePath("/catalogos");
  revalidatePath("/");
  redirect(`/catalogos/${slug}`);
}
