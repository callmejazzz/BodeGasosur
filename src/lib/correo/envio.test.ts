/*
  Envío, conciliación y cierre (contrato fase 9, §3.5 y §3.6) contra PostgreSQL
  real y un sustituto de Resend que respeta su idempotencia.

  · Pruebas 3 y 4, la parte de Resend; 5, 6, 7, 9 y 12.
  · El 409 de otro cuerpo, el plazo de la corrida y el día sano.
*/

import type { EstadoLote } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { cuerpoDelEvento, peticionFirmada } from "../../../pruebas/firma-resend";
import { resendSimulado } from "../../../pruebas/resend-simulado";
import { aLas, ENTORNO_DE_CORREO, fechasDesde, registrosDelDia, sembrarBajoMinimo, usuarioConAlerta, vencerArriendos } from "../../../pruebas/semilla-correo";
import { aFechaDeBase } from "../fechas";
import { plazoDesde, type Plazo } from "./plazos";
import type { EnviadorDeLotes } from "./resend";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
Object.assign(process.env, ENTORNO_DE_CORREO);
const { ejecutarCorrida, motivosDelDia } = await import("./corrida");
const { clasificarRespuesta } = await import("./resend");
const { conciliarAceptaciones } = await import("./conciliacion");
const { cerrarDiasAnteriores, NO_SE_ENVIO_A_TIEMPO, TANDA_DE_CIERRE } = await import("./envio");
const { evaluarYReservar } = await import("./reserva");
const { atenderWebhookDeResend } = await import("./webhook");
const { escrituraDeSistema } = await import("../db");

const prisma = crearCliente(URL_PRUEBAS);
const usuarioDeEjecucion = new URL(inject("urlEjecucionPruebas")).username;
const nuevaFecha = fechasDesde(2035);
const fechaAtrasada = fechasDesde(2033);
let unidadId: string;
let u: { id: string; correo: string };

beforeAll(async () => {
  ({ unidadId } = await sembrarBajoMinimo(prisma));
  u = await usuarioConAlerta(prisma);
  // Dos destinatarios como mínimo, para que un lote tenga huecos
  await usuarioConAlerta(prisma);
});
afterAll(() => prisma.$disconnect());
afterEach(() => {
  vi.restoreAllMocks();
});

const corrida = (fecha: string, hora: string, enviar: EnviadorDeLotes, extra: { esperaMs?: number; plazo?: Plazo; ahora?: () => Date } = {}) =>
  ejecutarCorrida({ ahora: extra.ahora ?? (() => aLas(fecha, hora)), plazo: extra.plazo ?? plazoDesde(), enviar, esperaMs: extra.esperaMs });
const lotesDelDia = (fecha: string) => prisma.loteCorreos.findMany({ where: { fecha: aFechaDeBase(fecha) }, orderBy: { numero: "asc" } });
const webhook = (cuerpo: unknown) => atenderWebhookDeResend(peticionFirmada(cuerpo));
const silenciarErrores = () => vi.spyOn(console, "error").mockImplementation(() => undefined);
const estados = (filas: { estado: string }[]) => [...new Set(filas.map((f) => f.estado))];
const lineas = (espia: ReturnType<typeof silenciarErrores>) => espia.mock.calls.map((c) => c.join(" "));

/** Más de 100 destinatarios mientras corre `fn`: el día tiene al menos dos lotes. */
async function conDosLotes(fn: () => Promise<void>) {
  const extra = Array.from({ length: 101 }, () => `user_correo_lote_${randomUUID().slice(0, 12)}`);
  await prisma.usuario.createMany({ data: extra.map((c) => ({ clerkUserId: c, correo: `${c}@prueba.test`, rol: "JEFE" as const, alertasCorreo: true })) });
  try {
    await fn();
  } finally {
    await prisma.usuario.updateMany({ where: { clerkUserId: { in: extra } }, data: { alertasCorreo: false } });
  }
}

