/*
  La frontera de la fase 7: pantallas, acciones y lecturas solo llegan a la
  base por consultar() y accionProtegida(), cada acción con su permiso, y el
  actor nunca viaja como argumento. Se lee el código fuente, no se ejecuta.
*/

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "../../..");
const APP = join(RAIZ, "src/app/(sistema)");

function archivosDe(carpeta: string): string[] {
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return archivosDe(ruta);
    return /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

const RUTAS = ["traspasos", "devoluciones", "conteos", "ajustes", "prestamos", "reversas"];
const CAPA_DE_APLICACION = [
  ...RUTAS.flatMap((r) => archivosDe(join(APP, r))),
  ...archivosDe(join(RAIZ, "src/components/inventario")),
  join(RAIZ, "src/lib/inventario/repo.ts"),
  join(RAIZ, "src/lib/inventario/pantallas.ts"),
];
const relativa = (ruta: string) => ruta.slice(RAIZ.length + 1);

/** Acción exportada → [permiso, función de servicio]. */
const ACCIONES: Record<string, Record<string, [string, string]>> = {
  traspasos: {
    crearTraspaso: ["traspasos:capturar", "crearTraspaso"],
    guardarTraspaso: ["traspasos:capturar", "guardarTraspaso"],
    descartarTraspaso: ["traspasos:capturar", "descartarTraspaso"],
    confirmarTraspaso: ["traspasos:confirmar", "confirmarTraspaso"],
  },
  devoluciones: {
    crearDevolucion: ["devoluciones:capturar", "crearDevolucion"],
    guardarDevolucion: ["devoluciones:capturar", "guardarDevolucion"],
    descartarDevolucion: ["devoluciones:capturar", "descartarDevolucion"],
    confirmarDevolucion: ["devoluciones:confirmar", "confirmarDevolucion"],
  },
  conteos: {
    abrirHoja: ["ajustes:capturar", "abrirHoja"],
    guardarConteo: ["ajustes:capturar", "guardarConteo"],
    actualizarHoja: ["ajustes:capturar", "actualizarHoja"],
    descartarHoja: ["ajustes:capturar", "descartarHoja"],
    confirmarConteo: ["ajustes:confirmar", "confirmarConteo"],
  },
  reversas: { revertirMovimiento: ["movimientos:revertir", "revertirMovimiento"] },
};

describe("frontera de la fase 7", () => {
  it("la capa de aplicación no crea ni importa un cliente Prisma", () => {
    expect(CAPA_DE_APLICACION.length).toBeGreaterThan(20);
    for (const ruta of CAPA_DE_APLICACION) {
      const codigo = readFileSync(ruta, "utf8");
      expect(codigo, relativa(ruta)).not.toMatch(/PrismaClient|@prisma\/adapter-pg|\$transaction|\$queryRawUnsafe|\$executeRawUnsafe/);
      for (const linea of codigo.split("\n").filter((l) => l.includes('from "@prisma/client"'))) {
        expect(linea, relativa(ruta)).toMatch(/^import type /);
      }
      for (const [, nombres] of codigo.matchAll(/import \{([^}]+)\} from "@\/lib\/db"/g)) {
        for (const nombre of nombres.split(",").map((n) => n.trim().replace(/^type /, "")).filter(Boolean)) {
          expect(["consultar", "SinAcceso", "SinPermiso", "UsuarioSesion"], `${relativa(ruta)} importa ${nombre}`).toContain(nombre);
        }
      }
    }
  });

  it("cada página lee dentro de consultar() con el permiso de su sección", () => {
    const PERMISO: Record<string, RegExp> = {
      traspasos: /consultar\("traspasos:(leer|capturar)"/,
      devoluciones: /consultar\("devoluciones:(leer|capturar)"/,
      conteos: /consultar\("ajustes:(leer|capturar)"/,
      ajustes: /consultar\("ajustes:leer"/,
      prestamos: /consultar\("devoluciones:leer"/,
    };
    for (const [ruta, patron] of Object.entries(PERMISO)) {
      for (const pagina of archivosDe(join(APP, ruta)).filter((a) => a.endsWith("page.tsx"))) {
        const codigo = readFileSync(pagina, "utf8");
        expect(codigo, relativa(pagina)).toMatch(patron);
        expect(codigo.match(/consultar\(/g), relativa(pagina)).toHaveLength(1);
      }
    }
  });

  it("los enlaces a captura no se precargan", () => {
    for (const ruta of CAPA_DE_APLICACION) {
      const codigo = readFileSync(ruta, "utf8");
      for (const [enlace] of codigo.matchAll(/<(?:ButtonLink|Link)[^>]*href=\{?[`"]\/[a-z]+\/(?:nuevo|nueva)[^>]*>/g)) {
        expect(enlace, relativa(ruta)).toContain("prefetch={false}");
      }
    }
  });

  it("cada Server Action pasa por la puerta con su permiso y ninguna recibe el actor", () => {
    for (const [carpeta, esperadas] of Object.entries(ACCIONES)) {
      const archivo = join(APP, carpeta, "actions.ts");
      const codigo = readFileSync(archivo, "utf8");
      expect(codigo.startsWith('"use server";'), carpeta).toBe(true);

      const exportadas = [...codigo.matchAll(/export async function (\w+)\(([^)]*)\)/g)];
      expect(exportadas.map((m) => m[1]).sort(), carpeta).toEqual(Object.keys(esperadas).sort());
      for (const [, nombre, parametros] of exportadas) {
        expect(parametros, nombre).not.toMatch(/usuario|creadoPor|confirmadoPor|canceladoPor|rol|esperada/i);
      }

      // const x = protegida("permiso", esquema, (tx, u, d) => servicio.fn(...)
      const puertas = Object.fromEntries(
        [...codigo.matchAll(/^const (\w+) = protegida\("([\w:]+)", \w+, \(tx, u, d\) => servicio\.(\w+)\(/gm)].map(([, constante, permiso, fn]) => [constante, [permiso, fn]]),
      );
      const usadas = Object.fromEntries(
        [...codigo.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)].map(([, nombre, cuerpo]) => {
          const constante = /\b(crear|guardar|descartar|confirmar|abrir|actualizar|revertir)\(/.exec(cuerpo)?.[1];
          expect(cuerpo, nombre).not.toMatch(/formData\.\w+\(|\bleer\w*\(|servicio\./);
          return [nombre, constante ? puertas[constante] : undefined];
        }),
      );
      expect(usadas, carpeta).toEqual(esperadas);
      // El servicio solo se llama dentro de una puerta.
      const llamadas = codigo.split("\n").filter((l) => /servicio\.\w+\(/.test(l));
      expect(llamadas.every((l) => /^const \w+ = protegida\(/.test(l)), carpeta).toBe(true);
      expect(codigo, carpeta).not.toMatch(/accionProtegida\(|consultar\(/);
    }
  });

  it("la búsqueda de salida del formulario solo lee, dentro de consultar() con el permiso de captura", () => {
    const codigo = readFileSync(join(APP, "devoluciones", "consultas.ts"), "utf8");
    expect(codigo.startsWith('"use server";')).toBe(true);
    const exportadas = [...codigo.matchAll(/export async function (\w+)\(([^)]*)\)/g)];
    expect(exportadas.map((m) => m[1])).toEqual(["buscarSalidas"]);
    expect(exportadas[0][2]).not.toMatch(/usuario|creadoPor|rol/i);
    expect(codigo).toMatch(/return await consultar\("devoluciones:capturar", \(db\) => salidasDelSelector\(db, busqueda\)\)/);
    expect(codigo.match(/consultar\("/g)).toHaveLength(1);
    expect(codigo).not.toMatch(/accionProtegida\(|protegida\(|servicio|\$queryRaw|\$executeRaw/);
  });

  it("la puerta común lee y valida dentro de accionProtegida(), y traduce la confirmación", () => {
    const codigo = readFileSync(join(RAIZ, "src/lib/inventario/acciones.ts"), "utf8");
    expect(codigo).toMatch(/return traducida\(\s*accionProtegida\(permiso, \(tx, usuario, entrada: I\) => \{\s*const r = esquema\.safeParse\(leer\(entrada\)\);/);
    expect(codigo.match(/accionProtegida\(/g)).toHaveLength(1);
  });

  it("todo servicio recibe el actor de la puerta, nunca de los datos", () => {
    for (const archivo of ["traspasos", "devoluciones", "conteos", "reversas"]) {
      const codigo = readFileSync(join(RAIZ, `src/lib/inventario/${archivo}.ts`), "utf8");
      const exportadas = [...codigo.matchAll(/export async function (\w+)\(([\s\S]*?)\): Promise/g)];
      expect(exportadas.length, archivo).toBeGreaterThanOrEqual(1);
      for (const [, nombre, parametros] of exportadas) {
        expect(parametros.replace(/\s+/g, " ").trim(), nombre).toMatch(/^tx: Tx, usuario: UsuarioSesion,/);
      }
    }
  });
});
