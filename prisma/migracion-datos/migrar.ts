// Migración de catálogos: empresas, estaciones y personas de Gasosur entran a
// la base desde los CSV de `datos/`. Ver el README de esta carpeta para saber
// de qué archivo y de qué día es cada uno.
//
// Es código y no trabajo manual en Studio por lo que dice la auditoría (F5):
// tiene que poder correrse N veces y quedar versionado junto con el corte.
//
// El CSV es la carga inicial, no la fuente permanente. Lo que Compras cambie
// después desde la pantalla manda, y este script lo respeta con tres modos:
//
//   npm run datos:migrar                    crea lo que falta. Si algo existe y
//                                           coincide, no lo toca. Si existe y
//                                           difiere, SE DETIENE con el reporte y
//                                           no escribe nada, ni lo nuevo.
//   npm run datos:migrar -- --sincronizar   además sobrescribe las divergencias
//                                           desde el CSV, y lista cada una.
//   npm run datos:migrar -- --simular       imprime lo que haría y no escribe.
//
// Para lograrlo trabaja en dos pasadas dentro de una sola transacción: primero
// PLANEA —compara cada renglón con la base y lo clasifica en crear, igual o
// divergente— y solo después ESCRIBE. Un renglón igual no genera ningún
// UPDATE: `updatedAt` queda intacto y la bitácora, en silencio.
//
// Dos cosas que el script compara y dos que no:
//   · Compara solo los campos que el CSV trae, ya normalizados.
//   · Para cada divergencia consulta la bitácora y dice quién hizo el último
//     cambio: es lo que distingue una edición manual de un corte nuevo.
//   · No toca `activa`: el CSV no la tiene. Dar de baja desde la pantalla no
//     es una divergencia.
//   · No borra ni desactiva lo que está en la base y no en el CSV.

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { FORMA_RFC, normalizarRfc } from "../../src/lib/rfc";
import {
  buscarPorNombre,
  crearCliente,
  esEjecucionDirecta,
  nombreNormalizado,
  type Tx,
} from "../comun";
import { leerCsv, type Renglon } from "./csv";

/** Con qué firma la migración en la bitácora. */
export const ORIGEN = "migracion-datos";

const DATOS_POR_OMISION = path.join(path.dirname(fileURLToPath(import.meta.url)), "datos");

export type OpcionesMigracion = {
  /** Carpeta con los CSV. Por omisión, `datos/` junto a este archivo. */
  datos?: string;
  sincronizar?: boolean;
  simular?: boolean;
};

export type Divergencia = {
  entidad: "empresa" | "estación" | "persona";
  clave: string;
  campo: string;
  enBase: string | null;
  enCsv: string | null;
  /** Quién y cuándo tocó la fila por última vez, según la bitácora. */
  ultimoCambio: string;
};

export type ResumenMigracion = {
  simulado: boolean;
  creados: { empresas: number; estaciones: number; personas: number };
  iguales: number;
  /** Divergencias encontradas. Con --sincronizar, ya sobrescritas. */
  divergencias: Divergencia[];
  sobrescritas: number;
};

export class ErrorDivergencia extends Error {
  constructor(public readonly divergencias: Divergencia[]) {
    super(
      `${divergencias.length} divergencia(s) entre la base y el CSV. No se escribió nada.\n` +
        `Para sobrescribir desde el CSV: npm run datos:migrar -- --sincronizar`,
    );
    this.name = "ErrorDivergencia";
  }
}

// ── Lectura y validación de los CSV ───────────────────────────────────────

type EmpresaDeseada = { rfc: string; razonSocial: string };
type EstacionDeseada = {
  numero: string;
  alias: string;
  empresaRfc: string;
  telefono: string | null;
  movil: string | null;
  correo: string | null;
};
type PersonaDeseada = { nombre: string; puesto: string | null };

function obligatorio(r: Renglon, archivo: string, columna: string): string {
  const valor = r.col(columna);
  if (valor === "") throw new Error(`${archivo}, renglón ${r.linea}: falta «${columna}».`);
  return valor;
}

