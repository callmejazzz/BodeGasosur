-- ═══════════════════════════════════════════════════════════════════════════
-- Lo que tiene que existir ANTES de que Prisma cree las tablas.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── UUIDv7 del lado del servidor ───────────────────────────────────────────
--
-- Prisma genera los UUIDv7 en el cliente, así que las filas que escribe la
-- aplicación no necesitan nada. Pero la Bitacora la escribe un trigger, y ahí
-- no hay cliente: hace falta generarlos en SQL.
--
-- PostgreSQL 18 trae uuidv7() nativo; este contenedor corre la 16. La función
-- se llama uuid_generate_v7 y no uuidv7 justo para no chocar con la nativa el
-- día que se actualice el servidor — ese día, esta se borra y los DEFAULT
-- cambian de nombre, sin migrar un solo dato.

CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(
            int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
            FROM 3
          )
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$ LANGUAGE sql VOLATILE;

COMMENT ON FUNCTION uuid_generate_v7() IS
  'UUIDv7 para las filas que escribe la base y no la aplicación. Sustituible por uuidv7() nativo en PostgreSQL 18.';

-- ── Consecutivo de la clave de artículo ────────────────────────────────────
--
-- La clave la asigna el sistema: ART-00001, ART-00002… Sin prefijo de
-- categoría, porque una clave que codifica la categoría miente en cuanto
-- Compras recategoriza el artículo — que es el error que el catálogo viejo
-- ya cometió.
--
-- Una secuencia deja huecos si una inserción falla, y en artículos da igual.
-- El folio NO puede usar una por exactamente esa razón: el invariante 8 exige
-- consecutivo sin huecos, y por eso se toma con UPDATE … RETURNING.

CREATE SEQUENCE IF NOT EXISTS articulo_clave_seq AS bigint START WITH 1;

-- ── Consecutivo de la clave de bodega ──────────────────────────────────────
--
-- Misma decisión que en artículos: BDG-00001, BDG-00002… La clave de bodega
-- vive en la URL y es inmutable; si la capturara una persona, «MAG» y «SFE»
-- serían nombres inventados por quien sembró la demo y no por Compras, y ya
-- no habría forma de cambiarlos. Que la ponga la base cierra esa puerta.

CREATE SEQUENCE IF NOT EXISTS bodega_clave_seq AS bigint START WITH 1;
