/*
  La frontera de la fase 5 (11 §11): pantallas, acciones y componentes de
  entradas solo llegan a la base por consultar() y accionProtegida(). Aquí se
  lee el código fuente, no se ejecuta: si alguien abre otro camino, la suite
  lo nombra.
*/

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "../../..");

function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

const CAPA_DE_APLICACION = [
  ...archivosDe(join(RAIZ, "src/app/(sistema)/entradas")),
  ...archivosDe(join(RAIZ, "src/components/entradas")),
  join(RAIZ, "src/lib/entradas/repo.ts"),
];

const relativa = (ruta: string) => ruta.slice(RAIZ.length + 1);

describe("frontera de entradas", () => {
  it("la capa de aplicación no crea ni importa un cliente Prisma", () => {
    for (const ruta of CAPA_DE_APLICACION) {
      const codigo = readFileSync(ruta, "utf8");
      expect(codigo, relativa(ruta)).not.toMatch(/PrismaClient|@prisma\/adapter-pg|\$transaction|\$queryRawUnsafe|\$executeRawUnsafe/);
      // De @prisma/client solo tipos: ningún valor con el que consultar.
      for (const linea of codigo.split("\n").filter((l) => l.includes('from "@prisma/client"'))) {
        expect(linea, relativa(ruta)).toMatch(/^import type /);
      }
    }
  });

  it("de @/lib/db solo se toman las dos puertas y sus errores", () => {
    for (const ruta of CAPA_DE_APLICACION) {
      const codigo = readFileSync(ruta, "utf8");
      for (const [, nombres] of codigo.matchAll(/import \{([^}]+)\} from "@\/lib\/db"/g)) {
        for (const nombre of nombres.split(",").map((n) => n.trim().replace(/^type /, "")).filter(Boolean)) {
          expect(["consultar", "accionProtegida", "mensajeDeNegativa", "SinAcceso", "SinPermiso", "UsuarioSesion"], `${relativa(ruta)} importa ${nombre}`).toContain(nombre);
        }
      }
    }
  });

  it("cada Server Action de entradas pasa por accionProtegida() y ninguna recibe el usuario del cliente", () => {
    const codigo = readFileSync(join(RAIZ, "src/app/(sistema)/entradas/actions.ts"), "utf8");
    expect(codigo.startsWith('"use server";')).toBe(true);
    const exportadas = [...codigo.matchAll(/export async function (\w+)\(([^)]*)\)/g)];
    expect(exportadas.map((m) => m[1]).sort()).toEqual(["confirmarRecepcion", "crearEntrada", "descartarEntrada", "guardarEntrada"]);
    for (const [, nombre, parametros] of exportadas) {
      expect(parametros, nombre).not.toMatch(/usuario|creadoPor|confirmadoPor|rol/i);
    }

    // Servicio → permiso exigido por la puerta.
    const puertas = Object.fromEntries(
      [...codigo.matchAll(/^const \w+ = protegida\("([\w:]+)", \w+, \(tx, u, d\) => servicio\.(\w+)\(/gm)].map(([, permiso, fn]) => [fn, permiso]),
    );
    expect(puertas).toEqual({
      crearBorrador: "entradas:capturar",
      guardarBorrador: "entradas:capturar",
      descartarBorrador: "entradas:capturar",
      confirmarEntrada: "entradas:confirmar",
    });
    // El servicio solo se llama dentro de la puerta, y la puerta entera va traducida.
    const llamadas = codigo.split("\n").filter((l) => /servicio\.\w+\(/.test(l));
    expect(llamadas.every((l) => /^const \w+ = protegida\(/.test(l))).toBe(true);
    expect(llamadas).toHaveLength(4);
    expect(codigo.match(/accionProtegida\(/g)).toHaveLength(1);
    expect(codigo).toMatch(/return traducida\(\s*accionProtegida\(permiso,/);
    // La lectura y Zod van dentro de la puerta: sin sesión no se abre ningún dato.
    expect(codigo.match(/\.safeParse\(/g)).toHaveLength(1);
    expect(codigo).toMatch(/accionProtegida\(permiso, \(tx, usuario, entrada: I\) => \{\s*const r = esquema\.safeParse\(leer\(entrada\)\);/);
    for (const [, nombre, cuerpo] of codigo.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)) {
      expect(cuerpo, nombre).not.toMatch(/formData\.\w+\(|\bleer\w*\(|Object\.fromEntries/);
    }
    // El cliente de escritura no sale del módulo de la puerta.
    expect(readFileSync(join(RAIZ, "src/lib/db.ts"), "utf8")).not.toMatch(/export (const|let|var) prisma\b/);
  });
});
