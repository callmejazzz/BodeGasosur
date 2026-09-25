/*
  Criterio 13 (11 §12): quien no tiene permiso no crea ni confirma una entrada
  aunque invoque la Server Action directamente, sin pasar por la pantalla.

  Se prueba la acción real —Zod → accionProtegida() → servicio— contra
  PostgreSQL. Lo único que se sustituye es lo que solo existe dentro de Next:
  la sesión de Clerk, `server-only`, `next/headers`, la revalidación y el
  redirect.
*/

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../../prisma/comun";
import { URL_PRUEBAS } from "../../../../pruebas/base-de-pruebas";
import { articuloNuevo, sembrarEntorno, type Entorno } from "../../../../pruebas/semilla-entradas";
import { bloqueadaPor, conexion } from "../../../../pruebas/concurrencia";
import { formDataEspia } from "../../../../pruebas/formulario-espia";
import { sembrarCapa, sinDefensas } from "../../../../pruebas/semilla-inventario";
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

// db.ts abre su propio cliente con DATABASE_URL: se apunta a la base de pruebas
// con el usuario de ejecución, sin propiedad, igual que en producción.
process.env.DATABASE_URL = inject("urlEjecucionPruebas");
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

describe("el alta inválida devuelve errores con la ruta de cada campo", () => {
  it("encabezado.* y partidas.N.*, sin el prefijo del borrador, y no escribe nada", async () => {
    sesion.userId = await clerkId("COMPRAS");
    const llave = randomUUID();
    const fd = formulario(llave);
    fd.set("encabezado.fecha", "2099-01-01");
    fd.set("encabezado.proveedorId", "no-soy-uuid");
    fd.set("partidas.0.cantidadCapturada", "1.5");
    const r = await crearEntrada(ESTADO_INICIAL, fd);
    expect(r.mensaje).toBe("Revisa los campos marcados.");
    expect(Object.keys(r.errores).sort()).toEqual(["encabezado.fecha", "encabezado.proveedorId", "partidas.0.cantidadCapturada"]);
    await expect(prisma.movimiento.findUnique({ where: { llaveIdempotencia: llave } })).resolves.toBeNull();
  });
});

