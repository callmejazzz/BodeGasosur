-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 7: traspasos, devoluciones, conteo y reversas, también ante escritores
-- SQL directos. El servicio añade bloqueos, PEPS e idempotencia; aquí se
-- impide que el libro quede distinto de lo que dicen sus partidas.
--
-- Va después de 99-… a propósito: usa la bitácora y la guarda de actor.
--
--   BG801  hoja de conteo: transición o edición no permitida
--   BG802  reversa no permitida o que no reproduce al original
--   BG803  devolución no permitida o que excede lo retirado
--   BG804  capas, consumos o restituciones que no concilian con el movimiento
--   BG805  hoja de conteo confirmada que no concilia con sus ajustes
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────── Movimiento ─────────────────────────────────

-- Traspasos y devoluciones se capturan con llave; la reversa no se captura.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_captura_llave_ck" CHECK (
  tipo NOT IN ('TRASPASO','DEVOLUCION') OR "llaveIdempotencia" IS NOT NULL OR "cancelaAId" IS NOT NULL
);

-- La reversa es un AJUSTE o, si revierte un traspaso, otro TRASPASO. Lleva
-- motivo y no se confunde con una captura, un conteo ni una devolución.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_reversa_ck" CHECK (
  "cancelaAId" IS NULL OR (
    tipo IN ('AJUSTE','TRASPASO') AND "cancelaAId" <> id
    AND btrim(coalesce(motivo, '')) <> ''
    AND "conteoId" IS NULL AND "devuelveAId" IS NULL AND "llaveIdempotencia" IS NULL
  )
);

ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_conteo_solo_ajuste_ck" CHECK (
  "conteoId" IS NULL OR tipo = 'AJUSTE'
);

-- El motivo es del ajuste y de la reversa, y no se deja en blanco.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_motivo_ck" CHECK (
  (motivo IS NULL OR tipo = 'AJUSTE' OR "cancelaAId" IS NOT NULL)
  AND (tipo <> 'AJUSTE' OR btrim(motivo) <> '')
);

-- Traspaso, devolución y ajuste no tienen autorización, retiro ni recepción.
ALTER TABLE "Movimiento" ADD CONSTRAINT "movimiento_inventario_sin_datos_ajenos_ck" CHECK (
  tipo NOT IN ('TRASPASO','DEVOLUCION','AJUSTE') OR (
    "autorizadoPorId" IS NULL AND "rechazadoPorId" IS NULL AND "motivoRechazo" IS NULL
    AND "entregadoPorId" IS NULL AND "recibidoPorId" IS NULL
    AND "solicitadoPorId" IS NULL AND "entregadoA" IS NULL
  )
);

-- Un traspaso o una devolución crean una capa por capa de origen, no dos.
CREATE UNIQUE INDEX "capa_una_por_origen_uq"
  ON "CapaCosto" ("movimientoId", "origenId") WHERE "origenId" IS NOT NULL;

-- ─────────────────────────── Hoja de conteo ───────────────────────────────

ALTER TABLE "HojaConteo" ADD CONSTRAINT "conteo_motivo_ck" CHECK (btrim(motivo) <> '');
ALTER TABLE "HojaConteo" ADD CONSTRAINT "conteo_revision_ck" CHECK (revision >= 1);
ALTER TABLE "HojaConteo" ADD CONSTRAINT "conteo_estado_datos_ck" CHECK (
  ("confirmadoPorId" IS NULL) = ("confirmadoEn" IS NULL)
  AND ("canceladoPorId" IS NULL) = ("canceladoEn" IS NULL)
  AND (estatus = 'CONFIRMADO') = ("confirmadoPorId" IS NOT NULL)
  AND (estatus = 'CANCELADO') = ("canceladoPorId" IS NOT NULL)
  AND (estatus = 'CANCELADO') = ("motivoCancelacion" IS NOT NULL)
  AND (estatus <> 'CANCELADO' OR btrim("motivoCancelacion") <> '')
);

ALTER TABLE "RenglonConteo" ADD CONSTRAINT "renglon_cantidades_ck" CHECK (
  "cantidadEsperada" >= 0 AND ("cantidadContada" IS NULL OR "cantidadContada" >= 0) AND orden >= 1
);

