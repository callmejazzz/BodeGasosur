"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutar, enviarFormulario, protegida, type ResultadoAccion } from "@/lib/inventario/acciones";
import * as servicio from "@/lib/inventario/devoluciones";
import {
  erroresDeFormulario,
  esquemaAltaDevolucion,
  esquemaDescarte,
  esquemaGuardadoDevolucion,
  esquemaId,
  leerAlta,
  leerGuardado,
  type EstadoFormulario,
} from "@/lib/inventario/formulario";

// Las cuatro acciones de devoluciones: sesión y permiso → Zod → servicio.

const NO_EXISTE = "La devolución no existe.";

const crear = protegida("devoluciones:capturar", esquemaAltaDevolucion, (tx, u, d) => servicio.crearDevolucion(tx, u, d.llaveIdempotencia, d.datos), {
  leer: leerAlta,
  errores: erroresDeFormulario,
});
const guardar = protegida("devoluciones:capturar", esquemaGuardadoDevolucion, (tx, u, d) => servicio.guardarDevolucion(tx, u, d.id, d.datos), {
  leer: leerGuardado,
  errores: erroresDeFormulario,
});
const descartar = protegida("devoluciones:capturar", esquemaDescarte, (tx, u, d) => servicio.descartarDevolucion(tx, u, d.id, d.motivo));
const confirmar = protegida("devoluciones:confirmar", esquemaId, (tx, u, d) => servicio.confirmarDevolucion(tx, u, d.id));

function refrescar({ id }: { id: string }) {
  revalidatePath("/devoluciones");
  revalidatePath(`/devoluciones/${id}`);
  revalidatePath("/prestamos");
  revalidatePath("/salidas", "layout");
  revalidatePath("/");
}

export async function crearDevolucion(_previo: EstadoFormulario, formData: FormData): Promise<EstadoFormulario> {
  const r = await enviarFormulario(() => crear(formData), NO_EXISTE);
  if (!r.ok) return r.estado;
  refrescar(r.resultado);
  redirect(`/devoluciones/${r.resultado.id}`);
}

export async function guardarDevolucion(id: string, _previo: EstadoFormulario, formData: FormData): Promise<EstadoFormulario> {
  const r = await enviarFormulario(() => guardar([id, formData]), NO_EXISTE);
  if (!r.ok) return r.estado;
  refrescar(r.resultado);
  return { errores: {}, mensaje: null };
}

export async function descartarDevolucion(id: string, motivo: string): Promise<ResultadoAccion> {
  return ejecutar(() => descartar({ id, motivo }), NO_EXISTE, refrescar);
}

export async function confirmarDevolucion(id: string): Promise<ResultadoAccion> {
  return ejecutar(() => confirmar({ id }), NO_EXISTE, refrescar);
}