describe("lo que falla al confirmar también sale traducido", () => {
  it("una existencia que ya no cuadra con sus capas detiene la confirmación con el texto de BG606, sin cantidades", async () => {
    const articulo = await articuloNuevo(prisma, e.unidadId, null);
    const bodega = await prisma.bodega.findUniqueOrThrow({ where: { id: e.bodegaId } });
    await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: articulo.id, cantidad: 5, fechaOriginal: "2026-09-01", costo: null });
    await sinDefensas(prisma, (tx) =>
      tx.existencia.update({ where: { bodegaId_articuloId: { bodegaId: e.bodegaId, articuloId: articulo.id } }, data: { cantidad: 7 } }),
    );
    sesion.userId = await clerkId("COMPRAS");
    const llave = randomUUID();
    const fd = formulario(llave);
    fd.set("partidas.0.articuloId", articulo.id);
    await expect(crearEntrada(ESTADO_INICIAL, fd)).rejects.toThrow(/^REDIRECT \/entradas\//);
    const { id } = await prisma.movimiento.findUniqueOrThrow({ where: { llaveIdempotencia: llave } });

    await expect(confirmarRecepcion(id)).resolves.toEqual({
      ok: false,
      mensaje: `La existencia de ${articulo.clave} en ${bodega.clave} no coincide con sus capas de costo; no se guardó nada.`,
    });
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ estatus: "BORRADOR", folio: null });
  });
});

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

  it("primero la sesión y el permiso, después los datos: con datos inválidos la respuesta sigue siendo la negativa", async () => {
    const { id } = await borradorDeCompras();
    const altaInvalida = formulario("no-soy-uuid");
    altaInvalida.set("encabezado.fecha", "2099-01-01");
    for (const userId of [null, await clerkId("JEFE")]) {
      sesion.userId = userId;
      await expect(crearEntrada(ESTADO_INICIAL, altaInvalida)).resolves.toEqual({ errores: {}, mensaje: SIN_PERMISO });
      await expect(guardarEntrada("no-soy-uuid", ESTADO_INICIAL, formulario(randomUUID()))).resolves.toEqual({ errores: {}, mensaje: SIN_PERMISO });
      await expect(guardarEntrada(id, ESTADO_INICIAL, altaInvalida)).resolves.toEqual({ errores: {}, mensaje: SIN_PERMISO });
      await expect(descartarEntrada("no-soy-uuid", "")).resolves.toEqual({ ok: false, mensaje: SIN_PERMISO });
      await expect(confirmarRecepcion("no-soy-uuid")).resolves.toEqual({ ok: false, mensaje: SIN_PERMISO });
    }
  });

  it("sin sesión o sin permiso, el FormData ni siquiera se abre", async () => {
    const { id } = await borradorDeCompras();
    for (const userId of [null, await clerkId("JEFE")]) {
      sesion.userId = userId;
      const [alta, guardado] = [formDataEspia(formulario(randomUUID())), formDataEspia(formulario(randomUUID()))];
      await expect(crearEntrada(ESTADO_INICIAL, alta.formData)).resolves.toEqual({ errores: {}, mensaje: SIN_PERMISO });
      await expect(guardarEntrada(id, ESTADO_INICIAL, guardado.formData)).resolves.toEqual({ errores: {}, mensaje: SIN_PERMISO });
      expect([...alta.lecturas, ...guardado.lecturas]).toEqual([]);
    }
    // Con permiso sí se lee: el espía funciona.
    sesion.userId = await clerkId("COMPRAS");
    const guardado = formDataEspia(formulario(randomUUID()));
    await expect(guardarEntrada(id, ESTADO_INICIAL, guardado.formData)).resolves.toEqual({ errores: {}, mensaje: null });
    expect(guardado.lecturas).not.toEqual([]);
  });

  it("con permiso, un id que no es UUID es una entrada que no existe y los campos inválidos van marcados", async () => {
    const { id } = await borradorDeCompras();
    const invalido = formulario(randomUUID());
    invalido.set("encabezado.fecha", "2099-01-01");
    await expect(guardarEntrada("no-soy-uuid", ESTADO_INICIAL, invalido)).resolves.toEqual({ errores: {}, mensaje: "La entrada no existe." });
    await expect(guardarEntrada(id, ESTADO_INICIAL, invalido)).resolves.toMatchObject({
      errores: { "encabezado.fecha": expect.any(String) },
      mensaje: "Revisa los campos marcados.",
    });
    await expect(descartarEntrada("no-soy-uuid", "motivo")).resolves.toEqual({ ok: false, mensaje: "La entrada no existe." });
    await expect(descartarEntrada(id, " ")).resolves.toEqual({ ok: false, mensaje: "Di por qué se descarta" });
    await expect(confirmarRecepcion("no-soy-uuid")).resolves.toEqual({ ok: false, mensaje: "La entrada no existe." });
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

describe("la puerta vuelve a exigir el permiso antes de confirmar", () => {
  it("una baja confirmada mientras se confirma la recepción la revierte: sin folio ni capas", async () => {
    const { id } = await borradorDeCompras();
    const u = await prisma.usuario.create({
      data: { clerkUserId: `user_conf_${randomUUID().slice(0, 8)}`, correo: `conf.${randomUUID().slice(0, 8)}@prueba.test`, rol: "COMPRAS" },
    });
    sesion.userId = u.clerkUserId;
    const [candado, observador] = [await conexion(URL_PRUEBAS), await conexion(URL_PRUEBAS)];
    try {
      // El encabezado tomado por otro detiene la confirmación ya dentro de su transacción.
      await candado.query("BEGIN");
      await candado.query(`SELECT id FROM "Movimiento" WHERE id = $1 FOR UPDATE`, [id]);
      const accion = confirmarRecepcion(id);
      await bloqueadaPor(observador, candado.pid);
      await prisma.usuario.update({ where: { id: u.id }, data: { activo: false } });
      await candado.query("ROLLBACK");
      await expect(accion).resolves.toEqual({ ok: false, mensaje: SIN_PERMISO });
    } finally {
      await candado.end();
      await observador.end();
    }
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ estatus: "BORRADOR", folio: null, confirmadoPorId: null });
    await expect(prisma.capaCosto.count({ where: { movimientoId: id } })).resolves.toBe(0);
  });
});
