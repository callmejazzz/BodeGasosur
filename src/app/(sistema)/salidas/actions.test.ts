/*
  Criterio 10 del contrato de salidas: las Server Actions, invocadas
  directamente, rechazan falta de sesión, usuario inactivo, rol sin permiso y
  autorizador sin bandera, aunque se conozca el identificador.

  Se prueba la acción real —Zod → accionProtegida() → servicio— contra
  PostgreSQL. Solo se sustituye lo que existe dentro de Next: la sesión de
  Clerk, `server-only`, `next/headers`, la revalidación y el redirect.
*/

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../../prisma/comun";
import { URL_PRUEBAS } from "../../../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../../../pruebas/semilla-entradas";
import { bloqueadaPor, conexion } from "../../../../pruebas/concurrencia";
import { formDataEspia } from "../../../../pruebas/formulario-espia";
import { sembrarCapa, sinDefensas } from "../../../../pruebas/semilla-inventario";
import { sembrarSalidas, type EntornoSalidas } from "../../../../pruebas/semilla-salidas";
import { ESTADO_INICIAL } from "@/lib/salidas/formulario";

const sesion = vi.hoisted(() => ({ userId: null as string | null, token: undefined as ((userId: string) => string | null) | undefined }));

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
vi.mock("@clerk/nextjs/server", async () => ({ auth: (await import("../../../../pruebas/clerk-simulado")).authSimulado(sesion) }));

// db.ts abre su propio cliente con DATABASE_URL: se apunta a la base de pruebas
// con el usuario de ejecución, sin propiedad, igual que en producción.
process.env.DATABASE_URL = inject("urlEjecucionPruebas");
const { autorizarSalida, cancelarSalida, confirmarRecepcion, crearSalida, rechazarSalida, retirarSalida } = await import("./actions");

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
let articuloId: string;

const SIN_PERMISO = "No tienes permiso para esta operación.";
const NEGADO = { ok: false, mensaje: SIN_PERMISO };

beforeAll(async () => {
  e = await sembrarSalidas(prisma);
  articuloId = (await articuloNuevo(prisma, e.unidadId, null)).id;
  await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId, cantidad: 100, fechaOriginal: "2026-09-01", costo: ["2.0000", "2.3200"] });
});
afterAll(() => prisma.$disconnect());

/** La sesión de Clerk de ese usuario; null es sin sesión. */
async function como(usuario: { id: string } | null) {
  sesion.userId = usuario ? (await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } })).clerkUserId : null;
}

function formulario(llave: string, cantidad = 1) {
  const fd = new FormData();
  fd.set("llaveIdempotencia", llave);
  fd.set("encabezado.bodegaOrigenId", e.bodegaId);
  fd.set("encabezado.estacionId", e.estacionId);
  fd.set("partidas.0.articuloId", articuloId);
  fd.set("partidas.0.presentacion", "UNIDAD");
  fd.set("partidas.0.cantidadCapturada", String(cantidad));
  return fd;
}