CREATE OR REPLACE FUNCTION verificar_transicion_de_conteo() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estatus <> 'BORRADOR' THEN
      RAISE EXCEPTION 'Una hoja de conteo nace en borrador.' USING ERRCODE = 'BG801';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.estatus <> 'BORRADOR' THEN
      RAISE EXCEPTION 'Una hoja de conteo confirmada o descartada no se borra.' USING ERRCODE = 'BG801';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.estatus <> 'BORRADOR' THEN
    IF (to_jsonb(OLD) - 'updatedAt') IS DISTINCT FROM (to_jsonb(NEW) - 'updatedAt') THEN
      RAISE EXCEPTION 'La hoja de conteo ya no está en borrador: no cambia.' USING ERRCODE = 'BG801';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."bodegaId" <> OLD."bodegaId" OR NEW."llaveIdempotencia" <> OLD."llaveIdempotencia" THEN
    RAISE EXCEPTION 'La bodega de una hoja de conteo no cambia.' USING ERRCODE = 'BG801';
  END IF;

  IF NEW.estatus = 'CONFIRMADO' AND NOT EXISTS (
    SELECT 1 FROM "RenglonConteo" WHERE "hojaId" = NEW.id AND "cantidadContada" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Una hoja sin ningún artículo contado no se confirma.' USING ERRCODE = 'BG801';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conteo_transicion
  BEFORE INSERT OR UPDATE OR DELETE ON "HojaConteo"
  FOR EACH ROW EXECUTE FUNCTION verificar_transicion_de_conteo();

-- Los renglones siguen a la hoja, con su candado, como las partidas a su encabezado.
CREATE OR REPLACE FUNCTION verificar_escritura_de_renglon() RETURNS trigger AS $$
DECLARE
  v_hojas uuid[] := ARRAY(
    SELECT DISTINCT h FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW."hojaId" END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD."hojaId" END
    ]) AS h WHERE h IS NOT NULL ORDER BY h
  );
BEGIN
  PERFORM 1 FROM "HojaConteo" WHERE id = ANY(v_hojas) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "HojaConteo" WHERE id = ANY(v_hojas) AND estatus <> 'BORRADOR') THEN
    RAISE EXCEPTION 'Los renglones de una hoja confirmada o descartada no cambian.' USING ERRCODE = 'BG801';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER renglon_escritura
  BEFORE INSERT OR UPDATE OR DELETE ON "RenglonConteo"
  FOR EACH ROW EXECUTE FUNCTION verificar_escritura_de_renglon();

-- Con liga, la hoja nace a nombre del actor y cada columna de actor se llena
-- una sola vez con él (igual que columnas_de_actor en Movimiento).
CREATE FUNCTION seguridad.columnas_de_actor_conteo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  columna text;
  antes uuid;
  despues uuid;
BEGIN
  SELECT * INTO a FROM seguridad.actor_de_la_escritura(TG_TABLE_SCHEMA, TG_TABLE_NAME);
  IF a.verificacion <> 'liga' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."creadoPorId" IS DISTINCT FROM a.usuario OR num_nonnulls(NEW."confirmadoPorId", NEW."canceladoPorId") > 0 THEN
      RAISE EXCEPTION 'Una hoja de conteo nueva solo lleva como actor a quien la crea.' USING ERRCODE = 'BG707';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."creadoPorId" IS DISTINCT FROM OLD."creadoPorId" THEN
    RAISE EXCEPTION 'El creador de una hoja de conteo no cambia.' USING ERRCODE = 'BG707';
  END IF;
  FOREACH columna IN ARRAY ARRAY['confirmadoPorId', 'canceladoPorId'] LOOP
    antes := (to_jsonb(OLD) ->> columna)::uuid;
    despues := (to_jsonb(NEW) ->> columna)::uuid;
    IF despues IS DISTINCT FROM antes AND (antes IS NOT NULL OR despues IS DISTINCT FROM a.usuario) THEN
      RAISE EXCEPTION 'La columna % solo puede tomar al actor verificado, y una sola vez.', columna USING ERRCODE = 'BG707';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER columnas_de_actor BEFORE INSERT OR UPDATE ON "HojaConteo"
  FOR EACH ROW EXECUTE FUNCTION seguridad.columnas_de_actor_conteo();

REVOKE ALL ON FUNCTION seguridad.columnas_de_actor_conteo() FROM PUBLIC, bodegasosur_ejecucion;

-- ──────────────────────── Bitácora y actor exigido ────────────────────────

CREATE TRIGGER bitacora_hojaconteo AFTER INSERT OR UPDATE OR DELETE ON public."HojaConteo"
  FOR EACH ROW EXECUTE FUNCTION registrar_en_bitacora();
CREATE TRIGGER bitacora_renglonconteo AFTER INSERT OR UPDATE OR DELETE ON public."RenglonConteo"
  FOR EACH ROW EXECUTE FUNCTION registrar_en_bitacora();

