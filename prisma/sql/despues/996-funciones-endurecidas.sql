-- ═══════════════════════════════════════════════════════════════════════════
-- Funciones de public con search_path fijo y sin EXECUTE para PUBLIC.
--
-- Las funciones anteriores a 95 nacieron con EXECUTE para PUBLIC, así que en
-- Supabase anon y authenticated podían llamarlas si se encendiera la Data API.
-- Se cierran y la aplicación conserva por concesión explícita las que llama o
-- que se llaman desde sus triggers. Las de trigger no la necesitan: PostgreSQL
-- no pide EXECUTE al dispararlas, y llamarlas directo es un error.
--
-- Sin search_path propio, una función resolvía nombres con el de la sesión.
-- Se fija el mismo que usaban (public), con pg_catalog primero y pg_temp al
-- final para que nada temporal suplante una tabla o un operador.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'seguridad')
       AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
       AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp', f);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION
  cabe_en_costo(numeric),
  cabe_en_importe(numeric),
  clave_normalizada(text),
  conciliar_capa(uuid),
  conciliar_existencia(uuid, uuid),
  costo_base_mxn(numeric, numeric, integer, numeric),
  importe_renglon(integer, numeric),
  inventario_sin_conciliar(),
  nombre_normalizado(text),
  uuid_generate_v7()
TO bodegasosur_ejecucion;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Los roles de la Data API solo existen en Supabase.
DO $$
DECLARE
  rol text;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', rol);
    END IF;
  END LOOP;
END $$;
