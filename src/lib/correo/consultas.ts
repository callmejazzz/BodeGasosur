import "server-only";
import type { EstadoLote, EstadoRegistroCorreo, Prisma } from "@prisma/client";
import { existenciasBajoMinimo, type ExistenciasBajoMinimo } from "@/lib/reportes/existencias";

type Db = Prisma.TransactionClient;

export type Destinatario = { usuarioId: string; correo: string };

export function leerExistenciasBajoMinimo(db: Db, tope: number): Promise<ExistenciasBajoMinimo> {
  return existenciasBajoMinimo(db, tope);
}

export function leerDestinatarios(db: Db): Promise<Destinatario[]> {
  return db.$queryRaw<Destinatario[]>`
    SELECT id AS "usuarioId", btrim(correo) AS correo
    FROM "Usuario"
    WHERE activo AND "alertasCorreo"
    ORDER BY id`;
}

export type IntegranteDelLote = { registroId: string; posicion: number; correo: string };

export type LoteArrendado = {
  id: string;
  llave: string;
  remitente: string;
  asunto: string;
  html: string;
  texto: string;
  intentos: number;
  integrantes: IntegranteDelLote[];
};

export async function arrendarLote(db: Db, loteId: string, fecha: Date): Promise<LoteArrendado | null> {
  const [lote] = await db.$queryRaw<Omit<LoteArrendado, "integrantes">[]>`
    UPDATE "LoteCorreos" l
    SET intentos = l.intentos + 1, "ultimoIntentoEn" = now(), "arrendadoHasta" = now() + interval '5 minutes'
    WHERE l.id = ${loteId}::uuid AND l.fecha = ${fecha}::date
      AND (l."arrendadoHasta" IS NULL OR l."arrendadoHasta" <= now())
      AND (l.estado = 'PENDIENTE'
        OR (l.estado = 'ACEPTADO' AND EXISTS (SELECT 1 FROM "RegistroCorreos" r WHERE r."loteId" = l.id AND r.estado = 'PENDIENTE')))
    RETURNING l.id, l.llave, l.remitente, l.asunto, l.html, l.texto, l.intentos`;
  if (!lote) return null;
  const integrantes = await db.$queryRaw<IntegranteDelLote[]>`
    SELECT id AS "registroId", posicion, correo FROM "RegistroCorreos" WHERE "loteId" = ${loteId}::uuid ORDER BY posicion`;
  return { ...lote, integrantes };
}

export type RegistroBloqueado = { id: string; posicion: number; estado: EstadoRegistroCorreo; resendId: string | null; correo: string };
export type LoteBloqueado = { id: string; estado: EstadoLote; intentos: number; registros: RegistroBloqueado[] };

export async function bloquearLote(db: Db, loteId: string): Promise<LoteBloqueado | null> {
  const [lote] = await db.$queryRaw<Omit<LoteBloqueado, "registros">[]>`
    SELECT id, estado::text AS estado, intentos FROM "LoteCorreos" WHERE id = ${loteId}::uuid FOR UPDATE`;
  if (!lote) return null;
  const registros = await db.$queryRaw<RegistroBloqueado[]>`
    SELECT id, posicion, estado::text AS estado, "resendId", correo
    FROM "RegistroCorreos" WHERE "loteId" = ${loteId}::uuid ORDER BY posicion FOR UPDATE`;
  return { ...lote, registros };
}
