/*
  La frontera de la fase 8: los reportes y las descargas solo leen, siempre
  por la puerta y con el permiso de su pantalla. Se lee el código fuente.
*/

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { CLAVES_DE_DESCARGA, descargaDe } = await import("../exportar/descargas");

const RAIZ = join(import.meta.dirname, "../../..");
const relativa = (ruta: string) => ruta.slice(RAIZ.length + 1);

function archivosDe(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

const CODIGO = [
  ...archivosDe(join(RAIZ, "src/lib/reportes")),
  ...archivosDe(join(RAIZ, "src/lib/exportar")),
  ...archivosDe(join(RAIZ, "src/app/(sistema)/reportes")),
  ...archivosDe(join(RAIZ, "src/app/exportar")),
  ...archivosDe(join(RAIZ, "src/components/reportes")),
];

// Lleva en un Map los libros en curso: su `.delete(` no es de Prisma. A cambio,
// no importa nada con qué llegar a la base.
const EN_MEMORIA = join(RAIZ, "src/lib/exportar/generaciones.ts");

describe("frontera de la fase 8", () => {
  it("nada crea un cliente, abre transacciones, escribe ni arma SQL con texto", () => {
    expect(CODIGO.length).toBeGreaterThan(15);
    for (const ruta of CODIGO) {
      const codigo = readFileSync(ruta, "utf8");
      if (ruta === EN_MEMORIA) {
        for (const linea of codigo.split("\n").filter((l) => l.startsWith("import "))) expect(linea).toMatch(/^import (type \{|"server-only";$)/);
        expect(codigo).not.toMatch(/PrismaClient|\$transaction|\$queryRaw|\$executeRaw|\bdb\b|\btx\b/);
        continue;
      }
      expect(codigo, relativa(ruta)).not.toMatch(/PrismaClient|@prisma\/adapter-pg|\$transaction|\$queryRawUnsafe|\$executeRaw|accionProtegida|\.(create|update|upsert|delete)(Many)?\(/);
      expect(codigo, relativa(ruta)).not.toMatch(/Prisma\.raw\(`[^`]*\$\{(?!k\}|nombre\})/);
    }
  });

  it("cada reporte lee una vez dentro de consultar() con reportes:leer", () => {
    const paginas = archivosDe(join(RAIZ, "src/app/(sistema)/reportes")).filter((a) => a.endsWith("page.tsx"));
    expect(paginas).toHaveLength(5);
    for (const pagina of paginas) {
      const codigo = readFileSync(pagina, "utf8");
      expect(codigo.match(/consultar\(/g), relativa(pagina)).toHaveLength(1);
      expect(codigo, relativa(pagina)).toMatch(/consultar\("reportes:leer"/);
    }
  });

  it("la búsqueda de artículos solo lee, dentro de consultarDesdeAccion() con reportes:leer", () => {
    const codigo = readFileSync(join(RAIZ, "src/app/(sistema)/reportes/consultas.ts"), "utf8");
    expect(codigo.startsWith('"use server";')).toBe(true);
    expect([...codigo.matchAll(/export async function (\w+)/g)].map((m) => m[1])).toEqual(["buscarArticulos"]);
    expect(codigo.match(/consultar(DesdeAccion)?\("/g)).toEqual(['consultarDesdeAccion("']);
    expect(codigo).toMatch(/consultarDesdeAccion\("reportes:leer"/);
  });

  it("la ruta de descarga lee por consultarParaDescarga() con el permiso de la tabla y nada más", () => {
    const codigo = readFileSync(join(RAIZ, "src/app/exportar/[tabla]/route.ts"), "utf8");
    expect(codigo).toMatch(/consultarParaDescarga\(descarga\.permiso, fn\)/);
    expect(codigo).not.toMatch(/consultar\(|consultarDesdeAccion\(|export async function (POST|PUT|PATCH|DELETE)/);
  });

  it("cada descarga exige el permiso de su pantalla", () => {
    const esperado: Record<string, string> = {
      semanal: "reportes:leer",
      existencias: "reportes:leer",
      kardex: "reportes:leer",
      gasto: "reportes:leer",
      frecuencia: "reportes:leer",
      entradas: "entradas:leer",
      entrada: "entradas:leer",
      salidas: "salidas:leer",
      salida: "salidas:leer",
      pendientes: "salidas:leer",
      traspasos: "traspasos:leer",
      traspaso: "traspasos:leer",
      devoluciones: "devoluciones:leer",
      devolucion: "devoluciones:leer",
      ajustes: "ajustes:leer",
      ajuste: "ajustes:leer",
      prestamos: "devoluciones:leer",
      conteos: "ajustes:leer",
      conteo: "ajustes:leer",
      catalogo: "catalogos:leer",
      usuarios: "usuarios:administrar",
    };
    expect([...CLAVES_DE_DESCARGA].sort()).toEqual(Object.keys(esperado).sort());
    for (const [clave, permiso] of Object.entries(esperado)) expect(descargaDe(clave)?.permiso, clave).toBe(permiso);
    for (const clave of ["toString", "constructor", "__proto__", "Movimiento"]) expect(descargaDe(clave), clave).toBeNull();
  });
});
