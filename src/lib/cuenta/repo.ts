import "server-only";
import type { Prisma } from "@prisma/client";
import { causaDeExclusion } from "@/lib/correo/exclusion";
import { estadoDelAviso } from "@/lib/correo/entrega";
import { aFechaDeBase, deFechaDeBase, hoyEnMexico } from "@/lib/fechas";
import type { MiCuenta } from "./formulario";

/* Siempre recibe el id de la sesión */

export async function leerMiCuenta(db: Prisma.TransactionClient, usuarioId: string, hoy = hoyEnMexico()): Promise<MiCuenta> {
  const { correo, alertasCorreo } = await db.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { correo: true, alertasCorreo: true } });
  const dia = aFechaDeBase(hoy);
  const ultimo = await db.registroCorreos.findFirst({
    where: { usuarioId, fecha: { lte: dia } },
    orderBy: { fecha: "desc" },
    // Solo los asociados: un evento anómalo no lleva registroId
    select: { fecha: true, estado: true, eventos: { select: { tipo: true, rebote: true } } },
  });
  // Con la dirección actual, aunque el evento lo haya recibido otra cuenta; no se dice cuál
  const exclusion = await causaDeExclusion(db, correo);
  const evaluacion = await db.evaluacionCorreos.findUnique({ where: { fecha: dia }, select: { resultado: true } });

  const fecha = ultimo ? deFechaDeBase(ultimo.fecha) : null;
  let avisoDelDia: MiCuenta["avisoDelDia"] = null;
  if (alertasCorreo && evaluacion?.resultado === "SIN_BAJO_MINIMO") avisoDelDia = "SIN_BAJO_MINIMO";
  else if (alertasCorreo && evaluacion && !exclusion && fecha !== hoy) avisoDelDia = "EMPIEZA_MANIANA";

  return {
    correo,
    alertasCorreo,
    ultimoAviso: ultimo && fecha ? { fecha, estado: estadoDelAviso(ultimo.estado, ultimo.eventos) } : null,
    exclusion,
    avisoDelDia,
  };
}

export async function cambiarAlertasCorreo(db: Prisma.TransactionClient, usuarioId: string, activar: boolean): Promise<void> {
  await db.usuario.update({ where: { id: usuarioId }, data: { alertasCorreo: activar }, select: { id: true } });
}
