"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ejecutar, enviarFormulario, protegida, type ResultadoAccion } from "@/lib/inventario/acciones";
import {
  erroresDeFormulario,
  esquemaAltaTraspaso,
  esquemaDescarte,
  esquemaGuardadoTraspaso,
  esquemaId,
  leerAlta,
  leerGuardado,
  type EstadoFormulario,
} from "@/lib/inventario/formulario";
import * as servicio from "@/lib/inventario/traspasos";

// Las cuatro acciones de traspasos. Cada una: sesión y permiso
// (accionProtegida) → lectura y forma de los datos (Zod) → servicio. El actor
// sale de la sesión; ningún id de usuario viaja en el formulario.

const NO_EXISTE = "El traspaso no existe.";

const crear = protegida("traspasos:capturar", esquemaAltaTraspaso, (tx, u, d) => servicio.crearTraspaso(tx, u, d.llaveIdempotencia, d.datos), {
  leer: leerAlta,
  errores: erroresDeFormulario,
});
const guardar = protegida("traspasos:capturar", esquemaGuardadoTraspaso, (tx, u, d) => servicio.guardarTraspaso(tx, u, d.id, d.datos), {
  leer: leerGuardado,
  errores: erroresDeFormulario,
});
const descartar = protegida("traspasos:capturar", esquemaDescarte, (tx, u, d) => servicio.descartarTraspaso(tx, u, d.id, d.motivo));
const confirmar = protegida("traspasos:confirmar", esquemaId, (tx, u, d) => servicio.confirmarTraspaso(tx, u, d.id));

function refrescar({ id }: { id: string }) {
  revalidatePath("/traspasos");
  revalidatePath(`/traspasos/${id}`);
  revalidatePath("/");
}

export async function crearTraspaso(_previo: EstadoFormulario, formData: FormData): Promise<EstadoFormulario> {
  const r = await enviarFormulario(() => crear(formData), NO_EXISTE);
  if (!r.ok) return r.estado;
  refrescar(r.resultado);
  redirect(`/traspasos/${r.resultado.id}`);
}

export async function guardarTraspaso(id: string, _previo: EstadoFormulario, formData: FormData): Promise<EstadoFormulario> {
  const r = await enviarFormulario(() => guardar([id, formData]), NO_EXISTE);
  if (!r.ok) return r.estado;
  refrescar(r.resultado);
  return { errores: {}, mensaje: null };
}

export async function descartarTraspaso(id: string, motivo: string): Promise<ResultadoAccion> {
  return ejecutar(() => descartar({ id, motivo }), NO_EXISTE, refrescar);
}

export async function confirmarTraspaso(id: string): Promise<ResultadoAccion> {
  return ejecutar(() => confirmar({ id }), NO_EXISTE, refrescar);
}