async function sesionesOciosas(): Promise<number> {
  const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = ${usuarioDeEjecucion} AND state LIKE 'idle in transaction%'`;
  return n;
}

async function cifras(fecha: string) {
  const where = { fecha: aFechaDeBase(fecha) };
  return {
    evaluaciones: await prisma.evaluacionCorreos.count({ where }),
    lotes: await prisma.loteCorreos.count({ where }),
    registros: await prisma.registroCorreos.count({ where }),
  };
}

describe("clasificación de la respuesta de Resend", () => {
  it("clasifica por código y tipo: solo un rechazo de datos es definitivo; llave, remitente, cuota o lo desconocido son incidentes", () => {
    expect(clasificarRespuesta({ data: [{ id: "re_1" }, { id: "re_2" }] }, null)).toEqual({ tipo: "aceptado", ids: ["re_1", "re_2"] });
    expect(clasificarRespuesta({ data: [] }, null)).toMatchObject({ tipo: "pasajero", codigo: "200 sin_identificadores" });
    const casos: [number | null, string, string][] = [
      [null, "application_error", "pasajero"],
      [500, "internal_server_error", "pasajero"],
      [503, "desconocido", "pasajero"],
      [409, "concurrent_idempotent_requests", "pasajero"],
      [429, "rate_limit_exceeded", "pasajero"],
      [409, "invalid_idempotent_request", "cuerpo-distinto"],
      [400, "validation_error", "rechazado"],
      [400, "invalid_idempotency_key", "rechazado"],
      [422, "validation_error", "rechazado"],
      [422, "invalid_parameter", "rechazado"],
      [422, "missing_required_field", "rechazado"],
      [401, "missing_api_key", "AUTENTICACION"],
      [401, "restricted_api_key", "AUTENTICACION"],
      [403, "invalid_api_key", "AUTENTICACION"],
      [403, "validation_error", "REMITENTE"],
      [422, "invalid_from_address", "REMITENTE"],
      [429, "daily_quota_exceeded", "CUOTA"],
      [429, "monthly_quota_exceeded", "CUOTA"],
      [404, "not_found", "OPERATIVO"],
      [451, "security_error", "OPERATIVO"],
      [400, "algo_nuevo", "OPERATIVO"],
      [409, "otro_conflicto", "OPERATIVO"],
    ];
    for (const [statusCode, name, esperado] of casos) {
      const r = clasificarRespuesta(null, { statusCode, name, message: "No se pudo con persona@ejemplo.test: buzón lleno" });
      expect(r.tipo === "incidente" ? r.incidente : r.tipo, `${statusCode} ${name}`).toBe(esperado);
      if (r.tipo === "aceptado") continue;
      expect(r.codigo).toBe(`${statusCode ?? "sin_estado"} ${name}`);
      expect(r.motivo).toMatch(new RegExp(`\\(${r.codigo}\\)$`));
      expect(r.motivo).not.toMatch(/@|buzón/);
    }
    // Un nombre que no tiene forma de código no se copia
    expect(clasificarRespuesta(null, { statusCode: 422, name: "Malo <persona@ejemplo.test>" })).toMatchObject({ tipo: "incidente", incidente: "OPERATIVO", codigo: "422 desconocido" });
  });

  it("el día está sano solo evaluado y sin pendientes, fallidos, sin confirmar ni incidentes", () => {
    expect(motivosDelDia({ evaluado: true, lotes: { ACEPTADO: 1 }, destinatarios: { ENVIADO: 3 } })).toEqual([]);
    expect(motivosDelDia({ evaluado: false, lotes: {}, destinatarios: {} })).toEqual(["SIN_EVALUACION"]);
    expect(motivosDelDia({ evaluado: true, lotes: { ACEPTADO: 1 }, destinatarios: { ENVIADO: 2, FALLIDO: 1 } })).toEqual(["RECHAZADOS"]);
    expect(motivosDelDia({ evaluado: true, lotes: { PENDIENTE: 1 }, destinatarios: { PENDIENTE: 2 }, incidente: "CUOTA" })).toEqual(["PENDIENTES", "INCIDENTE"]);
    expect(motivosDelDia({ evaluado: true, lotes: { ACEPTADO: 1, RECHAZADO: 1 }, destinatarios: { PENDIENTE: 1, SIN_CONFIRMAR: 1 } })).toEqual([
      "PENDIENTES",
      "RECHAZADOS",
      "SIN_CONFIRMAR",
    ]);
  });
});

describe("envío y conciliación", () => {
  it("una corrida envía cada lote una vez y deja a todos ENVIADO; otra corrida del día no agrega nada (prueba 3)", async () => {
    const fecha = nuevaFecha();
    const resend = resendSimulado();
    const resumen = await corrida(fecha, "08:00", resend.enviar);
    expect(resumen).toMatchObject({ fecha, evaluacion: { evaluadaAhora: true, resultado: "CON_ENVIO" }, diaSano: true, motivos: [], ultimaDeLaVentana: false });

    const registros = await registrosDelDia(prisma, fecha);
    const lotes = await lotesDelDia(fecha);
    expect(estados(registros)).toEqual(["ENVIADO"]);
    expect(lotes.map((l) => [l.estado, l.intentos])).toEqual(lotes.map(() => ["ACEPTADO", 1]));
    expect(Object.values(resend.porLlave())).toEqual(lotes.map(() => 1));

    const propio = registros.find((r) => r.usuarioId === u.id)!;
    const peticion = resend.peticiones.find((p) => p.llave === propio.lote.llave)!;
    expect(peticion.correos[propio.posicion]).toEqual({
      from: propio.lote.remitente,
      to: [u.correo],
      subject: propio.lote.asunto,
      html: propio.lote.html,
      text: propio.lote.texto,
      tags: [{ name: "registro", value: propio.id }],
    });
    expect(propio.resendId).toBe(resend.aceptados.get(propio.lote.llave)!.ids[propio.posicion]);

    const antes = await cifras(fecha);
    await expect(corrida(fecha, "08:15", resend.enviar)).resolves.toMatchObject({ evaluacion: { evaluadaAhora: false }, diaSano: true });
    expect(resend.peticiones).toHaveLength(lotes.length);
    await expect(cifras(fecha)).resolves.toEqual(antes);
  });

  it("dos corridas simultáneas: una evaluación, una petición por llave y una fila por destinatario (prueba 4)", async () => {
    const fecha = nuevaFecha();
    const resend = resendSimulado();
    const corridas = await Promise.all([corrida(fecha, "08:00", resend.enviar), corrida(fecha, "08:00", resend.enviar)]);
    expect(corridas.filter((c) => c.evaluacion.evaluadaAhora)).toHaveLength(1);
    expect(Object.values(resend.porLlave()).every((n) => n === 1)).toBe(true);
    const registros = await registrosDelDia(prisma, fecha);
    expect(new Set(registros.map((r) => r.usuarioId)).size).toBe(registros.length);
    expect(estados(registros)).toEqual(["ENVIADO"]);
    await expect(cifras(fecha)).resolves.toMatchObject({ evaluaciones: 1 });
  });

  it("un 409 concurrente deja el lote PENDIENTE, nunca FALLIDO, y la primera llamada lo concilia (prueba 4)", async () => {
    const fecha = nuevaFecha();
    let dentro = false;
    let durante: { lote: EstadoLote; intentos: number; registros: string[] } | undefined;
    let segunda: Awaited<ReturnType<typeof corrida>> | undefined;
    const resend = resendSimulado({
      aMitad: async () => {
        if (dentro) return;
        dentro = true;
        // Como si la primera llamada llevara más de 5 minutos: otra corrida toma el lote
        await vencerArriendos(prisma, fecha);
        segunda = await corrida(fecha, "08:15", resend.enviar);
        const [lote] = await lotesDelDia(fecha);
        durante = { lote: lote.estado, intentos: lote.intentos, registros: estados(await registrosDelDia(prisma, fecha)) };
      },
    });
    await corrida(fecha, "08:00", resend.enviar);

    expect(durante).toEqual({ lote: "PENDIENTE", intentos: 2, registros: ["PENDIENTE"] });
    expect(segunda).toMatchObject({ diaSano: false, motivos: ["PENDIENTES"] });
    const [lote] = await lotesDelDia(fecha);
    expect(lote.estado).toBe("ACEPTADO");
    expect(resend.porLlave()[lote.llave]).toBe(2);
    expect(estados(await registrosDelDia(prisma, fecha))).toEqual(["ENVIADO"]);
  });

  it("si se pierde la respuesta, el reintento manda el mismo cuerpo byte por byte y recibe los identificadores originales (prueba 5)", async () => {
    const fecha = nuevaFecha();
    let perder = true;
    const resend = resendSimulado({ perderRespuesta: () => perder });
    await expect(corrida(fecha, "08:00", resend.enviar)).rejects.toThrow(/Se perdió la respuesta/);
    const [lote] = await lotesDelDia(fecha);
    expect(lote).toMatchObject({ estado: "PENDIENTE", intentos: 1 });
    expect(estados(await registrosDelDia(prisma, fecha))).toEqual(["PENDIENTE"]);

    // A mitad cambian las existencias y alguien enciende su alerta: el cuerpo guardado no
    await prisma.articulo.create({ data: { descripcion: `Bajó a mitad ${randomUUID().slice(0, 8)}`, unidadId, stockMinimo: 9 } });
    const tarde = await usuarioConAlerta(prisma);
    perder = false;

    // Antes de que venza el arriendo nadie lo toca
    await corrida(fecha, "08:01", resend.enviar);
    expect(resend.peticiones).toHaveLength(1);

    await vencerArriendos(prisma, fecha);
    await expect(corrida(fecha, "08:15", resend.enviar)).resolves.toMatchObject({ diaSano: true });
    const registros = await registrosDelDia(prisma, fecha);
    expect(estados(registros)).toEqual(["ENVIADO"]);
    expect(registros.map((r) => r.usuarioId)).not.toContain(tarde.id);
    expect(registros.map((r) => r.resendId)).toEqual(resend.aceptados.get(lote.llave)!.ids);
    expect(resend.peticiones.map((p) => p.llave)).toEqual([lote.llave, lote.llave]);
    expect(new Set(resend.peticiones.map((p) => p.huella)).size).toBe(1);
    await prisma.usuario.update({ where: { id: tarde.id }, data: { alertasCorreo: false } });
  });

  it("una respuesta lenta se aborta sin transacciones abiertas y se retoma con la misma llave al vencer el arriendo (prueba 6)", async () => {
    const fecha = nuevaFecha();
    let ociosas = -1;
    const resend = resendSimulado({ demoraMs: 500, aMitad: async () => void (ociosas = await sesionesOciosas()) });
    const primera = await corrida(fecha, "08:00", resend.enviar, { esperaMs: 100 });
    expect(ociosas).toBe(0);
    expect(primera).toMatchObject({ diaSano: false, motivos: ["PENDIENTES"] });
    const [lote] = await lotesDelDia(fecha);
    expect(lote).toMatchObject({ estado: "PENDIENTE", intentos: 1 });

    await corrida(fecha, "08:02", resend.enviar, { esperaMs: 100 });
    expect(resend.peticiones).toHaveLength(1);

    await vencerArriendos(prisma, fecha);
    await expect(corrida(fecha, "08:15", resend.enviar, { esperaMs: 100 })).resolves.toMatchObject({ diaSano: true });
    expect(resend.peticiones.map((p) => p.llave)).toEqual([lote.llave, lote.llave]);
    expect(estados(await registrosDelDia(prisma, fecha))).toEqual(["ENVIADO"]);
  });

  it("email.sent antes de la respuesta, o después, deja el mismo estado; repetir no cambia nada (prueba 7)", async () => {
    const enviadoAMitad = nuevaFecha();
    const resend = resendSimulado({
      aMitad: async (correos, _llave, ids) => {
        const i = correos.findIndex((c) => c.to[0] === u.correo);
        if (i >= 0) expect((await webhook(cuerpoDelEvento({ tipo: "email.sent", emailId: ids[i], para: correos[i].to, registro: correos[i].tags[0].value }))).status).toBe(200);
      },
    });
    await corrida(enviadoAMitad, "08:00", resend.enviar);
    const propio = (await registrosDelDia(prisma, enviadoAMitad)).find((r) => r.usuarioId === u.id)!;
    expect(propio).toMatchObject({ estado: "ENVIADO", resendId: resend.aceptados.get(propio.lote.llave)!.ids[propio.posicion] });
    expect(propio.lote.estado).toBe("ACEPTADO");
    await expect(prisma.eventoCorreo.count({ where: { registroId: propio.id } })).resolves.toBe(1);

    // Repetir la conciliación de la respuesta o del webhook no cambia nada
    await escrituraDeSistema("resumen-diario", (db) => conciliarAceptaciones(db, propio.loteId, [{ registroId: propio.id, resendId: propio.resendId! }]));
    await webhook(cuerpoDelEvento({ tipo: "email.sent", emailId: propio.resendId, para: [u.correo], registro: propio.id }));
    await expect(prisma.registroCorreos.findUniqueOrThrow({ where: { id: propio.id } })).resolves.toMatchObject({ estado: "ENVIADO", resendId: propio.resendId });

    // En el orden inverso queda igual
    const despues = nuevaFecha();
    const normal = resendSimulado();
    await corrida(despues, "08:00", normal.enviar);
    const otro = (await registrosDelDia(prisma, despues)).find((r) => r.usuarioId === u.id)!;
    await webhook(cuerpoDelEvento({ tipo: "email.sent", emailId: otro.resendId, para: [u.correo], registro: otro.id }));
    await expect(prisma.registroCorreos.findUniqueOrThrow({ where: { id: otro.id } })).resolves.toMatchObject({ estado: "ENVIADO", resendId: otro.resendId });
    await expect(prisma.loteCorreos.findUniqueOrThrow({ where: { id: otro.loteId } })).resolves.toMatchObject({ estado: "ACEPTADO" });
  });

  it("si la respuesta trae otro identificador que el que dejó el webhook, no lo sobrescribe y deja una línea de error (prueba 7)", async () => {
    const fecha = nuevaFecha();
    const errores = silenciarErrores();
    const resend = resendSimulado({
      aMitad: async (correos) => {
        const i = correos.findIndex((c) => c.to[0] === u.correo);
        if (i >= 0) await webhook(cuerpoDelEvento({ tipo: "email.sent", emailId: "re_del_webhook", para: correos[i].to, registro: correos[i].tags[0].value }));
      },
    });
    await corrida(fecha, "08:00", resend.enviar);
    const propio = (await registrosDelDia(prisma, fecha)).find((r) => r.usuarioId === u.id)!;
    expect(propio).toMatchObject({ estado: "ENVIADO", resendId: "re_del_webhook" });
    const lineas = errores.mock.calls.map((c) => String(c[0]));
    expect(lineas).toContainEqual(expect.stringContaining(`otro identificador para el registro ${propio.id}`));
    expect(lineas.some((l) => l.includes("@"))).toBe(false);
  });

  it("los lotes de días anteriores se cierran sin reenviarse, y un evento posterior todavía los concilia (prueba 9)", async () => {
    const [sinIntentos, conIntentos, conHuecos, hoy] = [nuevaFecha(), nuevaFecha(), nuevaFecha(), nuevaFecha()];
    await evaluarYReservar(sinIntentos);
    await evaluarYReservar(conIntentos);
    await prisma.$executeRaw`UPDATE "LoteCorreos" SET intentos = 1, "ultimoIntentoEn" = now(), "arrendadoHasta" = now() WHERE fecha = ${conIntentos}::date`;
    await evaluarYReservar(conHuecos);
    const [primero] = await registrosDelDia(prisma, conHuecos);
    await escrituraDeSistema("resend-webhook", (db) => conciliarAceptaciones(db, primero.loteId, [{ registroId: primero.id, resendId: `re_${randomUUID()}` }]));

    const resend = resendSimulado();
    await corrida(hoy, "08:00", resend.enviar);
    expect(resend.peticiones.some((p) => [sinIntentos, conIntentos, conHuecos].some((f) => p.llave.startsWith(`resumen-${f}-`)))).toBe(false);

    const vencidos = await registrosDelDia(prisma, sinIntentos);
    expect(estados(await lotesDelDia(sinIntentos))).toEqual(["VENCIDO"]);
    expect(vencidos.every((r) => r.estado === "FALLIDO" && r.motivo === NO_SE_ENVIO_A_TIEMPO)).toBe(true);
    expect(estados(await lotesDelDia(conIntentos))).toEqual(["SIN_CONFIRMAR"]);
    expect(estados(await registrosDelDia(prisma, conIntentos))).toEqual(["SIN_CONFIRMAR"]);
    expect(estados(await lotesDelDia(conHuecos))).toEqual(["ACEPTADO"]);
    const huecos = await registrosDelDia(prisma, conHuecos);
    expect(huecos[0]).toMatchObject({ id: primero.id, estado: "ENVIADO" });
    expect(estados(huecos.slice(1))).toEqual(["SIN_CONFIRMAR"]);

    const [sinConfirmar] = await registrosDelDia(prisma, conIntentos);
    await webhook(cuerpoDelEvento({ tipo: "email.delivered", para: [sinConfirmar.correo], registro: sinConfirmar.id }));
    await expect(prisma.registroCorreos.findUniqueOrThrow({ where: { id: sinConfirmar.id } })).resolves.toMatchObject({ estado: "ENVIADO" });
    expect(estados(await lotesDelDia(conIntentos))).toEqual(["ACEPTADO"]);
  });

  it("un rechazo de los datos deja FALLIDO a sus integrantes con un motivo propio y no impide los demás lotes (prueba 12)", async () => {
    await conDosLotes(async () => {
      const fecha = nuevaFecha();
      const errores = silenciarErrores();
      const resend = resendSimulado({
        errorPara: (llave) => (llave === `resumen-${fecha}-1` ? { statusCode: 422, name: "validation_error", message: "Invalid `to` field: persona@ejemplo.test" } : undefined),
      });
      await expect(corrida(fecha, "08:00", resend.enviar)).resolves.toMatchObject({ diaSano: false, motivos: ["RECHAZADOS"], incidente: null });
      const motivo = "Resend rechazó los datos de la petición (422 validation_error)";
      const [rechazado, ...otros] = await lotesDelDia(fecha);
      expect(rechazado).toMatchObject({ estado: "RECHAZADO", motivo });
      expect(otros.length).toBeGreaterThan(0);
      expect(estados(otros)).toEqual(["ACEPTADO"]);
      const registros = await registrosDelDia(prisma, fecha);
      expect(registros.filter((r) => r.loteId === rechazado.id).every((r) => r.estado === "FALLIDO" && r.motivo === motivo)).toBe(true);
      expect(estados(registros.filter((r) => r.loteId !== rechazado.id))).toEqual(["ENVIADO"]);
      expect(lineas(errores)).toContainEqual(`[correo] ${rechazado.llave}: rechazo definitivo (422 validation_error)`);
      expect(lineas(errores).some((l) => l.includes("@"))).toBe(false);

      await vencerArriendos(prisma, fecha);
      await corrida(fecha, "08:15", resend.enviar);
      expect(resend.porLlave()[rechazado.llave]).toBe(1);
    });
  });

  it("un rechazo después de que un evento aceptó el lote no pisa el ENVIADO, deja a los demás SIN_CONFIRMAR y el día no queda sano (prueba 12)", async () => {
    const fecha = nuevaFecha();
    silenciarErrores();
    const resend = resendSimulado({
      errorPara: () => ({ statusCode: 422, name: "invalid_parameter" }),
      aMitad: async (correos, _llave, ids) => {
        const i = correos.findIndex((c) => c.to[0] === u.correo);
        if (i >= 0) await webhook(cuerpoDelEvento({ tipo: "email.delivered", emailId: ids[i], para: correos[i].to, registro: correos[i].tags[0].value }));
      },
    });
    await expect(corrida(fecha, "08:00", resend.enviar)).resolves.toMatchObject({ diaSano: false, motivos: ["SIN_CONFIRMAR"] });
    const registros = await registrosDelDia(prisma, fecha);
    const propio = registros.find((r) => r.usuarioId === u.id)!;
    expect(propio.estado).toBe("ENVIADO");
    expect(propio.lote.estado).toBe("ACEPTADO");
    const demas = registros.filter((r) => r.loteId === propio.loteId && r.id !== propio.id);
    expect(demas.length).toBeGreaterThan(0);
    expect(estados(demas)).toEqual(["SIN_CONFIRMAR"]);

    // Sus huecos ya no se vuelven a pedir
    await vencerArriendos(prisma, fecha);
    await corrida(fecha, "08:15", resend.enviar);
    expect(resend.porLlave()[propio.lote.llave]).toBe(1);
  });

  it("una llave rechazada es un incidente: nadie queda FALLIDO, la corrida se detiene y se envía al corregirla", async () => {
    await conDosLotes(async () => {
      const fecha = nuevaFecha();
      const errores = silenciarErrores();
      const revocada = resendSimulado({ errorPara: () => ({ statusCode: 401, name: "restricted_api_key", message: "Llave restringida; avisa a admin@ejemplo.test" }) });
      const resumen = await corrida(fecha, "08:00", revocada.enviar);
      expect(resumen).toMatchObject({ diaSano: false, incidente: "AUTENTICACION", detenidaPor: "INCIDENTE", motivos: ["PENDIENTES", "INCIDENTE"] });
      expect(resumen.lotesSinIniciar).toBeGreaterThan(0);
      expect(revocada.peticiones).toHaveLength(1);

      const lotes = await lotesDelDia(fecha);
      expect(estados(lotes)).toEqual(["PENDIENTE"]);
      expect(lotes[0].motivo).toBe("Resend rechazó la llave de la API (401 restricted_api_key)");
      expect(estados(await registrosDelDia(prisma, fecha))).toEqual(["PENDIENTE"]);
      expect(lineas(errores)).toContainEqual(`[correo] ${lotes[0].llave}: incidente AUTENTICACION (401 restricted_api_key); el lote sigue pendiente`);
      expect(lineas(errores).some((l) => l.includes("@"))).toBe(false);

      // Se corrige la llave dentro de la ventana
      await vencerArriendos(prisma, fecha);
      await expect(corrida(fecha, "08:15", resendSimulado().enviar)).resolves.toMatchObject({ diaSano: true, incidente: null, detenidaPor: null });
      expect(estados(await registrosDelDia(prisma, fecha))).toEqual(["ENVIADO"]);
    });
  });

  it("un 409 de otro cuerpo deja el lote SIN_CONFIRMAR con una línea de error y no se reenvía", async () => {
    const fecha = nuevaFecha();
    const errores = silenciarErrores();
    const resend = resendSimulado();
    resend.aceptados.set(`resumen-${fecha}-1`, { huella: "otro cuerpo", ids: [] });
    await expect(corrida(fecha, "08:00", resend.enviar)).resolves.toMatchObject({ diaSano: false, motivos: ["SIN_CONFIRMAR"] });
    const [lote] = await lotesDelDia(fecha);
    expect(lote).toMatchObject({ estado: "SIN_CONFIRMAR", motivo: "Resend ya tenía otro cuerpo con la misma llave (409 invalid_idempotent_request)" });
    expect(estados(await registrosDelDia(prisma, fecha))).toEqual(["SIN_CONFIRMAR"]);
    expect(lineas(errores)).toContainEqual(expect.stringContaining("otro cuerpo con la misma llave"));

    await vencerArriendos(prisma, fecha);
    await corrida(fecha, "08:15", resend.enviar);
    expect(resend.porLlave()[lote.llave]).toBe(1);
  });
});

describe("la corrida", () => {
  it("con el plazo justo evalúa pero no empieza un lote que no cabe; sin plazo para evaluar, no evalúa", async () => {
    const fecha = nuevaFecha();
    const resend = resendSimulado();
    const justo = await corrida(fecha, "08:00", resend.enviar, { plazo: { restante: () => 40_000 } });
    expect(justo).toMatchObject({ evaluacion: { evaluadaAhora: true }, detenidaPor: "PLAZO", lotesSinIniciar: 1, diaSano: false, motivos: ["PENDIENTES"] });
    expect(resend.peticiones).toHaveLength(0);
    expect((await lotesDelDia(fecha)).map((l) => [l.estado, l.intentos])).toEqual([["PENDIENTE", 0]]);
    await expect(corrida(fecha, "08:15", resend.enviar)).resolves.toMatchObject({ diaSano: true, detenidaPor: null });

    const sinEvaluar = nuevaFecha();
    const corto = await corrida(sinEvaluar, "08:00", resend.enviar, { plazo: { restante: () => 20_000 } });
    expect(corto).toMatchObject({ evaluacion: { evaluadaAhora: false, resultado: null }, detenidaPor: "PLAZO", motivos: ["SIN_EVALUACION"] });
    await expect(cifras(sinEvaluar)).resolves.toEqual({ evaluaciones: 0, lotes: 0, registros: 0 });
    // Para que el aviso del día anterior no salga en las pruebas siguientes
    await corrida(sinEvaluar, "08:15", resend.enviar);
  });

  it("no empieza otro lote al llegar el mediodía, aunque la corrida haya empezado antes", async () => {
    await conDosLotes(async () => {
      const fecha = nuevaFecha();
      let reloj = aLas(fecha, "11:59");
      const resend = resendSimulado({ aMitad: async () => void (reloj = aLas(fecha, "12:00")) });
      const resumen = await corrida(fecha, "11:59", resend.enviar, { ahora: () => reloj });
      const lotes = await lotesDelDia(fecha);
      expect(lotes.length).toBeGreaterThan(1);
      expect(resumen).toMatchObject({ detenidaPor: "MEDIODIA", lotesSinIniciar: lotes.length - 1, ultimaDeLaVentana: true, motivos: ["PENDIENTES"] });
      expect(resend.peticiones).toHaveLength(1);
      expect(lotes[0].estado).toBe("ACEPTADO");
      expect(lotes.slice(1).map((l) => [l.estado, l.intentos])).toEqual(lotes.slice(1).map(() => ["PENDIENTE", 0]));
    });
  });

  it("cierra los días anteriores en tandas mientras haya tiempo; lo demás queda para la siguiente corrida", async () => {
    const atrasadas = Array.from({ length: TANDA_DE_CIERRE + 1 }, fechaAtrasada);
    for (const f of atrasadas) await evaluarYReservar(f);
    const hoy = aFechaDeBase(nuevaFecha());
    let tandas = 0;
    await expect(cerrarDiasAnteriores(hoy, () => tandas++ === 0)).resolves.toEqual({ cerrados: TANDA_DE_CIERRE, quedan: true });
    const resto = await cerrarDiasAnteriores(hoy);
    expect(resto).toMatchObject({ quedan: false });
    expect(resto.cerrados).toBeGreaterThan(0);
    for (const f of atrasadas) expect(estados(await lotesDelDia(f)), f).toEqual(["VENCIDO"]);
  });

  it("una espera de candado no rebasa el tope de su transacción dentro de la base", async () => {
    const fecha = nuevaFecha();
    const ocupante = new Client({ connectionString: URL_PRUEBAS });
    await ocupante.connect();
    try {
      await ocupante.query("BEGIN");
      await ocupante.query("SELECT candado_correos_del_dia($1::date)", [fecha]);
      const inicio = Date.now();
      await expect(escrituraDeSistema("resumen-diario", (db) => db.candadoDelDia(aFechaDeBase(fecha)), { maxWait: 1_000, timeout: 300 })).rejects.toThrow();
      expect(Date.now() - inicio).toBeLessThan(3_000);
      // La base canceló la espera: no queda nadie formado tras el candado
      await new Promise((listo) => setTimeout(listo, 300));
      const { rows } = await ocupante.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");
      expect(rows[0].n).toBe(0);
    } finally {
      await ocupante.query("ROLLBACK");
      await ocupante.end();
    }
  });

  it("la corrida que evalúa el día avisa si el anterior no tuvo evaluación, y marca la última corrida de la ventana", async () => {
    const errores = silenciarErrores();
    const sinEvaluar = nuevaFecha();
    const fecha = nuevaFecha();
    await expect(corrida(fecha, "11:45", resendSimulado().enviar)).resolves.toMatchObject({ ultimaDeLaVentana: true });
    expect(errores).toHaveBeenCalledWith(expect.stringContaining(`el ${sinEvaluar} no tuvo evaluación`));

    errores.mockClear();
    await expect(corrida(fecha, "11:30", resendSimulado().enviar)).resolves.toMatchObject({ ultimaDeLaVentana: false });
    expect(errores).not.toHaveBeenCalledWith(expect.stringContaining("no tuvo evaluación"));
  });
});
