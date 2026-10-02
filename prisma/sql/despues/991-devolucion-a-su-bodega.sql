-- ═══════════════════════════════════════════════════════════════════════════
-- Una devolución ligada a una salida regresa a la bodega de la que salió.
-- Sin salida, la bodega es libre: procedencia no comprobada, sin costo.
--
-- Se revisa en cada escritura, también al confirmar: si la salida cambiara de
-- bodega antes de retirarse, la devolución ya no se confirma en otra.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Movimiento" d JOIN "Movimiento" s ON s.id = d."devuelveAId"
     WHERE d.tipo = 'DEVOLUCION' AND d.estatus <> 'CANCELADO'
       AND d."bodegaDestinoId" IS DISTINCT FROM s."bodegaOrigenId"
  ) THEN
    RAISE EXCEPTION 'Hay devoluciones ligadas a una salida que no regresan a su bodega de origen; corrígelas antes de migrar.'
      USING ERRCODE = 'BG803';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION devolucion_a_su_bodega() RETURNS trigger AS $$
DECLARE
  s record;
BEGIN
  SELECT folio, "bodegaOrigenId" INTO s FROM "Movimiento" WHERE id = NEW."devuelveAId";
  IF NEW."bodegaDestinoId" IS DISTINCT FROM s."bodegaOrigenId" THEN
    RAISE EXCEPTION 'La devolución de % regresa a la bodega de la que salió.', coalesce(s.folio, 'la salida')
      USING ERRCODE = 'BG803';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER devolucion_a_su_bodega
  BEFORE INSERT OR UPDATE ON "Movimiento"
  FOR EACH ROW WHEN (NEW.tipo = 'DEVOLUCION' AND NEW."devuelveAId" IS NOT NULL)
  EXECUTE FUNCTION devolucion_a_su_bodega();
