// Bootstrap de producción — Plan B (docs/decisiones-otros/10-plan-b-produccion.md).
//
// Deja una base lista para operar con lo mínimo real y nada demostrativo:
// la configuración (bodegas, áreas, PZA, folios), las empresas, estaciones y
// personas migradas, y el primer Superadmin. Sin proveedores, sin artículos,
// sin existencias: eso lo captura Compras desde la aplicación.
//
// Es manual, y por diseño no forma parte de `next build` ni de `next start`.
// En este orden, y cada paso detiene al siguiente:
//
//   1. Valida el ENTORNO antes de tocar la base: DATABASE_URL bien formada,
//      Clerk configurado, terminal interactiva, y que BODEGASOSUR_FIXTURES no
//      esté definida —si está, esto es una máquina de desarrollo—. Nada de
//      esto necesita conexión, y por eso va antes de `migrate deploy`.
//   2. Aplica las migraciones pendientes con `prisma migrate deploy`. Nunca
//      `migrate dev`, que puede resetear.
//   3. Rechaza una base que ya opera: movimientos, existencias, artículos o
//      proveedores.
//   4. Rechaza divergencias entre los CSV y lo que ya exista en la base: este
//      script nunca sobrescribe ni reactiva nada. Si hay que sincronizar, se
//      hace aparte y a conciencia con `datos:migrar -- --sincronizar`.
//   5. Muestra qué va a escribir y a dónde, y exige teclear el nombre de la
//      base para confirmar.
//
// Uso:  npm run prod:bootstrap

import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  AREAS,
  BODEGAS,
  FOLIOS,
  UNIDAD_BASE,
  aplicarConfiguracion,
} from "../prisma/configuracion";
import { formatearDivergencia, migrar } from "../prisma/migracion-datos/migrar";
import { VARIABLE_DE_AUTORIZACION, contarDatosOperativos, crearCliente } from "../prisma/comun";
import { arrancarSuperadmin, describirArranque } from "./arranque-superadmin";

function detener(mensaje: string): never {
  throw new Error(mensaje);
}

/** Todo lo que se puede comprobar sin conectarse. Falla antes de `migrate deploy`. */
function validarEntorno(): { correo: string; secretKey: string; base: string; servidor: string } {
  const url = process.env.DATABASE_URL;
  if (!url) detener("Falta DATABASE_URL.");
  let base: string;
  let servidor: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") throw new Error();
    base = u.pathname.replace(/^\//, "");
    servidor = `${u.hostname}:${u.port || "5432"}`;
    if (base === "") throw new Error();
  } catch {
    detener("DATABASE_URL no es una URL de PostgreSQL válida con nombre de base.");
  }
  if (base.endsWith("_prueba")) {
    detener(`La base «${base}» es de pruebas (termina en _prueba). El bootstrap de producción no corre ahí.`);
  }

  const correo = process.env.CLERK_SUPERADMIN_CORREO;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!correo || !secretKey) {
    detener("Producción exige CLERK_SUPERADMIN_CORREO y CLERK_SECRET_KEY: sin Superadmin nadie entra.");
  }
  if (secretKey.startsWith("sk_test_")) {
    detener("CLERK_SECRET_KEY es una llave de prueba (sk_test_). Producción exige la llave de la instancia de producción de Clerk.");
  }
  if (process.env[VARIABLE_DE_AUTORIZACION] !== undefined) {
    detener(
      `${VARIABLE_DE_AUTORIZACION} está definida: este entorno es de desarrollo. ` +
        "El bootstrap de producción no corre aquí; quítala del entorno si de verdad es producción.",
    );
  }
  if (!stdin.isTTY) {
    detener("El bootstrap de producción exige una terminal interactiva para confirmar. No corre desatendido.");
  }

  return { correo, secretKey, base, servidor };
}

async function main() {
  // ── 1. Entorno, antes de tocar nada ─────────────────────────────────────
  const { correo, secretKey, base, servidor } = validarEntorno();
  console.log(`Entorno válido. Base: ${base} en ${servidor}. Superadmin: ${correo}.`);

  // ── 2. Migraciones pendientes ───────────────────────────────────────────
  console.log("Aplicando migraciones pendientes (prisma migrate deploy)…");
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });

  const prisma = crearCliente();

  try {
    // ── 3. La base tiene que estar sin operar ────────────────────────────
    const operativos = await contarDatosOperativos(prisma);
    const ocupado = Object.entries(operativos).filter(([, n]) => n > 0);
    if (ocupado.length > 0) {
      detener(
        `La base ${base} en ${servidor} ya opera: ${ocupado.map(([k, n]) => `${n} ${k}`).join(", ")}. ` +
          "El bootstrap solo entra a una base sin datos operativos.",
      );
    }

    // ── 4. Qué se va a escribir ──────────────────────────────────────────
    const simulacion = await migrar(prisma, { simular: true });
    if (simulacion.divergencias.length > 0) {
      for (const d of simulacion.divergencias) console.error(`  ${formatearDivergencia(d)}`);
      detener(
        `${simulacion.divergencias.length} divergencia(s) entre los CSV y la base. El bootstrap no sobrescribe: ` +
          "revísalas y, si procede, corre `npm run datos:migrar -- --sincronizar` aparte.",
      );
    }

    const c = simulacion.creados;
    console.log(`\nBootstrap de producción sobre ${base} en ${servidor}\n`);
    console.log(`  Empresas       ${c.empresas} a crear${simulacion.iguales ? ` (y ${simulacion.iguales} registros ya presentes, sin cambios)` : ""}`);
    console.log(`  Estaciones     ${c.estaciones} a crear`);
    console.log(`  Personas       ${c.personas} a crear`);
    console.log(`  Bodegas        ${BODEGAS.map((b) => b.nombre).join(", ")}`);
    console.log(`  Áreas          ${AREAS.join(", ")}`);
    console.log(`  Unidad         ${UNIDAD_BASE.clave} — ${UNIDAD_BASE.nombre}`);
    console.log(`  Folios         ${FOLIOS.map((f) => f.prefijo).join(" ")}`);
    console.log(`  Superadmin     ${correo}`);
    console.log("  Sin proveedores, artículos ni existencias: los captura Compras desde la aplicación.\n");

    // ── 5. Confirmación explícita ────────────────────────────────────────
    const rl = createInterface({ input: stdin, output: stdout });
    const respuesta = await rl.question(`Escribe el nombre de la base («${base}») para confirmar que es PRODUCCIÓN: `);
    rl.close();
    if (respuesta.trim() !== base) {
      console.log("Cancelado. No se escribió nada.");
      return;
    }

    // ── 6. Escribir ──────────────────────────────────────────────────────
    const conf = await prisma.$transaction((tx) => aplicarConfiguracion(tx));
    console.log(`  ✓ Configuración mínima: ${conf.creados} creados, ${conf.existentes} ya existían.`);

    const r = await migrar(prisma);
    console.log(`  ✓ Catálogos: ${r.creados.empresas} empresas, ${r.creados.estaciones} estaciones, ${r.creados.personas} personas creadas; ${r.iguales} sin cambios.`);

    const arranque = await arrancarSuperadmin(prisma, { correo, secretKey });
    console.log(describirArranque(correo, arranque));

    console.log("\nListo. La base está en pie y sin operación: Compras puede empezar a capturar.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? `✗ ${e.message}` : e);
  process.exit(1);
});
