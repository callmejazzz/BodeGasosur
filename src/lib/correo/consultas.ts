import "server-only";
import type { Prisma } from "@prisma/client";
import { existenciasBajoMinimo, type ExistenciasBajoMinimo } from "@/lib/reportes/existencias";

/*
  El SQL de la alerta diaria. Solo lo importa db.ts, que entrega estas
  funciones ya ligadas a la transacción en los clientes de sistema: el código
  de la reserva, del envío y del webhook nunca recibe SQL libre.
*/

type Db = Prisma.TransactionClient;

export type Destinatario = { usuarioId: string; correo: string };

/** §3.1: la misma regla y consulta base del reporte de existencias. */
export function leerExistenciasBajoMinimo(db: Db, tope: number): Promise<ExistenciasBajoMinimo> {
  return existenciasBajoMinimo(db, tope);
}

/** §3.4, paso 4: activos con la alerta encendida, por id. */
export function leerDestinatarios(db: Db): Promise<Destinatario[]> {
  return db.$queryRaw<Destinatario[]>`
    SELECT id AS "usuarioId", btrim(correo) AS correo
    FROM "Usuario"
    WHERE activo AND "alertasCorreo"
    ORDER BY id`;
}