-- Como ConsumoCapa: sin bitácora porque es su propia historia, pero con actor.
CREATE TRIGGER exigir_actor BEFORE INSERT OR UPDATE OR DELETE ON "RestitucionCapa"
  FOR EACH STATEMENT EXECUTE FUNCTION seguridad.exigir_actor();

-- ─────────────────────────── Restituciones ────────────────────────────────

ALTER TABLE "RestitucionCapa" ADD CONSTRAINT "restitucion_cantidad_positiva_ck" CHECK (cantidad > 0);
ALTER TABLE "RestitucionCapa" ADD CONSTRAINT "restitucion_par_costo_ck" CHECK (
  ("costoUnitario" IS NULL) = ("costoUnitarioConIva" IS NULL)
);

CREATE OR REPLACE FUNCTION impedir_editar_restitucion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Una restitución de capa no se modifica ni se borra.' USING ERRCODE = 'BG607';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER restitucion_inmutable
  BEFORE UPDATE OR DELETE ON "RestitucionCapa"
  FOR EACH ROW EXECUTE FUNCTION impedir_editar_restitucion();

-- ─────────────────────────────── Conciliación ─────────────────────────────
--
-- Una capa descuenta lo que le consumieron menos lo que le restituyeron.

CREATE OR REPLACE FUNCTION conciliar_capa(p_capa uuid) RETURNS void AS $$
DECLARE
  v record;
BEGIN
  SELECT a.clave, c."cantidadInicial" - c."cantidadRestante" AS descontado,
         coalesce((SELECT sum(k.cantidad) FROM "ConsumoCapa" k WHERE k."capaId" = c.id), 0)
         - coalesce((SELECT sum(r.cantidad) FROM "RestitucionCapa" r WHERE r."capaId" = c.id), 0) AS consumido
    INTO v
    FROM "CapaCosto" c JOIN "Articulo" a ON a.id = c."articuloId"
   WHERE c.id = p_capa;
  IF FOUND AND v.descontado <> v.consumido THEN
    RAISE EXCEPTION 'Una capa de costo de % no concilia con sus consumos; no se guardó nada.', v.clave
      USING ERRCODE = 'BG606';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- La hoja confirmada es exactamente sus ajustes: una partida por diferencia,
-- con su signo en la bodega, y ninguna más. Con p_existencias, además, lo que
-- quedó en la bodega es lo contado: solo se pide en la transacción que la
-- confirma, que es cuando la existencia de antes era la esperada.
CREATE OR REPLACE FUNCTION conciliar_conteo(p_hoja uuid, p_existencias boolean) RETURNS void AS $$
DECLARE
  h "HojaConteo"%ROWTYPE;
  v_clave text;
BEGIN
  SELECT * INTO h FROM "HojaConteo" WHERE id = p_hoja;
  IF NOT FOUND THEN RETURN; END IF;

  IF h.estatus <> 'CONFIRMADO' THEN
    IF EXISTS (SELECT 1 FROM "Movimiento" WHERE "conteoId" = h.id) THEN
      RAISE EXCEPTION 'Un ajuste de conteo solo nace de una hoja confirmada; no se guardó nada.' USING ERRCODE = 'BG805';
    END IF;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Movimiento" a
    WHERE a."conteoId" = h.id
      AND (a.estatus <> 'CONFIRMADO' OR coalesce(a."bodegaDestinoId", a."bodegaOrigenId") <> h."bodegaId" OR a.motivo <> h.motivo)
  ) OR (SELECT count(*) FROM "Movimiento" WHERE "conteoId" = h.id AND "bodegaDestinoId" IS NOT NULL) > 1
    OR (SELECT count(*) FROM "Movimiento" WHERE "conteoId" = h.id AND "bodegaOrigenId" IS NOT NULL) > 1 THEN
    RAISE EXCEPTION 'Los ajustes de la hoja de conteo no corresponden a su bodega y motivo; no se guardó nada.' USING ERRCODE = 'BG805';
  END IF;

  IF (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
        SELECT jsonb_build_array(r."articuloId", r."cantidadContada" - r."cantidadEsperada") AS f
          FROM "RenglonConteo" r
         WHERE r."hojaId" = h.id AND r."cantidadContada" IS NOT NULL AND r."cantidadContada" <> r."cantidadEsperada") d)
     IS DISTINCT FROM
     (SELECT coalesce(jsonb_agg(f ORDER BY f), '[]') FROM (
        SELECT jsonb_build_array(p."articuloId", CASE WHEN a."bodegaDestinoId" IS NOT NULL THEN p.cantidad ELSE -p.cantidad END) AS f
          FROM "MovimientoPartida" p JOIN "Movimiento" a ON a.id = p."movimientoId"
         WHERE a."conteoId" = h.id) x) THEN
    RAISE EXCEPTION 'Los ajustes no son las diferencias de la hoja de conteo; no se guardó nada.' USING ERRCODE = 'BG805';
  END IF;

  IF p_existencias THEN
    SELECT a.clave INTO v_clave
      FROM "RenglonConteo" r
      JOIN "Articulo" a ON a.id = r."articuloId"
      LEFT JOIN "Existencia" e ON e."bodegaId" = h."bodegaId" AND e."articuloId" = r."articuloId"
     WHERE r."hojaId" = h.id AND r."cantidadContada" IS NOT NULL
       AND coalesce(e.cantidad, 0) <> r."cantidadContada"
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'La existencia de % no quedó igual a lo contado: la hoja estaba desactualizada; no se guardó nada.', v_clave
        USING ERRCODE = 'BG805';
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Devolución vigente: confirmada y sin reversa.
CREATE OR REPLACE FUNCTION devolucion_vigente(p_mov uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Movimiento" d
     WHERE d.id = p_mov AND d.tipo = 'DEVOLUCION' AND d.estatus = 'CONFIRMADO'
       AND NOT EXISTS (SELECT 1 FROM "Movimiento" r WHERE r."cancelaAId" = d.id)
  );
