-- Una entrada confirmada es exactamente sus capas. Copia de prisma/sql/despues/995-entrada-con-sus-capas.sql.

-- ═══════════════════════════════════════════════════════════════════════════
-- Una entrada confirmada es exactamente sus capas: una por partida, con su
-- cantidad y su par de costos, en su bodega y con su fecha. Antes solo se
-- revisaba que cada capa existente correspondiera a una partida, y una
-- entrada escrita a mano podía confirmarse sin capas ni existencia.
--
-- Redefine conciliar_movimiento() de 990 con la regla de ENTRADA completa, y
-- movimientos_sin_conciliar() para revisar también las entradas sin capas.
-- ═══════════════════════════════════════════════════════════════════════════

/*
  Lo que un movimiento dejó en el libro es exactamente lo que dicen sus
  partidas, según su tipo:

    sin efecto (borrador, cancelado, salida sin retirar): nada
    ENTRADA              una capa propia por partida, igual a ella
    SALIDA               consumos que cubren sus partidas, en su bodega
    TRASPASO             consumos en origen y, por cada uno, una capa en
                         destino con su fecha original y su par de costos
    DEVOLUCION vinculada capas cuyo origen es un consumo de la salida, sin
                         exceder lo retirado entre todas las vigentes
    DEVOLUCION sin salida una capa sin costo por partida
    AJUSTE +             una capa sin costo por partida
    AJUSTE −             consumos que cubren sus partidas
    reversa              consume completas las capas del original y restituye
                         cada uno de sus consumos; no crea capas

  El candado del movimiento relacionado (la salida de una devolución, el
  original de una reversa) serializa las comprobaciones de saldo aun para un
  escritor que no tomó los candados del servicio.
*/
CREATE OR REPLACE FUNCTION conciliar_movimiento(p_mov uuid) RETURNS void AS $$
DECLARE
  m          "Movimiento"%ROWTYPE;
  o          "Movimiento"%ROWTYPE;
  s          "Movimiento"%ROWTYPE;
  v_ref      text;
  v_clave    text;
  v_efecto   boolean;
  v_consume  boolean;
  v_restituye boolean;
