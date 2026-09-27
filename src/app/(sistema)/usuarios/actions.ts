"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { accionProtegida, comprobarPermiso, SinAcceso, SinPermiso } from "@/lib/db";
import { obtenerIdentidad } from "@/lib/usuarios/clerk";
import type { EstadoAcceso } from "@/lib/usuarios/formulario";
import {
  bloquearSuperadmins,
  buscarPorClerkId,
  contarSuperadminsActivos,
  guardarAcceso as escribirEnBase,
} from "@/lib/usuarios/repo";

/** Una regla del sistema que la persona puede corregir; no es un fallo. */
class ReglaDeAcceso extends Error {}

/**
 * Una casilla sin marcar no viaja en el FormData.
 *
 * El `.optional()` no sobra aunque la unión acepte `undefined`: en Zod 4 el
 * `.transform()` envuelve el esquema en un pipe y la llave pasa a ser
 * obligatoria. Es el mismo defecto que impedía desactivar catálogos.
 */
const casilla = () =>
  z
    .union([z.literal("on"), z.literal("true"), z.undefined(), z.null()])
    .optional()
    .transform((v) => v === "on" || v === "true");

const esquema = z.object({
  clerkUserId: z.string().trim().min(1),
  rol: z.enum(["SUPERADMIN", "COMPRAS", "JEFE"]),
  puedeAutorizar: casilla(),
  activo: casilla(),
});

/**
 * Conceder acceso y actualizarlo son la misma operación.
 *
 * Es un `upsert` a propósito: la diferencia entre las dos es solo si ya existía
 * la fila, y tenerlas separadas duplicaría las guardas —que es justo lo que no
 * puede desincronizarse—.
 */
const guardar = accionProtegida(
  "usuarios:administrar",
  async (tx, actor, datos: z.infer<typeof esquema>, correoDeClerk: string | null) => {
    // Serializa contra otra degradación simultánea antes de leer nada.
    await bloquearSuperadmins(tx);

    const existente = await buscarPorClerkId(tx, datos.clerkUserId);

    // Nadie se degrada ni se desactiva a sí mismo: es la forma más fácil de
    // quedarse fuera del sistema sin querer, y la que nadie prueba.
    if (existente && existente.id === actor.id) {
      if (datos.rol !== existente.rol) {
        throw new ReglaDeAcceso("No puedes cambiarte de rol tú mismo.");
      }
      if (!datos.activo) {
        throw new ReglaDeAcceso("No puedes desactivar tu propia cuenta.");
      }
    }

    // El correo sale de Clerk. Si Clerk ya no conoce la identidad —dada de baja
    // allá, con su fila conservada aquí— se respeta el que ya estaba.
    const correo = correoDeClerk ?? existente?.correo;
    if (!correo) {
      throw new ReglaDeAcceso(
        "Clerk no reconoce esa identidad. No se puede conceder acceso a alguien que no existe en la base de Clerk.",
      );
    }

    await escribirEnBase(tx, { ...datos, correo });

    // La comprobación va DESPUÉS de escribir y dentro de la misma transacción:
    // así mide el estado resultante, y lanzar aquí revierte el cambio entero.
    if ((await contarSuperadminsActivos(tx)) === 0) {
      throw new ReglaDeAcceso(
        "Imposible quedar sin ningún Superadmin activo. Nombra otro antes de este cambio.",
      );
    }
  },
);

function negativa(error: unknown): EstadoAcceso | null {
  if (error instanceof SinPermiso) return { mensaje: "No tienes permiso para administrar usuarios.", tono: "error" };
  if (error instanceof SinAcceso) return { mensaje: "No tienes acceso al sistema.", tono: "error" };
  return null;
}

export async function guardarAcceso(
  _estadoPrevio: EstadoAcceso,
  formData: FormData,
): Promise<EstadoAcceso> {
  // Sesión y permiso antes de leer el formulario y de preguntarle nada a Clerk.
  try {
    await comprobarPermiso("usuarios:administrar");
  } catch (error) {
    const r = negativa(error);
    if (r) return r;
    throw error;
  }

  const resultado = esquema.safeParse(Object.fromEntries(formData.entries()));
  if (!resultado.success) {
    return { mensaje: "Revisa el rol seleccionado.", tono: "error" };
  }

  // Fuera de toda transacción: es una petición HTTP a Clerk.
  const identidad = await obtenerIdentidad(resultado.data.clerkUserId);

  try {
    await guardar(resultado.data, identidad?.correo ?? null);
  } catch (error) {
    if (error instanceof ReglaDeAcceso) {
      return { mensaje: error.message, tono: "error" };
    }
    const r = negativa(error);
    if (r) return r;
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return {
        mensaje:
          "Ya hay otra cuenta activa con ese correo. Desactívala antes de conceder este acceso.",
        tono: "error",
      };
    }
    console.error("Fallo al guardar el acceso:", error);
    return { mensaje: "No se pudo guardar. Inténtalo de nuevo.", tono: "error" };
  }

  revalidatePath("/usuarios");
  return { mensaje: "Acceso guardado.", tono: "exito" };
}
