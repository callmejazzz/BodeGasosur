import "server-only";
import { Resend } from "resend";
import { llaveDeResend } from "./configuracion";

export type CorreoDelLote = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  tags: { name: string; value: string }[];
};

export type TipoDeIncidente = "AUTENTICACION" | "REMITENTE" | "CUOTA" | "OPERATIVO";

export type RespuestaDeResend =
  | { tipo: "aceptado"; ids: string[] }
  | { tipo: "pasajero" | "cuerpo-distinto" | "rechazado"; codigo: string; motivo: string }
  | { tipo: "incidente"; incidente: TipoDeIncidente; codigo: string; motivo: string };

export type EnviadorDeLotes = (correos: CorreoDelLote[], opciones: { llave: string; signal: AbortSignal }) => Promise<RespuestaDeResend>;

type ErrorDeResend = { name?: string; statusCode?: number | null; message?: string };

// Descripciones propias: el mensaje de Resend nunca se guarda ni se registra, porque puede traer direcciones
const DESCRIPCION = {
  pasajero: "Resend no respondió o pidió reintentar",
  "cuerpo-distinto": "Resend ya tenía otro cuerpo con la misma llave",
  rechazado: "Resend rechazó los datos de la petición",
  AUTENTICACION: "Resend rechazó la llave de la API",
  REMITENTE: "Resend rechazó el remitente o su dominio",
  CUOTA: "Se agotó la cuota de envío de Resend",
  OPERATIVO: "Resend rechazó la petición por una causa ajena a los destinatarios",
} as const;

const AUTENTICACION = new Set(["missing_api_key", "restricted_api_key", "invalid_api_key"]);
const CUOTA = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);
const DATOS = new Set(["validation_error", "invalid_parameter", "missing_required_field", "invalid_idempotency_key", "invalid_attachment"]);
const NOMBRE = /^[a-z][a-z_]{0,39}$/;

const conMotivo = (clave: keyof typeof DESCRIPCION, codigo: string) => ({ codigo, motivo: `${DESCRIPCION[clave]} (${codigo})` });

/**
 * Solo un rechazo por los datos (400 o 422 de validación) deja FALLIDO a los
 * destinatarios. Llave, remitente, cuota o una causa desconocida son incidentes:
 * el lote sigue pendiente y se reintenta cuando se corrige.
 */
export function clasificarRespuesta(data: { data?: { id?: unknown }[] } | null, error: ErrorDeResend | null): RespuestaDeResend {
  if (!error) {
    const ids = data?.data?.map((d) => d.id);
    if (ids?.length && ids.every((id): id is string => typeof id === "string" && id !== "")) return { tipo: "aceptado", ids };
    return { tipo: "pasajero", ...conMotivo("pasajero", "200 sin_identificadores") };
  }
  const estado = typeof error.statusCode === "number" ? error.statusCode : null;
  const nombre = error.name && NOMBRE.test(error.name) ? error.name : "desconocido";
  const codigo = `${estado ?? "sin_estado"} ${nombre}`;
  const incidente = (tipo: TipoDeIncidente): RespuestaDeResend => ({ tipo: "incidente", incidente: tipo, ...conMotivo(tipo, codigo) });

  if (nombre === "invalid_idempotent_request") return { tipo: "cuerpo-distinto", ...conMotivo("cuerpo-distinto", codigo) };
  if (estado === null || estado >= 500 || nombre === "concurrent_idempotent_requests" || nombre === "rate_limit_exceeded") {
    return { tipo: "pasajero", ...conMotivo("pasajero", codigo) };
  }
  if (estado === 401 || AUTENTICACION.has(nombre)) return incidente("AUTENTICACION");
  if (estado === 403 || nombre === "invalid_from_address") return incidente("REMITENTE");
  if (CUOTA.has(nombre)) return incidente("CUOTA");
  if (estado === 429) return { tipo: "pasajero", ...conMotivo("pasajero", codigo) };
  if ((estado === 400 || estado === 422) && DATOS.has(nombre)) return { tipo: "rechazado", ...conMotivo("rechazado", codigo) };
  return incidente("OPERATIVO");
}

// Se crea al atender la petición: durante `next build` no hay llave
export function enviadorDeResend(entorno: Record<string, string | undefined> = process.env): EnviadorDeLotes {
  const resend = new Resend(llaveDeResend(entorno));
  return async (correos, { llave, signal }) => {
    const { data, error } = await resend.batch.send(correos, { idempotencyKey: llave, batchValidation: "strict", signal });
    return clasificarRespuesta(data, error);
  };
}
