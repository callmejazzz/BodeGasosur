// El usuario con el que corre la aplicación.
//
// La migración crea el rol de grupo `bodegasosur_ejecucion` con permisos de
// fila y nada más (90-privilegios.sql). Este comando crea —o actualiza— el
// usuario con contraseña que hereda ese rol, con los datos de DATABASE_URL, y
// se conecta como quien migra (DATABASE_URL_MIGRACIONES) para hacerlo. La
// contraseña nunca queda en el repositorio ni viaja a la base: se manda su
// verificador SCRAM, porque Supabase escribe cada DDL en su bitácora.
//
// Se niega si las dos URL no apuntan a la misma base o si usan el mismo
// usuario: la separación es justamente que no sean el mismo.
//
// Uso:  npm run db:usuario-app

import "dotenv/config";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { Client } from "pg";
import { esEjecucionDirecta, esPoolerDeSupabase } from "../prisma/comun";

export const ROL_DE_EJECUCION = "bodegasosur_ejecucion";

type Destino = { usuario: string; contrasena: string; servidor: string; base: string };

export function leer(nombre: string, url: string | undefined): Destino {
  if (!url) throw new Error(`Falta ${nombre}.`);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`${nombre} no es una URL de PostgreSQL válida.`);
  }
  // Una base de Supabase se alcanza directo (db.<proyecto>.supabase.co) o por
  // Supavisor, que recibe el usuario como «rol.<proyecto>»: se comparan por proyecto.
  const usuario = decodeURIComponent(u.username);
  const directo = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  const pooler = esPoolerDeSupabase(url) ? usuario.match(/^(.+)\.([a-z0-9]+)$/) : null;
  return {
    usuario: pooler ? pooler[1] : usuario,
    contrasena: decodeURIComponent(u.password),
    servidor: directo ? `supabase:${directo[1]}` : pooler ? `supabase:${pooler[2]}` : `${u.hostname}:${u.port || "5432"}`,
    base: u.pathname.replace(/^\//, ""),
  };
}

/** El verificador SCRAM-SHA-256 que guarda PostgreSQL, calculado aquí como lo hace `\password` de psql. */
export function verificadorScram(contrasena: string, sal = randomBytes(16), iteraciones = 4096): string {
  // PostgreSQL normaliza con SASLprep lo que no es ASCII; fuera de ASCII el verificador no coincidiría.
  if (!/^[\x20-\x7e]+$/.test(contrasena)) throw new Error("La contraseña de DATABASE_URL tiene que ser ASCII imprimible.");
  const salada = pbkdf2Sync(contrasena, sal, iteraciones, 32, "sha256");
  const hmac = (texto: string) => createHmac("sha256", salada).update(texto).digest();
  const almacenada = createHash("sha256").update(hmac("Client Key")).digest("base64");
  return `SCRAM-SHA-256$${iteraciones}:${sal.toString("base64")}$${almacenada}:${hmac("Server Key").toString("base64")}`;
}

