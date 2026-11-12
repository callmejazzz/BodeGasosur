export type OpcionesDeTransaccion = { maxWait: number; timeout: number };

export const TX_CORTA: OpcionesDeTransaccion = { maxWait: 2_000, timeout: 5_000 };
export const TX_RESERVA: OpcionesDeTransaccion = { maxWait: 2_000, timeout: 15_000 };
export const ESPERA_DE_RESEND_MS = 30_000;
export const PLAZO_DE_CORRIDA_MS = 120_000;

const peor = (tx: OpcionesDeTransaccion) => tx.maxWait + tx.timeout;

// Lo más que puede tardar cada paso: esperar conexión, el tope de su transacción y, en un lote, la espera de Resend
export const COSTO_MS = {
  tanda: peor(TX_CORTA),
  reserva: peor(TX_RESERVA) + peor(TX_CORTA),
  lectura: peor(TX_CORTA),
  lote: peor(TX_CORTA) + ESPERA_DE_RESEND_MS + peor(TX_CORTA),
  final: peor(TX_CORTA) + 3_000,
};

export type Plazo = { restante(): number };

export function plazoDesde(totalMs = PLAZO_DE_CORRIDA_MS, reloj: () => number = () => performance.now()): Plazo {
  const fin = reloj() + totalMs;
  return { restante: () => fin - reloj() };
}
