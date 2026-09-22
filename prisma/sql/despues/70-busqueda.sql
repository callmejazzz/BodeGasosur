-- ═══════════════════════════════════════════════════════════════════════════
-- Búsqueda tolerante de claves con forma LETRAS-CEROS-NÚMERO (folio E-000001,
-- bodega BDG-00002): sin guiones, sin ceros a la izquierda del número y sin
-- distinguir mayúsculas. Se aplica a los dos lados de la comparación, así que
-- «e1», «E-1» y «e-000001» encuentran lo mismo.
--
--   clave_normalizada('E-000001')  → 'e1'
--   clave_normalizada('bdg-00010') → 'bdg10'
--   clave_normalizada('E-100')     → 'e100'   (los ceros interiores se quedan)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION clave_normalizada(texto text) RETURNS text AS $$
  SELECT regexp_replace(replace(lower(trim(texto)), '-', ''), '(^|[a-z])0+(\d)', '\1\2', 'g')
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;
