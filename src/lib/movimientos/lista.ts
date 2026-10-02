import "server-only";
import { Prisma, type EstatusMovimiento, type TipoMovimiento } from "@prisma/client";

/*
  El orden y la búsqueda de las listas de movimientos, en una sola consulta.
  Primero lo abierto (borradores, o lo que una salida tiene en curso), luego
  lo que tiene folio, del más alto al más bajo, y al final lo cerrado sin
  folio, lo más nuevo arriba. Solo devuelve ids: el tope acota lo que después
  se hidrata con Prisma, por amplia que sea la búsqueda.
*/

type Db = Prisma.TransactionClient;

/** Fragmentos parametrizados para filtros y columnas: los repositorios solo importan tipos de Prisma. */
export const sql = Prisma.sql;

export type ConsultaDeLista = {
  tipo: TipoMovimiento;
  /** Estatus del primer grupo. */
  abiertos: EstatusMovimiento[];
  /** El primer grupo por último toque en vez de por creación. */
  abiertosPorToque?: boolean;
  /** LEFT JOIN de los catálogos que se buscan; `m` es el movimiento. */
  joins?: Prisma.Sql;
  /** Condiciones adicionales sobre `m`, unidas con AND. */
  filtros?: Prisma.Sql[];
  busqueda: string;
  /** Se comparan como clave: sin guiones, ceros a la izquierda ni mayúsculas. */
  claves: Prisma.Sql[];
  /** Se comparan como texto: sin acentos ni mayúsculas. */
  textos: Prisma.Sql[];
  /** Última fila del tramo anterior, ya validada. */
  cursor?: string | null;
  tope: number;
};

const cualquiera = (condiciones: Prisma.Sql[]) => (condiciones.length ? Prisma.join(condiciones, " OR ") : Prisma.sql`false`);

export async function idsDeLista(db: Db, c: ConsultaDeLista): Promise<string[]> {
  const abiertos = Prisma.sql`m.estatus::text = ANY(${c.abiertos}::text[])`;
  const orden = c.abiertosPorToque ? Prisma.sql`CASE WHEN ${abiertos} THEN m."updatedAt" ELSE m."createdAt" END` : Prisma.sql`m."createdAt"`;
  // La llave de orden; la misma expresión sirve para la fila del cursor.
  const llave = Prisma.sql`
    CASE WHEN ${abiertos} THEN 0 WHEN m.folio IS NOT NULL THEN 1 ELSE 2 END AS grupo,
    coalesce(m.folio, '') COLLATE "C" AS folio, ${orden} AS orden, m.id`;

  const q = c.busqueda.trim();
  const busqueda = q
    ? Prisma.sql`AND (
        (clave_normalizada(${q}) <> '' AND (${cualquiera(c.claves.map((col) => Prisma.sql`position(clave_normalizada(${q}) IN clave_normalizada(${col})) > 0`))}))
        OR ${cualquiera(c.textos.map((col) => Prisma.sql`position(texto_buscable(${q}) IN texto_buscable(${col})) > 0`))})`
    : Prisma.empty;
  const filtros = c.filtros?.length ? Prisma.sql`AND ${Prisma.join(c.filtros, " AND ")}` : Prisma.empty;

  const filas = await db.$queryRaw<{ id: string }[]>`
    WITH lista AS (
      SELECT ${llave} FROM "Movimiento" m ${c.joins ?? Prisma.empty}
      WHERE m.tipo = ${c.tipo}::"TipoMovimiento" ${filtros} ${busqueda}
    ), cursor AS (
      SELECT ${llave} FROM "Movimiento" m WHERE m.id = ${c.cursor ?? null}::uuid AND m.tipo = ${c.tipo}::"TipoMovimiento"
    )
    SELECT l.id FROM lista l
    WHERE NOT EXISTS (SELECT 1 FROM cursor)
       OR EXISTS (SELECT 1 FROM cursor k WHERE l.grupo > k.grupo OR (l.grupo = k.grupo AND (l.folio, l.orden, l.id) < (k.folio, k.orden, k.id)))
    ORDER BY l.grupo, l.folio DESC, l.orden DESC, l.id DESC
    LIMIT ${c.tope}`;
  return filas.map((f) => f.id);
}

/** Las filas hidratadas, en el orden de los ids. */
export function enOrden<T extends { id: string }>(ids: readonly string[], filas: readonly T[]): T[] {
  const porId = new Map(filas.map((f) => [f.id, f]));
  return ids.flatMap((id) => porId.get(id) ?? []);
}
