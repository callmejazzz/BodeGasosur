-- ═══════════════════════════════════════════════════════════════════════════
-- Actor verificable, fase B: la liga se exige.
--
-- Todo lo que escribe un login fuera de seguridad.login_de_confianza necesita
-- una liga de fijar_actor(). La única excepción es el alcance del webhook de
-- Clerk, cuyo origen sigue siendo declarado hasta verificar la firma Svix.
-- ═══════════════════════════════════════════════════════════════════════════

-- «heredada» deja de existir: sin liga ni confianza, la escritura se rechaza.
CREATE OR REPLACE FUNCTION seguridad.actor_de_la_escritura(p_esquema text, p_tabla text,
  OUT usuario uuid, OUT origen text, OUT verificacion text, OUT jti text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT l.usuario_id, l.jti INTO usuario, jti FROM seguridad.liga_actor l WHERE l.xid = pg_current_xact_id();
  IF usuario IS NOT NULL THEN
    verificacion := 'liga';
    RETURN;
  END IF;

  BEGIN
    usuario := nullif(current_setting('app.usuario_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    usuario := NULL;
  END;
  origen := nullif(current_setting('app.origen', true), '');

  IF session_user IN (SELECT c.login FROM seguridad.login_de_confianza c) THEN
    verificacion := 'dueño';
  ELSIF usuario IS NULL AND origen = 'clerk-webhook' AND p_esquema = 'public' AND p_tabla IN ('Usuario', 'EventoWebhook') THEN
    verificacion := 'declarada';
  ELSE
    RAISE EXCEPTION 'Escritura sin actor verificado en %.', p_tabla USING ERRCODE = 'BG706';
  END IF;
END $$;

-- ── Tablas sin bitácora ────────────────────────────────────────────────────
-- Existencia, ConsumoCapa y Folio no llevan bitácora, pero tampoco se
-- escriben sin actor. EventoWebhook admite el origen declarado del webhook.

CREATE FUNCTION seguridad.exigir_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM seguridad.actor_de_la_escritura(TG_TABLE_SCHEMA, TG_TABLE_NAME);
  RETURN NULL;
END $$;

CREATE TRIGGER exigir_actor BEFORE INSERT OR UPDATE OR DELETE ON "Existencia"
  FOR EACH STATEMENT EXECUTE FUNCTION seguridad.exigir_actor();
CREATE TRIGGER exigir_actor BEFORE INSERT OR UPDATE OR DELETE ON "ConsumoCapa"
  FOR EACH STATEMENT EXECUTE FUNCTION seguridad.exigir_actor();
CREATE TRIGGER exigir_actor BEFORE INSERT OR UPDATE OR DELETE ON "Folio"
  FOR EACH STATEMENT EXECUTE FUNCTION seguridad.exigir_actor();
CREATE TRIGGER exigir_actor BEFORE INSERT OR UPDATE OR DELETE ON "EventoWebhook"
  FOR EACH STATEMENT EXECUTE FUNCTION seguridad.exigir_actor();

-- ── Columnas de actor de Movimiento ────────────────────────────────────────
-- Con liga: al insertar, creadoPorId es el actor y las otras seis van nulas;
-- al actualizar, una columna solo pasa de nula al actor y ya no cambia.
-- solicitadoPorId queda fuera: apunta a una Persona.

CREATE FUNCTION seguridad.columnas_de_actor() RETURNS trigger
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
    IF NEW."creadoPorId" IS DISTINCT FROM a.usuario
       OR num_nonnulls(NEW."confirmadoPorId", NEW."autorizadoPorId", NEW."rechazadoPorId",
                       NEW."entregadoPorId", NEW."recibidoPorId", NEW."canceladoPorId") > 0 THEN
      RAISE EXCEPTION 'Un movimiento nuevo solo lleva como actor a quien lo crea.' USING ERRCODE = 'BG707';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."creadoPorId" IS DISTINCT FROM OLD."creadoPorId" THEN
    RAISE EXCEPTION 'El creador de un movimiento no cambia.' USING ERRCODE = 'BG707';
  END IF;
  FOREACH columna IN ARRAY ARRAY['confirmadoPorId', 'autorizadoPorId', 'rechazadoPorId',
                                 'entregadoPorId', 'recibidoPorId', 'canceladoPorId'] LOOP
    antes := (to_jsonb(OLD) ->> columna)::uuid;
    despues := (to_jsonb(NEW) ->> columna)::uuid;
    IF despues IS DISTINCT FROM antes AND (antes IS NOT NULL OR despues IS DISTINCT FROM a.usuario) THEN
      RAISE EXCEPTION 'La columna % solo puede tomar al actor verificado, y una sola vez.', columna USING ERRCODE = 'BG707';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER columnas_de_actor BEFORE INSERT OR UPDATE ON "Movimiento"
  FOR EACH ROW EXECUTE FUNCTION seguridad.columnas_de_actor();

-- ── Usuario ────────────────────────────────────────────────────────────────
-- Con liga, solo un superadmin activo inserta o cambia usuarios. Sin liga,
-- el webhook solo cambia el correo o da de baja. DELETE ya está revocado.

CREATE FUNCTION seguridad.usuario_exige_superadmin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
  v_es_superadmin boolean;
BEGIN
  SELECT * INTO a FROM seguridad.actor_de_la_escritura(TG_TABLE_SCHEMA, TG_TABLE_NAME);
  IF a.verificacion = 'dueño' THEN
    RETURN NEW;
  END IF;

  IF a.verificacion = 'liga' THEN
    SELECT rol = 'SUPERADMIN' AND activo INTO v_es_superadmin FROM public."Usuario" WHERE id = a.usuario;
    IF v_es_superadmin THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Solo un superadmin activo da de alta o cambia usuarios.' USING ERRCODE = 'BG708';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'correo' - 'activo' - 'updatedAt') = (to_jsonb(OLD) - 'correo' - 'activo' - 'updatedAt')
     AND NOT (NEW.activo AND NOT OLD.activo) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'El webhook de Clerk solo cambia el correo o da de baja a un usuario.' USING ERRCODE = 'BG710';
END $$;

CREATE TRIGGER usuario_exige_superadmin BEFORE INSERT OR UPDATE ON "Usuario"
  FOR EACH ROW EXECUTE FUNCTION seguridad.usuario_exige_superadmin();

-- ── Privilegios ────────────────────────────────────────────────────────────

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA seguridad FROM PUBLIC, bodegasosur_ejecucion;
GRANT EXECUTE ON FUNCTION
  seguridad.fijar_actor(text),
  seguridad.registrar_acceso_denegado(text, text, text),
  seguridad.registrar_evento_de_sesion(text, text, text, text),
  seguridad.kids_cargados()
TO bodegasosur_ejecucion;

-- Los accesos solo se registran por sus funciones.
REVOKE INSERT ON "EventoAcceso" FROM bodegasosur_ejecucion;
