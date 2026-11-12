/*
  POST /api/webhooks/resend (contrato fase 9, §3.7): firma, idempotencia,
  asociación y anomalías, rebotes y estado de entrega. Pruebas 8, 14, 15 y 16.
*/

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { cuerpoDelEvento, peticionFirmada, type EventoDePrueba } from "../../../pruebas/firma-resend";
import { ENTORNO_DE_CORREO, fechasDesde, registrosDelDia, sembrarBajoMinimo, usuarioConAlerta } from "../../../pruebas/semilla-correo";
import { estadoDeEntrega, claseDeRebote } from "./entrega";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
Object.assign(process.env, ENTORNO_DE_CORREO);
const { atenderWebhookDeResend, TOPE_DEL_CUERPO } = await import("./webhook");
const { evaluarYReservar } = await import("./reserva");

const prisma = crearCliente(URL_PRUEBAS);
const nuevaFecha = fechasDesde(2037);
let uno: { id: string; correo: string };
let dos: { id: string; correo: string };

beforeAll(async () => {
  await sembrarBajoMinimo(prisma);
  [uno, dos] = [await usuarioConAlerta(prisma), await usuarioConAlerta(prisma)];
});
afterAll(() => prisma.$disconnect());
afterEach(() => {
  vi.restoreAllMocks();
});

const enviar = (cuerpo: unknown, opciones?: Parameters<typeof peticionFirmada>[1]) => atenderWebhookDeResend(peticionFirmada(cuerpo, opciones));
const evento = (e: EventoDePrueba) => cuerpoDelEvento(e);
const rebote = (tipo: string) => ({ bounce: { type: tipo, subType: "General", message: "550 5.1.1 La dirección no existe" } });

/** Un día reservado: el registro de cada uno de los dos usuarios de la prueba. */
async function reservarDia() {
  const fecha = nuevaFecha();
  await evaluarYReservar(fecha);
  const registros = await registrosDelDia(prisma, fecha);
  return { r1: registros.find((r) => r.usuarioId === uno.id)!, r2: registros.find((r) => r.usuarioId === dos.id)! };
}

async function entregaDe(registroId: string) {
  const [registro, eventos] = await Promise.all([
    prisma.registroCorreos.findUniqueOrThrow({ where: { id: registroId }, select: { estado: true, resendId: true } }),
    prisma.eventoCorreo.findMany({ where: { registroId }, select: { tipo: true, rebote: true } }),
  ]);
  return { ...registro, entrega: estadoDeEntrega(eventos), eventos: eventos.length };
}

const filasDe = (svixId: string) => prisma.eventoCorreo.count({ where: { svixId } });

describe("estado de entrega", () => {
  it("gana la precedencia de §3.11, no el orden de llegada", () => {
    const e = (tipo: string, r: "PERMANENTE" | "TRANSITORIO" | "INDETERMINADO" | null = null) => ({ tipo, rebote: r });
    expect(estadoDeEntrega([])).toBe("ACEPTADO");
    expect(estadoDeEntrega([e("email.sent")])).toBe("ACEPTADO");
    expect(estadoDeEntrega([e("email.delivery_delayed"), e("email.delivered")])).toBe("ENTREGADO");
    expect(estadoDeEntrega([e("email.delivered"), e("email.bounced", "PERMANENTE")])).toBe("NO_ENTREGADO");
    expect(estadoDeEntrega([e("email.bounced", "PERMANENTE"), e("email.delivered")])).toBe("NO_ENTREGADO");
    expect(estadoDeEntrega([e("email.bounced", "INDETERMINADO")])).toBe("ENTREGA_DEMORADA");
    expect(estadoDeEntrega([e("email.failed"), e("email.complained")])).toBe("MARCADO_COMO_SPAM");
    expect(estadoDeEntrega([e("email.suppressed")])).toBe("NO_ENTREGADO");
    expect([claseDeRebote("Permanent"), claseDeRebote("Transient"), claseDeRebote("Temporary"), claseDeRebote("Raro"), claseDeRebote(undefined)]).toEqual([
      "PERMANENTE",
      "TRANSITORIO",
      "TRANSITORIO",
      "INDETERMINADO",
      "INDETERMINADO",
    ]);
  });
});

