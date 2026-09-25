/*
  accionProtegida() vuelve a exigir el permiso dentro de la transacción, bajo
  FOR SHARE del usuario y antes de confirmar. La sesión se leyó antes; aquí se
  prueba la carrera con la revocación, contra PostgreSQL y con el usuario de
  ejecución. Solo se sustituye la sesión de Clerk y lo que existe dentro de Next.
*/

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../prisma/comun";
import { URL_PRUEBAS } from "../../pruebas/base-de-pruebas";
import { bloqueadaPor, conexion, desenlace, type Conexion } from "../../pruebas/concurrencia";
import type { Permiso } from "./permisos";

const sesion = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: sesion.userId }) }));

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
const { accionProtegida, SinAcceso, SinPermiso } = await import("./db");

const prisma = crearCliente(URL_PRUEBAS);
let observador: Conexion;

const PAUSA = 710_001;
const AL_CONFIRMAR = 710_002;

beforeAll(async () => {
  observador = await conexion(URL_PRUEBAS);
  // Solo para esta prueba: una bodega «pausa-al-confirmar» detiene el COMMIT,
  // ya comprobado el permiso, hasta que se suelte el candado AL_CONFIRMAR.
  await observador.query(`
    CREATE FUNCTION prueba_pausa_al_confirmar() RETURNS trigger AS $$
    BEGIN PERFORM pg_advisory_xact_lock_shared(${AL_CONFIRMAR}); RETURN NULL; END $$ LANGUAGE plpgsql`);
  await observador.query(`
    CREATE CONSTRAINT TRIGGER prueba_pausa_al_confirmar AFTER INSERT ON "Bodega"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      WHEN (NEW.nombre LIKE 'pausa-al-confirmar %') EXECUTE FUNCTION prueba_pausa_al_confirmar()`);
});
afterAll(async () => {
  await observador.query(`DROP TRIGGER IF EXISTS prueba_pausa_al_confirmar ON "Bodega"`);
  await observador.query(`DROP FUNCTION IF EXISTS prueba_pausa_al_confirmar()`);
  await observador.end();
  await prisma.$disconnect();
});

/** Escribe una bodega y, si se pide, espera el candado `pausa` antes de terminar. */
const escribir = (permiso: Permiso) =>
  accionProtegida(permiso, async (tx, _usuario, nombre: string, pausa: number | null) => {
    await tx.$executeRaw`INSERT INTO "Bodega" (id, nombre, "updatedAt") VALUES (uuid_generate_v7(), ${nombre}, now())`;
    if (pausa !== null) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${pausa}::bigint)`;
    return nombre;
  });

async function usuario(datos: { rol: "COMPRAS" | "JEFE"; puedeAutorizar?: boolean }) {
  const u = await prisma.usuario.create({
    data: { clerkUserId: `user_vig_${randomUUID().slice(0, 8)}`, correo: `vig.${randomUUID().slice(0, 8)}@prueba.test`, ...datos },
  });
  sesion.userId = u.clerkUserId;
  return u;
}

const existe = (nombre: string) => prisma.bodega.count({ where: { nombre } });

class Sintoma extends Error {}

/** Espera el candado `pausa` y falla: lo que haría un trigger que ya vio la revocación. */
const fallar = accionProtegida("entradas:capturar", async (tx, _usuario, pausa: number) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${pausa}::bigint)`;
  throw new Sintoma("La acción falló por su cuenta.");
});

