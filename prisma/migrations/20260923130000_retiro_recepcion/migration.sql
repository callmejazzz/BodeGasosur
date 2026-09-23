-- Cambio de nombre operativo: la salida física es RETIRADA y la recepción
-- confirmada por la estación es RECIBIDA. Conserva los valores ya guardados.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'EstatusMovimiento'
      AND e.enumlabel = 'ENTREGADA'
  ) THEN
    ALTER TYPE public."EstatusMovimiento" RENAME VALUE 'ENTREGADA' TO 'RETIRADA';
  END IF;
END;
$$;

-- Revierte la restricción transitoria que cerraba la salida al retirarla.
ALTER TABLE "Movimiento" DROP CONSTRAINT IF EXISTS "salida_entregada_final_ck";

-- La función de transición se redefine abajo con el nuevo valor del enum.

CREATE OR REPLACE FUNCTION verificar_transicion_salida() RETURNS trigger AS $$
DECLARE
  v_permitida boolean;
  v_excluidas text[] := ARRAY['updatedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.tipo = 'SALIDA' THEN
      RAISE EXCEPTION 'Una salida no se borra; se cancela antes de entregar.' USING ERRCODE = 'BG601';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.tipo <> 'SALIDA' THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estatus <> 'SOLICITADA' THEN
      RAISE EXCEPTION 'Una salida nace solicitada.' USING ERRCODE = 'BG601';
    END IF;
    RETURN NEW;
  END IF;

  v_permitida :=
    (OLD.estatus = 'SOLICITADA' AND NEW.estatus IN ('AUTORIZADA','RECHAZADA','CANCELADO')) OR
    (OLD.estatus = 'AUTORIZADA' AND NEW.estatus IN ('RETIRADA','CANCELADO')) OR
    (OLD.estatus = 'RETIRADA' AND NEW.estatus = 'RECIBIDA');

  IF OLD.estatus <> NEW.estatus AND NOT v_permitida THEN
    RAISE EXCEPTION 'Transición de salida no permitida: % a %.', OLD.estatus, NEW.estatus
      USING ERRCODE = 'BG601';
  END IF;

  -- Cada transición puede escribir solo sus datos propios. La solicitud aprobada
  -- nunca cambia bodega, estación, partidas o cantidades bajo la misma autorización.
  IF OLD.estatus = 'SOLICITADA' AND NEW.estatus = 'AUTORIZADA' THEN
    v_excluidas := v_excluidas || ARRAY['estatus','autorizadoPorId','autorizadoEn'];
  ELSIF OLD.estatus = 'SOLICITADA' AND NEW.estatus = 'RECHAZADA' THEN
    v_excluidas := v_excluidas || ARRAY['estatus','rechazadoPorId','rechazadoEn','motivoRechazo'];
  ELSIF OLD.estatus IN ('SOLICITADA','AUTORIZADA') AND NEW.estatus = 'CANCELADO' THEN
    v_excluidas := v_excluidas || ARRAY['estatus','canceladoPorId','canceladoEn','motivoCancelacion'];
  ELSIF OLD.estatus = 'AUTORIZADA' AND NEW.estatus = 'RETIRADA' THEN
    v_excluidas := v_excluidas || ARRAY['estatus','fecha','entregadoA','entregadoPorId','entregadoEn','folio'];
  ELSIF OLD.estatus = 'RETIRADA' AND NEW.estatus = 'RECIBIDA' THEN
    v_excluidas := v_excluidas || ARRAY['estatus','recibidoPorId','recibidoEn'];
  END IF;

  IF (to_jsonb(OLD) - v_excluidas) IS DISTINCT FROM (to_jsonb(NEW) - v_excluidas) THEN
    RAISE EXCEPTION 'Los datos de la solicitud no se modifican durante una transición.'
      USING ERRCODE = 'BG602';
  END IF;

  IF NEW.estatus IN ('AUTORIZADA','RETIRADA') AND NOT EXISTS (
    SELECT 1 FROM "MovimientoPartida" WHERE "movimientoId" = NEW.id
  ) THEN
    RAISE EXCEPTION 'No se puede autorizar ni entregar una salida sin partidas.'
      USING ERRCODE = 'BG603';
  END IF;

  IF OLD.estatus = 'AUTORIZADA' AND NEW.estatus = 'RETIRADA' THEN
    IF EXISTS (
      SELECT 1 FROM "MovimientoPartida" p
      LEFT JOIN "ConsumoCapa" c ON c."partidaId" = p.id
      WHERE p."movimientoId" = NEW.id
      GROUP BY p.id, p.cantidad
      HAVING coalesce(sum(c.cantidad), 0) <> p.cantidad
    ) THEN
      RAISE EXCEPTION 'La entrega exige consumir todas sus partidas.' USING ERRCODE = 'BG605';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "MovimientoPartida" p
      JOIN "ConsumoCapa" c ON c."partidaId" = p.id
      JOIN "CapaCosto" capa ON capa.id = c."capaId"
      WHERE p."movimientoId" = NEW.id
        AND (capa."articuloId" <> p."articuloId" OR capa."bodegaId" <> NEW."bodegaOrigenId"
          OR c."costoUnitario" IS DISTINCT FROM capa."costoUnitario"
          OR c."costoUnitarioConIva" IS DISTINCT FROM capa."costoUnitarioConIva")
    ) THEN
      RAISE EXCEPTION 'El consumo no corresponde a las capas de la bodega y el artículo.'
        USING ERRCODE = 'BG605';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
