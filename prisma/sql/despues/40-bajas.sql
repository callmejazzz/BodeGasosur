-- ═══════════════════════════════════════════════════════════════════════════
-- Dar de baja.
--
-- El principio, que hace innecesario decidir tabla por tabla:
--
--     La baja lógica no borra nada. Significa «ya no se puede elegir al
--     capturar». Todo lo histórico sigue existiendo, contando y apareciendo
--     en reportes.
--
-- Un artículo dado de baja con existencia sigue valuándose y sigue en el
-- kardex; simplemente no aparece en el selector de un movimiento nuevo.
--
-- Con una sola excepción, y es por criterio y no por invariante: desactivar
-- una bodega con material adentro no rompe nada, pero es casi siempre un
-- error de dedo, y su efecto es que inventario real desaparece de las
-- pantallas de captura sin que nadie lo note.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION impedir_baja_de_bodega_con_existencia() RETURNS trigger AS $$
DECLARE
  v_articulos int;
  v_piezas    bigint;
BEGIN
  IF OLD.activa AND NOT NEW.activa THEN
    SELECT count(*), coalesce(sum(cantidad), 0)
      INTO v_articulos, v_piezas
      FROM public."Existencia"
     WHERE "bodegaId" = NEW.id AND cantidad > 0;

    IF v_articulos > 0 THEN
      RAISE EXCEPTION
        'La bodega % todavía tiene % piezas de % artículos.', NEW.clave, v_piezas, v_articulos
        USING ERRCODE = 'check_violation',
              HINT = 'Traspasa o ajusta la existencia antes de dar de baja la bodega.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bodega_baja_con_existencia
  BEFORE UPDATE ON public."Bodega"
  FOR EACH ROW EXECUTE FUNCTION impedir_baja_de_bodega_con_existencia();
