"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutar, enviarFormulario, protegida, type ResultadoAccion } from "@/lib/inventario/acciones";
import * as servicio from "@/lib/inventario/conteos";
import {
  erroresDeFormulario,
  esquemaAltaConteo,
  esquemaDescarte,
  esquemaGuardadoConteo,
  esquemaRevision,
  leerAltaConteo,
  leerGuardadoConteo,
  type EstadoFormulario,
} from "@/lib/inventario/formulario";

// Las cinco acciones de la hoja de conteo: sesión y permiso → Zod → servicio.
// La revisión viaja para confirmar lo que la persona revisó, no como autoridad:
// la existencia esperada la lee siempre el servidor.

const NO_EXISTE = "La hoja de conteo no existe.";

const abrir = protegida("ajustes:capturar", esquemaAltaConteo, (tx, u, d) => servicio.abrirHoja(tx, u, d.llaveIdempotencia, d.datos), {
  leer: leerAltaConteo,
  errores: erroresDeFormulario,
});
const guardar = protegida("ajustes:capturar", esquemaGuardadoConteo, (tx, u, d) => servicio.guardarConteo(tx, u, d.id, d.datos), {
  leer: leerGuardadoConteo,
  errores: erroresDeFormulario,
});
const actualizar = protegida("ajustes:capturar", esquemaRevision, (tx, u, d) => servicio.actualizarHoja(tx, u, d.id, d.revision));
const descartar = protegida("ajustes:capturar", esquemaDescarte, (tx, u, d) => servicio.descartarHoja(tx, u, d.id, d.motivo));
const confirmar = protegida("ajustes:confirmar", esquemaRevision, (tx, u, d) => servicio.confirmarConteo(tx, u, d.id, d.revision));

function refrescar({ id }: { id: string }) {
  revalidatePath("/conteos");
  revalidatePath(`/conteos/${id}`);
  revalidatePath("/ajustes");
  revalidatePath("/");
}

export async function abrirHoja(_previo: EstadoFormulario, formData: FormData): Promise<EstadoFormulario> {
  const r = await enviarFormulario(() => abrir(formData), NO_EXISTE);
  if (!r.ok) return r.estado;
  refrescar(r.resultado);
  redirect(`/conteos/${r.resultado.id}`);
}

export async function guardarConteo(id: string, _previo: EstadoFormulario, formData: FormData): Promise<EstadoFormulario> {
  const r = await enviarFormulario(() => guardar([id, formData]), NO_EXISTE);
  if (!r.ok) return r.estado;
  refrescar(r.resultado);
  return { errores: {}, mensaje: null, revision: r.resultado.revision };
}

export async function actualizarHoja(id: string, revision: number): Promise<ResultadoAccion> {
  return ejecutar(() => actualizar({ id, revision }), NO_EXISTE, refrescar);
}

export async function descartarHoja(id: string, motivo: string): Promise<ResultadoAccion> {
  return ejecutar(() => descartar({ id, motivo }), NO_EXISTE, refrescar);
}

export async function confirmarConteo(id: string, revision: number): Promise<ResultadoAccion> {
  return ejecutar(() => confirmar({ id, revision }), NO_EXISTE, refrescar);
}