/** Una salida creada por Compras a través de la acción, llevada hasta `hasta`. */
async function salida(hasta: "SOLICITADA" | "AUTORIZADA" | "RETIRADA" = "SOLICITADA"): Promise<string> {
  await como(e.usuarios.COMPRAS);
  const llave = randomUUID();
  await expect(crearSalida(ESTADO_INICIAL, formulario(llave))).rejects.toThrow(/^REDIRECT \/salidas\//);
  const { id } = await prisma.movimiento.findUniqueOrThrow({ where: { llaveIdempotencia: llave }, select: { id: true } });
  if (hasta === "SOLICITADA") return id;
  await como(e.autorizadores.JEFE);
  await expect(autorizarSalida(id)).resolves.toEqual({ ok: true });
  if (hasta === "AUTORIZADA") return id;
  await como(e.usuarios.COMPRAS);
  await expect(retirarSalida(id, "Mensajero")).resolves.toEqual({ ok: true });
  return id;
}

const leer = (id: string) => prisma.movimiento.findUniqueOrThrow({ where: { id } });

/** Las seis acciones sobre salidas en cada estado, con la sesión que haya. */
async function todasNegadas(etiqueta: string) {
  const [solicitada, autorizada, retirada] = [await salida(), await salida("AUTORIZADA"), await salida("RETIRADA")];
  const antes = await Promise.all([solicitada, autorizada, retirada].map(leer));
  return {
    antes,
    probar: async () => {
      const llave = randomUUID();
      await expect(crearSalida(ESTADO_INICIAL, formulario(llave)), etiqueta).resolves.toEqual({ errores: {}, mensaje: SIN_PERMISO });
      await expect(prisma.movimiento.findUnique({ where: { llaveIdempotencia: llave } }), etiqueta).resolves.toBeNull();
      await expect(autorizarSalida(solicitada), etiqueta).resolves.toEqual(NEGADO);
      await expect(rechazarSalida(solicitada, "No procede"), etiqueta).resolves.toEqual(NEGADO);
      await expect(cancelarSalida(autorizada, "Ya no"), etiqueta).resolves.toEqual(NEGADO);
      await expect(retirarSalida(autorizada, "Mensajero"), etiqueta).resolves.toEqual(NEGADO);
      await expect(confirmarRecepcion(retirada), etiqueta).resolves.toEqual(NEGADO);
      await expect(Promise.all([solicitada, autorizada, retirada].map(leer)), etiqueta).resolves.toEqual(antes);
    },
  };
}

describe("con permiso, la acción real llega a la base con el actor de la sesión", () => {
  it("solicitar, autorizar, retirar y confirmar recepción", async () => {
    await como(e.usuarios.COMPRAS);
    const llave = randomUUID();
    const fd = formulario(llave, 3);
    // Nada de lo que el servidor toma de la sesión o deriva se acepta del navegador.
    fd.set("creadoPorId", e.usuarios.SUPERADMIN.id);
    fd.set("encabezado.creadoPorId", e.usuarios.SUPERADMIN.id);
    fd.set("partidas.0.factorConversion", "99");
    await expect(crearSalida(ESTADO_INICIAL, fd)).rejects.toThrow(/^REDIRECT \/salidas\//);
    const { id } = await prisma.movimiento.findUniqueOrThrow({ where: { llaveIdempotencia: llave } });
    const antes = (await prisma.existencia.findUniqueOrThrow({ where: { bodegaId_articuloId: { bodegaId: e.bodegaId, articuloId } } })).cantidad;

    await como(e.autorizadores.JEFE);
    await expect(autorizarSalida(id)).resolves.toEqual({ ok: true });
    await como(e.usuarios.COMPRAS);
    await expect(retirarSalida(id, " Juan Pérez ")).resolves.toEqual({ ok: true });
    await expect(retirarSalida(id, "Otro")).resolves.toEqual({ ok: true });
    await como(e.usuarios.SUPERADMIN);
    await expect(confirmarRecepcion(id)).resolves.toEqual({ ok: true });

    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id }, include: { partidas: true } });
    expect(m).toMatchObject({
      estatus: "RECIBIDA",
      creadoPorId: e.usuarios.COMPRAS.id,
      autorizadoPorId: e.autorizadores.JEFE.id,
      entregadoPorId: e.usuarios.COMPRAS.id,
      entregadoA: "Juan Pérez",
      recibidoPorId: e.usuarios.SUPERADMIN.id,
    });
    expect(m.folio).toMatch(/^S-\d{6}$/);
    expect(m.partidas[0]).toMatchObject({ factorConversion: 1, cantidad: 3 });
    await expect(
      prisma.existencia.findUniqueOrThrow({ where: { bodegaId_articuloId: { bodegaId: e.bodegaId, articuloId } } }),
    ).resolves.toMatchObject({ cantidad: antes - 3 });
  });

  it("rechazar y cancelar guardan su motivo y su actor", async () => {
    const a = await salida();
    await como(e.autorizadores.COMPRAS);
    await expect(rechazarSalida(a, " Sin presupuesto ")).resolves.toEqual({ ok: true });
    await expect(leer(a)).resolves.toMatchObject({ estatus: "RECHAZADA", motivoRechazo: "Sin presupuesto", rechazadoPorId: e.autorizadores.COMPRAS.id });

    const b = await salida("AUTORIZADA");
    await como(e.usuarios.SUPERADMIN);
    await expect(cancelarSalida(b, "Error de captura")).resolves.toEqual({ ok: true });
    await expect(leer(b)).resolves.toMatchObject({ estatus: "CANCELADO", canceladoPorId: e.usuarios.SUPERADMIN.id });
  });
});

