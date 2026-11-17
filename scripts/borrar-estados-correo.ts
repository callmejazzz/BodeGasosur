/*
  Uso:  npm run correo:borrar-estados
*/

import type { PrismaClient } from "@prisma/client";
import { crearClienteDelDueno, esEjecucionDirecta } from "../prisma/comun";
import { IDS, verificarGuardia } from "./mostrar-estados-correo";

// En este orden por las llaves foráneas
export function borrarEstados(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => ({
    eventos: (await tx.eventoCorreo.deleteMany({ where: { id: { in: IDS.eventos } } })).count,
    registros: (await tx.registroCorreos.deleteMany({ where: { id: { in: IDS.registros } } })).count,
    lotes: (await tx.loteCorreos.deleteMany({ where: { id: { in: IDS.lotes } } })).count,
    evaluaciones: (await tx.evaluacionCorreos.deleteMany({ where: { id: { in: IDS.evaluaciones } } })).count,
  }));
}

async function main() {
  verificarGuardia();
  const prisma = crearClienteDelDueno();
  try {
    const n = await borrarEstados(prisma);
    console.log(`Borradas: ${n.eventos} eventos, ${n.registros} registros, ${n.lotes} lotes y ${n.evaluaciones} evaluaciones.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (esEjecucionDirecta(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
