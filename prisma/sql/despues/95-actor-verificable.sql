-- ═══════════════════════════════════════════════════════════════════════════
-- Actor verificable, fase A.
--
-- El actor de una escritura deja de ser una variable de sesión que cualquiera
-- fija: Clerk firma un JWT RS256 (plantilla bodegasosur-db) y la base lo
-- verifica con la llave pública de la instancia. La base nunca guarda un
-- secreto de firma.
--
-- Fase A: todo lo necesario para ligar el actor y medirlo, sin exigirlo
-- todavía. La bitácora prefiere la liga y marca cada fila con el origen de su
-- actor; la fase B (96-actor-exigido.sql) elimina el camino heredado.
--
-- Diseño completo: https://claude.ai/artifact/2VrXcqG9LFN7sptXcg6vfx (v5).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA seguridad;
REVOKE ALL ON SCHEMA seguridad FROM PUBLIC;
GRANT USAGE ON SCHEMA seguridad TO bodegasosur_ejecucion;

-- Las funciones que cree este rol nacen sin EXECUTE para PUBLIC, en cualquier
-- esquema. La forma IN SCHEMA no sirve: no puede quitar el permiso global.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ── Tablas privadas ────────────────────────────────────────────────────────

-- Solo estos logins escriben con app.usuario_id / app.origen declarados. Se
-- compara session_user, no pertenencias a roles: pg_has_role(..., 'MEMBER')
-- es verdadero por cualquier pertenencia, aunque no dé privilegios.
CREATE TABLE seguridad.login_de_confianza (
  login         name PRIMARY KEY,
  registrado_en timestamptz NOT NULL DEFAULT now()
);
INSERT INTO seguridad.login_de_confianza (login) VALUES (session_user);

