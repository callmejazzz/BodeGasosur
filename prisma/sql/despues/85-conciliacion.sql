-- Fase 6: consumo, capa y existencia concilian ante cualquier escritor SQL.
--
-- Al confirmar cada transacción, por cada fila tocada:
--   · capa:       cantidadInicial − cantidadRestante = Σ ConsumoCapa de la capa
--   · existencia: Existencia.cantidad = Σ cantidadRestante de sus capas (invariante 9)
--   · consumo:    pertenece a una partida de SALIDA retirada o recibida y la cubre exacta
-- Una capa solo cambia su cantidadRestante y no se borra; un consumo no se edita ni se
-- borra. Sin eso, subir cantidadInicial "conciliaría" un consumo sin descontar nada.
--
--   BG606  consumo, capa y existencia no concilian al confirmar
--   BG607  capa o consumo ya escritos no se modifican

-- ───────────────────────── Preflight: lo que ya existe ────────────────────────
--
-- Los triggers solo vigilan lo que cambie de aquí en adelante; lo histórico se
-- comprueba antes de crearlos. La función queda para volver a correrla:
--   SELECT * FROM inventario_sin_conciliar();

CREATE OR REPLACE FUNCTION inventario_sin_conciliar()
RETURNS TABLE (problema text, referencia text) AS $$
  -- Capa cuyo descuento no es la suma de sus consumos.
  SELECT 'capa', c.id::text
    FROM "CapaCosto" c
   WHERE c."cantidadInicial" - c."cantidadRestante"
         <> coalesce((SELECT sum(k.cantidad) FROM "ConsumoCapa" k WHERE k."capaId" = c.id), 0)
  UNION ALL
  -- Existencia distinta de lo que queda en sus capas (invariante 9).
  SELECT 'existencia', k."bodegaId"::text || '/' || k."articuloId"::text
    FROM (SELECT "bodegaId", "articuloId" FROM "Existencia"
          UNION SELECT "bodegaId", "articuloId" FROM "CapaCosto") k
   WHERE coalesce((SELECT e.cantidad FROM "Existencia" e WHERE e."bodegaId" = k."bodegaId" AND e."articuloId" = k."articuloId"), 0)
         <> coalesce((SELECT sum(c."cantidadRestante") FROM "CapaCosto" c WHERE c."bodegaId" = k."bodegaId" AND c."articuloId" = k."articuloId"), 0)
  UNION ALL
  -- Partida de una salida retirada o recibida que sus consumos no cubren exactamente,
  -- incluida la que quedó sin ninguno.
  SELECT 'partida-retirada', p.id::text
    FROM "MovimientoPartida" p
    JOIN "Movimiento" m ON m.id = p."movimientoId"
    LEFT JOIN "ConsumoCapa" c ON c."partidaId" = p.id
   WHERE m.tipo = 'SALIDA' AND m.estatus IN ('RETIRADA','RECIBIDA')
   GROUP BY p.id, p.cantidad
  HAVING coalesce(sum(c.cantidad), 0) <> p.cantidad
  UNION ALL
  -- Consumo fuera de una salida retirada o recibida.
  SELECT 'consumo-fuera-de-salida', c.id::text
    FROM "ConsumoCapa" c
    JOIN "MovimientoPartida" p ON p.id = c."partidaId"
    JOIN "Movimiento" m ON m.id = p."movimientoId"
   WHERE m.tipo <> 'SALIDA' OR m.estatus NOT IN ('RETIRADA','RECIBIDA')
  UNION ALL
  -- Consumo de una capa de otro artículo u otra bodega, o con otro par de costos.
  SELECT 'consumo-de-otra-capa', c.id::text
    FROM "ConsumoCapa" c
    JOIN "MovimientoPartida" p ON p.id = c."partidaId"
    JOIN "Movimiento" m ON m.id = p."movimientoId"
    JOIN "CapaCosto" capa ON capa.id = c."capaId"
   WHERE capa."articuloId" <> p."articuloId"
      OR capa."bodegaId" IS DISTINCT FROM m."bodegaOrigenId"
      OR c."costoUnitario" IS DISTINCT FROM capa."costoUnitario"
      OR c."costoUnitarioConIva" IS DISTINCT FROM capa."costoUnitarioConIva"
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  v_detalle text;
BEGIN
  SELECT string_agg(format('%s: %s casos (p. ej. %s)', problema, total, ejemplos), '; ')
    INTO v_detalle
    FROM (
      SELECT problema, count(*) AS total, string_agg(referencia, ', ') FILTER (WHERE n <= 5) AS ejemplos
        FROM (SELECT problema, referencia, row_number() OVER (PARTITION BY problema ORDER BY referencia) AS n
                FROM inventario_sin_conciliar()) x
       GROUP BY problema
    ) y;
  IF v_detalle IS NOT NULL THEN
    RAISE EXCEPTION 'El inventario actual no concilia; corrígelo antes de migrar. %', v_detalle
      USING ERRCODE = 'BG606';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION conciliar_capa(p_capa uuid) RETURNS void AS $$
