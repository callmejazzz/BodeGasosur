/*
  Lo mínimo para probar salidas: el entorno de entradas más estación, área,
  solicitante, un autorizador por rol y el consecutivo S. Las capas se siembran
  con semilla-inventario.ts.
*/

import type { PrismaClient, Rol } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { UsuarioSesion } from "../src/lib/db";
import { sembrarEntorno, type Entorno } from "./semilla-entradas";

export type EntornoSalidas = Entorno & {
  estacionId: string;
  areaId: string;
  personaId: string;
  /** Mismo rol que `usuarios`, con puedeAutorizar = true. */
  autorizadores: Record<Rol, UsuarioSesion>;
};

export async function sembrarSalidas(prisma: PrismaClient): Promise<EntornoSalidas> {
  const e = await sembrarEntorno(prisma);
  const sufijo = randomUUID().slice(0, 8);

  await prisma.folio.upsert({ where: { tipo: "SALIDA" }, update: {}, create: { tipo: "SALIDA", prefijo: "S" } });

  const empresa = await prisma.empresa.create({ data: { razonSocial: `Empresa ${sufijo}` } });
  const [estacion, area, persona] = await Promise.all([
    prisma.estacion.create({ data: { numero: `ES${sufijo}`, alias: `Estación ${sufijo}`, empresaId: empresa.id } }),
    prisma.area.create({ data: { nombre: `Área ${sufijo}` } }),
    prisma.persona.create({ data: { nombre: `Gerente ${sufijo}` } }),
  ]);

  const autorizadores = {} as Record<Rol, UsuarioSesion>;
  for (const rol of ["SUPERADMIN", "COMPRAS", "JEFE"] as const) {
    const u = await prisma.usuario.create({
      data: { clerkUserId: `aut_${rol}_${sufijo}`, correo: `aut.${rol}.${sufijo}@prueba.test`, rol, puedeAutorizar: true },
    });
    autorizadores[rol] = { id: u.id, rol, puedeAutorizar: true };
  }

  return { ...e, estacionId: estacion.id, areaId: area.id, personaId: persona.id, autorizadores };
}
