-- ═══════════════════════════════════════════════════════════════════════════
-- Actor verificable: dos correcciones sobre las fases A y B.
--
-- 1. La bitácora resolvía el actor después de descartar los UPDATE sin cambios
--    (updatedAt aparte), así que tocar solo updatedAt no exigía liga.
-- 2. La guarda de Usuario leía rol y activo del actor sin candado: una
--    revocación concurrente podía confirmarse entre la lectura y el commit.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION registrar_en_bitacora() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a          record;
  v_origen   text;
  v_registro text;
  v_antes    jsonb;
  v_despues  jsonb;
  v_accion   public."AccionBitacora";
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_accion  := 'ELIMINAR';
    v_antes   := to_jsonb(OLD);
    v_despues := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_accion  := 'ACTUALIZAR';
    v_antes   := to_jsonb(OLD);
    v_despues := to_jsonb(NEW);
  ELSE
    v_accion  := 'INSERTAR';
    v_antes   := NULL;
    v_despues := to_jsonb(NEW);
  END IF;

  -- El actor se exige antes de decidir si hay historia: un UPDATE que solo
  -- toca updatedAt también es una escritura.
  SELECT * INTO a FROM seguridad.actor_de_la_escritura(TG_TABLE_SCHEMA, TG_TABLE_NAME);

  -- Un UPDATE que no cambió nada no es historia (updatedAt aparte).
  IF TG_OP = 'UPDATE' AND (v_antes - 'updatedAt') = (v_despues - 'updatedAt') THEN
    RETURN NEW;
  END IF;
  v_origen := a.origen;
  IF a.usuario IS NULL AND v_origen IS NULL THEN
    v_origen := 'escritura-directa';
  END IF;
  v_registro := coalesce(v_despues, v_antes) ->> 'id';

  INSERT INTO public."Bitacora" (tabla, "registroId", accion, "usuarioId", origen, antes, despues, verificacion, jti)
  VALUES (TG_TABLE_NAME, v_registro, v_accion, a.usuario, v_origen, v_antes, v_despues, a.verificacion, a.jti);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION seguridad.usuario_exige_superadmin() RETURNS trigger
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
    -- FOR SHARE: una revocación concurrente espera a este commit, y una que
    -- ya estaba en curso se lee aquí. No hay ciclo con otro superadmin: la
    -- administración de accesos ya bloqueó a todos antes de escribir.
    SELECT rol = 'SUPERADMIN' AND activo INTO v_es_superadmin FROM public."Usuario" WHERE id = a.usuario FOR SHARE;
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
