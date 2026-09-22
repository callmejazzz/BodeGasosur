import { z } from "zod";
import { FECHA_MINIMA_OPERATIVA, hoyEnMexico, motivoFechaNoOperativa } from "@/lib/fechas";
import type { DatosBorrador } from "./servicio";

// ─────────────────────────────── Piezas ──────────────────────────────────────

/** Todo identificador y la llave de idempotencia son UUID canónicos (minúsculas); nada más entra al SQL. */
export const uuid = z
  .string()
  .trim()
  .uuid("Identificador inválido")
  .transform((id) => id.toLowerCase());

/** Piezas o cajas enteras, escritas como dígitos: ni «1.5», ni «3.0», ni «1e3». */
const enteroPositivo = z
  .string()
  .trim()
  .regex(/^\d{1,7}$/, "Solo cantidades enteras, sin decimales")
  .transform(Number)
  .refine((n) => n > 0, "La cantidad debe ser mayor que cero")
  .refine((n) => n <= 1_000_000, "Cantidad demasiado grande");

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres`)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

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

// ───────────────────────────── Estado del formulario ─────────────────────────

/** Errores por campo, con la ruta plana del formulario: `encabezado.fecha`, `partidas.2.cantidadCapturada`. */
export type ErroresFormulario = Record<string, string>;

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

/** Aplana los issues de Zod a `ruta.plana → primer mensaje`. */
export function erroresDe(error: z.ZodError): ErroresFormulario {
  const errores: ErroresFormulario = {};
  for (const issue of error.issues) {
    const ruta = issue.path.map(String).join(".") || "_";
    if (!errores[ruta]) errores[ruta] = issue.message;
  }
  return errores;
}