describe("criterio 10: acceso directo sin permiso", () => {
  it("sin sesión o con una identidad que no existe en el sistema", async () => {
    const { probar } = await todasNegadas("sin sesión");
    for (const userId of [null, "user_desconocido"]) {
      sesion.userId = userId;
      await probar();
    }
  });

  it("un usuario dado de baja, aunque conserve su sesión y su bandera", async () => {
    const { probar } = await todasNegadas("inactivo");
    for (const rol of ["SUPERADMIN", "COMPRAS", "JEFE"] as const) {
      const baja = await prisma.usuario.create({
        data: {
          clerkUserId: `user_baja_${randomUUID().slice(0, 8)}`,
          correo: `baja.${randomUUID().slice(0, 8)}@prueba.test`,
          rol,
          puedeAutorizar: true,
          activo: false,
        },
      });
      await como(baja);
      await probar();
    }
  });

  it("JEFE sin bandera solo lee: ninguna acción", async () => {
    const { probar } = await todasNegadas("jefe");
    await como(e.usuarios.JEFE);
    await probar();
  });

  it("JEFE con bandera autoriza y rechaza, pero no captura, cancela, retira ni confirma", async () => {
    const [solicitada, autorizada, retirada] = [await salida(), await salida("AUTORIZADA"), await salida("RETIRADA")];
    await como(e.autorizadores.JEFE);
    await expect(crearSalida(ESTADO_INICIAL, formulario(randomUUID()))).resolves.toEqual({ errores: {}, mensaje: SIN_PERMISO });
    await expect(cancelarSalida(autorizada, "Ya no")).resolves.toEqual(NEGADO);
    await expect(retirarSalida(autorizada, "Mensajero")).resolves.toEqual(NEGADO);
    await expect(confirmarRecepcion(retirada)).resolves.toEqual(NEGADO);
    await expect(leer(autorizada)).resolves.toMatchObject({ estatus: "AUTORIZADA", folio: null });
    await expect(leer(retirada)).resolves.toMatchObject({ estatus: "RETIRADA", recibidoPorId: null });
    await expect(autorizarSalida(solicitada)).resolves.toEqual({ ok: true });
  });

  it("sin bandera ningún rol autoriza ni rechaza, y la revocación rige desde la petición siguiente", async () => {
    for (const rol of ["SUPERADMIN", "COMPRAS", "JEFE"] as const) {
      const id = await salida();
      await como(e.usuarios[rol]);
      await expect(autorizarSalida(id), rol).resolves.toEqual(NEGADO);
      await expect(rechazarSalida(id, "No"), rol).resolves.toEqual(NEGADO);
      await expect(leer(id), rol).resolves.toMatchObject({ estatus: "SOLICITADA", autorizadoPorId: null, rechazadoPorId: null });
    }

    const u = await prisma.usuario.create({
      data: { clerkUserId: `user_aut_${randomUUID().slice(0, 8)}`, correo: `aut.${randomUUID().slice(0, 8)}@prueba.test`, rol: "COMPRAS", puedeAutorizar: true },
    });
    const [a, b] = [await salida(), await salida()];
    await como(u);
    await expect(autorizarSalida(a)).resolves.toEqual({ ok: true });
    await prisma.usuario.update({ where: { id: u.id }, data: { puedeAutorizar: false } });
    await expect(autorizarSalida(b)).resolves.toEqual(NEGADO);
    // La autorización ya hecha se conserva.
    await expect(leer(a)).resolves.toMatchObject({ estatus: "AUTORIZADA", autorizadoPorId: u.id });
    await expect(leer(b)).resolves.toMatchObject({ estatus: "SOLICITADA", autorizadoPorId: null });
  });
});

