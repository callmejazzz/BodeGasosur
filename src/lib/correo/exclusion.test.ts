/*
  Exclusión por dirección (contrato fase 9, §3.7 y prueba 17): la reserva deja
  fuera la dirección actual de quien tenga un rebote duro, una supresión o una
  queja asociados en el historial, sin importar qué cuenta los recibió. El
  apartado «Preferencias» lo explica, leído por la sesión como en la aplicación.
*/

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { cuerpoDelEvento, peticionFirmada, type EventoDePrueba } from "../../../pruebas/firma-resend";
import { ENTORNO_DE_CORREO, fechasDesde, registrosDelDia, sembrarBajoMinimo, usuarioConAlerta } from "../../../pruebas/semilla-correo";
import { estadoDelAviso } from "./entrega";

const sesion = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@clerk/nextjs/server", async () => ({ auth: (await import("../../../pruebas/clerk-simulado")).authSimulado(sesion) }));

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
Object.assign(process.env, ENTORNO_DE_CORREO);
const { atenderWebhookDeResend } = await import("./webhook");
const { evaluarYReservar } = await import("./reserva");
const { consultar } = await import("@/lib/db");
const { leerMiCuenta } = await import("@/lib/cuenta/repo");

const prisma = crearCliente(URL_PRUEBAS);
const nuevaFecha = fechasDesde(2039);

beforeAll(async () => {
  await sembrarBajoMinimo(prisma);
});
afterAll(() => prisma.$disconnect());

type Usuario = { id: string; correo: string };

const enviar = (e: EventoDePrueba) => atenderWebhookDeResend(peticionFirmada(cuerpoDelEvento(e)));
const rebote = { bounce: { type: "Permanent", subType: "General" } };

/** Evalúa un día y devuelve el registro de cada usuario reservado. */
async function reservar(fecha: string) {
  await evaluarYReservar(fecha);
  return new Map((await registrosDelDia(prisma, fecha)).map((r) => [r.usuarioId, r]));
}

async function preferenciasDe(u: Usuario, hoy: string) {
  sesion.userId = (await prisma.usuario.findUniqueOrThrow({ where: { id: u.id }, select: { clerkUserId: true } })).clerkUserId;
  return consultar("cuenta:editar", (db, yo) => leerMiCuenta(db, yo.id, hoy));
}

