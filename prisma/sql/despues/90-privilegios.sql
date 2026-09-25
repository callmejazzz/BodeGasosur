-- Dos usuarios: quien migra es dueño del esquema; quien ejecuta la aplicación
-- solo lee y escribe filas.
--
-- Sin ser dueño, el de ejecución no puede alterar, deshabilitar ni borrar
-- triggers, ni cambiar tablas; sin TRUNCATE no vacía una tabla saltándose los
-- triggers de fila; sin TRIGGER no crea los suyos. No es superusuario, así que
-- tampoco puede fijar session_replication_role. Bitacora y EventoAcceso son
-- solo de agregar para él.
--
-- Este rol de grupo no entra (NOLOGIN). El usuario con contraseña se crea fuera
-- de la migración con `npm run db:usuario-app` y hereda este rol, como hace
-- lector_catalogo con los proyectos hermanos.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bodegasosur_ejecucion') THEN
    CREATE ROLE bodegasosur_ejecucion NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

-- Primero se cierra todo, después se abre lo mínimo.
REVOKE ALL ON ALL TABLES    IN SCHEMA public, catalogo_gasosur FROM bodegasosur_ejecucion;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, catalogo_gasosur FROM bodegasosur_ejecucion;
REVOKE CREATE ON SCHEMA public, catalogo_gasosur FROM PUBLIC;

GRANT USAGE ON SCHEMA public, catalogo_gasosur TO bodegasosur_ejecucion;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, catalogo_gasosur TO bodegasosur_ejecucion;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, catalogo_gasosur TO bodegasosur_ejecucion;

REVOKE ALL ON "_prisma_migrations" FROM bodegasosur_ejecucion;
REVOKE UPDATE, DELETE ON "Bitacora", "EventoAcceso" FROM bodegasosur_ejecucion;

-- Lo que creen migraciones futuras nace con los mismos permisos de fila.
ALTER DEFAULT PRIVILEGES IN SCHEMA public, catalogo_gasosur
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bodegasosur_ejecucion;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, catalogo_gasosur
  GRANT USAGE, SELECT ON SEQUENCES TO bodegasosur_ejecucion;
