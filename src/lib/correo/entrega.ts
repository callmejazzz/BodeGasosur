import type { ClaseRebote } from "@prisma/client";

export type EstadoDeEntrega = "MARCADO_COMO_SPAM" | "NO_ENTREGADO" | "ENTREGADO" | "ENTREGA_DEMORADA" | "ACEPTADO";

export type EventoDeEntrega = { tipo: string; rebote: ClaseRebote | null };

// Precedencia de §3.11, no orden de llegada: un rebote duro gana a «entregado» aunque llegue después
const PRECEDENCIA: EstadoDeEntrega[] = ["MARCADO_COMO_SPAM", "NO_ENTREGADO", "ENTREGADO", "ENTREGA_DEMORADA", "ACEPTADO"];

function estadoDeUnEvento({ tipo, rebote }: EventoDeEntrega): EstadoDeEntrega {
  if (tipo === "email.complained") return "MARCADO_COMO_SPAM";
  if (tipo === "email.failed" || tipo === "email.suppressed" || rebote === "PERMANENTE") return "NO_ENTREGADO";
  if (tipo === "email.delivered") return "ENTREGADO";
  if (tipo === "email.delivery_delayed" || rebote !== null) return "ENTREGA_DEMORADA";
  return "ACEPTADO";
}

/** Solo con eventos asociados al registro. */
export function estadoDeEntrega(eventos: EventoDeEntrega[]): EstadoDeEntrega {
  return eventos.map(estadoDeUnEvento).reduce((a, b) => (PRECEDENCIA.indexOf(a) <= PRECEDENCIA.indexOf(b) ? a : b), "ACEPTADO");
}

export const claseDeRebote = (tipo: unknown): ClaseRebote =>
  tipo === "Permanent" ? "PERMANENTE" : tipo === "Transient" || tipo === "Temporary" ? "TRANSITORIO" : "INDETERMINADO";
