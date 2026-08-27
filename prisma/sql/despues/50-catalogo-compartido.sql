-- ═══════════════════════════════════════════════════════════════════════════
-- El catálogo del grupo, expuesto por vistas versionadas.
--
-- El propósito de catalogo_gasosur es que otros proyectos de Gasosur lo lean
-- directo. Si lo hicieran contra las tablas, dos cosas se romperían: podrían
-- escribirlas —y solo el Superadmin debe escribir Empresa y Estacion—, y
-- renombrar una columna física rompería software ajeno.
--
-- Con vistas versionadas se puede renombrar una columna sin romper a nadie, y
-- la escritura es imposible por construcción y no por acuerdo. De paso queda
-- resuelto el pendiente de docs/08 §10, versionar el contrato compartido.
--
-- Las vistas empiezan mínimas. Si un proyecto necesita el teléfono, nace
-- v_estacion_v2 y la v1 sigue viva. Eso es lo que se compra aquí.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE VIEW catalogo_gasosur.v_empresa_v1 AS
  SELECT id, "razonSocial", rfc, activa
    FROM catalogo_gasosur."Empresa";

CREATE VIEW catalogo_gasosur.v_estacion_v1 AS
  SELECT id, numero, alias, "empresaId", activa
    FROM catalogo_gasosur."Estacion";

COMMENT ON VIEW catalogo_gasosur.v_empresa_v1  IS 'Contrato v1 para otros proyectos del grupo. No cambiar columnas: crear v2.';
COMMENT ON VIEW catalogo_gasosur.v_estacion_v1 IS 'Contrato v1 para otros proyectos del grupo. No cambiar columnas: crear v2.';

-- ── El rol lector ──────────────────────────────────────────────────────────
--
-- NOLOGIN a propósito: es un rol de grupo. Cada proyecto entra con su propio
-- usuario y se le concede este rol, así que ninguna contraseña queda en el
-- repositorio y revocarle el acceso a un proyecto no toca a los demás:
--
--     CREATE ROLE proyecto_x LOGIN PASSWORD '…';   -- fuera de la migración
--     GRANT lector_catalogo TO proyecto_x;
--
-- Los roles son del clúster y no de la base, así que CREATE ROLE a secas
-- falla en la segunda corrida.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lector_catalogo') THEN
    CREATE ROLE lector_catalogo NOLOGIN;
  END IF;
END $$;

-- El orden importa, y no es evidente: en PostgreSQL «ALL TABLES» incluye las
-- vistas. Si las revocaciones fueran después de los GRANT, borrarían justo el
-- permiso que acaban de dar y los proyectos hermanos se quedarían fuera sin
-- que nada avisara. Primero se cierra todo, después se abre lo mínimo.

REVOKE ALL ON SCHEMA public            FROM lector_catalogo;
REVOKE ALL ON ALL TABLES    IN SCHEMA public           FROM lector_catalogo;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public           FROM lector_catalogo;
REVOKE ALL ON ALL TABLES    IN SCHEMA catalogo_gasosur FROM lector_catalogo;

-- Las tablas que se creen después tampoco quedan expuestas por omisión.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM lector_catalogo;
ALTER DEFAULT PRIVILEGES IN SCHEMA catalogo_gasosur
  REVOKE ALL ON TABLES FROM lector_catalogo;

-- Y ahora lo único que sí puede ver: las dos vistas del contrato v1.
GRANT USAGE  ON SCHEMA catalogo_gasosur TO lector_catalogo;
GRANT SELECT ON catalogo_gasosur.v_empresa_v1, catalogo_gasosur.v_estacion_v1 TO lector_catalogo;