describe("primero la sesión y el permiso, después los datos", () => {
  it("sin sesión, o sin permiso, lo manipulado recibe la negativa de acceso y no un error de validación", async () => {
    const id = await salida("AUTORIZADA");
    const antes = await leer(id);
    const invalido = formulario(randomUUID());
    invalido.set("encabezado.estacionId", "no-soy-uuid");
    invalido.set("partidas.0.cantidadCapturada", "1.5");

    for (const [etiqueta, usuario] of [["sin sesión", null], ["JEFE sin bandera", e.usuarios.JEFE]] as const) {
      await como(usuario);
      await expect(crearSalida(ESTADO_INICIAL, invalido), etiqueta).resolves.toEqual({ errores: {}, mensaje: SIN_PERMISO });
      for (const falso of ["S-000001", "", null, 123]) {
        await expect(autorizarSalida(falso as string), etiqueta).resolves.toEqual(NEGADO);
        await expect(confirmarRecepcion(falso as string), etiqueta).resolves.toEqual(NEGADO);
      }
      await expect(rechazarSalida("x", ""), etiqueta).resolves.toEqual(NEGADO);
      await expect(cancelarSalida(id, "x".repeat(400)), etiqueta).resolves.toEqual(NEGADO);
      await expect(retirarSalida(id, "   "), etiqueta).resolves.toEqual(NEGADO);
    }
    await expect(leer(id)).resolves.toEqual(antes);
  });

  it("sin sesión o sin permiso, el FormData ni siquiera se abre", async () => {
    for (const usuario of [null, e.usuarios.JEFE]) {
      await como(usuario);
      const alta = formDataEspia(formulario(randomUUID()));
      await expect(crearSalida(ESTADO_INICIAL, alta.formData)).resolves.toEqual({ errores: {}, mensaje: SIN_PERMISO });
      expect(alta.lecturas).toEqual([]);
    }
    // Con permiso sí se lee: el espía funciona.
    await como(e.usuarios.COMPRAS);
    const alta = formDataEspia(formulario(randomUUID()));
    await expect(crearSalida(ESTADO_INICIAL, alta.formData)).rejects.toThrow(/^REDIRECT \/salidas\//);
    expect(alta.lecturas).not.toEqual([]);
  });
});

describe("la puerta vuelve a exigir el permiso antes de confirmar", () => {
  it("la bandera retirada mientras se autoriza revierte la autorización", async () => {
    const id = await salida();
    const u = await prisma.usuario.create({
      data: { clerkUserId: `user_aut_${randomUUID().slice(0, 8)}`, correo: `aut.${randomUUID().slice(0, 8)}@prueba.test`, rol: "JEFE", puedeAutorizar: true },
    });
    await como(u);
    const [candado, observador] = [await conexion(URL_PRUEBAS), await conexion(URL_PRUEBAS)];
    try {
      // El encabezado tomado por otro detiene la autorización ya dentro de su transacción.
      await candado.query("BEGIN");
      await candado.query(`SELECT id FROM "Movimiento" WHERE id = $1 FOR UPDATE`, [id]);
      const accion = autorizarSalida(id);
      await bloqueadaPor(observador, candado.pid);
      await prisma.usuario.update({ where: { id: u.id }, data: { puedeAutorizar: false } });
      await candado.query("ROLLBACK");
      await expect(accion).resolves.toEqual(NEGADO);
    } finally {
      await candado.end();
      await observador.end();
    }
    await expect(leer(id)).resolves.toMatchObject({ estatus: "SOLICITADA", autorizadoPorId: null });
  });
});

describe("lo que falla al confirmar también sale traducido", () => {
  it("un descuadre que detecta el trigger diferido llega con el texto de BG606, sin cantidades", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const capa = await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: x.id, cantidad: 5, fechaOriginal: "2026-09-01", costo: null });
    // Capa que ya no concilia con sus consumos; existencia y suma de capas sí cuadran,
    // así que el servicio no lo ve y el retiro llega hasta el COMMIT.
    await sinDefensas(prisma, (tx) => tx.capaCosto.update({ where: { id: capa.id }, data: { cantidadInicial: 9 } }));
    const d = new FormData();
    d.set("llaveIdempotencia", randomUUID());
    d.set("encabezado.bodegaOrigenId", e.bodegaId);
    d.set("encabezado.estacionId", e.estacionId);
    d.set("partidas.0.articuloId", x.id);
    d.set("partidas.0.presentacion", "UNIDAD");
    d.set("partidas.0.cantidadCapturada", "1");
    await como(e.usuarios.COMPRAS);
    await expect(crearSalida(ESTADO_INICIAL, d)).rejects.toThrow(/^REDIRECT/);
    const { id } = await prisma.movimiento.findUniqueOrThrow({ where: { llaveIdempotencia: d.get("llaveIdempotencia") as string } });
    await como(e.autorizadores.COMPRAS);
    await expect(autorizarSalida(id)).resolves.toEqual({ ok: true });

    const r = await retirarSalida(id, "Mensajero");
    expect(r).toEqual({ ok: false, mensaje: `Una capa de costo de ${x.clave} no concilia con sus consumos; no se guardó nada.` });
    await expect(leer(id)).resolves.toMatchObject({ estatus: "AUTORIZADA", folio: null });
    await expect(prisma.capaCosto.findUniqueOrThrow({ where: { id: capa.id } })).resolves.toMatchObject({ cantidadRestante: 5 });
  });
});

