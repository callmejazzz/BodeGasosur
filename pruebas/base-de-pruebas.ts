import "dotenv/config";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

export const URL_PRUEBAS =
  process.env.DATABASE_URL_PRUEBAS ??
  "postgresql://bodegasosur:bodegasosur@localhost:5433/bodegasosur_prueba?schema=public";

export default async function prepararBaseDePruebas() {
  const url = new URL(URL_PRUEBAS);
  const nombre = url.pathname.replace(/^\//, "");
  if (!nombre.endsWith("_prueba")) {
    throw new Error(`La base de pruebas tiene que llamarse *_prueba, no «${nombre}». Revisa DATABASE_URL_PRUEBAS.`);
  }

  // Para crear y destruir una base hay que estar conectado a otra.
  const mantenimiento = new URL(URL_PRUEBAS);
  mantenimiento.pathname = "/postgres";
  mantenimiento.search = "";

  const cliente = new Client({ connectionString: mantenimiento.toString() });
  await cliente.connect();
  try {
    await cliente.query(`DROP DATABASE IF EXISTS "${nombre}" WITH (FORCE)`);
    await cliente.query(`CREATE DATABASE "${nombre}"`);
  } finally {
    await cliente.end();
  }

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: URL_PRUEBAS },
    stdio: "pipe",
  });
}