function opcional(r: Renglon, columna: string): string | null {
  const valor = r.col(columna);
  return valor === "" ? null : valor;
}

function rfcValidado(crudo: string, donde: string): string {
  const rfc = normalizarRfc(crudo);
  if (!rfc || !FORMA_RFC.test(rfc)) throw new Error(`${donde}: «${crudo}» no tiene forma de RFC.`);
  return rfc;
}

function leerEstaciones(carpeta: string): { empresas: EmpresaDeseada[]; estaciones: EstacionDeseada[] } {
  const archivo = "estaciones.csv";
  const renglones = leerCsv(path.join(carpeta, archivo));

  // Varias estaciones comparten empresa. Si dos renglones del mismo RFC
  // trajeran razones sociales distintas no habría forma de saber cuál es la
  // buena: se detiene.
  const razonPorRfc = new Map<string, string>();
  const numerosVistos = new Set<string>();
  const estaciones: EstacionDeseada[] = [];

  for (const r of renglones) {
    const donde = `${archivo}, renglón ${r.linea}`;
    const rfc = rfcValidado(obligatorio(r, archivo, "RFC"), donde);
    const razonSocial = obligatorio(r, archivo, "Razón Social");
    const previa = razonPorRfc.get(rfc);
    if (previa !== undefined && previa !== razonSocial) {
      throw new Error(`${archivo}: el RFC ${rfc} aparece como «${previa}» y como «${razonSocial}».`);
    }
    razonPorRfc.set(rfc, razonSocial);

    const numero = obligatorio(r, archivo, "No. Estación").toUpperCase();
    if (numerosVistos.has(numero)) throw new Error(`${donde}: la estación ${numero} está repetida.`);
    numerosVistos.add(numero);

    estaciones.push({
      numero,
      alias: obligatorio(r, archivo, "Alias"),
      empresaRfc: rfc,
      telefono: opcional(r, "Teléfono"),
      movil: opcional(r, "Móvil"),
      correo: opcional(r, "Correo"),
    });
  }

  const empresas = [...razonPorRfc].map(([rfc, razonSocial]) => ({ rfc, razonSocial }));
  return { empresas, estaciones };
}

function leerPersonas(carpeta: string): PersonaDeseada[] {
  const archivo = "personas.csv";
  const vistos = new Set<string>();
  return leerCsv(path.join(carpeta, archivo)).map((r) => {
    const nombre = obligatorio(r, archivo, "nombre");
    const llave = nombreNormalizado(nombre);
    if (vistos.has(llave)) throw new Error(`${archivo}, renglón ${r.linea}: «${nombre}» está repetida.`);
    vistos.add(llave);
    return { nombre, puesto: opcional(r, "puesto") };
  });
}

// ── Planear ───────────────────────────────────────────────────────────────

type Plan<T> = { crear: T[]; iguales: number; divergentes: { id: string; deseado: T }[] };
type Campos = Record<string, string | null>;

/** Compara campo por campo y devuelve las diferencias, ya en forma de reporte. */
function comparar(
  entidad: Divergencia["entidad"],
  clave: string,
  enBase: Campos,
  deseado: Campos,
  ultimoCambio: string,
): Divergencia[] {
  const diferencias: Divergencia[] = [];
  for (const [campo, enCsv] of Object.entries(deseado)) {
    const actual = enBase[campo] ?? null;
    if (actual !== enCsv) diferencias.push({ entidad, clave, campo, enBase: actual, enCsv, ultimoCambio });
  }
  return diferencias;
}

