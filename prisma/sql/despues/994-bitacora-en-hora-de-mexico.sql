-- ═══════════════════════════════════════════════════════════════════════════
-- Las copias «antes» y «despues» de la bitácora escriben sus instantes en la
-- hora de México (…-06:00), como ya se lee ocurridoEn. to_jsonb() usa la zona
-- de la sesión y la de la aplicación va en UTC (993-hora-de-mexico.sql): la
-- función fija la suya solo mientras corre. El instante es el mismo.
--
-- Quien vuelva a definir registrar_en_bitacora() conserva este ajuste:
-- CREATE OR REPLACE reemplaza los SET de la función.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER FUNCTION registrar_en_bitacora() SET timezone = 'America/Mexico_City';
