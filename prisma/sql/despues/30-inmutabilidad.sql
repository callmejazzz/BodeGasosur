-- ═══════════════════════════════════════════════════════════════════════════
-- Lo que no se puede cambiar después de escrito.
--
-- Dos cosas distintas viven aquí:
--   1. Las claves de negocio, porque están en la URL y en los WhatsApp de
--      Compras. Inmutables sin excepción: la clave de artículo la asigna el
--      sistema, así que nadie la captura mal.
--   2. Quién autorizó y cuándo, porque es el rastro del requisito #1 del
--      sistema y un rastro que se puede reescribir no es un rastro.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────── Claves de negocio inmutables ─────────────────────

CREATE OR REPLACE FUNCTION impedir_cambio_de_clave() RETURNS trigger AS $$
DECLARE
  v_columna text := TG_ARGV[0];
  v_vieja   text := to_jsonb(OLD) ->> v_columna;
  v_nueva   text := to_jsonb(NEW) ->> v_columna;
BEGIN
  IF v_vieja IS DISTINCT FROM v_nueva THEN
    RAISE EXCEPTION
      'La clave de negocio %.% es inmutable: % no puede convertirse en %.',
      TG_TABLE_NAME, v_columna, v_vieja, v_nueva
      USING ERRCODE = 'check_violation',
            HINT = 'Si la clave quedó mal, se da de baja el registro y se crea otro.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER articulo_clave_inmutable
  BEFORE UPDATE ON public."Articulo"
  FOR EACH ROW EXECUTE FUNCTION impedir_cambio_de_clave('clave');

CREATE TRIGGER bodega_clave_inmutable
  BEFORE UPDATE ON public."Bodega"
  FOR EACH ROW EXECUTE FUNCTION impedir_cambio_de_clave('clave');

CREATE TRIGGER unidad_clave_inmutable
  BEFORE UPDATE ON public."UnidadMedida"
  FOR EACH ROW EXECUTE FUNCTION impedir_cambio_de_clave('clave');

CREATE TRIGGER estacion_numero_inmutable
  BEFORE UPDATE ON catalogo_gasosur."Estacion"
  FOR EACH ROW EXECUTE FUNCTION impedir_cambio_de_clave('numero');

-- El tipo decide qué máquina de estados y qué CHECK aplican: cambiarlo sería
-- cambiar de reglas a medio camino (ENTRADA/CONFIRMADO → SALIDA/CANCELADO).
CREATE TRIGGER movimiento_tipo_inmutable
  BEFORE UPDATE ON public."Movimiento"
  FOR EACH ROW EXECUTE FUNCTION impedir_cambio_de_clave('tipo');

-- ──────────────── Autorización: escritura única, y una sola vez ───────────

CREATE OR REPLACE FUNCTION impedir_reescribir_autorizacion() RETURNS trigger AS $$
BEGIN
  IF OLD."autorizadoPorId" IS NOT NULL
     AND NEW."autorizadoPorId" IS DISTINCT FROM OLD."autorizadoPorId" THEN
    RAISE EXCEPTION 'La autorización de un movimiento no se reescribe.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."autorizadoEn" IS NOT NULL
     AND NEW."autorizadoEn" IS DISTINCT FROM OLD."autorizadoEn" THEN
    RAISE EXCEPTION 'La fecha de autorización de un movimiento no se reescribe.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movimiento_autorizacion_escritura_unica
  BEFORE UPDATE ON public."Movimiento"
  FOR EACH ROW EXECUTE FUNCTION impedir_reescribir_autorizacion();

-- ─────────────── Quien autoriza tiene que poder autorizar ─────────────────
--
-- El requisito #1 del sistema es «no permitir salida sin autorización». El
-- permiso vive en Usuario.puedeAutorizar y la bandera es editable — esa fue
-- una decisión deliberada. Por eso la verificación tiene que ocurrir en el
-- instante del acto y quedar fechada: saber «¿lo tenía cuando autorizó?»
-- exige las dos cosas, y la Bitacora guarda el resto de la historia.

CREATE OR REPLACE FUNCTION verificar_facultad_de_autorizar() RETURNS trigger AS $$
DECLARE
  v_puede  boolean;
  v_activo boolean;
