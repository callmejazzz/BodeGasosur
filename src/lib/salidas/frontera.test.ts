/*
  La frontera de salidas: pantallas, acciones y lecturas solo llegan a la base
  por consultar() y accionProtegida(), cada acción con su permiso, y el actor
  nunca viaja como argumento. Se lee el código fuente, no se ejecuta.
*/

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "../../..");

function archivosDe(carpeta: string): string[] {
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

const CAPA_DE_APLICACION = [
  ...archivosDe(join(RAIZ, "src/app/(sistema)/salidas")),
  ...archivosDe(join(RAIZ, "src/components/salidas")),
  join(RAIZ, "src/lib/salidas/repo.ts"),
];

const ACCIONES = join(RAIZ, "src/app/(sistema)/salidas/actions.ts");
const relativa = (ruta: string) => ruta.slice(RAIZ.length + 1);

describe("frontera de salidas", () => {
  it("la capa de aplicación no crea ni importa un cliente Prisma", () => {
    for (const ruta of CAPA_DE_APLICACION) {
      const codigo = readFileSync(ruta, "utf8");
      expect(codigo, relativa(ruta)).not.toMatch(/PrismaClient|@prisma\/adapter-pg|\$transaction|\$queryRawUnsafe|\$executeRawUnsafe/);
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
          expect(["consultar", "accionProtegida", "SinAcceso", "SinPermiso", "UsuarioSesion"], `${relativa(ruta)} importa ${nombre}`).toContain(nombre);
        }
      }
    }
  });

  it("cada Server Action pasa por accionProtegida() con su permiso y ninguna recibe el actor", () => {
    const codigo = readFileSync(ACCIONES, "utf8");
    expect(codigo.startsWith('"use server";')).toBe(true);

    const exportadas = [...codigo.matchAll(/export async function (\w+)\(([^)]*)\)/g)];
    expect(exportadas.map((m) => m[1]).sort()).toEqual([
      "autorizarSalida",
      "cancelarSalida",
      "confirmarRecepcion",
      "crearSalida",
      "rechazarSalida",
      "retirarSalida",
    ]);
    for (const [, nombre, parametros] of exportadas) {
      expect(parametros, nombre).not.toMatch(/usuario|creadoPor|autorizadoPor|entregadoPor|recibidoPor|canceladoPor|rol/i);
    }

    // Servicio → permiso exigido por la puerta.
    const puertas = Object.fromEntries(
      [...codigo.matchAll(/^const \w+ = protegida\("([\w:]+)", \w+, \(tx, u, d\) => servicio\.(\w+)\(/gm)].map(([, permiso, fn]) => [fn, permiso]),
    );
    expect(puertas).toEqual({
      solicitarSalida: "salidas:capturar",
      autorizarSalida: "salidas:autorizar",
      rechazarSalida: "salidas:autorizar",
      cancelarSalida: "salidas:capturar",
      retirarSalida: "salidas:retirar",
      confirmarRecepcion: "salidas:recibir",
    });
    // El servicio solo se llama dentro de la puerta, y la puerta entera va traducida.
    const llamadas = codigo.split("\n").filter((l) => /servicio\.\w+\(/.test(l));
    expect(llamadas.every((l) => /^const \w+ = protegida\(/.test(l))).toBe(true);
    expect(llamadas).toHaveLength(6);
    expect(codigo.match(/accionProtegida\(/g)).toHaveLength(1);
    expect(codigo).toMatch(/return traducida\(\s*accionProtegida\(permiso,/);
    // La lectura y Zod van dentro de la puerta: sin sesión no se abre ningún dato.
    expect(codigo.match(/\.safeParse\(/g)).toHaveLength(1);
    expect(codigo).toMatch(/accionProtegida\(permiso, \(tx, usuario, entrada: I\) => \{\s*const r = esquema\.safeParse\(leer\(entrada\)\);/);
    for (const [, nombre, cuerpo] of codigo.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)) {
      expect(cuerpo, nombre).not.toMatch(/formData\.\w+\(|\bleer\w*\(|Object\.fromEntries/);
    }
  });

  it("todo el servicio recibe el actor de la puerta, nunca de los datos", () => {
    const codigo = readFileSync(join(RAIZ, "src/lib/salidas/servicio.ts"), "utf8");
    const exportadas = [...codigo.matchAll(/export async function (\w+)\(([\s\S]*?)\): Promise/g)];
    expect(exportadas.length).toBeGreaterThanOrEqual(6);
    for (const [, nombre, parametros] of exportadas) {
      expect(parametros.replace(/\s+/g, " ").trim(), nombre).toMatch(/^tx: Tx, usuario: UsuarioSesion,/);
    }
  });
});
