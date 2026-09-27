import "dotenv/config";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { AUDIENCIA, cargarJwk, type JwkRsa } from "../scripts/llaves-clerk";
import { asegurarUsuarioDeEjecucion } from "../scripts/usuario-ejecucion";
import type { LlaveDePrueba } from "./tokens";

/** La base de pruebas vista por su dueño: la recrea, la migra y siembra. */
export const URL_PRUEBAS =
  process.env.DATABASE_URL_PRUEBAS ??
  "postgresql://bodegasosur:bodegasosur@localhost:5433/bodegasosur_prueba?schema=public";

// La misma base vista por la aplicación: un usuario sin propiedad, con
// contraseña nueva en cada corrida. Las pruebas la leen con inject().
declare module "vitest" {
  export interface ProvidedContext {
    urlEjecucionPruebas: string;
    llavePruebas: LlaveDePrueba;
  }
}

/** El emisor de los tokens de prueba; nunca coincide con una instancia de Clerk. */
export const EMISOR_PRUEBAS = "https://clerk.bodegasosur.test";

const USUARIO_DE_EJECUCION = "bodegasosur_prueba_app";

export default async function prepararBaseDePruebas(project: TestProject) {
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
    env: { ...process.env, DATABASE_URL_MIGRACIONES: URL_PRUEBAS },
    stdio: "pipe",
  });

  const ejecucion = new URL(URL_PRUEBAS);
  ejecucion.username = USUARIO_DE_EJECUCION;
  ejecucion.password = randomBytes(18).toString("hex");
  await asegurarUsuarioDeEjecucion(URL_PRUEBAS, ejecucion.toString());
  project.provide("urlEjecucionPruebas", ejecucion.toString());

  // Un par RSA por corrida: la pública se carga como la de Clerk, la privada
  // firma los tokens de prueba y nunca sale de la memoria.
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const llave: LlaveDePrueba = {
    kid: `prueba-${randomBytes(6).toString("hex")}`,
    emisor: EMISOR_PRUEBAS,
    audiencia: AUDIENCIA,
    privadaPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  const dueno = new Client({ connectionString: URL_PRUEBAS });
  await dueno.connect();
  try {
    await cargarJwk(dueno, { ...(publicKey.export({ format: "jwk" }) as JwkRsa), kid: llave.kid }, llave.emisor);
  } finally {
    await dueno.end();
  }
  project.provide("llavePruebas", llave);
}
