// Cómo se nombra cada estatus en pantalla y en Excel: las insignias y las
// descargas leen el mismo texto.

export const TEXTO_ESTATUS_ENTRADA: Record<string, string> = { BORRADOR: "Borrador", CONFIRMADO: "Confirmada", CANCELADO: "Descartada" };

export const TEXTO_ESTATUS_MOVIMIENTO: Record<string, string> = { BORRADOR: "Borrador", CONFIRMADO: "Confirmado", CANCELADO: "Descartado" };

export const TEXTO_ESTATUS_SALIDA: Record<string, string> = {
  SOLICITADA: "Solicitada",
  AUTORIZADA: "Autorizada",
  RECHAZADA: "Rechazada",
  RETIRADA: "Retirada",
  RECIBIDA: "Recibida",
  CANCELADO: "Cancelada",
};

export const TEXTO_DEVOLUCION = { completa: "Devuelto", parcial: "Devuelto parcial" } as const;
