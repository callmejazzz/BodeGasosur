-- Decisión de Compras (2026-09-23): ENTREGADA cierra la salida.
-- RECIBIDA permanece en el enum histórico, pero no es un estado operable
-- de SALIDA en la fase 6. Este CHECK también frena escrituras SQL directas.
ALTER TABLE "Movimiento" ADD CONSTRAINT "salida_entregada_final_ck" CHECK (
  tipo <> 'SALIDA' OR estatus <> 'RECIBIDA'
);
