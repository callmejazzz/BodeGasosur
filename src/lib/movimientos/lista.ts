import "server-only";
import { Prisma, type EstatusMovimiento, type TipoMovimiento } from "@prisma/client";
import { acotarPagina, POR_PAGINA, type Pagina } from "@/lib/paginacion";

/*
  El orden y la búsqueda de las listas de movimientos, en una sola consulta.
  Primero lo abierto (borradores, o lo que una salida tiene en curso), luego
  lo que tiene folio, del más alto al más bajo, y al final lo cerrado sin
  folio, lo más nuevo arriba. Solo devuelve los ids de una página: es lo que
  después se hidrata con Prisma, por amplia que sea la búsqueda.
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
  /** La pedida en la URL; se acota a las que hay. */
  pagina: number;
};

const cualquiera = (condiciones: Prisma.Sql[]) => (condiciones.length ? Prisma.join(condiciones, " OR ") : Prisma.sql`false`);

export async function idsDeLista(db: Db, c: ConsultaDeLista): Promise<{ ids: string[]; pagina: Pagina }> {
  const abiertos = Prisma.sql`m.estatus::text = ANY(${c.abiertos}::text[])`;
  const orden = c.abiertosPorToque ? Prisma.sql`CASE WHEN ${abiertos} THEN m."updatedAt" ELSE m."createdAt" END` : Prisma.sql`m."createdAt"`;

  const q = c.busqueda.trim();
  const busqueda = q
    ? Prisma.sql`AND (
        (clave_normalizada(${q}) <> '' AND (${cualquiera(c.claves.map((col) => Prisma.sql`position(clave_normalizada(${q}) IN clave_normalizada(${col})) > 0`))}))
        OR ${cualquiera(c.textos.map((col) => Prisma.sql`position(texto_buscable(${q}) IN texto_buscable(${col})) > 0`))})`
    : Prisma.empty;
  const filtros = c.filtros?.length ? Prisma.sql`AND ${Prisma.join(c.filtros, " AND ")}` : Prisma.empty;

  const { filas, pagina } = await paginaDe<{ id: string }>(
    db,
    Prisma.sql`
      SELECT CASE WHEN ${abiertos} THEN 0 WHEN m.folio IS NOT NULL THEN 1 ELSE 2 END AS grupo,
             coalesce(m.folio, '') COLLATE "C" AS folio, ${orden} AS orden, m.id
      FROM "Movimiento" m ${c.joins ?? Prisma.empty}
      WHERE m.tipo = ${c.tipo}::"TipoMovimiento" ${filtros} ${busqueda}`,
    Prisma.sql`grupo, folio DESC, orden DESC, id DESC`,
    c.pagina,
  );
  return { ids: filas.map((f) => f.id), pagina };
}

/**
 * Una página de `consulta` en `orden`, y cuántas filas hay en total, en una
 * sola lectura. `orden` nombra columnas de la consulta sin prefijo y debe
 * terminar en una única (el id), para que las páginas no se encimen.
 */
export async function paginaDe<T extends { id: string }>(db: Db, consulta: Prisma.Sql, orden: Prisma.Sql, pedida: number): Promise<{ filas: T[]; pagina: Pagina }> {
  // La página se acota en SQL igual que en acotarPagina(): pasada la última, la última.
  const filas = await db.$queryRaw<(T & { total_de_la_lista: number })[]>`
    WITH lista AS (${consulta}), cuenta AS (SELECT count(*)::int AS total_de_la_lista FROM lista)
    SELECT c.total_de_la_lista, p.* FROM cuenta c
    LEFT JOIN LATERAL (
      SELECT * FROM lista ORDER BY ${orden}
      LIMIT ${POR_PAGINA}
      OFFSET (greatest(least(${pedida}::int, ceil(c.total_de_la_lista / ${POR_PAGINA}::numeric)::int), 1) - 1) * ${POR_PAGINA}
    ) p ON true
    ORDER BY ${orden}`;
  // Sin filas en la página vuelve solo la cuenta, con id nulo.
  return { filas: filas.filter((f) => f.id !== null), pagina: acotarPagina(pedida, filas[0]?.total_de_la_lista ?? 0) };
}

/** Las filas hidratadas, en el orden de los ids. */
export function enOrden<T extends { id: string }>(ids: readonly string[], filas: readonly T[]): T[] {
  const porId = new Map(filas.map((f) => [f.id, f]));
  return ids.flatMap((id) => porId.get(id) ?? []);
}