describe("webhook de Resend (prueba 14)", () => {
  it("con firma inválida, con otro secreto o sin encabezados responde 400 y no escribe nada", async () => {
    const { r1 } = await reservarDia();
    const cuerpo = evento({ tipo: "email.delivered", para: [uno.correo], registro: r1.id });
    for (const opciones of [{ alterar: true }, { secreto: `whsec_${Buffer.from("otro-secreto-de-prueba").toString("base64")}` }]) {
      const svixId = `msg_${randomUUID()}`;
      const respuesta = await enviar(cuerpo, { ...opciones, svixId });
      expect(respuesta.status).toBe(400);
      await expect(respuesta.text()).resolves.toBe("");
      await expect(filasDe(svixId)).resolves.toBe(0);
    }
    const sinEncabezados = await atenderWebhookDeResend(new Request("http://localhost/api/webhooks/resend", { method: "POST", body: JSON.stringify(cuerpo) }));
    expect(sinEncabezados.status).toBe(400);
    await expect(entregaDe(r1.id)).resolves.toMatchObject({ estado: "PENDIENTE", resendId: null, eventos: 0 });
  });

  it("un cuerpo de más de 64 KB se rechaza con 413 antes de verificarlo", async () => {
    const svixId = `msg_${randomUUID()}`;
    const respuesta = await enviar(evento({ tipo: "email.sent", datos: { relleno: "x".repeat(TOPE_DEL_CUERPO) } }), { svixId });
    expect(respuesta.status).toBe(413);
    await expect(filasDe(svixId)).resolves.toBe(0);
  });

  it("sin el secreto del webhook configurado responde 500 para que Resend reintente", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const respuesta = await atenderWebhookDeResend(peticionFirmada(evento({ tipo: "email.sent" })), { ...ENTORNO_DE_CORREO, RESEND_WEBHOOK_SECRET: undefined });
    expect(respuesta.status).toBe(500);
    expect(errores).toHaveBeenCalledWith(expect.stringContaining("RESEND_WEBHOOK_SECRET no está definida"));
  });

  it("un evento repetido con el mismo svix-id deja una sola fila, y uno ajeno a la alerta se descarta con 200", async () => {
    const { r1 } = await reservarDia();
    const svixId = `msg_${randomUUID()}`;
    const cuerpo = evento({ tipo: "email.sent", para: [uno.correo], registro: r1.id });
    expect((await enviar(cuerpo, { svixId })).status).toBe(200);
    expect((await enviar(cuerpo, { svixId })).status).toBe(200);
    await expect(filasDe(svixId)).resolves.toBe(1);

    const ajeno = `msg_${randomUUID()}`;
    expect((await enviar(evento({ tipo: "email.delivered", para: ["alguien@otro.test"] }), { svixId: ajeno })).status).toBe(200);
    await expect(filasDe(ajeno)).resolves.toBe(0);
  });

  it("email.delivered sin email.sent deja el registro ENVIADO con su identificador y la entrega como Entregado (prueba 8)", async () => {
    const { r1 } = await reservarDia();
    const emailId = `re_${randomUUID()}`;
    expect((await enviar(evento({ tipo: "email.delivered", emailId, para: [` ${uno.correo.toUpperCase()} `], registro: r1.id }))).status).toBe(200);
    await expect(entregaDe(r1.id)).resolves.toEqual({ estado: "ENVIADO", resendId: emailId, entrega: "ENTREGADO", eventos: 1 });
    await expect(prisma.loteCorreos.findUniqueOrThrow({ where: { id: r1.loteId } })).resolves.toMatchObject({ estado: "ACEPTADO" });
  });
});

