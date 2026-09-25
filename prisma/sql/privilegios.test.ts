/*
  El usuario de ejecución (90-privilegios.sql), conectado como lo hace la
  aplicación: lee y escribe filas, pero no es dueño de nada, no vacía tablas,
  no toca triggers ni esquema y no puede apagar las defensas de la sesión.
*/
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

const url = inject("urlEjecucionPruebas");
let app: Client;

beforeAll(async () => {
  app = new Client({ connectionString: url });
  await app.connect();
});
afterAll(() => app.end());

/** SQLSTATE con el que falla la sentencia; null si pasa. */
async function codigoDe(sql: string): Promise<string | null> {
  try {
    await app.query(sql);
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "desconocido";
  }
}

const SIN_PRIVILEGIO = "42501";

describe("usuario de ejecución", () => {
  it("no es superusuario ni puede crear roles o bases, y no es dueño de la base ni de sus objetos", async () => {
    const { rows } = await app.query(`
      SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls, r.rolreplication,
             (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE c.relowner = r.oid AND n.nspname IN ('public', 'catalogo_gasosur')) AS propios,
             (SELECT datdba = r.oid FROM pg_database WHERE datname = current_database()) AS duenoDeLaBase,
             pg_has_role(r.oid, 'bodegasosur_ejecucion', 'MEMBER') AS enElGrupo
        FROM pg_roles r WHERE r.rolname = current_user`);
    expect(rows[0]).toEqual({
      rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, rolreplication: false,
      propios: 0, duenodelabase: false, enelgrupo: true,
    });
  });

  it("no vacía tablas, no toca triggers ni restricciones, no cambia el esquema ni apaga las defensas", async () => {
    const intentos = [
      `TRUNCATE "Movimiento" CASCADE`,
      `TRUNCATE "Bitacora"`,
      `TRUNCATE "ConsumoCapa"`,
      `ALTER TABLE "CapaCosto" DISABLE TRIGGER capa_inmutable`,
      `ALTER TABLE "ConsumoCapa" DISABLE TRIGGER ALL`,
      `DROP TRIGGER consumo_concilia ON "ConsumoCapa"`,
      `CREATE TRIGGER intruso BEFORE DELETE ON "Movimiento" FOR EACH ROW EXECUTE FUNCTION impedir_editar_consumo()`,
      `CREATE OR REPLACE FUNCTION conciliar_capa(p_capa uuid) RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql`,
      `ALTER TABLE "Existencia" DROP CONSTRAINT existencia_no_negativa_ck`,
      `CREATE TABLE public.intrusa (id int)`,
      `CREATE TABLE catalogo_gasosur.intrusa (id int)`,
      `SET session_replication_role = replica`,
      `SELECT * FROM "_prisma_migrations"`,
    ];
    for (const sql of intentos) {
      await expect(codigoDe(sql), sql).resolves.toBe(SIN_PRIVILEGIO);
    }
  });

  it("la bitácora y los accesos solo se agregan: no se editan ni se borran", async () => {
    for (const sql of [
      `UPDATE "Bitacora" SET origen = 'reescrita'`,
      `DELETE FROM "Bitacora"`,
      `UPDATE "EventoAcceso" SET ip = '0.0.0.0'`,
      `DELETE FROM "EventoAcceso"`,
    ]) {
      await expect(codigoDe(sql), sql).resolves.toBe(SIN_PRIVILEGIO);
    }
    await expect(codigoDe(`SELECT count(*) FROM "Bitacora"`)).resolves.toBeNull();
  });

  it("lee y escribe filas, con las secuencias de las claves", async () => {
    await app.query("BEGIN");
    try {
      const { rows } = await app.query<{ clave: string }>(`INSERT INTO "Bodega" (id, nombre, "updatedAt") VALUES (uuid_generate_v7(), 'Bodega de ejecución ' || gen_random_uuid(), now()) RETURNING clave`);
      expect(rows[0].clave).toMatch(/^BDG-\d{5}$/);
      await expect(app.query(`UPDATE "Bodega" SET ubicacion = 'x' WHERE clave = $1`, [rows[0].clave])).resolves.toMatchObject({ rowCount: 1 });
      await expect(app.query(`SELECT count(*) FROM catalogo_gasosur."Estacion"`)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await app.query("ROLLBACK");
    }
  });
});