/** Quién tocó la fila por última vez, para que el reporte diga si fue una persona o un corte. */
async function ultimoCambio(tx: Tx, tabla: string, registroId: string): Promise<string> {
  const filas = await tx.$queryRaw<{ ocurridoEn: Date; origen: string | null; correo: string | null }[]>`
    SELECT b."ocurridoEn", b.origen, u.correo
      FROM "Bitacora" b LEFT JOIN "Usuario" u ON u.id = b."usuarioId"
     WHERE b.tabla = ${tabla} AND b."registroId" = ${registroId}
     ORDER BY b."ocurridoEn" DESC LIMIT 1`;
  const f = filas[0];
  if (!f) return "sin rastro en la bitácora";
  const cuando = f.ocurridoEn.toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
  return f.correo ? `editado por ${f.correo} el ${cuando}` : `origen «${f.origen}» el ${cuando}`;
}

async function planear(
  tx: Tx,
  deseado: { empresas: EmpresaDeseada[]; estaciones: EstacionDeseada[]; personas: PersonaDeseada[] },
) {
  const divergencias: Divergencia[] = [];
  const empresas: Plan<EmpresaDeseada> = { crear: [], iguales: 0, divergentes: [] };
  const estaciones: Plan<EstacionDeseada> = { crear: [], iguales: 0, divergentes: [] };
  const personas: Plan<PersonaDeseada> = { crear: [], iguales: 0, divergentes: [] };

  const clasificar = async <T extends Campos>(
    plan: Plan<T>,
    entidad: Divergencia["entidad"],
    tabla: string,
    clave: string,
    existente: { id: string } | null,
    enBase: Campos,
    d: T,
  ) => {
    if (!existente) {
      plan.crear.push(d);
      return;
    }
    const diferencias = comparar(entidad, clave, enBase, d, await ultimoCambio(tx, tabla, existente.id));
    if (diferencias.length === 0) {
      plan.iguales++;
      return;
    }
    divergencias.push(...diferencias);
    plan.divergentes.push({ id: existente.id, deseado: d });
  };

  for (const d of deseado.empresas) {
    const e = await tx.empresa.findUnique({ where: { rfc: d.rfc } });
    await clasificar(empresas, "empresa", "Empresa", d.rfc, e, e ? { rfc: e.rfc, razonSocial: e.razonSocial } : {}, d);
  }

  for (const d of deseado.estaciones) {
    const e = await tx.estacion.findUnique({ where: { numero: d.numero }, include: { empresa: true } });
    const enBase: Campos = e
      ? { numero: e.numero, alias: e.alias, empresaRfc: e.empresa.rfc, telefono: e.telefono, movil: e.movil, correo: e.correo }
      : {};
    await clasificar(estaciones, "estación", "Estacion", d.numero, e, enBase, d);
  }

  for (const d of deseado.personas) {
    const encontrada = await buscarPorNombre(tx, "Persona", d.nombre);
    const e = encontrada ? await tx.persona.findUnique({ where: { id: encontrada.id } }) : null;
    await clasificar(personas, "persona", "Persona", d.nombre, e, e ? { nombre: e.nombre, puesto: e.puesto } : {}, d);
  }

  return { empresas, estaciones, personas, divergencias };
}

// ── Escribir ──────────────────────────────────────────────────────────────

async function escribir(tx: Tx, plan: Awaited<ReturnType<typeof planear>>, sincronizar: boolean) {
  await tx.$executeRawUnsafe(`SET LOCAL app.origen = '${ORIGEN}'`);

  for (const d of plan.empresas.crear) await tx.empresa.create({ data: d });
  if (sincronizar) {
    for (const { id, deseado } of plan.empresas.divergentes) {
      await tx.empresa.update({ where: { id }, data: { razonSocial: deseado.razonSocial } });
    }
  }

  // Las estaciones apuntan a la empresa por id, y ese id no existe hasta que
  // la empresa se crea: se resuelve aquí y no al planear.
  const empresaPorRfc = new Map(
    (await tx.empresa.findMany({ where: { rfc: { not: null } } })).map((e) => [e.rfc!, e.id]),
  );
  const datosDe = (d: EstacionDeseada) => ({
    alias: d.alias,
    telefono: d.telefono,
    movil: d.movil,
    correo: d.correo,
    empresaId: empresaPorRfc.get(d.empresaRfc)!,
  });

  for (const d of plan.estaciones.crear) await tx.estacion.create({ data: { numero: d.numero, ...datosDe(d) } });
  if (sincronizar) {
    for (const { id, deseado } of plan.estaciones.divergentes) {
      await tx.estacion.update({ where: { id }, data: datosDe(deseado) });
    }
  }

  for (const d of plan.personas.crear) await tx.persona.create({ data: d });
  if (sincronizar) {
    for (const { id, deseado } of plan.personas.divergentes) {
      await tx.persona.update({ where: { id }, data: deseado });
    }
  }
}

