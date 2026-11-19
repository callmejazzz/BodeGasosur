"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EstadoCuenta } from "@/lib/cuenta/formulario";
import { cambiarAlertasCorreo } from "@/lib/cuenta/repo";
import { accionProtegida, comprobarPermiso, mensajeDeNegativa } from "@/lib/db";
import { FALLO_DEL_SERVIDOR } from "@/lib/mensajes";

const esquema = z.object({ alertasCorreo: z.enum(["activar", "desactivar"]) });

const guardar = accionProtegida("cuenta:editar", (tx, usuario, activar: boolean) => cambiarAlertasCorreo(tx, usuario.id, activar));

function negativa(error: unknown): EstadoCuenta | null {
  const mensaje = mensajeDeNegativa(error, "No tienes permiso para cambiar tu cuenta.");
  return mensaje ? { mensaje, tono: "error" } : null;
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
    return { mensaje: FALLO_DEL_SERVIDOR, tono: "error" };
  }

  // El apartado vive en el modal de Clerk: refresca la promesa que manda el layout.
  revalidatePath("/", "layout");
  return { mensaje: activar ? "Alerta activada" : "Alerta desactivada", tono: "exito" };
}