describe("privacidad de lo que se guarda", () => {
  it("solo guarda tipos, identificadores y códigos con forma controlada; lo demás queda como OTRO o se descarta", async () => {
    const { r1 } = await reservarDia();
    const emailId = `re_${randomUUID()}`;
    const fallido = `msg_${randomUUID()}`;
    await enviar(evento({ tipo: "email.failed", emailId, para: [uno.correo], registro: r1.id, datos: { failed: { reason: "No se entregó a persona@ejemplo.test" } } }), { svixId: fallido });
    await expect(prisma.eventoCorreo.findUniqueOrThrow({ where: { svixId: fallido } })).resolves.toMatchObject({ registroId: r1.id, motivoFallo: "OTRO" });

    const rebotado = `msg_${randomUUID()}`;
    await enviar(evento({ tipo: "email.bounced", emailId, para: [uno.correo], registro: r1.id, datos: { bounce: { type: "Permanent", subType: "Buzón de persona@ejemplo.test", message: "550 sin buzón" } } }), { svixId: rebotado });
    await expect(prisma.eventoCorreo.findUniqueOrThrow({ where: { svixId: rebotado } })).resolves.toMatchObject({ rebote: "PERMANENTE", subtipoRebote: "OTRO" });

    const raro = `msg_${randomUUID()}`;
    await enviar(evento({ tipo: "email.Raro <persona@ejemplo.test>", emailId, para: [uno.correo], registro: r1.id }), { svixId: raro });
    await expect(prisma.eventoCorreo.findUniqueOrThrow({ where: { svixId: raro } })).resolves.toMatchObject({ tipo: "desconocido" });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const etiquetaRara = `msg_${randomUUID()}`;
    await enviar(evento({ tipo: "email.delivered", para: [uno.correo], registro: "persona@ejemplo.test" }), { svixId: etiquetaRara });
    await expect(prisma.eventoCorreo.findUniqueOrThrow({ where: { svixId: etiquetaRara } })).resolves.toMatchObject({ anomalia: "ETIQUETA_DESCONOCIDA", etiquetaRecibida: null });

    for (const svixId of [fallido, rebotado, raro, etiquetaRara]) {
      expect(JSON.stringify(await prisma.eventoCorreo.findUniqueOrThrow({ where: { svixId } }))).not.toContain("@");
    }
    expect((await enviar(evento({ tipo: "email.sent" }), { svixId: "msg con espacios" })).status).toBe(400);
  });
});

describe("correlación contradictoria (prueba 15)", () => {
  it("cada anomalía se guarda sin registro, con su código y una línea sin direcciones; nada cambia y repetirla no agrega filas", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { r1, r2 } = await reservarDia();
    const x = `re_${randomUUID()}`;
    await enviar(evento({ tipo: "email.sent", emailId: x, para: [uno.correo], registro: r1.id }));
    const antes = { r1: await entregaDe(r1.id), r2: await entregaDe(r2.id) };
    expect(antes.r1).toMatchObject({ estado: "ENVIADO", resendId: x });

    const casos: [string, Omit<EventoDePrueba, "tipo">][] = [
      ["ETIQUETA_E_ID_DISCREPAN", { emailId: x, para: [dos.correo], registro: r2.id }],
      ["DESTINATARIO_DISTINTO", { emailId: x, para: ["otra.persona@prueba.test"], registro: r1.id }],
      ["ID_DISTINTO", { emailId: `re_${randomUUID()}`, para: [uno.correo], registro: r1.id }],
      ["ETIQUETA_DESCONOCIDA", { emailId: `re_${randomUUID()}`, para: [uno.correo], registro: randomUUID() }],
      ["SIN_ETIQUETA", { emailId: x, para: [uno.correo] }],
    ];
    for (const [anomalia, datos] of casos) {
      for (const [tipo, extra] of [["email.bounced", rebote("Permanent")], ["email.delivered", {}]] as const) {
        const svixId = `msg_${randomUUID()}`;
        const cuerpo = evento({ tipo, ...datos, datos: extra });
        errores.mockClear();
        expect((await enviar(cuerpo, { svixId })).status, `${anomalia} ${tipo}`).toBe(200);
        await expect(prisma.eventoCorreo.findUniqueOrThrow({ where: { svixId } }), `${anomalia} ${tipo}`).resolves.toMatchObject({
          anomalia,
          registroId: null,
          etiquetaRecibida: datos.registro ?? null,
        });
        const linea = errores.mock.calls.map((c) => c.join(" ")).join("\n");
        expect(linea).toContain(anomalia);
        expect(linea).not.toContain("@");
        await expect(entregaDe(r1.id)).resolves.toEqual(antes.r1);
        await expect(entregaDe(r2.id)).resolves.toEqual(antes.r2);
        expect((await enviar(cuerpo, { svixId })).status).toBe(200);
        await expect(filasDe(svixId)).resolves.toBe(1);
      }
    }
    // La exclusión solo cuenta eventos asociados: ningún rebote duro quedó ligado a R1 ni a R2
    await expect(prisma.eventoCorreo.count({ where: { registroId: { in: [r1.id, r2.id] }, rebote: "PERMANENTE" } })).resolves.toBe(0);
  });
});

