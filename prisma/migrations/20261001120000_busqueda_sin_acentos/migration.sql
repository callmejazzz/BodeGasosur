-- Búsqueda sin acentos. Copia de prisma/sql/despues/992-busqueda-sin-acentos.sql.

-- ═══════════════════════════════════════════════════════════════════════════
-- Búsqueda de texto sin acentos ni mayúsculas. Se aplica a los dos lados de la
-- comparación, así que «mensajeria», «MENSAJERÍA» y «Mensajería» encuentran
-- lo mismo. La ñ y la ü se vuelven n y u, como al teclear sin ellas.
--
--   texto_buscable('Peña Ñúñez') → 'pena nunez'
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION texto_buscable(texto text) RETURNS text AS $$
  SELECT translate(lower(texto), 'áéíóúüñàèìòùâêîôûäëïöç', 'aeiouunaeiouaeiouaeioc')
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- Nace sin EXECUTE (95-actor-verificable.sql) y la usan las lecturas de la aplicación.
GRANT EXECUTE ON FUNCTION texto_buscable(text) TO bodegasosur_ejecucion;