BEGIN
  IF NEW."autorizadoPorId" IS NULL THEN
    RETURN NEW;
  END IF;

  -- En un INSERT no hay OLD: en un UPDATE solo interesa el cambio.
  IF TG_OP = 'UPDATE' AND NEW."autorizadoPorId" IS NOT DISTINCT FROM OLD."autorizadoPorId" THEN
    RETURN NEW;
  END IF;

  SELECT "puedeAutorizar", activo INTO v_puede, v_activo
  FROM public."Usuario" WHERE id = NEW."autorizadoPorId";

  IF NOT coalesce(v_puede, false) OR NOT coalesce(v_activo, false) THEN
    RAISE EXCEPTION
      'El usuario % no tiene la facultad de autorizar salidas.', NEW."autorizadoPorId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movimiento_verificar_autorizador
  BEFORE INSERT OR UPDATE ON public."Movimiento"
  FOR EACH ROW EXECUTE FUNCTION verificar_facultad_de_autorizar();

-- ──────────── Un movimiento confirmado no se edita ni se borra ────────────
--
-- 11 §1 y §4, para los tipos con la máquina BORRADOR → CONFIRMADO; SALIDA
-- tiene sus propios estados y se cierra en la fase 6. Fuera de BORRADOR no
-- cambia nada, ni siquiera hacia CANCELADO: la cancelación por asiento
-- inverso es de la fase 7 y cuando llegue abrirá esta puerta a propósito.
--
-- Cada RAISE de este bloque lleva un SQLSTATE propio y estable (clase BG,
-- «BodeGasosur»): es lo único que la capa de servicios acepta mostrar tal
-- cual. Un mensaje sin código de la lista se sustituye por uno genérico.
--
--   BG501  el movimiento ya no está en BORRADOR: no se edita, no se borra,
--          sus partidas no cambian
--   BG502  un movimiento nace en BORRADOR
--   BG503  sin partidas no se confirma
--   BG504  el factor de una CAJA ya no es el del catálogo
--   BG505  una entrada se confirma con costo y tasa en todas sus partidas
--   BG506  la partida por CAJA no corresponde al catálogo
--
-- Bloqueos, para que esto y la confirmación no se pisen (11 §9): quien escribe
-- una partida toma FOR UPDATE sobre su encabezado, en orden de id si son dos;
-- la confirmación lo toma con su propio UPDATE. Así «¿tiene partidas?» y
-- «¿el factor sigue vigente?» se responden con el encabezado cerrado. Los
-- artículos se toman FOR SHARE después del encabezado, también por id. La
-- capa de servicios sigue el mismo orden y lo completa: encabezado →
-- proveedor → bodega → artículos → existencias → folio.

CREATE OR REPLACE FUNCTION verificar_transicion_de_movimiento() RETURNS trigger AS $$
DECLARE
  v_partida record;
  -- En un UPDATE manda el tipo que ya tenía la fila, aunque el trigger de
  -- arriba ya impida cambiarlo: dos defensas para la misma puerta.
  v_tipo "TipoMovimiento" := CASE WHEN TG_OP = 'INSERT' THEN NEW.tipo ELSE OLD.tipo END;
