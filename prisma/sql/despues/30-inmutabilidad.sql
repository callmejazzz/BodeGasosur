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
