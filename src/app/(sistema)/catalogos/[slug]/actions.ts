"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  campoSeCaptura,
  catalogoPorSlug,
  esquemaDe,
  type CatalogoDef,
} from "@/lib/catalogos/definiciones";
import type { EstadoFormulario, ValoresFormulario } from "@/lib/catalogos/formulario";
import { REPOS } from "@/lib/catalogos/repos";
import type { Prisma } from "@prisma/client";
import { accionProtegida, SinAcceso, SinPermiso, type UsuarioSesion } from "@/lib/db";

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

/** Un slug que ninguna definición reconoce. */
class CatalogoDesconocido extends Error {}

/** Datos con otra forma, ya con la sesión y el permiso comprobados. */
class DatosInvalidos extends Error {
  constructor(readonly errores: Record<string, string>) {
    super("Datos inválidos.");
  }
}

/**
 * El único camino por el que se escribe un catálogo.
 *
 * El permiso no es fijo: sale de la definición, porque escribir `Empresa`
 * exige `catalogos:globales:escribir` y escribir `Bodega` no (01 §3.3). Si el
 * slug no existe se pide el permiso más estricto, para que un slug desconocido
 * jamás cuele por la puerta más ancha. El FormData se lee y se valida dentro
 * de la puerta: sin sesión ni permiso no se abre.
 */
const escribirCatalogo = accionProtegida(
  ([slug]) => catalogoPorSlug(slug)?.permisoEscritura ?? "catalogos:globales:escribir",
  async (tx: Prisma.TransactionClient, _usuario: UsuarioSesion, slug: string, id: string | null, formData: FormData) => {
    const def = catalogoPorSlug(slug);
    const repo = REPOS[slug];
    if (!def || !repo) throw new CatalogoDesconocido();
    const resultado = esquemaDe(def, id ? "edicion" : "alta").safeParse(Object.fromEntries(formData.entries()));
    if (!resultado.success) {
      const errores: Record<string, string> = {};
      for (const issue of resultado.error.issues) {
        const campo = String(issue.path[0] ?? "");
        if (campo && !errores[campo]) errores[campo] = issue.message;
      }
      throw new DatosInvalidos(errores);
    }
    if (id) {
      await repo.actualizar(tx, id, resultado.data);
    } else {
      await repo.crear(tx, resultado.data);
    }
  },
);

/**
 * Lo capturado, para devolverlo si algo falla. Los campos que no se capturan
 * —clave generada, clave de negocio ya dada de alta— no vienen en el FormData
 * y los repuebla la página desde la base.
 */
function valoresEnviados(def: CatalogoDef, id: string | null, formData: FormData): ValoresFormulario {
  const modo = id ? "edicion" : "alta";
  const crudo = Object.fromEntries(formData.entries());
  const enviados: ValoresFormulario = {};
  for (const campo of def.campos) {
    if (!campoSeCaptura(campo, modo)) continue;
    enviados[campo.nombre] =
      campo.tipo === "booleano" ? crudo[campo.nombre] === "on" : String(crudo[campo.nombre] ?? "");
  }
  return enviados;
}

export async function guardarCatalogo(
  slug: string,
  id: string | null,
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  try {
    await escribirCatalogo(slug, id, formData);
  } catch (error) {
    const def = catalogoPorSlug(slug);
    if (error instanceof SinAcceso || error instanceof SinPermiso) {
      return { errores: {}, mensaje: def ? `No tienes permiso para modificar ${def.titulo.toLowerCase()}.` : "No tienes permiso para esta operación." };
    }
    if (!def || error instanceof CatalogoDesconocido) return { errores: {}, mensaje: "Catálogo desconocido." };
    // Aquí la sesión y el permiso ya se comprobaron: se puede leer lo capturado.
    const valores = valoresEnviados(def, id, formData);
    if (error instanceof DatosInvalidos) return { errores: error.errores, mensaje: "Revisa los campos marcados.", valores };
    return { errores: {}, mensaje: mensajeDeError(error, def.singular), valores };
  }

  revalidatePath(`/catalogos/${slug}`);
  revalidatePath("/catalogos");
  revalidatePath("/");
  redirect(`/catalogos/${slug}`);
}
