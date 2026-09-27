// Configuración mínima: lo que toda base de BodeGasosur lleva, en desarrollo
// y en producción, para poder operar. Nada más.
//
//   · Las dos bodegas reales, por nombre. La clave la asigna la base.
//   · Las tres áreas que quedaron del levantamiento (A4). Ni una más.
//   · La unidad PZA. Las demás presentaciones las crea Compras cuando las use.
//   · Los cinco consecutivos de folio, sin los cuales no se confirma nada.
//
// Solo crea lo que falta; nunca actualiza. Es carga inicial, y lo que
// Compras cambie después desde la pantalla no se revierte al volver a correr.
// Por eso también es idempotente sin esfuerzo: la segunda corrida no escribe.
//
// Uso:  npm run db:configuracion

import { buscarPorNombre, crearClienteDelDueno, esEjecucionDirecta, type Tx } from "./comun";

export const BODEGAS = [{ nombre: "Magallanes" }, { nombre: "Servi Fer" }] as const;

export const AREAS = ["Administración", "Mantenimiento", "Despacho"] as const;

export const UNIDAD_BASE = { clave: "PZA", nombre: "Pieza" } as const;

export const FOLIOS = [
  { tipo: "ENTRADA", prefijo: "E" },
  { tipo: "SALIDA", prefijo: "S" },
  { tipo: "TRASPASO", prefijo: "T" },
  { tipo: "DEVOLUCION", prefijo: "D" },
  { tipo: "AJUSTE", prefijo: "A" },
] as const;

export type ResumenConfiguracion = { creados: number; existentes: number };

export async function aplicarConfiguracion(tx: Tx): Promise<ResumenConfiguracion> {
  const resumen: ResumenConfiguracion = { creados: 0, existentes: 0 };
  const anotar = (existia: boolean) => (existia ? resumen.existentes++ : resumen.creados++);

  await tx.$executeRawUnsafe("SET LOCAL app.origen = 'configuracion'");

  for (const b of BODEGAS) {
    const existente = await buscarPorNombre(tx, "Bodega", b.nombre);
    if (!existente) await tx.bodega.create({ data: { nombre: b.nombre } });
    anotar(existente !== null);
  }

  for (const nombre of AREAS) {
    const existente = await tx.area.findUnique({ where: { nombre } });
    if (!existente) await tx.area.create({ data: { nombre } });
    anotar(existente !== null);
  }

  {
    const existente = await tx.unidadMedida.findUnique({ where: { clave: UNIDAD_BASE.clave } });
    if (!existente) await tx.unidadMedida.create({ data: UNIDAD_BASE });
    anotar(existente !== null);
  }

  for (const f of FOLIOS) {
    const existente = await tx.folio.findUnique({ where: { tipo: f.tipo } });
    if (!existente) await tx.folio.create({ data: f });
    anotar(existente !== null);
  }

  return resumen;
}

async function main() {
  const prisma = crearClienteDelDueno();
  try {
    console.log("Aplicando la configuración mínima…");
    const r = await prisma.$transaction((tx) => aplicarConfiguracion(tx));
    console.log(
      `  ✓ ${BODEGAS.length} bodegas, ${AREAS.length} áreas, unidad ${UNIDAD_BASE.clave} y ${FOLIOS.length} folios ` +
        `— ${r.creados} creados, ${r.existentes} ya existían.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (esEjecucionDirecta(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? `✗ ${e.message}` : e);
    process.exit(1);
  });
}
