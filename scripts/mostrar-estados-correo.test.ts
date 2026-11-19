/*
  Los scripts de estados contra la base de pruebas: cada paso deja en
  «Preferencias» lo que anuncia, y la limpieza borra solo lo que se creó.
*/

import { afterAll, describe, expect, it, vi } from "vitest";
import { crearCliente } from "../prisma/comun";
import { URL_PRUEBAS } from "../pruebas/base-de-pruebas";
import { usuarioConAlerta } from "../pruebas/semilla-correo";
import { aFechaDeBase } from "../src/lib/fechas";
import { borrarEstados } from "./borrar-estados-correo";
import { PASOS, prepararContexto, verificarGuardia } from "./mostrar-estados-correo";

vi.mock("server-only", () => ({}));
const { leerMiCuenta } = await import("../src/lib/cuenta/repo");

const prisma = crearCliente(URL_PRUEBAS);
afterAll(() => prisma.$disconnect());

const HOY = "2045-03-10";

describe("scripts de estados del correo", () => {
  it("cada paso deja en «Preferencias» lo que anuncia, y la limpieza lo deshace", async () => {
    const u = await usuarioConAlerta(prisma);
    const c = await prepararContexto(prisma, ` ${u.correo.toUpperCase()} `, HOY);
    expect(c).toStrictEqual({ usuarioId: u.id, correo: u.correo, hoy: HOY, anteayer: "2045-03-08", ayer: "2045-03-09" });

    for (const paso of PASOS) {
      await prisma.$transaction((tx) => paso.aplicar(tx, c));
      expect(await leerMiCuenta(prisma, u.id, HOY), paso.titulo).toStrictEqual({ correo: u.correo, alertasCorreo: true, ...paso.esperado(c) });
    }
    await expect(prepararContexto(prisma, u.correo, HOY)).rejects.toThrow("corrida anterior");

    expect(await borrarEstados(prisma)).toStrictEqual({ eventos: 5, registros: 2, lotes: 2, evaluaciones: 1 });
    expect(await leerMiCuenta(prisma, u.id, HOY)).toStrictEqual({
      correo: u.correo,
      alertasCorreo: true,
      ultimoAviso: null,
      exclusion: null,
      avisoDelDia: null,
    });
    expect(await borrarEstados(prisma)).toStrictEqual({ eventos: 0, registros: 0, lotes: 0, evaluaciones: 0 });
    await expect(prepararContexto(prisma, u.correo, HOY)).resolves.toMatchObject({ usuarioId: u.id });
  });

  it("no empieza sin una cuenta de prueba lista ni con días ya evaluados", async () => {
    await expect(prepararContexto(prisma, "nadie@prueba.test", HOY)).rejects.toThrow("No hay una cuenta activa");
    const apagada = await usuarioConAlerta(prisma, { alertasCorreo: false });
    await expect(prepararContexto(prisma, apagada.correo, HOY)).rejects.toThrow("Activa la alerta");

    const u = await usuarioConAlerta(prisma);
    await prisma.evaluacionCorreos.create({
      data: { fecha: aFechaDeBase("2045-04-01"), resultado: "SIN_BAJO_MINIMO", articulos: 0, renglones: 0, destinatarios: 0, lotes: 0 },
    });
    await expect(prepararContexto(prisma, u.correo, "2045-04-02")).rejects.toThrow("ya se evaluaron");
  });

  it("solo corre en desarrollo y contra la base local", () => {
    const local = { BODEGASOSUR_FIXTURES: "permitidos", DATABASE_URL_MIGRACIONES: "postgresql://u:c@localhost:5432/bodegasosur" };
    expect(() => verificarGuardia(local)).not.toThrow();
    expect(() => verificarGuardia({ ...local, BODEGASOSUR_FIXTURES: undefined })).toThrow("Solo es de desarrollo");
    expect(() => verificarGuardia({ ...local, NODE_ENV: "production" })).toThrow("NODE_ENV=production");
    expect(() => verificarGuardia({ ...local, DATABASE_URL_MIGRACIONES: "postgresql://u:c@db.abc.supabase.co:5432/postgres" })).toThrow("base local");
  });
});
