import { z } from "zod";
import { enteroPositivo, erroresDe, leerFormulario, textoOpcional, uuid, type ErroresFormulario } from "@/lib/movimientos/formulario";
import type { DatosSolicitud } from "./servicio";

// La forma de lo que llega del navegador. Las reglas de negocio (catálogo
// activo, factor, unidad base) se repiten en el servicio.

/** Un select vacío llega como "": se vuelve nulo; lo demás tiene que ser UUID. */
const uuidOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(uuid.nullable());

/** Casilla de verificación: presente ("on") o ausente. */
const casilla = z
  .union([z.boolean(), z.enum(["on", "true", "false", ""])])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

const motivo = (pregunta: string) => z.string().trim().min(1, pregunta).max(300, "Máximo 300 caracteres");

export const esquemaPartida = z.object({
  articuloId: uuid,
  presentacion: z.enum(["UNIDAD", "CAJA"], { error: "Elige unidad o caja" }),
  cantidadCapturada: enteroPositivo,
  observaciones: textoOpcional(300),
});

export const esquemaEncabezado = z.object({
  bodegaOrigenId: uuid,
  estacionId: uuid,
  solicitadoPorId: uuidOpcional,
  areaId: uuidOpcional,
  esPrestamo: casilla,
  observaciones: textoOpcional(500),
});

export const esquemaSolicitud = z
  .object({
    encabezado: esquemaEncabezado,
    partidas: z
      .array(esquemaPartida)
      .min(1, "Agrega al menos una partida")
      .max(200, "Demasiadas partidas en una sola salida"),
  })
  .superRefine((d, ctx) => {
    const vistos = new Set<string>();
    d.partidas.forEach((p, i) => {
      if (vistos.has(p.articuloId)) {
        ctx.addIssue({ code: "custom", path: ["partidas", i, "articuloId"], message: "Este artículo ya está en otra partida" });
      }
      vistos.add(p.articuloId);
    });
  })
  .transform((d): DatosSolicitud => d);

/** Lo que viaja en el alta: la llave generada al abrir el formulario más la solicitud. */
export const esquemaAlta = z.object({ llaveIdempotencia: uuid, solicitud: esquemaSolicitud });

export const esquemaRechazo = z.object({ id: uuid, motivo: motivo("Di por qué se rechaza") });
export const esquemaCancelacion = z.object({ id: uuid, motivo: motivo("Di por qué se cancela") });
export const esquemaRetiro = z.object({
  id: uuid,
  entregadoA: z.string().trim().min(1, "Di quién se lleva el material").max(120, "Máximo 120 caracteres"),
});

/** El alta completa desde el FormData, en la forma de `esquemaAlta`. */
export function leerAlta(formData: FormData): unknown {
  const llave = formData.get("llaveIdempotencia");
  return { llaveIdempotencia: typeof llave === "string" ? llave : "", solicitud: leerFormulario(formData) };
}

/** Estado que la Server Action de alta devuelve al formulario (mismo patrón que entradas). */
export type EstadoSalida = { errores: ErroresFormulario; mensaje: string | null };

export const ESTADO_INICIAL: EstadoSalida = { errores: {}, mensaje: null };

/** Errores del alta con la ruta del formulario (`encabezado.estacionId`), sin el prefijo `solicitud.`. */
export function erroresDeAlta(error: z.ZodError): ErroresFormulario {
  return Object.fromEntries(Object.entries(erroresDe(error)).map(([ruta, mensaje]) => [ruta.replace(/^solicitud\./, ""), mensaje]));
}

export const esquemaId = z.object({ id: uuid });