describe("exclusión por dirección (prueba 17)", () => {
  it("sigue a la dirección normalizada y no al usuario; termina al cambiar de dirección y no toca la preferencia", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const [a, c, d, e, f] = [
      await usuarioConAlerta(prisma),
      await usuarioConAlerta(prisma),
      await usuarioConAlerta(prisma),
      await usuarioConAlerta(prisma),
      await usuarioConAlerta(prisma),
    ];

    // Día 1: a A le rebota de forma permanente; D queda suprimida y E lo marca como spam.
    // El rebote de F es anómalo (data.to no trae su dirección): no excluye a nadie.
    const dia1 = nuevaFecha();
    const r1 = await reservar(dia1);
    for (const u of [a, c, d, e, f]) expect(r1.has(u.id)).toBe(true);
    const eventos: EventoDePrueba[] = [
      { tipo: "email.bounced", para: [a.correo], registro: r1.get(a.id)!.id, datos: rebote },
      { tipo: "email.suppressed", para: [d.correo], registro: r1.get(d.id)!.id, datos: { suppressed: { type: "OnAccountSuppressionList" } } },
      { tipo: "email.complained", para: [e.correo], registro: r1.get(e.id)!.id },
      { tipo: "email.bounced", para: ["otra.persona@prueba.test"], registro: r1.get(f.id)!.id, datos: rebote },
    ];
    for (const evento of eventos) expect((await enviar(evento)).status).toBe(200);
    await expect(prisma.eventoCorreo.findFirstOrThrow({ where: { etiquetaRecibida: r1.get(f.id)!.id } })).resolves.toMatchObject({
      anomalia: "DESTINATARIO_DISTINTO",
      registroId: null,
    });

    // A se da de baja y B se crea con la misma dirección, escrita con otras mayúsculas y espacios
    await prisma.usuario.update({ where: { id: a.id }, data: { activo: false } });
    const clerkB = `user_correo_${randomUUID().slice(0, 8)}`;
    const b = await prisma.usuario.create({
      data: { clerkUserId: clerkB, correo: `  ${a.correo.toUpperCase()} `, rol: "COMPRAS", alertasCorreo: true },
      select: { id: true, correo: true },
    });

    const dia2 = nuevaFecha();
    const r2 = await reservar(dia2);
    for (const u of [a, b, d, e]) expect(r2.has(u.id)).toBe(false);
    for (const u of [c, f]) expect(r2.has(u.id)).toBe(true);

    // «Preferencias» dice por qué tipo de evento, sin decir qué cuenta lo recibió; sin «Empieza mañana»
    await expect(preferenciasDe(b, dia2)).resolves.toMatchObject({ exclusion: "REBOTE", ultimoAviso: null, avisoDelDia: null });
    await expect(preferenciasDe(d, dia2)).resolves.toMatchObject({ exclusion: "SUPRESION", avisoDelDia: null });
    await expect(preferenciasDe(e, dia2)).resolves.toMatchObject({ exclusion: "QUEJA", avisoDelDia: null });
    await expect(preferenciasDe(f, dia2)).resolves.toMatchObject({ exclusion: null, ultimoAviso: { fecha: dia2, estado: "EN_PROCESO" } });

    // B se da de baja, C cambia su correo en Clerk a la dirección que rebotó y A vuelve con otra
    await prisma.usuario.update({ where: { id: b.id }, data: { activo: false } });
    await prisma.usuario.update({ where: { id: c.id }, data: { correo: a.correo.toUpperCase() } });
    await prisma.usuario.update({ where: { id: a.id }, data: { activo: true, correo: `otra.${a.correo}` } });

    const dia3 = nuevaFecha();
    const r3 = await reservar(dia3);
    expect(r3.has(c.id)).toBe(false);
    expect(r3.has(a.id)).toBe(true);
    await expect(preferenciasDe(c, dia3)).resolves.toMatchObject({ exclusion: "REBOTE", ultimoAviso: { fecha: dia2, estado: "EN_PROCESO" }, avisoDelDia: null });
    await expect(preferenciasDe(a, dia3)).resolves.toMatchObject({ exclusion: null, ultimoAviso: { fecha: dia3, estado: "EN_PROCESO" } });

    // Nadie tocó la preferencia
    const ids = [a, b, c, d, e, f].map((u) => u.id);
    await expect(prisma.usuario.count({ where: { id: { in: ids }, alertasCorreo: true } })).resolves.toBe(ids.length);
    errores.mockRestore();
  });
});

describe("estado del último aviso (§3.11)", () => {
  it("sin eventos sale del registro; con eventos asociados prevalece la evidencia de Resend", () => {
    expect(estadoDelAviso("PENDIENTE", [])).toBe("EN_PROCESO");
    expect(estadoDelAviso("ENVIADO", [])).toBe("ACEPTADO");
    expect(estadoDelAviso("FALLIDO", [])).toBe("NO_SE_ENVIO");
    expect(estadoDelAviso("SIN_CONFIRMAR", [])).toBe("SIN_CONFIRMAR");
    expect(estadoDelAviso("ENVIADO", [{ tipo: "email.sent", rebote: null }])).toBe("ACEPTADO");
    expect(estadoDelAviso("PENDIENTE", [{ tipo: "email.delivered", rebote: null }])).toBe("ENTREGADO");
    expect(estadoDelAviso("SIN_CONFIRMAR", [{ tipo: "email.bounced", rebote: "PERMANENTE" }])).toBe("NO_ENTREGADO");
  });
});