CREATE TABLE seguridad.llave_publica (
  kid         text PRIMARY KEY CHECK (length(kid) BETWEEN 1 AND 256),
  emisor      text NOT NULL CHECK (emisor ~ '^https://[^/?#\s]+$'),
  audiencia   text NOT NULL CHECK (length(audiencia) BETWEEN 1 AND 256),
  modulo      bytea NOT NULL CHECK (length(modulo) >= 256 AND get_byte(modulo, 0) <> 0),
  exponente   bytea NOT NULL CHECK (exponente = '\x010001'::bytea),
  vida_maxima integer NOT NULL DEFAULT 120 CHECK (vida_maxima BETWEEN 1 AND 3600),
  activa      boolean NOT NULL DEFAULT true,
  cargada_en  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seguridad.liga_actor (
  xid        xid8 PRIMARY KEY,
  usuario_id uuid NOT NULL,
  jti        text NOT NULL UNIQUE,
  exp        timestamptz NOT NULL
);
CREATE INDEX liga_actor_exp_idx ON seguridad.liga_actor (exp);

-- ── Verificación RS256 (RFC 8017, RSASSA-PKCS1-v1_5 con SHA-256) ───────────

CREATE FUNCTION seguridad.b64url(t text) RETURNS bytea
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF t !~ '^[A-Za-z0-9_-]*$' OR length(t) % 4 = 1 THEN
    RAISE EXCEPTION 'El token de identidad no es válido (base64url).' USING ERRCODE = 'BG701';
  END IF;
  RETURN decode(rpad(translate(t, '-_', '+/'), (length(t) + 3) / 4 * 4, '='), 'base64');
END $$;

CREATE FUNCTION seguridad.a_numero(b bytea) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
DECLARE r numeric := 0;
BEGIN
  FOR i IN 0 .. length(b) - 1 LOOP r := r * 256 + get_byte(b, i); END LOOP;
  RETURN r;
END $$;

CREATE FUNCTION seguridad.a_bytes(x numeric, k integer) RETURNS bytea
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
DECLARE r bytea := '\x'::bytea;
BEGIN
  FOR i IN 1 .. k LOOP
    r := set_byte('\x00'::bytea, 0, mod(x, 256)::integer) || r;
    x := div(x, 256);
  END LOOP;
  IF x <> 0 THEN RAISE EXCEPTION 'El número no cabe en % octetos.', k; END IF;
  RETURN r;
END $$;

CREATE FUNCTION seguridad.potencia(b numeric, e numeric, m numeric) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
DECLARE r numeric := 1;
BEGIN
  b := mod(b, m);
  WHILE e > 0 LOOP
    IF mod(e, 2) = 1 THEN r := mod(r * b, m); END IF;
    e := div(e, 2);
    b := mod(b * b, m);
  END LOOP;
  RETURN mod(r, m);
END $$;

-- El núcleo, sin política: cualquier módulo y exponente (así se prueba con
-- los vectores de Wycheproof). La política —2048 bits o más, e = 65537— la
-- imponen las restricciones de llave_publica.
CREATE FUNCTION seguridad.firma_rs256_valida(mensaje bytea, firma bytea, modulo bytea, exponente bytea) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  k integer := length(modulo);
  n numeric;
  s numeric;
  esperado bytea;
BEGIN
  -- §8.2.2: la firma mide exactamente k octetos y su valor es menor que n.
  -- §9.2: k alcanza para DigestInfo (51 octetos) más 11 de relleno mínimo.
  IF k < 62 OR get_byte(modulo, 0) = 0 OR length(firma) <> k THEN RETURN false; END IF;
  n := seguridad.a_numero(modulo);
  s := seguridad.a_numero(firma);
  IF s >= n THEN RETURN false; END IF;
  -- Se arma el mensaje codificado esperado completo —relleno, DigestInfo DER
  -- de SHA-256 con NULL y hash— y se compara byte a byte. Nunca se interpreta
  -- la estructura recibida: así no hay relleno ni ASN.1 «tolerable».
  esperado := '\x0001'::bytea || decode(repeat('ff', k - 54), 'hex') || '\x00'::bytea
    || '\x3031300d060960864801650304020105000420'::bytea || sha256(mensaje);
  RETURN seguridad.a_bytes(seguridad.potencia(s, seguridad.a_numero(exponente), n), k) = esperado;
END $$;

-- ── El token ───────────────────────────────────────────────────────────────

CREATE FUNCTION seguridad.rechazar(motivo text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'El token de identidad no es válido (%).', motivo USING ERRCODE = 'BG701';
END $$;

CREATE FUNCTION seguridad.validar_token(token text, OUT kid text, OUT sub text, OUT jti text, OUT exp timestamptz)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  margen constant integer := 5;
  partes text[];
  encabezado jsonb;
  carga jsonb;
  llave seguridad.llave_publica;
  ahora numeric := extract(epoch FROM clock_timestamp());
  v_exp numeric;
  v_nbf numeric;
  v_iat numeric;
BEGIN
  IF token IS NULL OR length(token) > 4096 OR token !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' THEN
    PERFORM seguridad.rechazar('forma');
  END IF;
  partes := string_to_array(token, '.');
  BEGIN
    encabezado := convert_from(seguridad.b64url(partes[1]), 'UTF8')::jsonb;
    carga := convert_from(seguridad.b64url(partes[2]), 'UTF8')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    PERFORM seguridad.rechazar('json');
  END;
  IF jsonb_typeof(encabezado) <> 'object' OR jsonb_typeof(carga) <> 'object' THEN
    PERFORM seguridad.rechazar('json');
  END IF;

  -- Solo RS256: ni none, ni HS256 con la llave pública como secreto.
  IF encabezado -> 'alg' IS DISTINCT FROM '"RS256"'::jsonb THEN PERFORM seguridad.rechazar('alg'); END IF;
  IF encabezado ? 'crit' THEN PERFORM seguridad.rechazar('crit'); END IF;
  IF jsonb_typeof(encabezado -> 'kid') IS DISTINCT FROM 'string' THEN PERFORM seguridad.rechazar('kid'); END IF;
  kid := encabezado ->> 'kid';

  SELECT * INTO llave FROM seguridad.llave_publica l WHERE l.kid = validar_token.kid AND l.activa;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La llave % no está cargada.', left(kid, 64) USING ERRCODE = 'BG702';
  END IF;

  IF NOT seguridad.firma_rs256_valida(convert_to(partes[1] || '.' || partes[2], 'UTF8'),
                                      seguridad.b64url(partes[3]), llave.modulo, llave.exponente) THEN
    PERFORM seguridad.rechazar('firma');
  END IF;

  IF carga -> 'iss' IS DISTINCT FROM to_jsonb(llave.emisor) THEN PERFORM seguridad.rechazar('iss'); END IF;
  IF carga -> 'aud' IS DISTINCT FROM to_jsonb(llave.audiencia) THEN PERFORM seguridad.rechazar('aud'); END IF;
  IF jsonb_typeof(carga -> 'exp') IS DISTINCT FROM 'number'
     OR jsonb_typeof(carga -> 'nbf') IS DISTINCT FROM 'number'
     OR jsonb_typeof(carga -> 'iat') IS DISTINCT FROM 'number' THEN
    PERFORM seguridad.rechazar('tiempos');
  END IF;
  v_exp := (carga ->> 'exp')::numeric;
  v_nbf := (carga ->> 'nbf')::numeric;
  v_iat := (carga ->> 'iat')::numeric;
  IF v_exp <= ahora - margen THEN PERFORM seguridad.rechazar('vencido'); END IF;
  IF v_nbf > ahora + margen THEN PERFORM seguridad.rechazar('nbf'); END IF;
  IF v_iat > ahora + margen THEN PERFORM seguridad.rechazar('iat'); END IF;
  IF v_exp <= v_iat OR v_exp - v_iat > llave.vida_maxima THEN PERFORM seguridad.rechazar('vida'); END IF;

  IF jsonb_typeof(carga -> 'sub') IS DISTINCT FROM 'string' OR length(carga ->> 'sub') NOT BETWEEN 1 AND 128 THEN
    PERFORM seguridad.rechazar('sub');
  END IF;
  IF jsonb_typeof(carga -> 'jti') IS DISTINCT FROM 'string' OR length(carga ->> 'jti') NOT BETWEEN 1 AND 128 THEN
    PERFORM seguridad.rechazar('jti');
  END IF;
  sub := carga ->> 'sub';
  jti := carga ->> 'jti';
  exp := to_timestamp(v_exp);
END $$;

-- ── Las funciones públicas ─────────────────────────────────────────────────

-- La primera sentencia de toda transacción de accionProtegida(). Liga el
-- actor a la transacción; un segundo llamado falla. El jti es único: dos
-- transacciones confirmadas no usan el mismo token, pero si una se revierte
-- su reserva se revierte con ella («uso confirmado»).
CREATE FUNCTION seguridad.fijar_actor(token text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t record;
  v_usuario uuid;
BEGIN
  SELECT * INTO t FROM seguridad.validar_token(token);
  SELECT id INTO v_usuario FROM public."Usuario" WHERE "clerkUserId" = t.sub AND activo;
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'La identidad del token no tiene un usuario activo.' USING ERRCODE = 'BG705';
  END IF;
  IF EXISTS (SELECT 1 FROM seguridad.liga_actor WHERE xid = pg_current_xact_id()) THEN
    RAISE EXCEPTION 'Esta transacción ya tiene un actor.' USING ERRCODE = 'BG704';
  END IF;

  -- Las vencidas ya no sirven: exp las rechaza. SKIP LOCKED para no esperar
  -- a otra transacción que esté purgando.
  DELETE FROM seguridad.liga_actor WHERE ctid IN (
    SELECT ctid FROM seguridad.liga_actor
     WHERE exp < clock_timestamp() - interval '10 minutes'
     LIMIT 100 FOR UPDATE SKIP LOCKED);

  BEGIN
    INSERT INTO seguridad.liga_actor (xid, usuario_id, jti, exp)
    VALUES (pg_current_xact_id(), v_usuario, t.jti, t.exp);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'El token de identidad ya se usó.' USING ERRCODE = 'BG703';
  END;
  RETURN v_usuario;
END $$;

-- Solo registra un acceso que de verdad está denegado: sin Usuario, o con uno
-- inactivo (la misma condición con la que sesionActual() decide «sin acceso»).
-- Un registro cada 15 minutos por identidad.
CREATE FUNCTION seguridad.registrar_acceso_denegado(token text, ip text, agente text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t record;
  v_usuario uuid;
  v_activo boolean;
BEGIN
  SELECT * INTO t FROM seguridad.validar_token(token);
  SELECT id, activo INTO v_usuario, v_activo FROM public."Usuario" WHERE "clerkUserId" = t.sub;
  IF v_activo THEN
    RAISE EXCEPTION 'Esta identidad tiene acceso: no hay acceso denegado que registrar.' USING ERRCODE = 'BG711';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('acceso-denegado:' || t.sub, 0));
  IF EXISTS (SELECT 1 FROM public."EventoAcceso"
              WHERE "clerkUserId" = t.sub AND tipo = 'ACCESO_DENEGADO'
                AND "ocurridoEn" >= clock_timestamp() - interval '15 minutes') THEN
    RETURN false;
  END IF;
  INSERT INTO public."EventoAcceso" ("clerkUserId", "usuarioId", tipo, ip, agente)
  VALUES (t.sub, v_usuario, 'ACCESO_DENEGADO', left(ip, 128), left(agente, 512));
  RETURN true;
END $$;

-- La ruta del webhook para los eventos de sesión. El origen sigue siendo
-- declarado hasta que se verifique la firma Svix en la base.
CREATE FUNCTION seguridad.registrar_evento_de_sesion(clerk_user_id text, tipo text, ip text, agente text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_usuario uuid;
BEGIN
  IF current_setting('app.origen', true) IS DISTINCT FROM 'clerk-webhook' THEN
    RAISE EXCEPTION 'Solo el webhook de Clerk registra eventos de sesión.' USING ERRCODE = 'BG710';
  END IF;
  IF tipo NOT IN ('SESION_INICIADA', 'SESION_TERMINADA', 'SESION_REMOVIDA', 'SESION_REVOCADA') THEN
    RAISE EXCEPTION 'Tipo de evento de sesión desconocido.' USING ERRCODE = 'BG710';
  END IF;
  SELECT id INTO v_usuario FROM public."Usuario" WHERE "clerkUserId" = clerk_user_id;
  -- Sin fila local no se registra: EventoAcceso dice quién entró al sistema.
  IF v_usuario IS NULL THEN RETURN false; END IF;
  INSERT INTO public."EventoAcceso" ("clerkUserId", "usuarioId", tipo, ip, agente)
  VALUES (clerk_user_id, v_usuario, tipo::public."TipoEventoAcceso", left(ip, 128), left(agente, 512));
  RETURN true;
END $$;

-- Para la alerta anticipada de rotación: solo identificadores públicos.
CREATE FUNCTION seguridad.kids_cargados() RETURNS TABLE (kid text, emisor text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT l.kid, l.emisor FROM seguridad.llave_publica l WHERE l.activa ORDER BY l.emisor, l.kid
$$;

-- ── Funciones del dueño ────────────────────────────────────────────────────

CREATE FUNCTION seguridad.cargar_llave(p_kid text, p_emisor text, p_audiencia text, p_modulo bytea, p_exponente bytea)
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
DECLARE previa seguridad.llave_publica;
BEGIN
  SELECT * INTO previa FROM seguridad.llave_publica WHERE kid = p_kid;
  IF NOT FOUND THEN
    INSERT INTO seguridad.llave_publica (kid, emisor, audiencia, modulo, exponente)
    VALUES (p_kid, p_emisor, p_audiencia, p_modulo, p_exponente);
    RETURN 'cargada';
  END IF;
  -- Un kid no cambia de llave: si cambiara, es otra llave con el mismo nombre.
  IF previa.modulo <> p_modulo OR previa.exponente <> p_exponente
     OR previa.emisor <> p_emisor OR previa.audiencia <> p_audiencia THEN
    RAISE EXCEPTION 'El kid % ya existe con otra llave, emisor o audiencia.', p_kid;
  END IF;
  IF previa.activa THEN RETURN 'sin-cambio'; END IF;
  UPDATE seguridad.llave_publica SET activa = true WHERE kid = p_kid;
  RETURN 'reactivada';
END $$;

CREATE FUNCTION seguridad.desactivar_llave(p_kid text) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  UPDATE seguridad.llave_publica SET activa = false WHERE kid = p_kid AND activa RETURNING true
$$;

-- Comprueba un token real sin ligarlo, para confirmar kid, iss y aud.
CREATE FUNCTION seguridad.probar_token(token text) RETURNS TABLE (kid text, sub text, vida_segundos integer, expira timestamptz)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE t record;
BEGIN
  SELECT * INTO t FROM seguridad.validar_token(token);
  kid := t.kid;
  sub := t.sub;
  vida_segundos := (convert_from(seguridad.b64url(split_part(token, '.', 2)), 'UTF8')::jsonb ->> 'exp')::integer
                 - (convert_from(seguridad.b64url(split_part(token, '.', 2)), 'UTF8')::jsonb ->> 'iat')::integer;
  expira := t.exp;
  RETURN NEXT;
END $$;

-- ── De dónde sale el actor de una escritura ───────────────────────────────
--
--   liga       token verificado por fijar_actor()
--   dueño      login de confianza con app.usuario_id / app.origen declarados
--   declarada  origen clerk-webhook, sin liga, sobre Usuario o EventoWebhook
--   heredada   usuario de ejecución sin liga: solo en la fase A, y se mide
--
-- La fase B reemplaza esta función para que «heredada» sea un rechazo.

CREATE FUNCTION seguridad.actor_de_la_escritura(p_esquema text, p_tabla text,
  OUT usuario uuid, OUT origen text, OUT verificacion text, OUT jti text)
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  SELECT l.usuario_id, l.jti INTO usuario, jti FROM seguridad.liga_actor l WHERE l.xid = pg_current_xact_id();
  IF usuario IS NOT NULL THEN
    verificacion := 'liga';
    RETURN;
  END IF;

  -- Lo declarado: si trae basura, se pierde el actor y no la escritura.
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
    verificacion := 'heredada';
  END IF;
END $$;

-- ── Bitácora de transición ─────────────────────────────────────────────────
--
-- Pasa a SECURITY DEFINER: lee la liga y escribe Bitacora como dueño, así que
-- al usuario de ejecución se le puede quitar el INSERT directo sin cortar
-- ningún camino legítimo. Cada fila guarda de dónde salió su actor y, con
-- liga, el jti del token.

ALTER TABLE "Bitacora" ADD CONSTRAINT bitacora_verificacion_ck
  CHECK (verificacion IN ('liga', 'dueño', 'declarada', 'heredada'));

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
    -- Un UPDATE que no cambió nada no es historia (updatedAt aparte).
    IF (v_antes - 'updatedAt') = (v_despues - 'updatedAt') THEN
      RETURN NEW;
    END IF;
  ELSE
    v_accion  := 'INSERTAR';
    v_antes   := NULL;
    v_despues := to_jsonb(NEW);
  END IF;

  SELECT * INTO a FROM seguridad.actor_de_la_escritura(TG_TABLE_SCHEMA, TG_TABLE_NAME);
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

-- ── Usuario: la identidad de Clerk no cambia ───────────────────────────────
--
-- Para todos, dueño incluido. Un re-enlace de identidades (por ejemplo, al
-- pasar a la instancia de producción de Clerk) se hace con una migración que
-- desactive este trigger de forma explícita dentro de su transacción.

CREATE FUNCTION seguridad.clerk_user_id_inmutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW."clerkUserId" IS DISTINCT FROM OLD."clerkUserId" THEN
    RAISE EXCEPTION 'La identidad de Clerk de un usuario no cambia.' USING ERRCODE = 'BG709';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER clerk_user_id_inmutable BEFORE UPDATE ON "Usuario"
  FOR EACH ROW EXECUTE FUNCTION seguridad.clerk_user_id_inmutable();

-- ── Privilegios ────────────────────────────────────────────────────────────

REVOKE ALL ON ALL TABLES IN SCHEMA seguridad FROM PUBLIC, bodegasosur_ejecucion;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA seguridad FROM PUBLIC, bodegasosur_ejecucion;
GRANT EXECUTE ON FUNCTION
  seguridad.fijar_actor(text),
  seguridad.registrar_acceso_denegado(text, text, text),
  seguridad.registrar_evento_de_sesion(text, text, text, text),
  seguridad.kids_cargados()
TO bodegasosur_ejecucion;

-- La bitácora solo la escribe su trigger, y nadie borra usuarios.
REVOKE INSERT ON "Bitacora" FROM bodegasosur_ejecucion;
REVOKE DELETE ON "Usuario" FROM bodegasosur_ejecucion;