$$ LANGUAGE sql STABLE;

/*
  Lo que un movimiento dejó en el libro es exactamente lo que dicen sus
  partidas, según su tipo:

    sin efecto (borrador, cancelado, salida sin retirar): nada
    ENTRADA              capas propias, cada una igual a una partida
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
    -- La fase 5 confirma y crea capas en el servicio; aquí se impide que una
    -- capa ajena a sus partidas infle el inventario.
    IF EXISTS (
      SELECT 1 FROM "CapaCosto" c
       WHERE c."movimientoId" = m.id
         AND (c."bodegaId" IS DISTINCT FROM m."bodegaDestinoId" OR c."origenId" IS NOT NULL
           OR c.fecha <> m.fecha OR c."fechaOriginal" <> m.fecha
           OR NOT EXISTS (
             SELECT 1 FROM "MovimientoPartida" p
              WHERE p."movimientoId" = m.id AND p."articuloId" = c."articuloId" AND p.cantidad = c."cantidadInicial"
                AND p."costoUnitario" IS NOT DISTINCT FROM c."costoUnitario"
                AND p."costoUnitarioConIva" IS NOT DISTINCT FROM c."costoUnitarioConIva"))
    ) OR EXISTS (
      SELECT 1 FROM "CapaCosto" WHERE "movimientoId" = m.id GROUP BY "articuloId" HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'Las capas de la entrada % no corresponden a sus partidas; no concilia.', v_ref USING ERRCODE = 'BG804';
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

-- Todo consumo toma de una capa del mismo artículo, en la bodega de origen,
-- con el par de costos de esa capa.
CREATE OR REPLACE FUNCTION conciliar_consumos(m "Movimiento") RETURNS void AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ConsumoCapa" k
      JOIN "MovimientoPartida" p ON p.id = k."partidaId"
      JOIN "CapaCosto" c ON c.id = k."capaId"
     WHERE p."movimientoId" = m.id
       AND (c."articuloId" <> p."articuloId" OR c."bodegaId" IS DISTINCT FROM m."bodegaOrigenId"
         OR k."costoUnitario" IS DISTINCT FROM c."costoUnitario"
         OR k."costoUnitarioConIva" IS DISTINCT FROM c."costoUnitarioConIva")
  ) THEN
    RAISE EXCEPTION 'Un consumo de % no corresponde a una capa del artículo en la bodega de origen; no concilia.', coalesce(m.folio, 'un movimiento')
      USING ERRCODE = 'BG804';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────── Al confirmar la transacción ──────────────────────

CREATE OR REPLACE FUNCTION conciliar_por_consumo() RETURNS trigger AS $$
BEGIN
  PERFORM conciliar_movimiento((SELECT "movimientoId" FROM "MovimientoPartida" WHERE id = NEW."partidaId"));
  PERFORM conciliar_capa(NEW."capaId");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Ya sin quien la llame: conciliar_movimiento la sustituye.
DROP FUNCTION conciliar_partida_consumida(uuid);

CREATE OR REPLACE FUNCTION conciliar_por_capa() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM conciliar_movimiento(NEW."movimientoId");
  END IF;
  PERFORM conciliar_capa(NEW.id);
  PERFORM conciliar_existencia(NEW."bodegaId", NEW."articuloId");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION conciliar_por_restitucion() RETURNS trigger AS $$
BEGIN
  PERFORM conciliar_movimiento((SELECT "movimientoId" FROM "MovimientoPartida" WHERE id = NEW."partidaId"));
  PERFORM conciliar_capa(NEW."capaId");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION conciliar_por_movimiento() RETURNS trigger AS $$
BEGIN
  PERFORM conciliar_movimiento(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION conciliar_por_conteo() RETURNS trigger AS $$
BEGIN
  PERFORM conciliar_conteo(NEW.id, true);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER restitucion_concilia
  AFTER INSERT ON "RestitucionCapa"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION conciliar_por_restitucion();

CREATE CONSTRAINT TRIGGER movimiento_concilia
  AFTER INSERT OR UPDATE ON "Movimiento"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION conciliar_por_movimiento();

CREATE CONSTRAINT TRIGGER conteo_concilia
  AFTER UPDATE ON "HojaConteo"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.estatus = 'CONFIRMADO' AND OLD.estatus <> 'CONFIRMADO')
  EXECUTE FUNCTION conciliar_por_conteo();

-- Las funciones nuevas nacen sin EXECUTE (95-actor-verificable.sql): los
-- triggers del usuario de ejecución las llaman, así que se le conceden.
GRANT EXECUTE ON FUNCTION
  conciliar_movimiento(uuid),
  conciliar_consumos("Movimiento"),
  conciliar_conteo(uuid, boolean),
  devolucion_vigente(uuid)
TO bodegasosur_ejecucion;

-- ─────────────────────── Preflight: lo que ya existe ──────────────────────
--
-- Los triggers vigilan lo que cambie de aquí en adelante; lo histórico se
-- comprueba antes de terminar la migración. Para volver a correrlo:
--   SELECT * FROM inventario_sin_conciliar();
--   SELECT * FROM movimientos_sin_conciliar();

CREATE OR REPLACE FUNCTION inventario_sin_conciliar()
RETURNS TABLE (problema text, referencia text) AS $$
  -- Capa cuyo descuento no es lo consumido menos lo restituido.
  SELECT 'capa', c.id::text
    FROM "CapaCosto" c
   WHERE c."cantidadInicial" - c."cantidadRestante"
         <> coalesce((SELECT sum(k.cantidad) FROM "ConsumoCapa" k WHERE k."capaId" = c.id), 0)
          - coalesce((SELECT sum(r.cantidad) FROM "RestitucionCapa" r WHERE r."capaId" = c.id), 0)
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
  -- Consumo fuera de un egreso con efecto: salida retirada o recibida, traspaso
  -- o ajuste confirmados.
  SELECT 'consumo-fuera-de-salida', c.id::text
    FROM "ConsumoCapa" c
    JOIN "MovimientoPartida" p ON p.id = c."partidaId"
    JOIN "Movimiento" m ON m.id = p."movimientoId"
   WHERE NOT ((m.tipo = 'SALIDA' AND m.estatus IN ('RETIRADA','RECIBIDA'))
           OR (m.tipo IN ('TRASPASO','AJUSTE') AND m.estatus = 'CONFIRMADO'))
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

-- Cada movimiento que dejó rastro en capas, o que es de la fase 7, contra
-- conciliar_movimiento(): el mensaje de la primera regla que no cumple.
CREATE OR REPLACE FUNCTION movimientos_sin_conciliar()
RETURNS TABLE (movimiento uuid, problema text) AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT m.id FROM "Movimiento" m
     WHERE m.tipo IN ('TRASPASO','DEVOLUCION','AJUSTE') OR m."cancelaAId" IS NOT NULL
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
  SELECT string_agg(format('%s: %s', problema, referencia), '; ')
    INTO v_detalle
    FROM (SELECT problema, referencia FROM inventario_sin_conciliar()
          UNION ALL SELECT problema, movimiento::text FROM movimientos_sin_conciliar()
          LIMIT 10) x;
  IF v_detalle IS NOT NULL THEN
    RAISE EXCEPTION 'El inventario actual no concilia con las reglas de la fase 7; corrígelo antes de migrar. %', v_detalle
      USING ERRCODE = 'BG804';
  END IF;
END;
$$;
