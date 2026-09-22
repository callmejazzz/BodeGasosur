-- ═══════════════════════════════════════════════════════════════════════════
-- Dinero (11 §6). El cálculo canónico vive aquí, en numeric, y no en
-- JavaScript: 0.1 + 0.2 en punto flotante no da 0.3, y una valuación de
-- inventario no puede depender de eso. round(numeric, n) de PostgreSQL
-- redondea medio hacia arriba, que es lo que el contrato pide.
-- ═══════════════════════════════════════════════════════════════════════════

-- Costo por unidad base en MXN a partir de lo capturado: por la presentación
-- elegida, en la moneda de la factura. tipo_cambio nulo es MXN (factor 1).
--
--   costo_base_mxn(120, NULL, 12)        → 10.0000   (una caja de 12 a $120)
--   costo_base_mxn(120, NULL, 12, 0.16)  → 11.6000   (con IVA)
--   costo_base_mxn(10, 17.5, 1)          → 175.0000  (10 USD la pieza)
CREATE OR REPLACE FUNCTION costo_base_mxn(
  costo_capturado numeric,
  tipo_cambio     numeric,
  factor          integer,
  tasa_iva        numeric DEFAULT 0
) RETURNS numeric AS $$
  SELECT round(
    costo_capturado * (1 + coalesce(tasa_iva, 0)) * coalesce(tipo_cambio, 1) / factor,
    4
  );
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION costo_base_mxn(numeric, numeric, integer, numeric) IS
  'Costo por unidad base en MXN, cuatro decimales, desde el costo capturado por presentación y en la moneda de la factura.';

-- Importe de un renglón de factura, en la moneda de la factura y a dos
-- decimales: cantidad capturada por costo capturado, sin pasar por el costo
-- base ya redondeado (11 §6). Los totales del encabezado son la suma de estos.
CREATE OR REPLACE FUNCTION importe_renglon(cantidad integer, costo numeric) RETURNS numeric AS $$
  SELECT round(cantidad * costo, 2);
$$ LANGUAGE sql IMMUTABLE STRICT;

COMMENT ON FUNCTION importe_renglon(integer, numeric) IS
  'Importe de un renglón a dos decimales, medio hacia arriba, en la moneda de la factura.';

-- Los topes de las columnas de dinero, para comprobarlos ANTES de escribir y
-- responder con un error de dominio en vez de un desbordamiento genérico:
-- costos son numeric(14,4), importes numeric(14,2).
CREATE OR REPLACE FUNCTION cabe_en_costo(valor numeric) RETURNS boolean AS $$
  SELECT valor IS NULL OR (valor >= 0 AND valor <= 9999999999.9999);
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION cabe_en_importe(valor numeric) RETURNS boolean AS $$
  SELECT valor IS NULL OR (valor >= 0 AND valor <= 999999999999.99);
$$ LANGUAGE sql IMMUTABLE;
