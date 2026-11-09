import "server-only";
import type { Prisma } from "@prisma/client";
import type { MiCuenta } from "./formulario";

/* La cuenta propia. Siempre recibe el id de la sesión. */

export function leerMiCuenta(db: Prisma.TransactionClient, usuarioId: string): Promise<MiCuenta> {
  return db.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { correo: true, alertasCorreo: true } });
}

export async function cambiarAlertasCorreo(db: Prisma.TransactionClient, usuarioId: string, activar: boolean): Promise<void> {
  await db.usuario.update({ where: { id: usuarioId }, data: { alertasCorreo: activar }, select: { id: true } });
}
