-- Fase 9, entrega 1: preferencia de alertas y tablas de la alerta diaria. El DDL que sale
-- de schema.prisma, seguido de la copia de prisma/sql/despues/997-correo-y-preferencia.sql.

-- CreateEnum
CREATE TYPE "ResultadoEvaluacion" AS ENUM ('CON_ENVIO', 'SIN_BAJO_MINIMO', 'SIN_DESTINATARIOS');

-- CreateEnum
CREATE TYPE "EstadoLote" AS ENUM ('PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'VENCIDO', 'SIN_CONFIRMAR');

-- CreateEnum
CREATE TYPE "EstadoRegistroCorreo" AS ENUM ('PENDIENTE', 'ENVIADO', 'FALLIDO', 'SIN_CONFIRMAR');

-- CreateEnum
CREATE TYPE "ClaseRebote" AS ENUM ('PERMANENTE', 'TRANSITORIO', 'INDETERMINADO');

-- CreateEnum
CREATE TYPE "AnomaliaCorreo" AS ENUM ('ETIQUETA_DESCONOCIDA', 'SIN_ETIQUETA', 'ETIQUETA_E_ID_DISCREPAN', 'DESTINATARIO_DISTINTO', 'ID_DISTINTO');

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "alertasCorreo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EvaluacionCorreos" (
    "id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "resultado" "ResultadoEvaluacion" NOT NULL,
    "articulos" INTEGER NOT NULL,
    "renglones" INTEGER NOT NULL,
    "destinatarios" INTEGER NOT NULL,
    "lotes" INTEGER NOT NULL,
    "evaluadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluacionCorreos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoteCorreos" (
    "id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "numero" INTEGER NOT NULL,
    "llave" TEXT NOT NULL,
    "remitente" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "articulos" INTEGER NOT NULL,
    "estado" "EstadoLote" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimoIntentoEn" TIMESTAMPTZ(3),
    "arrendadoHasta" TIMESTAMPTZ(3),
    "motivo" TEXT,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoEn" TIMESTAMPTZ(3),

    CONSTRAINT "LoteCorreos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistroCorreos" (
    "id" UUID NOT NULL,
    "loteId" UUID NOT NULL,
    "posicion" INTEGER NOT NULL,
    "fecha" DATE NOT NULL,
    "usuarioId" UUID NOT NULL,
    "correo" TEXT NOT NULL,
    "estado" "EstadoRegistroCorreo" NOT NULL DEFAULT 'PENDIENTE',
    "resendId" TEXT,
    "motivo" TEXT,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistroCorreos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoCorreo" (
    "id" UUID NOT NULL,
    "svixId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "resendId" TEXT,
    "registroId" UUID,
    "anomalia" "AnomaliaCorreo",
    "etiquetaRecibida" TEXT,
    "rebote" "ClaseRebote",
    "subtipoRebote" TEXT,
    "motivoFallo" TEXT,
    "tipoSupresion" TEXT,
    "ocurridoEn" TIMESTAMPTZ(3) NOT NULL,
    "recibidoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoCorreo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EvaluacionCorreos_fecha_key" ON "EvaluacionCorreos"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "LoteCorreos_llave_key" ON "LoteCorreos"("llave");

-- CreateIndex
CREATE UNIQUE INDEX "LoteCorreos_fecha_numero_key" ON "LoteCorreos"("fecha", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "LoteCorreos_id_fecha_key" ON "LoteCorreos"("id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "RegistroCorreos_resendId_key" ON "RegistroCorreos"("resendId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistroCorreos_fecha_usuarioId_key" ON "RegistroCorreos"("fecha", "usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "RegistroCorreos_loteId_posicion_key" ON "RegistroCorreos"("loteId", "posicion");

-- CreateIndex
CREATE UNIQUE INDEX "EventoCorreo_svixId_key" ON "EventoCorreo"("svixId");

-- CreateIndex
CREATE INDEX "EventoCorreo_registroId_idx" ON "EventoCorreo"("registroId");

-- AddForeignKey
ALTER TABLE "RegistroCorreos" ADD CONSTRAINT "RegistroCorreos_loteId_fecha_fkey" FOREIGN KEY ("loteId", "fecha") REFERENCES "LoteCorreos"("id", "fecha") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroCorreos" ADD CONSTRAINT "RegistroCorreos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoCorreo" ADD CONSTRAINT "EventoCorreo_registroId_fkey" FOREIGN KEY ("registroId") REFERENCES "RegistroCorreos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Fase 9, entrega 1: preferencia de alertas y tablas de la alerta diaria.
--
-- · Usuario: cada quien cambia solo su alertasCorreo; nadie más (BG712).
-- · Orígenes resumen-diario y resend-webhook, cada uno con sus tablas.
-- · Las cuatro tablas de correo solo las escriben esos orígenes y el dueño:
--   con sesión de una persona, la escritura falla con BG706.
-- · El índice de correo de Usuario usa el criterio de la exclusión.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Índice de correo ───────────────────────────────────────────────────────
-- El nuevo se crea antes de borrar el viejo: la unicidad nunca falta.

CREATE UNIQUE INDEX "usuario_correo_activo_uq_nuevo" ON public."Usuario" (lower(btrim(correo))) WHERE activo;
DROP INDEX public."usuario_correo_activo_uq";
ALTER INDEX public."usuario_correo_activo_uq_nuevo" RENAME TO "usuario_correo_activo_uq";

-- ── Orígenes de sistema ────────────────────────────────────────────────────

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
  ELSIF usuario IS NULL AND p_esquema = 'public' AND (
       (origen = 'clerk-webhook' AND p_tabla IN ('Usuario', 'EventoWebhook'))
    OR (origen = 'resumen-diario' AND p_tabla IN ('EvaluacionCorreos', 'LoteCorreos', 'RegistroCorreos'))
    OR (origen = 'resend-webhook' AND p_tabla IN ('EventoCorreo', 'LoteCorreos', 'RegistroCorreos'))) THEN
    verificacion := 'declarada';
  ELSE
    RAISE EXCEPTION 'Escritura sin actor verificado en %.', p_tabla USING ERRCODE = 'BG706';
  END IF;
END $$;

-- ── Guarda de Usuario ──────────────────────────────────────────────────────
-- La preferencia va antes de la regla del superadmin: ni él toca la de otro.
-- El cambio propio decide con OLD, sin leer otra fila ni tomar candados.

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
    IF TG_OP = 'INSERT' AND NEW."alertasCorreo" THEN
      RAISE EXCEPTION 'Un usuario nuevo empieza sin alertas por correo.' USING ERRCODE = 'BG712';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."alertasCorreo" IS DISTINCT FROM OLD."alertasCorreo" THEN
      IF a.usuario IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Solo cada usuario cambia su propia alerta por correo.' USING ERRCODE = 'BG712';
      END IF;
      IF OLD.activo AND (to_jsonb(NEW) - 'alertasCorreo' - 'updatedAt') = (to_jsonb(OLD) - 'alertasCorreo' - 'updatedAt') THEN
        RETURN NEW;
      END IF;
    END IF;

    -- FOR SHARE: ver 98-correcciones-actor.sql.
    SELECT rol = 'SUPERADMIN' AND activo INTO v_es_superadmin FROM public."Usuario" WHERE id = a.usuario FOR SHARE;
    IF v_es_superadmin THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Solo un superadmin activo da de alta o cambia usuarios.' USING ERRCODE = 'BG708';
  END IF;

  -- alertasCorreo no está entre lo que el webhook puede tocar: sigue en BG710.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'correo' - 'activo' - 'updatedAt') = (to_jsonb(OLD) - 'correo' - 'activo' - 'updatedAt')
     AND NOT (NEW.activo AND NOT OLD.activo) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'El webhook de Clerk solo cambia el correo o da de baja a un usuario.' USING ERRCODE = 'BG710';
END $$;

-- ── Tablas de correo: quién escribe ────────────────────────────────────────
-- resumen-diario inserta en las tres de la reserva; resend-webhook inserta
-- eventos; ambos concilian lotes y registros. Nadie con sesión escribe aquí.

CREATE FUNCTION seguridad.correo_exige_su_origen() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM seguridad.actor_de_la_escritura(TG_TABLE_SCHEMA, TG_TABLE_NAME);
  IF a.verificacion = 'dueño' THEN
    RETURN NULL;
  END IF;
  IF a.verificacion = 'declarada' AND (
       (TG_OP = 'INSERT' AND a.origen = 'resumen-diario' AND TG_TABLE_NAME IN ('EvaluacionCorreos', 'LoteCorreos', 'RegistroCorreos'))
    OR (TG_OP = 'INSERT' AND a.origen = 'resend-webhook' AND TG_TABLE_NAME = 'EventoCorreo')
    OR (TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('LoteCorreos', 'RegistroCorreos'))) THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION '% no admite % con esta conexión: solo la escribe el proceso de correo.', TG_TABLE_NAME, TG_OP USING ERRCODE = 'BG706';
END $$;

CREATE TRIGGER correo_exige_su_origen BEFORE INSERT OR UPDATE OR DELETE ON "EvaluacionCorreos"
  FOR EACH STATEMENT EXECUTE FUNCTION seguridad.correo_exige_su_origen();
CREATE TRIGGER correo_exige_su_origen BEFORE INSERT OR UPDATE OR DELETE ON "LoteCorreos"
  FOR EACH STATEMENT EXECUTE FUNCTION seguridad.correo_exige_su_origen();
CREATE TRIGGER correo_exige_su_origen BEFORE INSERT OR UPDATE OR DELETE ON "RegistroCorreos"
  FOR EACH STATEMENT EXECUTE FUNCTION seguridad.correo_exige_su_origen();
CREATE TRIGGER correo_exige_su_origen BEFORE INSERT OR UPDATE OR DELETE ON "EventoCorreo"
  FOR EACH STATEMENT EXECUTE FUNCTION seguridad.correo_exige_su_origen();

-- ── Candado del día ────────────────────────────────────────────────────────
-- El mismo que toma la reserva como primera sentencia (contrato §3.4, paso 1).
-- Las altas lo vuelven a tomar: es reentrante dentro de la transacción.

CREATE FUNCTION candado_correos_del_dia(p_fecha date) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(909, p_fecha - DATE '2000-01-01');
END $$;

GRANT EXECUTE ON FUNCTION candado_correos_del_dia(date) TO bodegasosur_ejecucion;

-- ── Restricciones ──────────────────────────────────────────────────────────

ALTER TABLE "EvaluacionCorreos"
  ADD CONSTRAINT evaluacion_correos_cifras_ck CHECK (
    articulos >= 0 AND renglones >= articulos AND destinatarios >= 0 AND lotes >= 0),
  ADD CONSTRAINT evaluacion_correos_resultado_ck CHECK (CASE resultado
    WHEN 'SIN_BAJO_MINIMO' THEN articulos = 0 AND destinatarios = 0 AND lotes = 0
    WHEN 'SIN_DESTINATARIOS' THEN articulos > 0 AND destinatarios = 0 AND lotes = 0
    WHEN 'CON_ENVIO' THEN articulos > 0 AND destinatarios > 0 AND lotes = (destinatarios + 99) / 100
  END);

ALTER TABLE "LoteCorreos"
  ADD CONSTRAINT lote_correos_llave_ck CHECK (numero >= 1 AND llave = 'resumen-' || to_char(fecha, 'YYYY-MM-DD') || '-' || numero::text),
  ADD CONSTRAINT lote_correos_contenido_ck CHECK (
    btrim(remitente) <> '' AND btrim(asunto) <> '' AND btrim(html) <> '' AND btrim(texto) <> '' AND articulos > 0),
  ADD CONSTRAINT lote_correos_intentos_ck CHECK (
    intentos >= 0 AND (intentos = 0) = ("ultimoIntentoEn" IS NULL) AND ("arrendadoHasta" IS NULL OR intentos > 0)),
  ADD CONSTRAINT lote_correos_resuelto_ck CHECK ((estado = 'PENDIENTE') = ("resueltoEn" IS NULL)),
  ADD CONSTRAINT lote_correos_vencido_ck CHECK (estado <> 'VENCIDO' OR intentos = 0);

ALTER TABLE "RegistroCorreos"
  ADD CONSTRAINT registro_correos_posicion_ck CHECK (posicion BETWEEN 0 AND 99),
  ADD CONSTRAINT registro_correos_correo_ck CHECK (btrim(correo) <> ''),
  ADD CONSTRAINT registro_correos_enviado_ck CHECK ((estado = 'ENVIADO') = ("resendId" IS NOT NULL) AND ("resendId" IS NULL OR btrim("resendId") <> ''));

-- La exclusión por dirección busca con este criterio (contrato §3.7).
CREATE INDEX registro_correos_direccion_idx ON "RegistroCorreos" (lower(btrim(correo)));

ALTER TABLE "EventoCorreo"
  ADD CONSTRAINT evento_correo_asociacion_ck CHECK (
    num_nonnulls("registroId", anomalia) = 1 AND (anomalia IS NOT NULL OR "etiquetaRecibida" IS NULL)),
  ADD CONSTRAINT evento_correo_datos_ck CHECK (
    btrim("svixId") <> '' AND btrim(tipo) <> '' AND ("subtipoRebote" IS NULL OR rebote IS NOT NULL));

-- ── Altas ──────────────────────────────────────────────────────────────────
-- Lotes y registros nacen pendientes y solo antes de la evaluación del día, que
-- se inserta al final de la reserva: así los integrantes quedan cerrados. La
-- evaluación debe cuadrar con lo reservado. La reserva corre en READ COMMITTED:
-- tras el candado, cada sentencia ve lo ya confirmado.

CREATE FUNCTION correo_alta() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_lotes     int;
  v_registros int;
BEGIN
  PERFORM candado_correos_del_dia(NEW.fecha);

  IF TG_TABLE_NAME = 'EvaluacionCorreos' THEN
    SELECT count(*) INTO v_lotes FROM "LoteCorreos" WHERE fecha = NEW.fecha;
    SELECT count(*) INTO v_registros FROM "RegistroCorreos" WHERE fecha = NEW.fecha;
    IF v_lotes <> NEW.lotes OR v_registros <> NEW.destinatarios THEN
      RAISE EXCEPTION 'La evaluación del % no cuadra con lo reservado: % lotes y % destinatarios.', NEW.fecha, v_lotes, v_registros
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM "EvaluacionCorreos" WHERE fecha = NEW.fecha) THEN
    RAISE EXCEPTION 'El % ya se evaluó: sus lotes y destinatarios están cerrados.', NEW.fecha USING ERRCODE = 'check_violation';
  END IF;

  -- IF anidados: cada condición nombra columnas de una sola tabla.
  IF TG_TABLE_NAME = 'LoteCorreos' THEN
    IF NEW.estado <> 'PENDIENTE' OR NEW.intentos <> 0 OR num_nonnulls(NEW."arrendadoHasta", NEW.motivo) > 0 THEN
      RAISE EXCEPTION 'Un lote nace pendiente, sin intentos ni motivo.' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.estado <> 'PENDIENTE' OR NEW.motivo IS NOT NULL THEN
    RAISE EXCEPTION 'Un destinatario nace pendiente y sin motivo.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER evaluacion_correos_alta BEFORE INSERT ON "EvaluacionCorreos"
  FOR EACH ROW EXECUTE FUNCTION correo_alta();
CREATE TRIGGER lote_correos_alta BEFORE INSERT ON "LoteCorreos"
  FOR EACH ROW EXECUTE FUNCTION correo_alta();
CREATE TRIGGER registro_correos_alta BEFORE INSERT ON "RegistroCorreos"
  FOR EACH ROW EXECUTE FUNCTION correo_alta();

-- ── Transiciones ───────────────────────────────────────────────────────────
-- Contrato §3.5, §3.6 y §3.11. Valen también para el dueño.

CREATE FUNCTION lote_correos_transicion() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW.fecha, NEW.numero, NEW.llave, NEW.remitente, NEW.asunto, NEW.html, NEW.texto, NEW.articulos, NEW."creadoEn")
     IS DISTINCT FROM (OLD.id, OLD.fecha, OLD.numero, OLD.llave, OLD.remitente, OLD.asunto, OLD.html, OLD.texto, OLD.articulos, OLD."creadoEn") THEN
    RAISE EXCEPTION 'La fecha, la llave y el contenido de un lote no cambian.' USING ERRCODE = 'check_violation';
  END IF;
  -- Desde PENDIENTE a cualquiera; ACEPTADO es final; los demás solo a ACEPTADO.
  IF NEW.estado <> OLD.estado AND OLD.estado <> 'PENDIENTE' AND NEW.estado <> 'ACEPTADO' THEN
    RAISE EXCEPTION 'Un lote no pasa de % a %.', OLD.estado, NEW.estado USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.intentos NOT IN (OLD.intentos, OLD.intentos + 1) THEN
    RAISE EXCEPTION 'Los intentos de un lote suben de uno en uno.' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.estado NOT IN ('PENDIENTE', 'ACEPTADO')
     AND (NEW.intentos, NEW."ultimoIntentoEn", NEW."arrendadoHasta") IS DISTINCT FROM (OLD.intentos, OLD."ultimoIntentoEn", OLD."arrendadoHasta") THEN
    RAISE EXCEPTION 'Un lote % no se vuelve a intentar.', OLD.estado USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.estado = OLD.estado AND NEW."resueltoEn" IS DISTINCT FROM OLD."resueltoEn" THEN
    RAISE EXCEPTION 'La resolución de un lote solo cambia con su estado.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER lote_correos_transicion BEFORE UPDATE ON "LoteCorreos"
  FOR EACH ROW EXECUTE FUNCTION lote_correos_transicion();

CREATE FUNCTION registro_correos_transicion() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (NEW.id, NEW."loteId", NEW.fecha, NEW.posicion, NEW."usuarioId", NEW.correo, NEW."creadoEn")
     IS DISTINCT FROM (OLD.id, OLD."loteId", OLD.fecha, OLD.posicion, OLD."usuarioId", OLD.correo, OLD."creadoEn") THEN
    RAISE EXCEPTION 'El lote, la posición, el usuario y el correo de un destinatario no cambian.' USING ERRCODE = 'check_violation';
  END IF;
  -- Desde PENDIENTE a cualquiera; ENVIADO es final; los demás solo a ENVIADO.
  IF NEW.estado <> OLD.estado AND OLD.estado <> 'PENDIENTE' AND NEW.estado <> 'ENVIADO' THEN
    RAISE EXCEPTION 'Un destinatario no pasa de % a %.', OLD.estado, NEW.estado USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."resendId" IS NOT NULL AND NEW."resendId" IS DISTINCT FROM OLD."resendId" THEN
    RAISE EXCEPTION 'El identificador de Resend se fija una sola vez.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER registro_correos_transicion BEFORE UPDATE ON "RegistroCorreos"
  FOR EACH ROW EXECUTE FUNCTION registro_correos_transicion();

CREATE FUNCTION correo_solo_insercion() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% solo admite inserciones.', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER evaluacion_correos_solo_insercion BEFORE UPDATE ON "EvaluacionCorreos"
  FOR EACH ROW EXECUTE FUNCTION correo_solo_insercion();
CREATE TRIGGER evento_correo_solo_insercion BEFORE UPDATE ON "EventoCorreo"
  FOR EACH ROW EXECUTE FUNCTION correo_solo_insercion();

-- ── Privilegios ────────────────────────────────────────────────────────────
-- Los privilegios por omisión dan las cuatro operaciones: se quita lo que no va.

REVOKE DELETE ON "EvaluacionCorreos", "LoteCorreos", "RegistroCorreos", "EventoCorreo" FROM bodegasosur_ejecucion;
REVOKE UPDATE ON "EvaluacionCorreos", "EventoCorreo" FROM bodegasosur_ejecucion;

-- Los roles de la Data API solo existen en Supabase.
DO $$
DECLARE
  rol text;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
      EXECUTE format('REVOKE ALL ON "EvaluacionCorreos", "LoteCorreos", "RegistroCorreos", "EventoCorreo" FROM %I', rol);
    END IF;
  END LOOP;
END $$;
