// Las cuatro pruebas del importador, contra PostgreSQL real. Cada una escribe
// sus propios CSV en una carpeta temporal: lo que se prueba es el
// comportamiento, no el corte de Compras.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { URL_PRUEBAS } from "../../pruebas/base-de-pruebas";
import { crearCliente } from "../comun";
import { ErrorDivergencia, ORIGEN, migrar } from "./migrar";

const prisma = crearCliente(URL_PRUEBAS);

const ESTACIONES = `Razón Social,RFC,No. Estación,Alias,Teléfono,Móvil,Correo
"SERVI FER, S.A. DE C.V.",SFE-020801-CS2,ES07839,Servi Fer Acapulco,(744) 450 12 18,744 225 36 00,es7839@gasosur.com.mx
"SERVI FER, S.A. DE C.V.",SFE020801CS2,ES13064,Chilpofer,(747) 480 00 89,,es13064@gasosur.com.mx
"RADIO FARO, S.A. DE C.V.",RFA170221NY8,ES14725,Radio Faro,,,
`;

const PERSONAS = `nombre,puesto
Diana Damián Hernández,Compras
`;

function carpetaCon(estaciones: string, personas = PERSONAS): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), "bodegasosur-migracion-"));
  writeFileSync(path.join(carpeta, "estaciones.csv"), estaciones);
  writeFileSync(path.join(carpeta, "personas.csv"), personas);
  return carpeta;
}

async function conteos() {
  const [empresas, estaciones, personas, bitacora] = await Promise.all([
    prisma.empresa.count(),
    prisma.estacion.count(),
    prisma.persona.count(),
    prisma.bitacora.count({ where: { origen: ORIGEN } }),
  ]);
  return { empresas, estaciones, personas, bitacora };
}

/** Simula una edición desde la pantalla: escribe con otro origen para que la bitácora lo distinga. */
async function editarAMano(numero: string, alias: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL app.origen = 'prueba-edicion-manual'");
    await tx.estacion.update({ where: { numero }, data: { alias } });
  });
}

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE catalogo_gasosur."Estacion", catalogo_gasosur."Empresa", "Persona", "Bitacora" CASCADE',
  );
});

afterAll(() => prisma.$disconnect());

describe("1. Base limpia → carga → segunda corrida sin escrituras", () => {
  it("crea todo la primera vez y no escribe nada la segunda", async () => {
    const datos = carpetaCon(ESTACIONES);

    const primera = await migrar(prisma, { datos });
    expect(primera.creados).toEqual({ empresas: 2, estaciones: 3, personas: 1 });
    expect(primera.divergencias).toEqual([]);
    expect(await conteos()).toEqual({ empresas: 2, estaciones: 3, personas: 1, bitacora: 6 });

    // El RFC entra normalizado aunque el CSV lo traiga con guiones.
    const serviFer = await prisma.empresa.findUnique({ where: { rfc: "SFE020801CS2" } });
    expect(serviFer?.razonSocial).toBe("SERVI FER, S.A. DE C.V.");

    const antes = await prisma.estacion.findMany({ orderBy: { numero: "asc" } });

    const segunda = await migrar(prisma, { datos });
    expect(segunda.creados).toEqual({ empresas: 0, estaciones: 0, personas: 0 });
    expect(segunda.iguales).toBe(6);
    expect(segunda.divergencias).toEqual([]);

    // Ni un UPDATE: updatedAt intacto y la bitácora en silencio.
    const despues = await prisma.estacion.findMany({ orderBy: { numero: "asc" } });
    expect(despues.map((e) => e.updatedAt)).toEqual(antes.map((e) => e.updatedAt));
    expect((await conteos()).bitacora).toBe(6);
  });
});

describe("2. Cambio manual → error y rollback completo", () => {
  it("se detiene con el reporte y no crea ni siquiera lo nuevo", async () => {
    await migrar(prisma, { datos: carpetaCon(ESTACIONES) });
    await editarAMano("ES13064", "Chilpofer Centro");
    const antes = await conteos();

    // Un corte nuevo con una estación más, y la que se editó a mano sigue igual en el CSV.
    const datos = carpetaCon(
      ESTACIONES + `"RADIO FARO, S.A. DE C.V.",RFA170221NY8,ES99999,Radio Faro 2,,,\n`,
    );

    const error = await migrar(prisma, { datos }).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDivergencia);
    expect(error.divergencias).toHaveLength(1);
    expect(error.divergencias[0]).toMatchObject({
      entidad: "estación",
      clave: "ES13064",
      campo: "alias",
      enBase: "Chilpofer Centro",
      enCsv: "Chilpofer",
    });
    expect(error.divergencias[0].ultimoCambio).toContain("prueba-edicion-manual");

    // Rollback completo: la estación nueva no existe y la edición manual sigue ahí.
    expect(await prisma.estacion.findUnique({ where: { numero: "ES99999" } })).toBeNull();
    expect((await prisma.estacion.findUnique({ where: { numero: "ES13064" } }))?.alias).toBe("Chilpofer Centro");
    expect(await conteos()).toEqual(antes);
  });
});

