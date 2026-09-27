-- ═══════════════════════════════════════════════════════════════════════════
-- La facultad de autorizar se lee bajo candado, como la guarda de Usuario
-- (98-correcciones-actor.sql). Por las acciones ya lo cubría la relectura de
-- accionProtegida(); esto cierra la misma carrera por SQL directo.
--
-- No forma ciclo con la administración de accesos: la autorización solo toma
-- la fila de quien autoriza, y la administración no toca movimientos.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION verificar_facultad_de_autorizar() RETURNS trigger AS $$
DECLARE
  v_puede  boolean;
  v_activo boolean;
BEGIN
  IF NEW."autorizadoPorId" IS NULL THEN
    RETURN NEW;
  END IF;

  -- En un INSERT no hay OLD: en un UPDATE solo interesa el cambio.
  IF TG_OP = 'UPDATE' AND NEW."autorizadoPorId" IS NOT DISTINCT FROM OLD."autorizadoPorId" THEN
    RETURN NEW;
  END IF;

  -- FOR SHARE: una revocación concurrente espera a este commit, y una que ya
  -- estaba en curso se lee aquí.
  SELECT "puedeAutorizar", activo INTO v_puede, v_activo
  FROM public."Usuario" WHERE id = NEW."autorizadoPorId" FOR SHARE;

  IF NOT coalesce(v_puede, false) OR NOT coalesce(v_activo, false) THEN
    RAISE EXCEPTION
      'El usuario % no tiene la facultad de autorizar salidas.', NEW."autorizadoPorId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
