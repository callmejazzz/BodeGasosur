-- ═══════════════════════════════════════════════════════════════════════════
-- La bitácora, alimentada por trigger.
--
-- Se eligió trigger y no extensión de Prisma Client por una sola razón: la
-- extensión conoce al usuario pero no ve lo que escriben prisma studio, los
-- scripts de migración de la fase 4 ni una consulta directa. El trigger ve a
-- todos los escritores, y el usuario le llega por variable de sesión.
--
-- Contrato con la capa de servicios — accionProtegida lo cumple una vez para
-- todo el sistema, así que no hay que acordarse en cada servicio:
--
--     SET LOCAL app.usuario_id = '0199…';   -- peticiones con usuario
--     SET LOCAL app.origen     = 'clerk-webhook';  -- la segunda puerta
--
-- Cuando nadie fijó ninguna de las dos, la bitácora dice 'escritura-directa'.
-- Es una respuesta honesta, y hoy no existe ninguna.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "Bitacora" ALTER COLUMN id SET DEFAULT uuid_generate_v7();

CREATE OR REPLACE FUNCTION registrar_en_bitacora() RETURNS trigger AS $$
DECLARE
  v_usuario  uuid;
  v_origen   text;
  v_registro text;
  v_antes    jsonb;
  v_despues  jsonb;
  v_accion   "AccionBitacora";
BEGIN
  -- current_setting con missing_ok: si nadie la fijó, devuelve NULL en vez de
  -- reventar. Y si trae basura, se prefiere perder el actor a perder la
  -- escritura: el renglón queda como escritura directa.
  BEGIN
    v_usuario := nullif(current_setting('app.usuario_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_usuario := NULL;
  END;

  v_origen := nullif(current_setting('app.origen', true), '');

  IF TG_OP = 'DELETE' THEN
    v_accion  := 'ELIMINAR';
    v_antes   := to_jsonb(OLD);
    v_despues := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_accion  := 'ACTUALIZAR';
    v_antes   := to_jsonb(OLD);
    v_despues := to_jsonb(NEW);
    -- Un UPDATE que no cambió nada no es historia. Se ignora updatedAt en la
    -- comparación: Prisma la toca en cada escritura, así que sin esto la
    -- guarda no se dispararía nunca y la bitácora se llenaría de renglones
    -- que no dicen nada.
    IF (v_antes - 'updatedAt') = (v_despues - 'updatedAt') THEN
      RETURN NEW;
    END IF;
  ELSE
    v_accion  := 'INSERTAR';
    v_antes   := NULL;
    v_despues := to_jsonb(NEW);
  END IF;

  v_registro := coalesce(v_despues, v_antes) ->> 'id';

  IF v_usuario IS NULL AND v_origen IS NULL THEN
    v_origen := 'escritura-directa';
  END IF;

  INSERT INTO "Bitacora" (tabla, "registroId", accion, "usuarioId", origen, antes, despues)
  VALUES (TG_TABLE_NAME, v_registro, v_accion, v_usuario, v_origen, v_antes, v_despues);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── A qué tablas se engancha ───────────────────────────────────────────────
--
-- Fuera quedan, a propósito:
--   Existencia    — es una proyección recalculable; bitacorearla es duplicar
--                   el libro con ruido.
--   ConsumoCapa   — append-only por construcción: ya es su propia historia.
--   Folio         — cambia en cada confirmación y no dice nada que el folio
--                   del movimiento no diga.
--   Bitacora, EventoAcceso, EventoWebhook — registros, no datos.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Movimiento', 'MovimientoPartida', 'CapaCosto',
    'Usuario',
    'Bodega', 'Area', 'UnidadMedida', 'CategoriaArticulo',
    'Articulo', 'Proveedor', 'Persona'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER bitacora_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION registrar_en_bitacora()',
      lower(t), t
    );
  END LOOP;

  FOREACH t IN ARRAY ARRAY['Empresa', 'Estacion'] LOOP
    EXECUTE format(
      'CREATE TRIGGER bitacora_%s AFTER INSERT OR UPDATE OR DELETE ON catalogo_gasosur.%I
         FOR EACH ROW EXECUTE FUNCTION registrar_en_bitacora()',
      lower(t), t
    );
  END LOOP;
END $$;

-- ── EventoAcceso ───────────────────────────────────────────────────────────
-- Lo escriben los webhooks de sesión de Clerk, no un trigger, pero también
-- necesita generar su id del lado del servidor.

ALTER TABLE "EventoAcceso" ALTER COLUMN id SET DEFAULT uuid_generate_v7();
