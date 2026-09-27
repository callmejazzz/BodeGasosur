/*
  El usuario de ejecución (90-privilegios.sql), conectado como lo hace la
  aplicación: lee y escribe filas, pero no es dueño de nada, no vacía tablas,
  no toca triggers ni esquema y no puede apagar las defensas de la sesión.
*/
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { URL_PRUEBAS } from "../../pruebas/base-de-pruebas";
import { firmarToken } from "../../pruebas/tokens";
import { asegurarUsuarioDeEjecucion } from "../../scripts/usuario-ejecucion";

const url = inject("urlEjecucionPruebas");
let app: Client;
let dueno: Client;

beforeAll(async () => {
  app = new Client({ connectionString: url });
  dueno = new Client({ connectionString: URL_PRUEBAS });
  await Promise.all([app.connect(), dueno.connect()]);
});
afterAll(() => Promise.all([app.end(), dueno.end()]));

/** Un usuario activo con su token de la plantilla, creado por el dueño. */
async function usuarioConToken() {
  const clerk = `user_priv_${randomUUID().slice(0, 8)}`;
  await dueno.query(`INSERT INTO "Usuario" (id, "clerkUserId", correo, rol, "updatedAt") VALUES (uuid_generate_v7(), $1, $2, 'COMPRAS', now())`, [
    clerk, `${clerk}@prueba.test`,
  ]);
  return firmarToken(inject("llavePruebas"), clerk);
}

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

  it("la bitácora y los accesos solo los escriben sus triggers y funciones; los usuarios no se borran", async () => {
    for (const sql of [
      `UPDATE "Bitacora" SET origen = 'reescrita'`,
      `DELETE FROM "Bitacora"`,
      `INSERT INTO "Bitacora" (id, tabla, "registroId", accion) VALUES (gen_random_uuid(), 'Bodega', 'x', 'INSERTAR')`,
      `UPDATE "EventoAcceso" SET ip = '0.0.0.0'`,
      `DELETE FROM "EventoAcceso"`,
      `INSERT INTO "EventoAcceso" (id, "clerkUserId", tipo) VALUES (gen_random_uuid(), 'user_x', 'ACCESO_DENEGADO')`,
      `DELETE FROM "Usuario" WHERE false`,
    ]) {
      await expect(codigoDe(sql), sql).resolves.toBe(SIN_PRIVILEGIO);
    }
    await expect(codigoDe(`SELECT count(*) FROM "Bitacora"`)).resolves.toBeNull();
  });

  it("lee y escribe filas con un actor ligado, con las secuencias de las claves", async () => {
    const token = await usuarioConToken();
    await app.query("BEGIN");
    try {
      await app.query("SELECT seguridad.fijar_actor($1)", [token]);
      const { rows } = await app.query<{ clave: string }>(`INSERT INTO "Bodega" (id, nombre, "updatedAt") VALUES (uuid_generate_v7(), 'Bodega de ejecución ' || gen_random_uuid(), now()) RETURNING clave`);
      expect(rows[0].clave).toMatch(/^BDG-\d{5}$/);
      await expect(app.query(`UPDATE "Bodega" SET ubicacion = 'x' WHERE clave = $1`, [rows[0].clave])).resolves.toMatchObject({ rowCount: 1 });
      await expect(app.query(`SELECT count(*) FROM catalogo_gasosur."Estacion"`)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await app.query("ROLLBACK");
    }
  });

  it("en seguridad solo ejecuta las cuatro funciones públicas y no lee ninguna tabla", async () => {
    const { rows } = await app.query<{ nombre: string }>(`
      SELECT p.proname AS nombre FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'seguridad' AND has_function_privilege(p.oid, 'EXECUTE') ORDER BY 1`);
    expect(rows.map((r) => r.nombre)).toEqual(["fijar_actor", "kids_cargados", "registrar_acceso_denegado", "registrar_evento_de_sesion"]);
    const { rows: todas } = await dueno.query(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'seguridad'`);
    expect(todas[0].n).toBeGreaterThan(10);

    for (const tabla of ["llave_publica", "liga_actor", "login_de_confianza"]) {
      await expect(codigoDe(`SELECT * FROM seguridad.${tabla}`), tabla).resolves.toBe(SIN_PRIVILEGIO);
    }
    await expect(codigoDe(`SELECT seguridad.cargar_llave('k', 'https://x', 'a', '\\x00', '\\x010001')`)).resolves.toBe(SIN_PRIVILEGIO);
  });

  it("una función nueva del dueño nace sin EXECUTE para PUBLIC, en cualquier esquema", async () => {
    const nombre = `prueba_por_omision_${randomBytes(4).toString("hex")}`;
    await dueno.query(`CREATE FUNCTION public.${nombre}() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
    try {
      await expect(codigoDe(`SELECT public.${nombre}()`)).resolves.toBe(SIN_PRIVILEGIO);
    } finally {
      await dueno.query(`DROP FUNCTION public.${nombre}()`);
    }
  });

  it("la confianza es por login, no por pertenencia: un miembro del rol dueño fuera de la lista necesita liga", async () => {
    const { rows } = await dueno.query<{ dueno: string }>("SELECT current_user AS dueno");
    const miembro = `bodegasosur_prueba_miembro_${randomBytes(4).toString("hex")}`;
    const contrasena = randomBytes(12).toString("hex");
    const { rows: sql } = await dueno.query<{ crear: string; conceder: string }>(
      "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS crear, format('GRANT %I TO %I', $3::text, $1::text) AS conceder",
      [miembro, contrasena, rows[0].dueno],
    );
    await dueno.query(sql[0].crear);
    await dueno.query(sql[0].conceder);
    const urlMiembro = new URL(URL_PRUEBAS);
    urlMiembro.username = miembro;
    urlMiembro.password = contrasena;
    const cliente = new Client({ connectionString: urlMiembro.toString() });
    await cliente.connect();
    try {
      await cliente.query("BEGIN");
      await cliente.query("SELECT set_config('app.origen', 'arranque', true)");
      await expect(
        cliente.query(`INSERT INTO "Bodega" (id, nombre, "updatedAt") VALUES (uuid_generate_v7(), $1, now())`, [`Miembro ${randomUUID()}`]),
      ).rejects.toMatchObject({ code: "BG706" });
      await cliente.query("ROLLBACK");
      // Tampoco sirve como usuario de ejecución.
      await expect(asegurarUsuarioDeEjecucion(URL_PRUEBAS, urlMiembro.toString())).rejects.toThrow(/miembro del rol dueño/);
    } finally {
      await cliente.end();
      const { rows: borrar } = await dueno.query<{ sql: string }>("SELECT format('DROP ROLE %I', $1::text) AS sql", [miembro]);
      await dueno.query(borrar[0].sql);
    }
  });
});