/** Crea o actualiza el usuario de ejecución y le concede el rol de grupo. */
export async function asegurarUsuarioDeEjecucion(urlMigraciones: string | undefined, urlEjecucion: string | undefined) {
  const dueno = leer("DATABASE_URL_MIGRACIONES", urlMigraciones);
  const app = leer("DATABASE_URL", urlEjecucion);
  if (dueno.servidor !== app.servidor || dueno.base !== app.base) {
    throw new Error("DATABASE_URL y DATABASE_URL_MIGRACIONES tienen que apuntar al mismo servidor y la misma base.");
  }
  if (!app.usuario || !app.contrasena) throw new Error("DATABASE_URL necesita usuario y contraseña propios.");
  if (app.usuario === dueno.usuario) {
    throw new Error("DATABASE_URL usa el mismo usuario que las migraciones; la aplicación necesita uno propio.");
  }
  const verificador = verificadorScram(app.contrasena);

  const cliente = new Client({ connectionString: urlMigraciones });
  await cliente.connect();
  try {
    const grupo = await cliente.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ROL_DE_EJECUCION]);
    if (grupo.rowCount === 0) throw new Error(`No existe el rol ${ROL_DE_EJECUCION}: aplica las migraciones primero.`);
    const existe = (await cliente.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [app.usuario])).rowCount! > 0;
    // Un usuario que ya es dueño de algo aquí podría alterar sus triggers: no sirve para ejecutar.
    const propiedades = await cliente.query(
      `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = $1)
          AND n.nspname IN ('public', 'catalogo_gasosur')
       UNION ALL
       SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
      [app.usuario],
    );
    if (propiedades.rowCount! > 0) throw new Error(`${app.usuario} es dueño de la base o de sus tablas; usa otro usuario para la aplicación.`);
    // Miembro de quien migra podría tomar sus privilegios con SET ROLE.
    if (existe) {
      const { rows: miembro } = await cliente.query<{ es: boolean }>("SELECT pg_has_role($1, current_user, 'MEMBER') AS es", [app.usuario]);
      if (miembro[0].es) throw new Error(`${app.usuario} es miembro del rol dueño; usa un usuario sin esa pertenencia.`);
      // Desde PostgreSQL 16 un dueño sin SUPERUSER (Supabase) no puede nombrar
      // estos atributos en ALTER ROLE ni para negarlos: se exigen en falso.
      const { rows: reservados } = await cliente.query<{ alguno: boolean }>(
        "SELECT rolsuper OR rolreplication OR rolbypassrls AS alguno FROM pg_roles WHERE rolname = $1",
        [app.usuario],
      );
      if (reservados[0].alguno) throw new Error(`${app.usuario} es superusuario, de replicación o salta RLS; usa otro usuario para la aplicación.`);
    }

    // DDL no admite parámetros: format() cita en el servidor el nombre y el verificador.
    const atributos = existe
      ? "LOGIN NOCREATEDB NOCREATEROLE INHERIT"
      : "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT";
    const plantilla = existe ? `ALTER ROLE %I WITH ${atributos} PASSWORD %L` : `CREATE ROLE %I WITH ${atributos} PASSWORD %L`;
    const { rows } = await cliente.query<{ sql: string }>("SELECT format($1, $2::text, $3::text) AS sql", [plantilla, app.usuario, verificador]);
    await cliente.query(rows[0].sql);
    const concesion = await cliente.query<{ sql: string }>("SELECT format('GRANT %I TO %I', $1::text, $2::text) AS sql", [ROL_DE_EJECUCION, app.usuario]);
    await cliente.query(concesion.rows[0].sql);
    // UTC en el rol y no solo en `options` de arranque, que Supavisor descarta
    // (solo reenvía search_path). Y si la red se corta a media transacción, la
    // base suelta los candados en vez de esperar al TCP.
    for (const [parametro, valor] of [["timezone", "UTC"], ["idle_in_transaction_session_timeout", "30s"]]) {
      const ajuste = await cliente.query<{ sql: string }>("SELECT format('ALTER ROLE %I SET %s = %L', $1::text, $2::text, $3::text) AS sql", [
        app.usuario, parametro, valor,
      ]);
      await cliente.query(ajuste.rows[0].sql);
    }
    return { usuario: app.usuario, base: app.base, servidor: app.servidor, creado: !existe };
  } finally {
    await cliente.end();
  }
}

async function main() {
  const r = await asegurarUsuarioDeEjecucion(process.env.DATABASE_URL_MIGRACIONES, process.env.DATABASE_URL);
  console.log(`✓ Usuario de ejecución ${r.usuario} ${r.creado ? "creado" : "actualizado"} en ${r.base} (${r.servidor}), con el rol ${ROL_DE_EJECUCION}.`);
}

if (esEjecucionDirecta(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? `✗ ${e.message}` : e);
    process.exit(1);
  });
}
