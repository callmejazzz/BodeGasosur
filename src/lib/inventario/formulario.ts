import { z } from "zod";
import { enteroPositivo, erroresDe, leerFormulario, seleccion, textoOpcional, uuid, type ErroresFormulario } from "@/lib/movimientos/formulario";
import type { PartidaCapturada } from "./captura";
import type { DatosConteo } from "./conteos";
import type { DatosDevolucion } from "./devoluciones";
import type { DatosTraspaso } from "./traspasos";

// La forma de lo que llega del navegador para traspasos, devoluciones,
// conteos y reversas. Las reglas de negocio (catálogo activo, factor, saldo,
// existencia) se repiten en el servicio, bajo candado.

const uuidOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(uuid.nullable());

const motivo = (pregunta: string) => z.string().trim().min(1, pregunta).max(300, "Máximo 300 caracteres");

export const esquemaPartida = z.object({
  articuloId: seleccion,
  presentacion: z.enum(["UNIDAD", "CAJA"], { error: "Elige unidad o caja" }),
  cantidadCapturada: enteroPositivo,
  observaciones: textoOpcional(300),
});

/** Al menos una partida, a lo más 200, sin artículos repetidos. */
const partidas = z
  .array(esquemaPartida)
  .min(1, "Agrega al menos una partida")
  .max(200, "Demasiadas partidas en un solo movimiento")
  .superRefine((ps, ctx) => {
    const vistos = new Set<string>();
    ps.forEach((p, i) => {
      if (vistos.has(p.articuloId)) ctx.addIssue({ code: "custom", path: [i, "articuloId"], message: "Este artículo ya está en otra partida" });
      vistos.add(p.articuloId);
    });
  })
  .transform((ps): PartidaCapturada[] => ps);

export const esquemaTraspaso = z
  .object({
    encabezado: z.object({ bodegaOrigenId: seleccion, bodegaDestinoId: seleccion, observaciones: textoOpcional(500) }),
    partidas,
  })
  .superRefine((d, ctx) => {
    if (d.encabezado.bodegaOrigenId === d.encabezado.bodegaDestinoId) {
      ctx.addIssue({ code: "custom", path: ["encabezado", "bodegaDestinoId"], message: "Elige una bodega distinta a la de origen" });
    }
  })
  .transform((d): DatosTraspaso => d);

export const esquemaDevolucion = z
  .object({
    encabezado: z.object({ estacionId: seleccion, bodegaDestinoId: seleccion, salidaId: uuidOpcional, observaciones: textoOpcional(500) }),
    partidas,
  })
  .transform((d): DatosDevolucion => d);

/** Lo contado: vacío es «no contado»; si no, un entero de cero en adelante. */
const contada = z
  .string()
  .trim()
  .optional()
  .transform((v) => v ?? "")
  .refine((v) => v === "" || /^\d{1,9}$/.test(v), "Solo cantidades enteras de cero en adelante")
  .transform((v) => (v === "" ? null : Number(v)));

export const esquemaConteo = z
  .object({
    revision: z.coerce.number().int().positive(),
    renglones: z
      .array(z.object({ articuloId: seleccion, cantidadContada: contada, observaciones: textoOpcional(300) }))
      .max(2000, "Demasiados artículos en una sola hoja")
      .superRefine((rs, ctx) => {
        const vistos = new Set<string>();
        rs.forEach((r, i) => {
          if (vistos.has(r.articuloId)) ctx.addIssue({ code: "custom", path: [i, "articuloId"], message: "Este artículo ya está en la hoja" });
          vistos.add(r.articuloId);
        });
      }),
  })
  .transform((d): DatosConteo => d);

export const esquemaAltaTraspaso = z.object({ llaveIdempotencia: uuid, datos: esquemaTraspaso });
export const esquemaAltaDevolucion = z.object({ llaveIdempotencia: uuid, datos: esquemaDevolucion });
export const esquemaGuardadoTraspaso = z.object({ id: uuid, datos: esquemaTraspaso });
export const esquemaGuardadoDevolucion = z.object({ id: uuid, datos: esquemaDevolucion });
export const esquemaAltaConteo = z.object({
  llaveIdempotencia: uuid,
  datos: z.object({ bodegaId: seleccion, motivo: motivo("Di el motivo del conteo"), observaciones: textoOpcional(500) }),
});
export const esquemaGuardadoConteo = z.object({ id: uuid, datos: esquemaConteo });

export const esquemaId = z.object({ id: uuid });
export const esquemaRevision = z.object({ id: uuid, revision: z.number().int().positive() });
export const esquemaDescarte = z.object({ id: uuid, motivo: motivo("Di por qué se descarta") });
export const esquemaReversa = z.object({ id: uuid, motivo: motivo("Di por qué se revierte") });

// ─────────────────────────── Lectura del FormData ────────────────────────────

const texto = (formData: FormData, nombre: string) => {
  const v = formData.get(nombre);
  return typeof v === "string" ? v : "";
};

/** Alta: la llave generada al abrir el formulario más encabezado y partidas. */
export function leerAlta(formData: FormData): unknown {
  return { llaveIdempotencia: texto(formData, "llaveIdempotencia"), datos: leerFormulario(formData) };
}

/** Guardado de un borrador: el id va ligado a la acción, no en el formulario. */
export function leerGuardado([id, formData]: [string, FormData]): unknown {
  return { id, datos: leerFormulario(formData) };
}

/** Apertura de una hoja de conteo. */
export function leerAltaConteo(formData: FormData): unknown {
  return {
    llaveIdempotencia: texto(formData, "llaveIdempotencia"),
    datos: { bodegaId: texto(formData, "bodegaId"), motivo: texto(formData, "motivo"), observaciones: texto(formData, "observaciones") },
  };
}

/** Lo contado: los renglones viajan como partidas.N.* y la revisión aparte. */
export function leerGuardadoConteo([id, formData]: [string, FormData]): unknown {
  const { partidas: renglones } = leerFormulario(formData) as { partidas: unknown[] };
  return { id, datos: { revision: texto(formData, "revision"), renglones } };
}

// ───────────────────────────── Estado de pantalla ────────────────────────────

/** Lo que devuelve una acción de formulario (mismo patrón que entradas y salidas). */
export type EstadoFormulario = { errores: ErroresFormulario; mensaje: string | null; revision?: number };

export const ESTADO_INICIAL: EstadoFormulario = { errores: {}, mensaje: null };

/** Errores con la ruta del formulario (`encabezado.bodegaOrigenId`), sin el prefijo `datos.`. */
export function erroresDeFormulario(error: z.ZodError): ErroresFormulario {
  return Object.fromEntries(
    Object.entries(erroresDe(error)).map(([ruta, mensaje]) => [ruta.replace(/^datos\./, "").replace(/^renglones\./, "partidas."), mensaje]),
  );
}
