-- ═══════════════════════════════════════════════════════════════════════════
-- La base muestra la hora de la Ciudad de México. Todas las columnas de
-- instante ya son timestamptz: guardan el momento exacto, y la zona de la
-- sesión solo decide cómo se lee en psql, TablePlus o pgAdmin. En UTC se veían
-- 6 horas adelante; los registros anteriores tampoco cambian, solo se ven bien.
--
-- La aplicación y los scripts fijan su sesión en UTC (src/lib/db.ts y
-- prisma/comun.ts): el adapter de Prisma lee y escribe suponiendo UTC.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND pg_has_role(current_user, datdba, 'MEMBER'))
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'America/Mexico_City');
  ELSE
    -- Sin ser dueño de la base, al menos las sesiones de quien migra.
    EXECUTE format('ALTER ROLE %I IN DATABASE %I SET timezone TO %L', current_user, current_database(), 'America/Mexico_City');
    RAISE NOTICE 'Solo las sesiones de % muestran la hora de México; el dueño de la base puede extenderlo con ALTER DATABASE.', current_user;
  END IF;
END $$;