BEGIN
  SELECT * INTO m FROM "Movimiento" WHERE id = p_mov;
  IF NOT FOUND THEN RETURN; END IF;
  v_ref := coalesce(m.folio, 'sin folio');
  v_efecto := (m.tipo = 'SALIDA' AND m.estatus IN ('RETIRADA','RECIBIDA'))
           OR (m.tipo <> 'SALIDA' AND m.estatus = 'CONFIRMADO');

  IF NOT v_efecto THEN
    IF m."cancelaAId" IS NOT NULL THEN
      RAISE EXCEPTION 'Una reversa se confirma en la misma operación que la crea; no se guardó nada.' USING ERRCODE = 'BG802';
    END IF;
    IF EXISTS (SELECT 1 FROM "CapaCosto" WHERE "movimientoId" = m.id)
       OR EXISTS (SELECT 1 FROM "ConsumoCapa" k JOIN "MovimientoPartida" p ON p.id = k."partidaId" WHERE p."movimientoId" = m.id)
       OR EXISTS (SELECT 1 FROM "RestitucionCapa" r JOIN "MovimientoPartida" p ON p.id = r."partidaId" WHERE p."movimientoId" = m.id) THEN
      IF m.tipo = 'SALIDA' THEN
        RAISE EXCEPTION 'Un consumo de capa solo existe en una salida retirada y cubre exactamente su partida; no se guardó nada.'
          USING ERRCODE = 'BG606';
      END IF;
      RAISE EXCEPTION 'Un movimiento sin confirmar no concilia con capas, consumos ni restituciones; no se guardó nada.'
        USING ERRCODE = 'BG804';
    END IF;
    RETURN;
  END IF;

  -- ── Reversa ──────────────────────────────────────────────────────────────
  IF m."cancelaAId" IS NOT NULL THEN
    SELECT * INTO o FROM "Movimiento" WHERE id = m."cancelaAId" FOR NO KEY UPDATE;
    IF NOT ((o.tipo = 'SALIDA' AND o.estatus IN ('RETIRADA','RECIBIDA'))
            OR (o.tipo <> 'SALIDA' AND o.estatus = 'CONFIRMADO')) THEN
      RAISE EXCEPTION 'Solo se revierte un movimiento que afectó el inventario.' USING ERRCODE = 'BG802';
    END IF;
    IF o."cancelaAId" IS NOT NULL THEN
      RAISE EXCEPTION 'Una reversa no se revierte.' USING ERRCODE = 'BG802';
    END IF;
    IF (m.tipo = 'TRASPASO') <> (o.tipo = 'TRASPASO')
       OR m."bodegaOrigenId" IS DISTINCT FROM o."bodegaDestinoId"
       OR m."bodegaDestinoId" IS DISTINCT FROM o."bodegaOrigenId" THEN
      RAISE EXCEPTION 'La reversa de % mueve las mismas bodegas en sentido contrario.', coalesce(o.folio, 'el movimiento')
        USING ERRCODE = 'BG802';
    END IF;
    IF o.tipo = 'SALIDA' AND EXISTS (
      SELECT 1 FROM "Movimiento" d WHERE d."devuelveAId" = o.id AND devolucion_vigente(d.id)
    ) THEN
      RAISE EXCEPTION 'La salida % tiene devoluciones vigentes: revierte primero esas devoluciones.', o.folio
        USING ERRCODE = 'BG802';
    END IF;
    IF EXISTS (SELECT 1 FROM "CapaCosto" WHERE "movimientoId" = m.id) THEN
      RAISE EXCEPTION 'Una reversa no crea capas de costo; no se guardó nada.' USING ERRCODE = 'BG804';
    END IF;

    IF (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
          SELECT jsonb_build_array("articuloId", cantidad) AS f FROM "MovimientoPartida" WHERE "movimientoId" = m.id) x)
       IS DISTINCT FROM
       (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
          SELECT jsonb_build_array("articuloId", cantidad) AS f FROM "MovimientoPartida" WHERE "movimientoId" = o.id) y) THEN
      RAISE EXCEPTION 'La reversa no reproduce las partidas de %.', coalesce(o.folio, 'el original') USING ERRCODE = 'BG802';
    END IF;

    -- Retira completas y exactas las capas que creó el original.
    IF (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
          SELECT jsonb_build_array(k."capaId", p."articuloId", k.cantidad, k."costoUnitario", k."costoUnitarioConIva") AS f
            FROM "ConsumoCapa" k JOIN "MovimientoPartida" p ON p.id = k."partidaId"
           WHERE p."movimientoId" = m.id) x)
       IS DISTINCT FROM
       (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
          SELECT jsonb_build_array(c.id, c."articuloId", c."cantidadInicial", c."costoUnitario", c."costoUnitarioConIva") AS f
            FROM "CapaCosto" c WHERE c."movimientoId" = o.id) y) THEN
      RAISE EXCEPTION 'La reversa de % retira exactamente las capas que creó, completas; no concilia.', coalesce(o.folio, 'el original')
        USING ERRCODE = 'BG804';
    END IF;

    -- Devuelve cada pieza que consumió el original a su capa exacta.
    IF (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
          SELECT jsonb_build_array(r."consumoId", r."capaId", p."articuloId", r.cantidad, r."costoUnitario", r."costoUnitarioConIva") AS f
            FROM "RestitucionCapa" r JOIN "MovimientoPartida" p ON p.id = r."partidaId"
           WHERE p."movimientoId" = m.id) x)
       IS DISTINCT FROM
       (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
          SELECT jsonb_build_array(k.id, k."capaId", p."articuloId", k.cantidad, k."costoUnitario", k."costoUnitarioConIva") AS f
            FROM "ConsumoCapa" k JOIN "MovimientoPartida" p ON p.id = k."partidaId"
           WHERE p."movimientoId" = o.id) y) THEN
      RAISE EXCEPTION 'La reversa de % restituye exactamente los consumos del original; no concilia.', coalesce(o.folio, 'el original')
        USING ERRCODE = 'BG804';
    END IF;

    -- Cada partida queda cubierta: lo que salió y lo que volvió, según el original.
    v_consume := o."bodegaDestinoId" IS NOT NULL;
    v_restituye := o."bodegaOrigenId" IS NOT NULL;
    SELECT a.clave INTO v_clave
      FROM "MovimientoPartida" p JOIN "Articulo" a ON a.id = p."articuloId"
     WHERE p."movimientoId" = m.id
       AND (coalesce((SELECT sum(k.cantidad) FROM "ConsumoCapa" k WHERE k."partidaId" = p.id), 0)
              <> CASE WHEN v_consume THEN p.cantidad ELSE 0 END
         OR coalesce((SELECT sum(r.cantidad) FROM "RestitucionCapa" r WHERE r."partidaId" = p.id), 0)
              <> CASE WHEN v_restituye THEN p.cantidad ELSE 0 END)
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'La reversa de % no cubre la partida de %; no concilia.', coalesce(o.folio, 'el original'), v_clave
        USING ERRCODE = 'BG804';
    END IF;

    PERFORM conciliar_consumos(m);
    RETURN;
  END IF;

  -- ── Movimiento ordinario con efecto ─────────────────────────────────────
  IF EXISTS (SELECT 1 FROM "RestitucionCapa" r JOIN "MovimientoPartida" p ON p.id = r."partidaId" WHERE p."movimientoId" = m.id) THEN
    RAISE EXCEPTION 'Solo una reversa devuelve piezas a sus capas; % no concilia.', v_ref USING ERRCODE = 'BG804';
  END IF;

  -- Consumos: los tienen los egresos y nadie más.
  IF m.tipo IN ('SALIDA','TRASPASO') OR (m.tipo = 'AJUSTE' AND m."bodegaOrigenId" IS NOT NULL) THEN
    SELECT a.clave INTO v_clave
      FROM "MovimientoPartida" p JOIN "Articulo" a ON a.id = p."articuloId"
     WHERE p."movimientoId" = m.id
       AND p.cantidad <> coalesce((SELECT sum(k.cantidad) FROM "ConsumoCapa" k WHERE k."partidaId" = p.id), 0)
     LIMIT 1;
    IF FOUND THEN
      IF m.tipo = 'SALIDA' THEN
        RAISE EXCEPTION 'Un consumo de capa solo existe en una salida retirada y cubre exactamente su partida; no se guardó nada.'
          USING ERRCODE = 'BG606';
      END IF;
      RAISE EXCEPTION 'Los consumos de % no cubren exactamente la partida de %; no concilia.', v_ref, v_clave USING ERRCODE = 'BG804';
    END IF;
    PERFORM conciliar_consumos(m);
  ELSIF EXISTS (SELECT 1 FROM "ConsumoCapa" k JOIN "MovimientoPartida" p ON p.id = k."partidaId" WHERE p."movimientoId" = m.id) THEN
    RAISE EXCEPTION 'El movimiento % no consume capas; no concilia.', v_ref USING ERRCODE = 'BG804';
  END IF;

  -- Capas: las crean los ingresos y nadie más.
  IF m.tipo = 'SALIDA' OR (m.tipo = 'AJUSTE' AND m."bodegaOrigenId" IS NOT NULL) THEN
    IF EXISTS (SELECT 1 FROM "CapaCosto" WHERE "movimientoId" = m.id) THEN
      RAISE EXCEPTION 'El movimiento % no crea capas de costo; no concilia.', v_ref USING ERRCODE = 'BG804';
    END IF;

  ELSIF m.tipo = 'ENTRADA' THEN
    -- Ni capas ajenas a sus partidas ni partidas sin capa: la existencia,
    -- conciliada con las capas, sube exactamente lo recibido.
    IF EXISTS (
      SELECT 1 FROM "CapaCosto" c
       WHERE c."movimientoId" = m.id
         AND (c."bodegaId" IS DISTINCT FROM m."bodegaDestinoId" OR c."origenId" IS NOT NULL
           OR c.fecha <> m.fecha OR c."fechaOriginal" <> m.fecha)
    ) OR (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
            SELECT jsonb_build_array("articuloId", cantidad, "costoUnitario", "costoUnitarioConIva") AS f
              FROM "MovimientoPartida" WHERE "movimientoId" = m.id) x)
         IS DISTINCT FROM
         (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
            SELECT jsonb_build_array("articuloId", "cantidadInicial", "costoUnitario", "costoUnitarioConIva") AS f
              FROM "CapaCosto" WHERE "movimientoId" = m.id) y) THEN
      RAISE EXCEPTION 'La entrada % crea una capa por partida, con su cantidad y su costo; no concilia.', v_ref USING ERRCODE = 'BG804';
    END IF;

  ELSIF m.tipo = 'TRASPASO' THEN
    IF EXISTS (
      SELECT 1 FROM "CapaCosto" c
       WHERE c."movimientoId" = m.id AND (c."bodegaId" <> m."bodegaDestinoId" OR c.fecha <> m.fecha)
    ) OR (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
            SELECT jsonb_build_array(c."origenId", c."articuloId", c."cantidadInicial", c."fechaOriginal", c."costoUnitario", c."costoUnitarioConIva") AS f
              FROM "CapaCosto" c WHERE c."movimientoId" = m.id) x)
         IS DISTINCT FROM
         (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
            SELECT jsonb_build_array(k."capaId", p."articuloId", k.cantidad, origen."fechaOriginal", k."costoUnitario", k."costoUnitarioConIva") AS f
              FROM "ConsumoCapa" k
              JOIN "MovimientoPartida" p ON p.id = k."partidaId"
              JOIN "CapaCosto" origen ON origen.id = k."capaId"
             WHERE p."movimientoId" = m.id) y) THEN
      RAISE EXCEPTION 'El traspaso % crea en destino una capa por cada capa consumida, con su fecha original y su costo; no concilia.', v_ref
        USING ERRCODE = 'BG804';
    END IF;

  ELSIF m.tipo = 'DEVOLUCION' AND m."devuelveAId" IS NOT NULL THEN
    SELECT * INTO s FROM "Movimiento" WHERE id = m."devuelveAId" FOR NO KEY UPDATE;
    IF s.tipo <> 'SALIDA' OR s.estatus NOT IN ('RETIRADA','RECIBIDA') OR s."estacionId" IS DISTINCT FROM m."estacionId" THEN
      RAISE EXCEPTION 'Una devolución vinculada exige una salida retirada o recibida de la misma estación.' USING ERRCODE = 'BG803';
    END IF;
    IF EXISTS (SELECT 1 FROM "Movimiento" r WHERE r."cancelaAId" = s.id) THEN
      RAISE EXCEPTION 'La salida % fue revertida: ya no admite devoluciones.', s.folio USING ERRCODE = 'BG803';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "CapaCosto" c
       WHERE c."movimientoId" = m.id
         AND (c."bodegaId" <> m."bodegaDestinoId" OR c.fecha <> m.fecha OR NOT EXISTS (
           SELECT 1 FROM "ConsumoCapa" k
             JOIN "MovimientoPartida" p ON p.id = k."partidaId"
             JOIN "CapaCosto" origen ON origen.id = k."capaId"
            WHERE p."movimientoId" = s.id AND k."capaId" = c."origenId" AND p."articuloId" = c."articuloId"
              AND origen."fechaOriginal" = c."fechaOriginal"
              AND k."costoUnitario" IS NOT DISTINCT FROM c."costoUnitario"
              AND k."costoUnitarioConIva" IS NOT DISTINCT FROM c."costoUnitarioConIva"))
    ) OR (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
            SELECT jsonb_build_array("articuloId", cantidad) AS f FROM "MovimientoPartida" WHERE "movimientoId" = m.id) x)
         IS DISTINCT FROM
         (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
            SELECT jsonb_build_array("articuloId", sum("cantidadInicial")) AS f
              FROM "CapaCosto" WHERE "movimientoId" = m.id GROUP BY "articuloId") y) THEN
      RAISE EXCEPTION 'Las capas de la devolución % no heredan de los consumos de la salida %; no concilia.', v_ref, s.folio
        USING ERRCODE = 'BG804';
    END IF;
    SELECT a.clave INTO v_clave
      FROM "ConsumoCapa" k
      JOIN "MovimientoPartida" p ON p.id = k."partidaId"
      JOIN "Articulo" a ON a.id = p."articuloId"
     WHERE p."movimientoId" = s.id
       AND k.cantidad < (
         SELECT coalesce(sum(c."cantidadInicial"), 0) FROM "CapaCosto" c
          JOIN "Movimiento" d ON d.id = c."movimientoId"
          WHERE c."origenId" = k."capaId" AND d."devuelveAId" = s.id AND devolucion_vigente(d.id))
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Las devoluciones de % exceden lo que salió en %.', v_clave, s.folio USING ERRCODE = 'BG803';
    END IF;

  ELSE
    -- DEVOLUCION sin salida y AJUSTE positivo: procedencia no comprobada, sin costo.
    IF EXISTS (
      SELECT 1 FROM "CapaCosto" c
       WHERE c."movimientoId" = m.id
         AND (c."bodegaId" <> m."bodegaDestinoId" OR c."origenId" IS NOT NULL
           OR c."costoUnitario" IS NOT NULL OR c."costoUnitarioConIva" IS NOT NULL
           OR c.fecha <> m.fecha OR c."fechaOriginal" <> m.fecha)
    ) OR (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
            SELECT jsonb_build_array("articuloId", cantidad) AS f FROM "MovimientoPartida" WHERE "movimientoId" = m.id) x)
         IS DISTINCT FROM
         (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
            SELECT jsonb_build_array("articuloId", "cantidadInicial") AS f FROM "CapaCosto" WHERE "movimientoId" = m.id) y) THEN
      RAISE EXCEPTION 'El movimiento % crea una capa sin costo por partida, con su propia fecha; no concilia.', v_ref USING ERRCODE = 'BG804';
    END IF;
  END IF;

  IF m."conteoId" IS NOT NULL THEN
    PERFORM conciliar_conteo(m."conteoId", false);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────── Preflight: lo que ya existe ──────────────────────