describe("accionProtegida relee el usuario bajo candado antes de confirmar", () => {
  it("una revocación confirmada mientras la acción corre la revierte entera: baja, cambio de rol o bandera retirada", async () => {
    const casos = [
      { permiso: "entradas:capturar", rol: "COMPRAS", puedeAutorizar: false, cambio: { activo: false }, error: SinAcceso },
      { permiso: "entradas:capturar", rol: "COMPRAS", puedeAutorizar: false, cambio: { rol: "JEFE" }, error: SinPermiso },
      { permiso: "salidas:autorizar", rol: "JEFE", puedeAutorizar: true, cambio: { puedeAutorizar: false }, error: SinPermiso },
    ] as const;
    for (const caso of casos) {
      const u = await usuario({ rol: caso.rol, puedeAutorizar: caso.puedeAutorizar });
      const candado = await conexion(URL_PRUEBAS);
      try {
        await candado.query("SELECT pg_advisory_lock($1)", [PAUSA]);
        const nombre = `vigencia ${randomUUID()}`;
        const accion = desenlace(escribir(caso.permiso)(nombre, PAUSA));
        await bloqueadaPor(observador, candado.pid);

        // La acción ya pasó la sesión y escribió; la revocación no la espera.
        await prisma.usuario.update({ where: { id: u.id }, data: caso.cambio });
        await candado.query("SELECT pg_advisory_unlock($1)", [PAUSA]);

        const r = await accion;
        expect(r.ok, JSON.stringify(caso.cambio)).toBe(false);
        if (!r.ok) expect(r.error).toBeInstanceOf(caso.error);
        await expect(existe(nombre)).resolves.toBe(0);
      } finally {
        await candado.end();
      }
    }
  });

  it("si la acción falla y el permiso ya no está, la respuesta es la negativa y no el síntoma", async () => {
    const u = await usuario({ rol: "COMPRAS" });
    await expect(fallar(PAUSA)).rejects.toBeInstanceOf(Sintoma);

    const candado = await conexion(URL_PRUEBAS);
    try {
      await candado.query("SELECT pg_advisory_lock($1)", [PAUSA]);
      const accion = desenlace(fallar(PAUSA));
      await bloqueadaPor(observador, candado.pid);
      await prisma.usuario.update({ where: { id: u.id }, data: { activo: false } });
      await candado.query("SELECT pg_advisory_unlock($1)", [PAUSA]);

      const r = await accion;
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBeInstanceOf(SinAcceso);
        expect((r.error as Error).cause).toBeInstanceOf(Sintoma);
      }
    } finally {
      await candado.end();
    }
  });

  it("dos superadmins que bloquean a todos los superadmins no se esperan en círculo", async () => {
    // Lo que hace guardarAcceso (bloquearSuperadmins), con pausas antes y después.
    const administrar = accionProtegida("usuarios:administrar", async (tx, _usuario, antes: number | null, despues: number | null) => {
      if (antes !== null) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${antes}::bigint)`;
      await tx.$queryRaw`SELECT id FROM "Usuario" WHERE rol = 'SUPERADMIN' AND activo FOR UPDATE`;
      if (despues !== null) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${despues}::bigint)`;
      return "guardado";
    });
    const [a, b] = await Promise.all(
      ["a", "b"].map((letra) =>
        prisma.usuario.create({
          data: { clerkUserId: `user_sa_${letra}_${randomUUID().slice(0, 8)}`, correo: `sa.${letra}.${randomUUID().slice(0, 8)}@prueba.test`, rol: "SUPERADMIN" },
        }),
      ),
    );
    const [antesDeB, despuesDeA] = [await conexion(URL_PRUEBAS), await conexion(URL_PRUEBAS)];
    try {
      await antesDeB.query("SELECT pg_advisory_lock($1)", [PAUSA]);
      await despuesDeA.query("SELECT pg_advisory_lock($1)", [AL_CONFIRMAR]);
      // B entra primero y se detiene antes de bloquear; A bloquea a todos, B incluida, y se detiene.
      sesion.userId = b.clerkUserId;
      const deB = desenlace(administrar(PAUSA, null));
      await bloqueadaPor(observador, antesDeB.pid);
      sesion.userId = a.clerkUserId;
      const deA = desenlace(administrar(null, AL_CONFIRMAR));
      const pidA = await bloqueadaPor(observador, despuesDeA.pid);
      // B sigue y espera a A; si B sostuviera ya su propia fila, A la esperaría a ella: ciclo.
      await antesDeB.query("SELECT pg_advisory_unlock($1)", [PAUSA]);
      await bloqueadaPor(observador, pidA);
      await despuesDeA.query("SELECT pg_advisory_unlock($1)", [AL_CONFIRMAR]);

      await expect(deA).resolves.toEqual({ ok: true, valor: "guardado" });
      await expect(deB).resolves.toEqual({ ok: true, valor: "guardado" });
    } finally {
      await antesDeB.end();
      await despuesDeA.end();
      await prisma.usuario.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { activo: false } });
    }
  });

  it("una revocación en curso al comprobar: la acción la espera y decide con lo que quedó", async () => {
    const u = await usuario({ rol: "COMPRAS" });
    const revocador = await conexion(URL_PRUEBAS);
    try {
      for (const final of ["ROLLBACK", "COMMIT"] as const) {
        await revocador.query("BEGIN");
        await revocador.query(`UPDATE "Usuario" SET activo = false WHERE id = $1`, [u.id]);
        const nombre = `vigencia ${randomUUID()}`;
        const accion = desenlace(escribir("entradas:capturar")(nombre, null));
        await bloqueadaPor(observador, revocador.pid);
        await revocador.query(final);

        const r = await accion;
        if (final === "ROLLBACK") {
          expect(r).toEqual({ ok: true, valor: nombre });
          await expect(existe(nombre)).resolves.toBe(1);
        } else {
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.error).toBeInstanceOf(SinAcceso);
          await expect(existe(nombre)).resolves.toBe(0);
        }
      }
    } finally {
      await revocador.end();
    }
  });

  it("una revocación posterior a la comprobación espera a que la acción confirme", async () => {
    const u = await usuario({ rol: "JEFE", puedeAutorizar: true });
    const candado = await conexion(URL_PRUEBAS);
    try {
      await candado.query("SELECT pg_advisory_lock($1)", [AL_CONFIRMAR]);
      const nombre = `pausa-al-confirmar ${randomUUID()}`;
      const accion = desenlace(escribir("salidas:autorizar")(nombre, null));
      const pidAccion = await bloqueadaPor(observador, candado.pid);

      // Comprobado el permiso, la acción sostiene su fila: la revocación espera.
      const revocacion = desenlace(prisma.usuario.update({ where: { id: u.id }, data: { puedeAutorizar: false } }));
      await bloqueadaPor(observador, pidAccion);
      await candado.query("SELECT pg_advisory_unlock($1)", [AL_CONFIRMAR]);

      await expect(accion).resolves.toEqual({ ok: true, valor: nombre });
      await expect(revocacion).resolves.toMatchObject({ ok: true });
      await expect(existe(nombre)).resolves.toBe(1);
      await expect(escribir("salidas:autorizar")(`vigencia ${randomUUID()}`, null)).rejects.toBeInstanceOf(SinPermiso);
    } finally {
      await candado.end();
    }
  });
});