// ── La función ────────────────────────────────────────────────────────────

export async function migrar(prisma: PrismaClient, opciones: OpcionesMigracion = {}): Promise<ResumenMigracion> {
  const carpeta = opciones.datos ?? DATOS_POR_OMISION;
  const sincronizar = opciones.sincronizar ?? false;
  const simular = opciones.simular ?? false;

  // Leer y validar antes de abrir la transacción: un CSV roto no merece conexión.
  const { empresas, estaciones } = leerEstaciones(carpeta);
  const personas = leerPersonas(carpeta);

  return prisma.$transaction(
    async (tx) => {
      const plan = await planear(tx, { empresas, estaciones, personas });

      if (plan.divergencias.length > 0 && !sincronizar && !simular) {
        throw new ErrorDivergencia(plan.divergencias);
      }
      if (!simular) await escribir(tx, plan, sincronizar);

      return {
        simulado: simular,
        creados: {
          empresas: plan.empresas.crear.length,
          estaciones: plan.estaciones.crear.length,
          personas: plan.personas.crear.length,
        },
        iguales: plan.empresas.iguales + plan.estaciones.iguales + plan.personas.iguales,
        divergencias: plan.divergencias,
        sobrescritas: sincronizar && !simular ? plan.divergencias.length : 0,
      };
    },
    { timeout: 120_000 },
  );
}

// ── Línea de comandos ─────────────────────────────────────────────────────

export function formatearDivergencia(d: Divergencia): string {
  const mostrar = (v: string | null) => (v === null ? "(vacío)" : `«${v}»`);
  return `≠ ${d.entidad} ${d.clave} · ${d.campo}: ${mostrar(d.enBase)} en la base, ${mostrar(d.enCsv)} en el CSV — ${d.ultimoCambio}`;
}

export function formatearResumen(r: ResumenMigracion): string {
  const c = r.creados;
  const cola =
    r.divergencias.length === 0
      ? ""
      : r.sobrescritas > 0
        ? ` Sobrescritas desde el CSV: ${r.sobrescritas}.`
        : ` Divergencias: ${r.divergencias.length}.`;
  return (
    `${r.simulado ? "Se crearían" : "Creados"}: ${c.empresas} empresas, ${c.estaciones} estaciones, ` +
    `${c.personas} personas. Sin cambios: ${r.iguales}.${cola}`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const sincronizar = args.includes("--sincronizar");
  const simular = args.includes("--simular");
  const desconocido = args.find((a) => a !== "--sincronizar" && a !== "--simular");
  if (desconocido) throw new Error(`Opción desconocida: ${desconocido}. Se aceptan --sincronizar y --simular.`);

  const prisma = crearCliente();
  try {
    console.log(
      `Migrando catálogos de Gasosur${simular ? " (simulación, no se escribe nada)" : ""}${sincronizar ? " con --sincronizar" : ""}…`,
    );
    const r = await migrar(prisma, { sincronizar, simular });
    for (const d of r.divergencias) console.log(`  ${formatearDivergencia(d)}`);
    console.log(formatearResumen(r));
  } finally {
    await prisma.$disconnect();
  }
}

if (esEjecucionDirecta(import.meta.url)) {
  main().catch((e) => {
    if (e instanceof ErrorDivergencia) {
      for (const d of e.divergencias) console.error(`  ${formatearDivergencia(d)}`);
    }
    console.error(e instanceof Error ? `✗ ${e.message}` : e);
    process.exit(1);
  });
}
