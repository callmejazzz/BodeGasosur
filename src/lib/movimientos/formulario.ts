import { z } from "zod";

// Piezas de formulario que comparten los movimientos. Sin nada de servidor:
// también las importan componentes de cliente.

/** Todo identificador y la llave de idempotencia son UUID canónicos (minúsculas); nada más entra al SQL. */
export const uuid = z
  .string()
  .trim()
  .uuid("Identificador inválido")
  .transform((id) => id.toLowerCase());

/** Un select obligatorio: vacío avisa que no se eligió; cualquier otra cosa tiene que ser UUID. */
const NADA = "No se seleccionó nada";
export const seleccion = z.string({ error: NADA }).trim().min(1, NADA).pipe(uuid);

/** Piezas o cajas enteras, escritas como dígitos: ni «1.5», ni «3.0», ni «1e3». */
export const enteroPositivo = z
  .string()
  .trim()
  .min(1, "Indica la cantidad")
  .regex(/^\d+$/, "Solo cantidades enteras, sin decimales")
  .transform(Number)
  .refine((n) => n > 0, "La cantidad debe ser mayor que cero")
  .refine((n) => n <= 1_000_000, "Cantidad demasiado grande");

export const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

/** `encabezado.campo` y `partidas.N.campo` del FormData a objeto; el resto se ignora. */
export function leerFormulario(formData: FormData): unknown {
  const encabezado: Record<string, string> = {};
  const partidas = new Map<number, Record<string, string>>();
  const CAMPO_PARTIDA = /^partidas\.(\d{1,3})\.([A-Za-z]+)$/;

  for (const [nombre, valor] of formData.entries()) {
    if (typeof valor !== "string") continue;
    const m = CAMPO_PARTIDA.exec(nombre);
    if (m) {
      const i = Number(m[1]);
      if (!partidas.has(i)) partidas.set(i, {});
      partidas.get(i)![m[2]] = valor;
    } else if (nombre.startsWith("encabezado.")) {
      encabezado[nombre.slice("encabezado.".length)] = valor;
    }
  }

  return {
    encabezado,
    partidas: [...partidas.entries()].sort(([a], [b]) => a - b).map(([, p]) => p),
  };
}

/** Errores por campo, con la ruta plana del formulario: `encabezado.fecha`, `partidas.2.cantidadCapturada`. */
export type ErroresFormulario = Record<string, string>;

/** Aplana los issues de Zod a `ruta.plana → primer mensaje`. */
export function erroresDe(error: z.ZodError): ErroresFormulario {
  const errores: ErroresFormulario = {};
  for (const issue of error.issues) {
    const ruta = issue.path.map(String).join(".") || "_";
    if (!errores[ruta]) errores[ruta] = issue.message;
  }
  return errores;
}
