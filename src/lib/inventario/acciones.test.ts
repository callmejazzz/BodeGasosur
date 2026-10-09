/*
  Criterio 6 del contrato de la fase 7: las Server Actions de traspasos,
  devoluciones, conteos y reversas, invocadas directamente, rechazan falta de
  sesión, usuario inactivo y rol sin permiso, aun con el identificador; el
  actor sale de la sesión y la base lo verifica con el JWT de Clerk.

  Se prueba la acción real —accionProtegida() → Zod → servicio— con el
  usuario de ejecución, sin propiedad. Solo se sustituye lo que existe dentro
  de Next: la sesión de Clerk, `server-only`, la revalidación y el redirect.
*/

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { bloqueadaPor, conexion } from "../../../pruebas/concurrencia";
import { formDataEspia } from "../../../pruebas/formulario-espia";
import { articuloNuevo } from "../../../pruebas/semilla-entradas";
import { sembrarCapa, sinDefensas } from "../../../pruebas/semilla-inventario";
import { como as comoEnServicio, sembrarOperacion } from "../../../pruebas/semilla-operacion";
import type { EntornoSalidas } from "../../../pruebas/semilla-salidas";
import { autorizarSalida, retirarSalida, solicitarSalida } from "../salidas/servicio";
import { ESTADO_INICIAL } from "./formulario";

