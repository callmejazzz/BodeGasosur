import "server-only";
import type { Prisma } from "@prisma/client";
import { listarPrestamos } from "@/lib/inventario/repo";
import type { Permiso } from "@/lib/permisos";
import { contarArticulosBajoMinimo } from "@/lib/reportes/existencias";

type Db = Prisma.TransactionClient;

const CONTADORES = [
  { ruta: "/entradas", permisos: ["entradas:leer"], contar: (db: Db) => db.movimiento.count({ where: { tipo: "ENTRADA", estatus: "BORRADOR" } }) },
  {
    ruta: "/salidas",
    permisos: ["salidas:leer"],
    contar: (db: Db) =>
      db.movimiento.count({ where: { tipo: "SALIDA", estatus: { in: ["SOLICITADA", "AUTORIZADA", "RETIRADA"] }, canceladoPor: { is: null } } }),
  },
  { ruta: "/traspasos", permisos: ["traspasos:leer"], contar: (db: Db) => db.movimiento.count({ where: { tipo: "TRASPASO", estatus: "BORRADOR" } }) },
  { ruta: "/devoluciones", permisos: ["devoluciones:leer"], contar: (db: Db) => db.movimiento.count({ where: { tipo: "DEVOLUCION", estatus: "BORRADOR" } }) },
  { ruta: "/prestamos", permisos: ["devoluciones:leer", "salidas:leer"], contar: async (db: Db) => (await listarPrestamos(db, "abiertos", 1, 1)).pagina.total },
  { ruta: "/conteos", permisos: ["ajustes:leer"], contar: (db: Db) => db.hojaConteo.count({ where: { estatus: "BORRADOR" } }) },
  { ruta: "/reportes/existencias", permisos: ["reportes:leer"], contar: contarArticulosBajoMinimo },
] as const satisfies readonly { ruta: string; permisos: readonly Permiso[]; contar: (db: Db) => Promise<number> }[];

export type RutaConContador = (typeof CONTADORES)[number]["ruta"];
export type Contadores = Partial<Record<RutaConContador, number>>;

export async function leerContadores(db: Db, puede: (permiso: Permiso) => boolean): Promise<Contadores> {
  const contadores: Contadores = {};
  for (const c of CONTADORES) if (c.permisos.every(puede)) contadores[c.ruta] = await c.contar(db);
  return contadores;
}
