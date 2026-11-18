import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { aFechaDeBase, inicioDelDiaEnMexico } from "../src/lib/fechas";
import { SECRETO_DEL_WEBHOOK } from "./firma-resend";

export const ENTORNO_DE_CORREO = {
  CORREO_REMITENTE: "BodeGasosur <avisos@avisos.prueba.test>",
  URL_APLICACION: "https://bodegasosur.prueba.test",
  RESEND_API_KEY: "re_prueba_sin_uso",
  RESEND_WEBHOOK_SECRET: SECRETO_DEL_WEBHOOK,
};

export async function sembrarBajoMinimo(prisma: PrismaClient) {
  const sufijo = randomUUID().slice(0, 8);
  const unidad = await prisma.unidadMedida.create({ data: { clave: `U${sufijo}`, nombre: "Pieza" } });
  await prisma.bodega.create({ data: { nombre: `Bodega correo ${sufijo}` } });
  await prisma.articulo.create({ data: { descripcion: `Faltante del correo ${sufijo}`, unidadId: unidad.id, stockMinimo: 3 } });
  return { unidadId: unidad.id };
}

export function usuarioConAlerta(prisma: PrismaClient, datos: { alertasCorreo?: boolean; activo?: boolean } = {}) {
  const clerk = `user_correo_${randomUUID().slice(0, 8)}`;
  return prisma.usuario.create({
    data: { clerkUserId: clerk, correo: `${clerk}@prueba.test`, rol: "COMPRAS", alertasCorreo: true, ...datos },
    select: { id: true, correo: true },
  });
}

export function fechasDesde(anio: number) {
  let n = 0;
  return () => new Date(Date.UTC(anio, 0, 1 + n++)).toISOString().slice(0, 10);
}

export const aLas = (fecha: string, hora: string) => {
  const [h, m] = hora.split(":").map(Number);
  return new Date(inicioDelDiaEnMexico(fecha).getTime() + (h * 60 + m) * 60_000);
};

export const registrosDelDia = (prisma: PrismaClient, fecha: string) =>
  prisma.registroCorreos.findMany({
    where: { fecha: aFechaDeBase(fecha) },
    include: { lote: true },
    orderBy: [{ lote: { numero: "asc" } }, { posicion: "asc" }],
  });

export const vencerArriendos = (prisma: PrismaClient, fecha: string) =>
  prisma.$executeRaw`UPDATE "LoteCorreos" SET "arrendadoHasta" = now() - interval '1 minute' WHERE fecha = ${fecha}::date AND intentos > 0 AND estado IN ('PENDIENTE', 'ACEPTADO')`;