const sesion = vi.hoisted(() => ({ userId: null as string | null, token: undefined as ((userId: string) => string | null) | undefined }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT ${destino}`);
  },
}));
vi.mock("@clerk/nextjs/server", async () => ({ auth: (await import("../../../pruebas/clerk-simulado")).authSimulado(sesion) }));

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
const traspasos = await import("@/app/(sistema)/traspasos/actions");
const devoluciones = await import("@/app/(sistema)/devoluciones/actions");
const consultasDeDevolucion = await import("@/app/(sistema)/devoluciones/consultas");
const conteos = await import("@/app/(sistema)/conteos/actions");
const reversas = await import("@/app/(sistema)/reversas/actions");

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
let articuloId: string;

const SIN_PERMISO = "No tienes permiso para esta operación.";
const NEGADO = { ok: false, mensaje: SIN_PERMISO };
const NEGADO_FORMULARIO = { errores: {}, mensaje: SIN_PERMISO };

beforeAll(async () => {
  e = await sembrarOperacion(prisma);
  articuloId = (await articuloNuevo(prisma, e.unidadId, null)).id;
  await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId, cantidad: 500, fechaOriginal: "2026-08-01", costo: ["2.0000", "2.3200"] });
});
afterAll(() => prisma.$disconnect());

async function como(usuario: { id: string } | null) {
  sesion.userId = usuario ? (await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } })).clerkUserId : null;
}

function formularioTraspaso(llave: string, cantidad = 1) {
  const fd = new FormData();
  fd.set("llaveIdempotencia", llave);
  fd.set("encabezado.bodegaOrigenId", e.bodegaId);
  fd.set("encabezado.bodegaDestinoId", e.otraBodegaId);
  fd.set("partidas.0.articuloId", articuloId);
  fd.set("partidas.0.presentacion", "UNIDAD");
  fd.set("partidas.0.cantidadCapturada", String(cantidad));
  return fd;
}

function formularioDevolucion(llave: string) {
  const fd = new FormData();
  fd.set("llaveIdempotencia", llave);
  fd.set("encabezado.estacionId", e.estacionId);
  fd.set("encabezado.bodegaDestinoId", e.bodegaId);
  fd.set("partidas.0.articuloId", articuloId);
  fd.set("partidas.0.presentacion", "UNIDAD");
  fd.set("partidas.0.cantidadCapturada", "1");
  return fd;
}

function formularioHoja(llave: string, bodegaId: string) {
  const fd = new FormData();
  fd.set("llaveIdempotencia", llave);
  fd.set("bodegaId", bodegaId);
  fd.set("motivo", "Conteo de prueba");
  return fd;
}

/** Crea con la acción, como Compras; devuelve el id que eligió el redirect. */
async function traspasoBorrador(): Promise<string> {
  await como(e.usuarios.COMPRAS);
  const llave = randomUUID();
  await expect(traspasos.crearTraspaso(ESTADO_INICIAL, formularioTraspaso(llave))).rejects.toThrow(/^REDIRECT \/traspasos\//);
  return (await prisma.movimiento.findUniqueOrThrow({ where: { llaveIdempotencia: llave } })).id;
}

async function traspasoConfirmado(): Promise<string> {
  const id = await traspasoBorrador();
  await como(e.usuarios.COMPRAS);
  await expect(traspasos.confirmarTraspaso(id)).resolves.toEqual({ ok: true });
  return id;
}

async function hojaAbierta(): Promise<{ id: string; bodegaId: string }> {
  const bodegaId = (await prisma.bodega.create({ data: { nombre: `Acciones ${randomUUID().slice(0, 8)}` } })).id;
  await como(e.usuarios.COMPRAS);
  const llave = randomUUID();
  await expect(conteos.abrirHoja(ESTADO_INICIAL, formularioHoja(llave, bodegaId))).rejects.toThrow(/^REDIRECT \/conteos\//);
  return { id: (await prisma.hojaConteo.findUniqueOrThrow({ where: { llaveIdempotencia: llave } })).id, bodegaId };
}

const leer = (id: string) => prisma.movimiento.findUniqueOrThrow({ where: { id } });

describe("con permiso, la acción real llega a la base con el actor de la sesión", () => {
  it("traspaso: capturar, corregir y confirmar; nada de lo derivado se acepta del navegador", async () => {
    await como(e.usuarios.COMPRAS);
    const llave = randomUUID();
    const fd = formularioTraspaso(llave, 3);
    fd.set("creadoPorId", e.usuarios.SUPERADMIN.id);
    fd.set("encabezado.creadoPorId", e.usuarios.SUPERADMIN.id);
    fd.set("encabezado.folio", "T-999999");
    fd.set("partidas.0.factorConversion", "99");
    fd.set("partidas.0.costoUnitario", "0");
    await expect(traspasos.crearTraspaso(ESTADO_INICIAL, fd)).rejects.toThrow(/^REDIRECT \/traspasos\//);
    const m = await prisma.movimiento.findUniqueOrThrow({ where: { llaveIdempotencia: llave }, include: { partidas: true } });
    expect(m).toMatchObject({ creadoPorId: e.usuarios.COMPRAS.id, folio: null, estatus: "BORRADOR" });
    expect(m.partidas[0]).toMatchObject({ factorConversion: 1, cantidad: 3, costoUnitario: null });

    await expect(traspasos.guardarTraspaso(m.id, ESTADO_INICIAL, formularioTraspaso(llave, 2))).resolves.toEqual({ errores: {}, mensaje: null });
    await como(e.usuarios.SUPERADMIN);
    await expect(traspasos.confirmarTraspaso(m.id)).resolves.toEqual({ ok: true });
    await expect(traspasos.confirmarTraspaso(m.id)).resolves.toEqual({ ok: true });
    const confirmado = await prisma.movimiento.findUniqueOrThrow({ where: { id: m.id }, include: { partidas: true } });
    expect(confirmado).toMatchObject({ estatus: "CONFIRMADO", confirmadoPorId: e.usuarios.SUPERADMIN.id });
    expect(confirmado.folio).toMatch(/^T-\d{6}$/);
    expect(confirmado.partidas[0].cantidad).toBe(2);
    const bitacora = await prisma.bitacora.findFirstOrThrow({ where: { tabla: "Movimiento", registroId: m.id, accion: "INSERTAR" } });
    expect(bitacora).toMatchObject({ usuarioId: e.usuarios.COMPRAS.id, verificacion: "liga" });
  });

  it("devolución sin salida, hoja de conteo y reversa, cada una con su actor", async () => {
    await como(e.usuarios.COMPRAS);
    const llave = randomUUID();
    await expect(devoluciones.crearDevolucion(ESTADO_INICIAL, formularioDevolucion(llave))).rejects.toThrow(/^REDIRECT \/devoluciones\//);
    const d = await prisma.movimiento.findUniqueOrThrow({ where: { llaveIdempotencia: llave } });
    await expect(devoluciones.confirmarDevolucion(d.id)).resolves.toEqual({ ok: true });

    const h = await hojaAbierta();
    await sembrarCapa(prisma, e, { bodegaId: h.bodegaId, articuloId, cantidad: 4, fechaOriginal: "2026-08-01", costo: null });
    await expect(conteos.actualizarHoja(h.id, 1)).resolves.toEqual({ ok: true });
    const fd = new FormData();
    fd.set("revision", "2");
    fd.set("partidas.0.articuloId", articuloId);
    fd.set("partidas.0.cantidadContada", "3");
    // La existencia esperada nunca se toma del navegador.
    fd.set("partidas.0.cantidadEsperada", "3");
    await expect(conteos.guardarConteo(h.id, ESTADO_INICIAL, fd)).resolves.toEqual({ errores: {}, mensaje: null, revision: 3 });
    await expect(prisma.renglonConteo.findFirstOrThrow({ where: { hojaId: h.id } })).resolves.toMatchObject({ cantidadEsperada: 4, cantidadContada: 3 });
    await expect(conteos.confirmarConteo(h.id, 2)).resolves.toMatchObject({ ok: false });
    await expect(conteos.confirmarConteo(h.id, 3)).resolves.toEqual({ ok: true });
    await expect(prisma.hojaConteo.findUniqueOrThrow({ where: { id: h.id } })).resolves.toMatchObject({ estatus: "CONFIRMADO", creadoPorId: e.usuarios.COMPRAS.id, confirmadoPorId: e.usuarios.COMPRAS.id });

    await como(e.usuarios.SUPERADMIN);
    const r = await reversas.revertirMovimiento(d.id, "Devolución capturada dos veces");
    expect(r).toMatchObject({ ok: true, href: expect.stringMatching(/^\/ajustes\//) });
    const reversa = await prisma.movimiento.findUniqueOrThrow({ where: { cancelaAId: d.id } });
    expect(reversa).toMatchObject({ creadoPorId: e.usuarios.SUPERADMIN.id, confirmadoPorId: e.usuarios.SUPERADMIN.id, motivo: "Devolución capturada dos veces" });

    // La reversa de un traspaso no tiene página propia en la lista: se vuelve al traspaso revertido.
    const t = await traspasoConfirmado();
    await como(e.usuarios.SUPERADMIN);
    await expect(reversas.revertirMovimiento(t, "Destino equivocado")).resolves.toEqual({ ok: true, href: `/traspasos/${t}` });
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { cancelaAId: t } })).resolves.toMatchObject({ tipo: "TRASPASO", motivo: "Destino equivocado" });
  });
});

describe("acceso directo sin permiso", () => {
  /** Todas las acciones de la fase 7 con la sesión que haya; nada cambia en la base. */
  async function todasNegadas(etiqueta: string) {
    const [borrador, confirmado, hoja] = [await traspasoBorrador(), await traspasoConfirmado(), await hojaAbierta()];
    const antes = await Promise.all([borrador, confirmado].map(leer));
    const hojaAntes = await prisma.hojaConteo.findUniqueOrThrow({ where: { id: hoja.id } });
    return async () => {
      await expect(traspasos.crearTraspaso(ESTADO_INICIAL, formularioTraspaso(randomUUID())), etiqueta).resolves.toEqual(NEGADO_FORMULARIO);
      await expect(traspasos.guardarTraspaso(borrador, ESTADO_INICIAL, formularioTraspaso(randomUUID())), etiqueta).resolves.toEqual(NEGADO_FORMULARIO);
      await expect(traspasos.descartarTraspaso(borrador, "No"), etiqueta).resolves.toEqual(NEGADO);
      await expect(traspasos.confirmarTraspaso(borrador), etiqueta).resolves.toEqual(NEGADO);
      await expect(devoluciones.crearDevolucion(ESTADO_INICIAL, formularioDevolucion(randomUUID())), etiqueta).resolves.toEqual(NEGADO_FORMULARIO);
      await expect(devoluciones.confirmarDevolucion(borrador), etiqueta).resolves.toEqual(NEGADO);
      await expect(conteos.abrirHoja(ESTADO_INICIAL, formularioHoja(randomUUID(), e.bodegaId)), etiqueta).resolves.toEqual(NEGADO_FORMULARIO);
      await expect(conteos.guardarConteo(hoja.id, ESTADO_INICIAL, new FormData()), etiqueta).resolves.toEqual(NEGADO_FORMULARIO);
      await expect(conteos.actualizarHoja(hoja.id, 1), etiqueta).resolves.toEqual(NEGADO);
      await expect(conteos.confirmarConteo(hoja.id, 1), etiqueta).resolves.toEqual(NEGADO);
      await expect(conteos.descartarHoja(hoja.id, "No"), etiqueta).resolves.toEqual(NEGADO);
      await expect(reversas.revertirMovimiento(confirmado, "No"), etiqueta).resolves.toEqual(NEGADO);
      // La búsqueda del formulario solo lee, pero tampoco responde sin sesión ni permiso de captura.
      await expect(consultasDeDevolucion.buscarSalidas({ estacionId: e.estacionId, texto: "", pagina: 1 }), etiqueta).resolves.toMatchObject({ salidas: [], aviso: SIN_PERMISO });
      await expect(Promise.all([borrador, confirmado].map(leer)), etiqueta).resolves.toEqual(antes);
      await expect(prisma.hojaConteo.findUniqueOrThrow({ where: { id: hoja.id } }), etiqueta).resolves.toEqual(hojaAntes);
      await expect(prisma.movimiento.count({ where: { cancelaAId: confirmado } }), etiqueta).resolves.toBe(0);
    };
  }

  it("sin sesión o con una identidad que no existe en el sistema", async () => {
    const probar = await todasNegadas("sin sesión");
    for (const userId of [null, "user_desconocido"]) {
      sesion.userId = userId;
      await probar();
    }
  });

  it("un usuario dado de baja, de cualquier rol", async () => {
    const probar = await todasNegadas("inactivo");
    for (const rol of ["SUPERADMIN", "COMPRAS", "JEFE"] as const) {
      const baja = await prisma.usuario.create({
        data: { clerkUserId: `user_baja_${randomUUID().slice(0, 8)}`, correo: `baja.${randomUUID().slice(0, 8)}@prueba.test`, rol, puedeAutorizar: true, activo: false },
      });
      await como(baja);
      await probar();
    }
  });

  it("Jefe, aun con la bandera de autorizar, solo lee", async () => {
    const probar = await todasNegadas("jefe");
    await como(e.autorizadores.JEFE);
    await probar();
  });

  it("Compras captura y confirma, pero no revierte", async () => {
    const id = await traspasoConfirmado();
    await como(e.autorizadores.COMPRAS);
    await expect(reversas.revertirMovimiento(id, "No")).resolves.toEqual(NEGADO);
    await expect(prisma.movimiento.count({ where: { cancelaAId: id } })).resolves.toBe(0);
  });

  it("sin sesión o sin permiso, el FormData ni siquiera se abre", async () => {
    for (const usuario of [null, e.usuarios.JEFE]) {
      await como(usuario);
      for (const [fd, accion] of [
        [formularioTraspaso(randomUUID()), (f: FormData) => traspasos.crearTraspaso(ESTADO_INICIAL, f)],
        [formularioDevolucion(randomUUID()), (f: FormData) => devoluciones.crearDevolucion(ESTADO_INICIAL, f)],
        [formularioHoja(randomUUID(), e.bodegaId), (f: FormData) => conteos.abrirHoja(ESTADO_INICIAL, f)],
      ] as const) {
        const espia = formDataEspia(fd);
        await expect(accion(espia.formData)).resolves.toEqual(NEGADO_FORMULARIO);
        expect(espia.lecturas).toEqual([]);
      }
    }
    await como(e.usuarios.COMPRAS);
    const espia = formDataEspia(formularioTraspaso(randomUUID()));
    await expect(traspasos.crearTraspaso(ESTADO_INICIAL, espia.formData)).rejects.toThrow(/^REDIRECT/);
    expect(espia.lecturas).not.toEqual([]);
  });
});

describe("la puerta vuelve a exigir el permiso antes de confirmar", () => {
  it("el rol cambiado a Jefe mientras se confirma revierte el traspaso entero", async () => {
    const id = await traspasoBorrador();
    const u = await prisma.usuario.create({
      data: { clerkUserId: `user_rev_${randomUUID().slice(0, 8)}`, correo: `rev.${randomUUID().slice(0, 8)}@prueba.test`, rol: "COMPRAS" },
    });
    await como(u);
    const antes = (await prisma.existencia.findUniqueOrThrow({ where: { bodegaId_articuloId: { bodegaId: e.bodegaId, articuloId } } })).cantidad;
    const [candado, observador] = [await conexion(URL_PRUEBAS), await conexion(URL_PRUEBAS)];
    try {
      await candado.query("BEGIN");
      await candado.query(`SELECT id FROM "Movimiento" WHERE id = $1 FOR UPDATE`, [id]);
      const accion = traspasos.confirmarTraspaso(id);
      await bloqueadaPor(observador, candado.pid);
      await prisma.usuario.update({ where: { id: u.id }, data: { rol: "JEFE" } });
      await candado.query("ROLLBACK");
      await expect(accion).resolves.toEqual(NEGADO);
    } finally {
      await candado.end();
      await observador.end();
    }
    await expect(leer(id)).resolves.toMatchObject({ estatus: "BORRADOR", folio: null });
    await expect(prisma.existencia.findUniqueOrThrow({ where: { bodegaId_articuloId: { bodegaId: e.bodegaId, articuloId } } })).resolves.toMatchObject({ cantidad: antes });
  });
});

describe("lo que llega manipulado no toca la base", () => {
  it("identificadores, motivos y revisiones que no pasan el esquema", async () => {
    const id = await traspasoBorrador();
    await como(e.usuarios.SUPERADMIN);
    for (const falso of ["T-000001", "", "' OR 1=1 --", 123, null, { id }]) {
      await expect(traspasos.confirmarTraspaso(falso as string)).resolves.toEqual({ ok: false, mensaje: "El traspaso no existe." });
      await expect(reversas.revertirMovimiento(falso as string, "motivo")).resolves.toEqual({ ok: false, mensaje: "El movimiento no existe." });
      await expect(conteos.confirmarConteo(falso as string, 1)).resolves.toEqual({ ok: false, mensaje: "La hoja de conteo no existe." });
    }
    await expect(traspasos.descartarTraspaso(id, "   ")).resolves.toEqual({ ok: false, mensaje: "Di por qué se descarta" });
    await expect(reversas.revertirMovimiento(id, "x".repeat(301))).resolves.toEqual({ ok: false, mensaje: "Máximo 300 caracteres" });
    await expect(conteos.confirmarConteo(randomUUID(), -1)).resolves.toMatchObject({ ok: false });
    await expect(leer(id)).resolves.toMatchObject({ estatus: "BORRADOR" });

    const fd = formularioTraspaso(randomUUID());
    fd.set("encabezado.bodegaDestinoId", e.bodegaId);
    fd.set("partidas.0.cantidadCapturada", "1.5");
    const r = await traspasos.crearTraspaso(ESTADO_INICIAL, fd);
    expect(r.mensaje).toBe("Revisa los campos marcados.");
    expect(Object.keys(r.errores).sort()).toEqual(["encabezado.bodegaDestinoId", "partidas.0.cantidadCapturada"]);
    await expect(traspasos.crearTraspaso(ESTADO_INICIAL, formularioTraspaso("no-soy-uuid"))).resolves.toMatchObject({
      mensaje: "El formulario ya no es válido. Recarga la página y vuelve a capturar.",
    });
  });

  it("una devolución ligada a una salida que el navegador manda a otra bodega no se guarda", async () => {
    const u = e.usuarios.COMPRAS;
    const jefe = e.autorizadores.JEFE;
    const { id: s } = await comoEnServicio(prisma, u, "salidas:capturar", (tx) =>
      solicitarSalida(tx, u, randomUUID(), {
        encabezado: { bodegaOrigenId: e.bodegaId, estacionId: e.estacionId, esPrestamo: true },
        partidas: [{ articuloId, presentacion: "UNIDAD", cantidadCapturada: 2 }],
      }),
    );
    await comoEnServicio(prisma, jefe, "salidas:autorizar", (tx) => autorizarSalida(tx, jefe, s));
    await comoEnServicio(prisma, u, "salidas:retirar", (tx) => retirarSalida(tx, u, s, "Mensajero"));

    // El selector la encuentra con su saldo, con el usuario de ejecución y la sesión de Compras.
    await como(u);
    const { folio } = await leer(s);
    const r = await consultasDeDevolucion.buscarSalidas({ estacionId: e.estacionId, texto: folio, pagina: 1 });
    expect(r.salidas).toEqual([expect.objectContaining({ id: s, bodega: expect.objectContaining({ id: e.bodegaId }), pendientes: { [articuloId]: 2 } })]);
    await expect(consultasDeDevolucion.buscarSalidas({ estacionId: e.estacionId, texto: { toString: () => folio }, pagina: 1 })).resolves.toMatchObject({ salidas: [], aviso: expect.stringMatching(/^Elige la estación/) });

    const fd = formularioDevolucion(randomUUID());
    fd.set("encabezado.salidaId", s);
    fd.set("encabezado.bodegaDestinoId", e.otraBodegaId);
    await expect(devoluciones.crearDevolucion(ESTADO_INICIAL, fd)).resolves.toMatchObject({ mensaje: expect.stringContaining("regresa a la bodega de la que salió") });
    await expect(prisma.movimiento.count({ where: { llaveIdempotencia: fd.get("llaveIdempotencia") as string } })).resolves.toBe(0);
  });

  it("un id de otro tipo responde como inexistente y los errores de dominio salen tal cual", async () => {
    await como(e.usuarios.COMPRAS);
    const hoja = await hojaAbierta();
    await expect(traspasos.confirmarTraspaso(hoja.id)).resolves.toEqual({ ok: false, mensaje: "El traspaso no existe." });
    const id = await traspasoConfirmado();
    await expect(devoluciones.confirmarDevolucion(id)).resolves.toEqual({ ok: false, mensaje: "La devolución no existe." });
    await como(e.usuarios.SUPERADMIN);
    const borrador = await traspasoBorrador();
    await como(e.usuarios.SUPERADMIN);
    await expect(reversas.revertirMovimiento(borrador, "No va")).resolves.toEqual({
      ok: false,
      mensaje: "El traspaso no afectó el inventario: un borrador se descarta, no se revierte.",
    });
  });

  it("un descuadre que detecta el trigger diferido llega con el texto propio, sin guardar nada", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const capa = await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: x.id, cantidad: 5, fechaOriginal: "2026-08-01", costo: null });
    // La capa ya no concilia con sus consumos; existencia y suma de capas sí, así que el servicio llega al COMMIT.
    await sinDefensas(prisma, (tx) => tx.capaCosto.update({ where: { id: capa.id }, data: { cantidadInicial: 9 } }));
    const fd = formularioTraspaso(randomUUID());
    fd.set("partidas.0.articuloId", x.id);
    await como(e.usuarios.COMPRAS);
    await expect(traspasos.crearTraspaso(ESTADO_INICIAL, fd)).rejects.toThrow(/^REDIRECT/);
    const { id } = await prisma.movimiento.findUniqueOrThrow({ where: { llaveIdempotencia: fd.get("llaveIdempotencia") as string } });
    await expect(traspasos.confirmarTraspaso(id)).resolves.toEqual({ ok: false, mensaje: `Una capa de costo de ${x.clave} no concilia con sus consumos; no se guardó nada.` });
    await expect(leer(id)).resolves.toMatchObject({ estatus: "BORRADOR", folio: null });
    await expect(prisma.capaCosto.findUniqueOrThrow({ where: { id: capa.id } })).resolves.toMatchObject({ cantidadRestante: 5 });
  });
});