DECLARE
  v record;
BEGIN
  SELECT a.clave, c."cantidadInicial" - c."cantidadRestante" AS descontado,
         coalesce((SELECT sum(k.cantidad) FROM "ConsumoCapa" k WHERE k."capaId" = c.id), 0) AS consumido
    INTO v
    FROM "CapaCosto" c JOIN "Articulo" a ON a.id = c."articuloId"
   WHERE c.id = p_capa;
  IF FOUND AND v.descontado <> v.consumido THEN
    RAISE EXCEPTION 'Una capa de costo de % no concilia con sus consumos; no se guardó nada.', v.clave
      USING ERRCODE = 'BG606';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION conciliar_existencia(p_bodega uuid, p_articulo uuid) RETURNS void AS $$
DECLARE
  v_existencia bigint;
  v_capas bigint;
BEGIN
  SELECT coalesce((SELECT cantidad FROM "Existencia" WHERE "bodegaId" = p_bodega AND "articuloId" = p_articulo), 0),
         coalesce((SELECT sum("cantidadRestante") FROM "CapaCosto" WHERE "bodegaId" = p_bodega AND "articuloId" = p_articulo), 0)
    INTO v_existencia, v_capas;
  IF v_existencia <> v_capas THEN
    RAISE EXCEPTION 'La existencia de % en % no coincide con sus capas de costo; no se guardó nada.',
      (SELECT clave FROM "Articulo" WHERE id = p_articulo), (SELECT clave FROM "Bodega" WHERE id = p_bodega)
      USING ERRCODE = 'BG606';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION conciliar_partida_consumida(p_partida uuid) RETURNS void AS $$
DECLARE
  v record;
BEGIN
  SELECT m.tipo, m.estatus, p.cantidad,
         coalesce((SELECT sum(k.cantidad) FROM "ConsumoCapa" k WHERE k."partidaId" = p.id), 0) AS consumido
    INTO v
    FROM "MovimientoPartida" p JOIN "Movimiento" m ON m.id = p."movimientoId"
   WHERE p.id = p_partida;
  -- Hasta la fase 7 solo una salida consume capas.
  IF FOUND AND v.consumido > 0 AND (
    v.tipo <> 'SALIDA' OR v.estatus NOT IN ('RETIRADA','RECIBIDA') OR v.consumido <> v.cantidad
  ) THEN
    RAISE EXCEPTION 'Un consumo de capa solo existe en una salida retirada y cubre exactamente su partida; no se guardó nada.'
      USING ERRCODE = 'BG606';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────── Al confirmar la transacción ────────────────────────

CREATE OR REPLACE FUNCTION conciliar_por_consumo() RETURNS trigger AS $$
BEGIN
  PERFORM conciliar_partida_consumida(NEW."partidaId");
  PERFORM conciliar_capa(NEW."capaId");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION conciliar_por_capa() RETURNS trigger AS $$
BEGIN
  PERFORM conciliar_capa(NEW.id);
  PERFORM conciliar_existencia(NEW."bodegaId", NEW."articuloId");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION conciliar_por_existencia() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM conciliar_existencia(OLD."bodegaId", OLD."articuloId");
  ELSE
    PERFORM conciliar_existencia(NEW."bodegaId", NEW."articuloId");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER consumo_concilia
  AFTER INSERT ON "ConsumoCapa"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION conciliar_por_consumo();

CREATE CONSTRAINT TRIGGER capa_concilia
  AFTER INSERT OR UPDATE ON "CapaCosto"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION conciliar_por_capa();

CREATE CONSTRAINT TRIGGER existencia_concilia
  AFTER INSERT OR UPDATE OR DELETE ON "Existencia"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION conciliar_por_existencia();

-- ───────────────────────────── Lo ya escrito ──────────────────────────────────

CREATE OR REPLACE FUNCTION impedir_editar_capa() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Una capa de costo no se borra.' USING ERRCODE = 'BG607';
  END IF;
  IF (to_jsonb(OLD) - 'cantidadRestante') IS DISTINCT FROM (to_jsonb(NEW) - 'cantidadRestante') THEN
    RAISE EXCEPTION 'De una capa de costo solo cambia lo que le queda.' USING ERRCODE = 'BG607';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER capa_inmutable
  BEFORE UPDATE OR DELETE ON "CapaCosto"
  FOR EACH ROW EXECUTE FUNCTION impedir_editar_capa();

CREATE OR REPLACE FUNCTION impedir_editar_consumo() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Un consumo de capa no se modifica ni se borra.' USING ERRCODE = 'BG607';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER consumo_inmutable
  BEFORE UPDATE OR DELETE ON "ConsumoCapa"
  FOR EACH ROW EXECUTE FUNCTION impedir_editar_consumo();
