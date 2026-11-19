import "server-only";
import { Prisma } from "@prisma/client";

export type CausaDeExclusion = "QUEJA" | "REBOTE" | "SUPRESION";

// Solo eventos asociados (el JOIN por registroId deja fuera los anómalos)
const CAUSA = Prisma.sql`CASE
  WHEN e.tipo = 'email.complained' THEN 'QUEJA'
  WHEN e.rebote = 'PERMANENTE' THEN 'REBOTE'
  WHEN e.tipo = 'email.suppressed' THEN 'SUPRESION'
END`;
const ORDEN: CausaDeExclusion[] = ["QUEJA", "REBOTE", "SUPRESION"];

/** FROM y WHERE de los eventos que excluyen `correo`, en cualquier registro con esa dirección normalizada */
export const eventosQueExcluyen = (correo: Prisma.Sql) => Prisma.sql`
  FROM "RegistroCorreos" r JOIN "EventoCorreo" e ON e."registroId" = r.id
  WHERE lower(btrim(r.correo)) = lower(btrim(${correo})) AND ${CAUSA} IS NOT NULL`;

export async function causaDeExclusion(db: Prisma.TransactionClient, correo: string): Promise<CausaDeExclusion | null> {
  const filas = await db.$queryRaw<{ causa: CausaDeExclusion }[]>`SELECT DISTINCT ${CAUSA} AS causa ${eventosQueExcluyen(Prisma.sql`${correo}`)}`;
  return ORDEN.find((c) => filas.some((f) => f.causa === c)) ?? null;
}
