// Lo que comparten los scripts que escriben la base fuera de la aplicación:
// la configuración, la migración de datos, los fixtures y el bootstrap.
//
// Ninguno pasa por accionProtegida() —no hay usuario—, así que cada uno
// declara su origen con SET LOCAL app.origen antes de escribir. Este archivo
// no lo hace por ellos a propósito: una transacción que firma «configuracion»
// tiene que decirlo en el archivo de la configuración, donde se lee.

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

export type Tx = Prisma.TransactionClient;

/**
 * La variable que autoriza los fixtures. Solo existe en el .env de una máquina
 * de desarrollo: los fixtures exigen que valga `permitidos`, y el bootstrap de
 * producción se niega a correr si está definida con cualquier valor.
 */
export const VARIABLE_DE_AUTORIZACION = "BODEGASOSUR_FIXTURES";
export const VALOR_DE_AUTORIZACION = "permitidos";

/**
 * La sesión va en UTC aunque la base muestre la hora de México: el adapter
 * lee y escribe timestamptz suponiendo UTC, y en otra zona movería cada
 * instante (src/lib/db.ts igual).
 */
export function crearCliente(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error("Falta DATABASE_URL.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: "-c TimeZone=UTC" }) });
}

/**
 * Los scripts escriben como el dueño del esquema, que la base reconoce como
 * login de confianza: el usuario de ejecución ya no escribe sin un token de
 * Clerk (prisma/sql/despues/96-actor-exigido.sql).
 */
export function crearClienteDelDueno(): PrismaClient {
  const url = process.env.DATABASE_URL_MIGRACIONES;
  if (!url) throw new Error("Falta DATABASE_URL_MIGRACIONES: los scripts de datos escriben como el dueño del esquema.");
  return crearCliente(url);
}

/** `true` cuando el archivo se corrió con `tsx archivo.ts`, y no se importó. */
export function esEjecucionDirecta(urlDelModulo: string): boolean {
  const principal = process.argv[1];
  return principal !== undefined && pathToFileURL(principal).href === urlDelModulo;
}

// ── Búsqueda por nombre ────────────────────────────────────────────────────
//
// Bodega, Persona y Proveedor tienen un índice único sobre
// nombre_normalizado(columna) —prisma/sql/despues/10-invariantes.sql—. Buscar
// con esa misma función es lo único que garantiza que «encontrado» y «el
// índice lo rechazaría» sean la misma pregunta. Un `equals` de Prisma, aunque
// fuera insensible a mayúsculas, no vería los espacios dobles.

const TABLAS_CON_NOMBRE = {
  Bodega: "nombre",
  Persona: "nombre",
  Proveedor: "nombreComercial",
} as const;

export type TablaConNombre = keyof typeof TABLAS_CON_NOMBRE;

export async function buscarPorNombre(
  tx: Tx,
  tabla: TablaConNombre,
  valor: string,
): Promise<{ id: string } | null> {
  const columna = TABLAS_CON_NOMBRE[tabla];
  const filas = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM public.${Prisma.raw(`"${tabla}"`)}
               WHERE nombre_normalizado(${Prisma.raw(`"${columna}"`)}) = nombre_normalizado(${valor})
               LIMIT 1`,
  );
  return filas[0] ?? null;
}

/** Cuántos registros operativos tiene la base: lo que solo existe cuando ya se trabajó en ella. */
export async function contarDatosOperativos(db: Tx | PrismaClient) {
  const [movimientos, existencias, articulos, proveedores] = await Promise.all([
    db.movimiento.count(),
    db.existencia.count(),
    db.articulo.count(),
    db.proveedor.count(),
  ]);
  return { movimientos, existencias, articulos, proveedores };
}

/** Nombre de la base y servidor a los que apunta la URL, para decirlo antes de escribir. */
export function describirBase(url = process.env.DATABASE_URL ?? ""): { base: string; servidor: string } {
  try {
    const u = new URL(url);
    return { base: u.pathname.replace(/^\//, ""), servidor: `${u.hostname}:${u.port || "5432"}` };
  } catch {
    return { base: "?", servidor: "?" };
  }
}

/** La misma regla que nombre_normalizado() en SQL, para comparar dentro de un archivo antes de tocar la base. */
export function nombreNormalizado(texto: string): string {
  return texto.trim().replace(/\s+/g, " ").toLowerCase();
}
