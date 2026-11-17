import type { ClaseRebote, EstadoRegistroCorreo } from "@prisma/client";

export type EstadoDeEntrega = "MARCADO_COMO_SPAM" | "NO_ENTREGADO" | "ENTREGADO" | "ENTREGA_DEMORADA" | "ACEPTADO";

export type EventoDeEntrega = { tipo: string; rebote: ClaseRebote | null };

// Precedencia, no orden de llegada: un rebote duro gana a "entregado" aunque llegue después
const PRECEDENCIA: EstadoDeEntrega[] = ["MARCADO_COMO_SPAM", "NO_ENTREGADO", "ENTREGADO", "ENTREGA_DEMORADA", "ACEPTADO"];

function estadoDeUnEvento({ tipo, rebote }: EventoDeEntrega): EstadoDeEntrega {
  if (tipo === "email.complained") return "MARCADO_COMO_SPAM";
  if (tipo === "email.failed" || tipo === "email.suppressed" || rebote === "PERMANENTE") return "NO_ENTREGADO";
  if (tipo === "email.delivered") return "ENTREGADO";
  if (tipo === "email.delivery_delayed" || rebote !== null) return "ENTREGA_DEMORADA";
  return "ACEPTADO";
}

export function estadoDeEntrega(eventos: EventoDeEntrega[]): EstadoDeEntrega {
  return eventos.map(estadoDeUnEvento).reduce((a, b) => (PRECEDENCIA.indexOf(a) <= PRECEDENCIA.indexOf(b) ? a : b), "ACEPTADO");
}

export type EstadoDelAviso = EstadoDeEntrega | "EN_PROCESO" | "NO_SE_ENVIO" | "SIN_CONFIRMAR";

const SIN_EVENTOS: Record<EstadoRegistroCorreo, EstadoDelAviso> = {
  PENDIENTE: "EN_PROCESO",
  ENVIADO: "ACEPTADO",
  FALLIDO: "NO_SE_ENVIO",
  SIN_CONFIRMAR: "SIN_CONFIRMAR",
};

export function estadoDelAviso(registro: EstadoRegistroCorreo, eventos: EventoDeEntrega[]): EstadoDelAviso {
  return eventos.length > 0 ? estadoDeEntrega(eventos) : SIN_EVENTOS[registro];
}

export const claseDeRebote = (tipo: unknown): ClaseRebote =>
  tipo === "Permanent" ? "PERMANENTE" : tipo === "Transient" || tipo === "Temporary" ? "TRANSITORIO" : "INDETERMINADO";