describe("lo que llega manipulado no toca la base", () => {
  it("identificadores y datos que no pasan el esquema", async () => {
    const id = await salida("AUTORIZADA");
    // Con sesión y todos los permisos: lo que responde es la validación.
    await como(e.autorizadores.COMPRAS);
    for (const falso of ["S-000001", "", "' OR 1=1 --", 123, null, { id }]) {
      await expect(autorizarSalida(falso as string)).resolves.toEqual({ ok: false, mensaje: "La salida no existe." });
      await expect(confirmarRecepcion(falso as string)).resolves.toEqual({ ok: false, mensaje: "La salida no existe." });
    }
    await expect(retirarSalida(id, "   ")).resolves.toEqual({ ok: false, mensaje: "Di quién se lleva el material" });
    await expect(retirarSalida(id, { toString: () => "x" } as unknown as string)).resolves.toMatchObject({ ok: false });
    await expect(cancelarSalida(id, "x".repeat(301))).resolves.toEqual({ ok: false, mensaje: "Máximo 300 caracteres" });
    await expect(leer(id)).resolves.toMatchObject({ estatus: "AUTORIZADA", folio: null });

    const fd = formulario(randomUUID());
    fd.set("partidas.0.cantidadCapturada", "1.5");
    fd.set("encabezado.estacionId", "no-soy-uuid");
    const r = await crearSalida(ESTADO_INICIAL, fd);
    expect(r.mensaje).toBe("Revisa los campos marcados.");
    expect(Object.keys(r.errores).sort()).toEqual(["encabezado.estacionId", "partidas.0.cantidadCapturada"]);
  });

  it("un id de otro tipo de movimiento responde como inexistente, y los errores de dominio salen tal cual", async () => {
    const entrada = await prisma.movimiento.create({
      data: {
        tipo: "ENTRADA", estatus: "BORRADOR", fecha: new Date("2026-09-10"), moneda: "MXN",
        proveedorId: e.proveedorId, bodegaDestinoId: e.bodegaId, creadoPorId: e.usuarios.COMPRAS.id, llaveIdempotencia: randomUUID(),
      },
    });
    await como(e.usuarios.COMPRAS);
    await expect(retirarSalida(entrada.id, "Mensajero")).resolves.toEqual({ ok: false, mensaje: "La salida no existe." });
    await expect(retirarSalida(randomUUID(), "Mensajero")).resolves.toEqual({ ok: false, mensaje: "La salida no existe." });
    const solicitada = await salida();
    await como(e.usuarios.COMPRAS);
    await expect(retirarSalida(solicitada, "Mensajero")).resolves.toEqual({
      ok: false,
      mensaje: "No se puede retirar: la salida todavía no está autorizada.",
    });
  });
});