describe("3. --sincronizar → cambio explícito y bitácora correcta", () => {
  it("sobrescribe la divergencia desde el CSV, crea lo nuevo y lo firma como migracion-datos", async () => {
    await migrar(prisma, { datos: carpetaCon(ESTACIONES) });
    await editarAMano("ES13064", "Chilpofer Centro");
    const editada = (await prisma.estacion.findUnique({ where: { numero: "ES13064" } }))!;

    const datos = carpetaCon(
      ESTACIONES + `"RADIO FARO, S.A. DE C.V.",RFA170221NY8,ES99999,Radio Faro 2,,,\n`,
    );
    const r = await migrar(prisma, { datos, sincronizar: true });

    expect(r.creados).toEqual({ empresas: 0, estaciones: 1, personas: 0 });
    expect(r.sobrescritas).toBe(1);
    expect(r.divergencias[0]).toMatchObject({ clave: "ES13064", campo: "alias" });

    expect((await prisma.estacion.findUnique({ where: { numero: "ES13064" } }))?.alias).toBe("Chilpofer");
    expect(await prisma.estacion.findUnique({ where: { numero: "ES99999" } })).not.toBeNull();

    // La sobrescritura queda en la bitácora, con el origen del importador y el antes/después.
    const rastro = await prisma.bitacora.findFirst({
      where: { tabla: "Estacion", registroId: editada.id, accion: "ACTUALIZAR", origen: ORIGEN },
      orderBy: { ocurridoEn: "desc" },
    });
    expect(rastro).not.toBeNull();
    expect((rastro!.antes as { alias: string }).alias).toBe("Chilpofer Centro");
    expect((rastro!.despues as { alias: string }).alias).toBe("Chilpofer");
  });
});

describe("4. Datos inválidos o repetidos → rollback", () => {
  const casos: [string, () => string, RegExp][] = [
    [
      "RFC sin forma de RFC",
      () => carpetaCon(ESTACIONES.replace("RFA170221NY8", "RADIO-FARO")),
      /no tiene forma de RFC/,
    ],
    [
      "número de estación repetido",
      () => carpetaCon(ESTACIONES.replace("ES13064", "ES07839")),
      /ES07839 está repetida/,
    ],
    [
      "mismo RFC con dos razones sociales",
      () => carpetaCon(ESTACIONES.replace('"SERVI FER, S.A. DE C.V.",SFE020801CS2', '"SERVIFER SA",SFE020801CS2')),
      /aparece como/,
    ],
    [
      "persona repetida aunque cambie mayúsculas y espacios",
      () => carpetaCon(ESTACIONES, PERSONAS + "diana  damián hernández,Compras\n"),
      /está repetida/,
    ],
  ];

  it.each(casos)("%s: falla y no escribe nada", async (_nombre, preparar, mensaje) => {
    await expect(migrar(prisma, { datos: preparar() })).rejects.toThrow(mensaje);
    expect(await conteos()).toEqual({ empresas: 0, estaciones: 0, personas: 0, bitacora: 0 });
  });

  it("una persona que ya existe con otra grafía no se duplica: la búsqueda y el índice coinciden", async () => {
    await migrar(prisma, { datos: carpetaCon(ESTACIONES) });

    // Misma persona con mayúsculas y espacios distintos: se encuentra, y la
    // grafía cuenta como divergencia del campo nombre, no como un alta nueva.
    const error = await migrar(prisma, {
      datos: carpetaCon(ESTACIONES, "nombre,puesto\nDIANA DAMIÁN  HERNÁNDEZ,Compras\n"),
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDivergencia);
    expect(error.divergencias).toEqual([
      expect.objectContaining({ entidad: "persona", campo: "nombre", enBase: "Diana Damián Hernández", enCsv: "DIANA DAMIÁN HERNÁNDEZ" }),
    ]);
    expect(await prisma.persona.count()).toBe(1);
  });
});
