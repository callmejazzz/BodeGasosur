/*
  Criterio 13 (11 §12): quien no tiene permiso no crea ni confirma una entrada
  aunque invoque la Server Action directamente, sin pasar por la pantalla.

  Se prueba la acción real —Zod → accionProtegida() → servicio— contra
  PostgreSQL. Lo único que se sustituye es lo que solo existe dentro de Next:
  la sesión de Clerk, `server-only`, `next/headers`, la revalidación y el
  redirect.
*/

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearCliente } from "../../../../prisma/comun";
import { URL_PRUEBAS } from "../../../../pruebas/base-de-pruebas";
import { sembrarEntorno, type Entorno } from "../../../../pruebas/semilla-entradas";
import { ESTADO_INICIAL } from "@/lib/entradas/formulario";

const sesion = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT ${destino}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: sesion.userId }) }));

// db.ts abre su propio cliente con DATABASE_URL: apuntarlo a la base de pruebas antes de cargarlo.
process.env.DATABASE_URL = URL_PRUEBAS;
const { confirmarRecepcion, crearEntrada, descartarEntrada, guardarEntrada } = await import("./actions");

const prisma = crearCliente(URL_PRUEBAS);
let e: Entorno;
const clerkId = (rol: keyof Entorno["usuarios"]) => prisma.usuario.findUniqueOrThrow({ where: { id: e.usuarios[rol].id } }).then((u) => u.clerkUserId);

beforeAll(async () => {
  e = await sembrarEntorno(prisma);
});
afterAll(() => prisma.$disconnect());

function formulario(llave: string) {
  const fd = new FormData();
  fd.set("llaveIdempotencia", llave);
  fd.set("encabezado.proveedorId", e.proveedorId);
  fd.set("encabezado.bodegaDestinoId", e.bodegaId);
  fd.set("encabezado.fecha", "2026-09-10");
  fd.set("encabezado.moneda", "MXN");
  fd.set("partidas.0.articuloId", e.articuloSueltoId);
  fd.set("partidas.0.presentacion", "UNIDAD");
  fd.set("partidas.0.cantidadCapturada", "2");
  fd.set("partidas.0.costoUnitarioCapturado", "5");
  fd.set("partidas.0.tasaIva", "0.16");
  return fd;
}

const SIN_PERMISO = "No tienes permiso para esta operación.";

async function borradorDeCompras() {
  sesion.userId = await clerkId("COMPRAS");
  const llave = randomUUID();
  await expect(crearEntrada(ESTADO_INICIAL, formulario(llave))).rejects.toThrow(/^REDIRECT \/entradas\//);
  return prisma.movimiento.findUniqueOrThrow({ where: { llaveIdempotencia: llave }, select: { id: true } });
}

describe("13. el usuario sin permiso, sobre la Server Action real", () => {
  it("con permiso sí crea: la acción real llega a la base", async () => {
    const { id } = await borradorDeCompras();
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ estatus: "BORRADOR", folio: null });
  });

  it("JEFE solo lee: no crea, no guarda, no descarta ni confirma", async () => {
    const { id } = await borradorDeCompras();
    sesion.userId = await clerkId("JEFE");
    const llave = randomUUID();

    await expect(crearEntrada(ESTADO_INICIAL, formulario(llave))).resolves.toEqual({ errores: {}, mensaje: SIN_PERMISO });
    await expect(prisma.movimiento.findUnique({ where: { llaveIdempotencia: llave } })).resolves.toBeNull();

    await expect(guardarEntrada(id, ESTADO_INICIAL, formulario(llave))).resolves.toEqual({ errores: {}, mensaje: SIN_PERMISO });
    await expect(descartarEntrada(id, "no debería poder")).resolves.toEqual({ ok: false, mensaje: SIN_PERMISO });
    await expect(confirmarRecepcion(id)).resolves.toEqual({ ok: false, mensaje: SIN_PERMISO });
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ estatus: "BORRADOR", folio: null, confirmadoPorId: null });
    await expect(prisma.capaCosto.count({ where: { movimientoId: id } })).resolves.toBe(0);
  });

  it("sin sesión o con un usuario que no existe en el sistema, lo mismo", async () => {
    const { id } = await borradorDeCompras();
    for (const userId of [null, "user_desconocido"]) {
      sesion.userId = userId;
      await expect(crearEntrada(ESTADO_INICIAL, formulario(randomUUID()))).resolves.toEqual({ errores: {}, mensaje: SIN_PERMISO });
      await expect(confirmarRecepcion(id)).resolves.toEqual({ ok: false, mensaje: SIN_PERMISO });
    }
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ estatus: "BORRADOR", folio: null });
  });

  it("un usuario dado de baja tampoco, aunque conserve su sesión en Clerk", async () => {
    const { id } = await borradorDeCompras();
    const baja = await prisma.usuario.create({
      data: { clerkUserId: `user_baja_${randomUUID().slice(0, 8)}`, correo: `baja.${randomUUID().slice(0, 8)}@prueba.test`, rol: "COMPRAS", activo: false },
    });
    sesion.userId = baja.clerkUserId;
    await expect(confirmarRecepcion(id)).resolves.toEqual({ ok: false, mensaje: SIN_PERMISO });
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ estatus: "BORRADOR" });
  });
});