--
-- Igual que en 990, ahora también con las entradas que no dejaron capas:
--   SELECT * FROM movimientos_sin_conciliar();

CREATE OR REPLACE FUNCTION movimientos_sin_conciliar()
RETURNS TABLE (movimiento uuid, problema text) AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT m.id FROM "Movimiento" m
     WHERE m.tipo IN ('ENTRADA','TRASPASO','DEVOLUCION','AJUSTE') OR m."cancelaAId" IS NOT NULL
        OR EXISTS (SELECT 1 FROM "CapaCosto" c WHERE c."movimientoId" = m.id)
     ORDER BY m.id
  LOOP
    BEGIN
      PERFORM conciliar_movimiento(r.id);
    EXCEPTION WHEN OTHERS THEN
      movimiento := r.id;
      problema := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_detalle text;
BEGIN
  SELECT string_agg(format('%s: %s', movimiento, problema), '; ')
    INTO v_detalle
    FROM (SELECT movimiento, problema FROM movimientos_sin_conciliar() LIMIT 10) x;
  IF v_detalle IS NOT NULL THEN
    RAISE EXCEPTION 'Hay movimientos que no concilian con sus capas; corrígelos antes de migrar. %', v_detalle
      USING ERRCODE = 'BG804';
  END IF;
END;
$$;