BEGIN
  IF v_tipo = 'SALIDA' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estatus <> 'BORRADOR' THEN
      RAISE EXCEPTION 'Un movimiento nace en BORRADOR y se confirma después, con sus partidas.'
        USING ERRCODE = 'BG502';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.estatus <> 'BORRADOR' THEN
    IF (to_jsonb(OLD) - 'updatedAt') <> (to_jsonb(NEW) - 'updatedAt') THEN
      RAISE EXCEPTION 'El movimiento % está %: ya no se edita.', coalesce(OLD.folio, OLD.id::text), OLD.estatus
        USING ERRCODE = 'BG501',
              HINT = 'Un movimiento confirmado se corrige con un asiento inverso, no editándolo.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estatus <> 'CONFIRMADO' THEN
    RETURN NEW;
  END IF;

  -- BORRADOR → CONFIRMADO.
  IF NOT EXISTS (SELECT 1 FROM public."MovimientoPartida" WHERE "movimientoId" = NEW.id) THEN
    RAISE EXCEPTION 'Un movimiento sin partidas no se confirma.'
      USING ERRCODE = 'BG503';
  END IF;

  PERFORM 1 FROM public."Articulo"
    WHERE id IN (SELECT "articuloId" FROM public."MovimientoPartida" WHERE "movimientoId" = NEW.id)
    ORDER BY id FOR SHARE;

  -- El factor guardado es una fotografía; si el catálogo cambió desde
  -- entonces, la partida se vuelve a guardar, no se reinterpreta (11 §5).
  SELECT a.clave, p."factorConversion", a."piezasPorCaja" INTO v_partida
  FROM public."MovimientoPartida" p
  JOIN public."Articulo" a ON a.id = p."articuloId"
  WHERE p."movimientoId" = NEW.id
    AND p."presentacionCapturada" = 'CAJA'
    AND p."factorConversion" IS DISTINCT FROM a."piezasPorCaja"
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'El artículo % pasó de % a % piezas por caja: vuelve a guardar esa partida.',
      v_partida.clave, v_partida."factorConversion", coalesce(v_partida."piezasPorCaja"::text, 'ninguna')
      USING ERRCODE = 'BG504';
  END IF;

  IF v_tipo = 'ENTRADA' AND EXISTS (
    SELECT 1 FROM public."MovimientoPartida"
    WHERE "movimientoId" = NEW.id
      AND ("costoUnitarioCapturado" IS NULL OR "tasaIva" IS NULL OR "costoUnitario" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Una entrada se confirma con costo y tasa de IVA en todas sus partidas.'
      USING ERRCODE = 'BG505';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movimiento_transicion
  BEFORE INSERT OR UPDATE ON public."Movimiento"
  FOR EACH ROW EXECUTE FUNCTION verificar_transicion_de_movimiento();

CREATE OR REPLACE FUNCTION impedir_borrar_movimiento_cerrado() RETURNS trigger AS $$
BEGIN
  IF OLD.tipo <> 'SALIDA' AND OLD.estatus <> 'BORRADOR' THEN
    RAISE EXCEPTION 'El movimiento % está %: no se borra.', coalesce(OLD.folio, OLD.id::text), OLD.estatus
      USING ERRCODE = 'BG501';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movimiento_cerrado_no_se_borra
  BEFORE DELETE ON public."Movimiento"
  FOR EACH ROW EXECUTE FUNCTION impedir_borrar_movimiento_cerrado();

-- Las partidas siguen al encabezado: fuera de BORRADOR no se agregan, cambian
-- ni quitan. Y el factor de una CAJA sale del catálogo, no del navegador.
CREATE OR REPLACE FUNCTION verificar_escritura_de_partida() RETURNS trigger AS $$
DECLARE
  -- En un UPDATE que cambia de movimiento son dos encabezados.
  v_encabezados uuid[] := ARRAY(
    SELECT DISTINCT m FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW."movimientoId" END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD."movimientoId" END
    ]) AS m WHERE m IS NOT NULL ORDER BY m
  );
  v_cerrado record;
  v_piezas  integer;
BEGIN
  -- Si el encabezado ya no existe (cascada de un borrador borrado), no hay
  -- nada que proteger.
  PERFORM 1 FROM public."Movimiento" WHERE id = ANY(v_encabezados) ORDER BY id FOR UPDATE;

  SELECT folio, id, estatus INTO v_cerrado FROM public."Movimiento"
    WHERE id = ANY(v_encabezados) AND tipo <> 'SALIDA' AND estatus <> 'BORRADOR' LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Las partidas del movimiento % (%) no se modifican.',
      coalesce(v_cerrado.folio, v_cerrado.id::text), v_cerrado.estatus
      USING ERRCODE = 'BG501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW."presentacionCapturada" = 'CAJA' THEN
    SELECT "piezasPorCaja" INTO v_piezas FROM public."Articulo" WHERE id = NEW."articuloId";
    IF v_piezas IS NULL THEN
      RAISE EXCEPTION 'El artículo no se maneja por caja: no tiene piezas por caja.'
        USING ERRCODE = 'BG506';
    END IF;
    IF NEW."factorConversion" <> v_piezas THEN
      RAISE EXCEPTION 'El factor % no es el del catálogo (% piezas por caja).', NEW."factorConversion", v_piezas
        USING ERRCODE = 'BG506';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER partida_escritura
  BEFORE INSERT OR UPDATE OR DELETE ON public."MovimientoPartida"
  FOR EACH ROW EXECUTE FUNCTION verificar_escritura_de_partida();
