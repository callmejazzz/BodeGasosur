import { z } from "zod";
import { FECHA_MINIMA_OPERATIVA, hoyEnMexico, motivoFechaNoOperativa } from "@/lib/fechas";
import {
  enteroPositivo,
  erroresDe,
  leerFormulario,
  textoOpcional,
  uuid,
  type ErroresFormulario,
} from "@/lib/movimientos/formulario";
import type { DatosBorrador } from "./servicio";

export { erroresDe, leerFormulario, uuid, type ErroresFormulario } from "@/lib/movimientos/formulario";

// ─────────────────────────────── Piezas ──────────────────────────────────────

/** Decimal capturado como texto: se conserva tal cual para que numeric lo lea sin pasar por float. */
const decimal = (enteros: number, decimales: number, mensaje: string) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{1,${enteros}}(\\.\\d{1,${decimales}})?$`), mensaje);

export const fechaOperativa = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    const motivo = motivoFechaNoOperativa(v, hoyEnMexico());
    if (motivo === null) return;
    ctx.addIssue({
      code: "custom",
      message:
        motivo === "invalida"
          ? "Escribe una fecha válida (AAAA-MM-DD)"
          : motivo === "futura"
            ? "La fecha no puede ser posterior a hoy"
            : `La fecha no puede ser anterior al ${FECHA_MINIMA_OPERATIVA}`,
    });
  });

export const esquemaPartida = z.object({
  articuloId: uuid,
  presentacion: z.enum(["UNIDAD", "CAJA"], { error: "Elige unidad o caja" }),
  cantidadCapturada: enteroPositivo,
  costoUnitarioCapturado: decimal(10, 4, "Costo inválido: hasta cuatro decimales, sin signo"),
  tasaIva: z.enum(["0", "0.08", "0.16"], { error: "Elige la tasa de IVA" }),
  numeroSerie: textoOpcional(80),
  observaciones: textoOpcional(300),
});

export const esquemaEncabezado = z.object({
  proveedorId: uuid,
  bodegaDestinoId: uuid,
  fecha: fechaOperativa,
  moneda: z.enum(["MXN", "USD"], { error: "Elige la moneda" }),
  tipoCambio: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  referencia: textoOpcional(60),
  observaciones: textoOpcional(500),
});

export const esquemaBorrador = z
  .object({
    encabezado: esquemaEncabezado,
    partidas: z.array(esquemaPartida).max(200, "Demasiadas partidas en una sola entrada"),
  })
  .superRefine((d, ctx) => {
    if (d.encabezado.moneda === "USD") {
      const tc = d.encabezado.tipoCambio ?? "";
      if (!/^\d{1,8}(\.\d{1,6})?$/.test(tc) || Number(tc) <= 0) {
        ctx.addIssue({
          code: "custom",
          path: ["encabezado", "tipoCambio"],
          message: "En dólares el tipo de cambio es obligatorio (pesos por dólar, hasta seis decimales)",
        });
      }
    }
    const vistos = new Set<string>();
    d.partidas.forEach((p, i) => {
      if (vistos.has(p.articuloId)) {
        ctx.addIssue({ code: "custom", path: ["partidas", i, "articuloId"], message: "Este artículo ya está en otra partida" });
      }
      vistos.add(p.articuloId);
    });
  })
  .transform((d): DatosBorrador => ({
    encabezado: { ...d.encabezado, tipoCambio: d.encabezado.moneda === "USD" ? d.encabezado.tipoCambio : null },
    partidas: d.partidas,
  }));

/** Lo que viaja en el alta: la llave generada al abrir el formulario más el borrador. */
export const esquemaAlta = z.object({ llaveIdempotencia: uuid, borrador: esquemaBorrador });

/** El guardado de un borrador existente: su id más lo capturado. */
export const esquemaGuardado = z.object({ id: uuid, borrador: esquemaBorrador });

export const esquemaId = z.object({ id: uuid });

export const esquemaDescarte = z.object({
  id: uuid,
  motivo: z.string().trim().min(1, "Di por qué se descarta").max(300, "Máximo 300 caracteres"),
});

// ────────────────────────── Del FormData al objeto ───────────────────────────

/** El alta completa: la llave oculta del formulario más el borrador, en la forma de `esquemaAlta`. */
export function leerAlta(formData: FormData): unknown {
  const llave = formData.get("llaveIdempotencia");
  return { llaveIdempotencia: typeof llave === "string" ? llave : "", borrador: leerFormulario(formData) };
}

/** El guardado: el id de la ruta más el borrador, en la forma de `esquemaGuardado`. */
export function leerGuardado({ id, formData }: { id: string; formData: FormData }): unknown {
  return { id, borrador: leerFormulario(formData) };
}

/** Errores del alta o del guardado con la ruta del formulario (`encabezado.fecha`), sin el prefijo `borrador.`. */
export function erroresDeAlta(error: z.ZodError): ErroresFormulario {
  return Object.fromEntries(Object.entries(erroresDe(error)).map(([ruta, mensaje]) => [ruta.replace(/^borrador\./, ""), mensaje]));
}

// ───────────────────────────── Estado del formulario ─────────────────────────

export type ValoresPartida = {
  articuloId: string;
  presentacion: "UNIDAD" | "CAJA";
  cantidadCapturada: string;
  costoUnitarioCapturado: string;
  tasaIva: string;
  numeroSerie: string;
  observaciones: string;
};

export type ValoresEncabezado = {
  proveedorId: string;
  bodegaDestinoId: string;
  fecha: string;
  moneda: "MXN" | "USD";
  tipoCambio: string;
  referencia: string;
  observaciones: string;
};

/** Lo que el formulario muestra y devuelve: texto plano, tal como se capturó. */
export type ValoresEntrada = { encabezado: ValoresEncabezado; partidas: ValoresPartida[] };

/** Estado que la Server Action devuelve al formulario (mismo patrón que catálogos). */
export type EstadoEntrada = { errores: ErroresFormulario; mensaje: string | null };

export const ESTADO_INICIAL: EstadoEntrada = { errores: {}, mensaje: null };

export const PARTIDA_VACIA: ValoresPartida = {
  articuloId: "",
  presentacion: "UNIDAD",
  cantidadCapturada: "",
  costoUnitarioCapturado: "",
  tasaIva: "0.16",
  numeroSerie: "",
  observaciones: "",
};

export function valoresIniciales(hoy = hoyEnMexico()): ValoresEntrada {
  return {
    encabezado: { proveedorId: "", bodegaDestinoId: "", fecha: hoy, moneda: "MXN", tipoCambio: "", referencia: "", observaciones: "" },
    partidas: [{ ...PARTIDA_VACIA }],
  };
}
