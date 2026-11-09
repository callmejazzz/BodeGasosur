"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoCuenta } from "@/lib/cuenta/formulario";
import { cambiarAlertasCorreo } from "@/lib/cuenta/repo";
import { accionProtegida, comprobarPermiso, SinAcceso, SinPermiso } from "@/lib/db";

const esquema = z.object({ alertasCorreo: z.enum(["activar", "desactivar"]) });

const guardar = accionProtegida("cuenta:editar", (tx, usuario, activar: boolean) => cambiarAlertasCorreo(tx, usuario.id, activar));

function negativa(error: unknown): EstadoCuenta | null {
  if (error instanceof SinPermiso) return { mensaje: "No tienes permiso para cambiar tu cuenta", tono: "error" };
  if (error instanceof SinAcceso) return { mensaje: "No tienes acceso al sistema", tono: "error" };
  return null;
}

export async function guardarPreferencia(_estadoPrevio: EstadoCuenta, formData: FormData): Promise<EstadoCuenta> {
  try {
    await comprobarPermiso("cuenta:editar");
  } catch (error) {
    const r = negativa(error);
    if (r) return r;
    throw error;
  }

  const resultado = esquema.safeParse({ alertasCorreo: formData.get("alertasCorreo") });
  if (!resultado.success) return { mensaje: "Elige si activas o desactivas la alerta", tono: "error" };
  const activar = resultado.data.alertasCorreo === "activar";

  try {
    await guardar(activar);
  } catch (error) {
    const r = negativa(error);
    if (r) return r;
    console.error("Fallo al guardar la alerta por correo:", error);
    return { mensaje: "No se pudo guardar. Inténtalo de nuevo", tono: "error" };
  }

  // El apartado vive en el modal de Clerk: refresca la promesa que manda el layout.
  revalidatePath("/", "layout");
  return { mensaje: activar ? "Alerta activada" : "Alerta desactivada", tono: "exito" };
}