describe("rebotes y entrega (prueba 16)", () => {
  async function con(...eventos: { tipo: string; datos?: Record<string, unknown> }[]) {
    const { r1 } = await reservarDia();
    const emailId = `re_${randomUUID()}`;
    for (const e of eventos) expect((await enviar(evento({ ...e, emailId, para: [uno.correo], registro: r1.id }))).status).toBe(200);
    return r1.id;
  }

  it("un rebote Permanent da No entregado y gana a la entrega en cualquier orden; Transient seguido de la entrega da Entregado", async () => {
    await expect(entregaDe(await con({ tipo: "email.bounced", datos: rebote("Permanent") }, { tipo: "email.delivered" }))).resolves.toMatchObject({ entrega: "NO_ENTREGADO" });
    await expect(entregaDe(await con({ tipo: "email.delivered" }, { tipo: "email.bounced", datos: rebote("Permanent") }))).resolves.toMatchObject({ entrega: "NO_ENTREGADO" });
    await expect(entregaDe(await con({ tipo: "email.bounced", datos: rebote("Transient") }, { tipo: "email.delivered" }))).resolves.toMatchObject({ entrega: "ENTREGADO" });
  });

  it("un rebote Undetermined o de tipo desconocido da Entrega demorada", async () => {
    await expect(entregaDe(await con({ tipo: "email.bounced", datos: rebote("Undetermined") }))).resolves.toMatchObject({ entrega: "ENTREGA_DEMORADA" });
    await expect(entregaDe(await con({ tipo: "email.bounced", datos: rebote("Rarísimo") }))).resolves.toMatchObject({ entrega: "ENTREGA_DEMORADA" });
  });

  it("guarda la clase y el subtipo del rebote, el motivo del fallo y el tipo de supresión, sin el mensaje del rebote", async () => {
    const rebotado = await con({ tipo: "email.bounced", datos: rebote("Permanent") });
    await expect(prisma.eventoCorreo.findFirstOrThrow({ where: { registroId: rebotado } })).resolves.toMatchObject({ rebote: "PERMANENTE", subtipoRebote: "General" });
    const guardado = JSON.stringify(await prisma.eventoCorreo.findFirstOrThrow({ where: { registroId: rebotado } }));
    expect(guardado).not.toContain("550 5.1.1");
    expect(guardado).not.toContain("@");

    const fallido = await con({ tipo: "email.failed", datos: { failed: { reason: "reached_daily_quota" } } });
    await expect(prisma.eventoCorreo.findFirstOrThrow({ where: { registroId: fallido } })).resolves.toMatchObject({ motivoFallo: "reached_daily_quota", rebote: null });
    await expect(entregaDe(fallido)).resolves.toMatchObject({ entrega: "NO_ENTREGADO" });

    const suprimido = await con({ tipo: "email.suppressed", datos: { suppressed: { type: "OnAccountSuppressionList" } } });
    await expect(prisma.eventoCorreo.findFirstOrThrow({ where: { registroId: suprimido } })).resolves.toMatchObject({ tipoSupresion: "OnAccountSuppressionList" });
    await expect(entregaDe(suprimido)).resolves.toMatchObject({ entrega: "NO_ENTREGADO" });

    await expect(entregaDe(await con({ tipo: "email.delivered" }, { tipo: "email.complained" }))).resolves.toMatchObject({ entrega: "MARCADO_COMO_SPAM" });
  });
});
