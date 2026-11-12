/*
  POST /api/tareas/resumen-diario (contrato fase 9, §3.9): la prueba 13, la
  ventana de 8:00 a 12:00 en sus dos extremos y la respuesta de la corrida.
*/

import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { resendSimulado } from "../../../pruebas/resend-simulado";
import { aLas, ENTORNO_DE_CORREO, fechasDesde, sembrarBajoMinimo, usuarioConAlerta } from "../../../pruebas/semilla-correo";
import { aFechaDeBase } from "../fechas";
import type { OpcionesDeCorrida, ResumenDeCorrida } from "./corrida";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
Object.assign(process.env, ENTORNO_DE_CORREO);
const { atenderTarea } = await import("./tarea");
const { ConfiguracionDeCorreoInvalida } = await import("./configuracion");
const { enviadorDeResend } = await import("./resend");

const prisma = crearCliente(URL_PRUEBAS);
const nuevaFecha = fechasDesde(2036);
const SECRETO = "secreto-del-cron-de-prueba-con-mas-de-32-caracteres";

beforeAll(async () => {
  await sembrarBajoMinimo(prisma);
  await usuarioConAlerta(prisma);
});
afterAll(() => prisma.$disconnect());
afterEach(() => {
  vi.restoreAllMocks();
});

const peticion = (autorizacion?: string) =>
  new Request("http://localhost/api/tareas/resumen-diario", { method: "POST", headers: autorizacion === undefined ? {} : { authorization: autorizacion } });

const RESUMEN: ResumenDeCorrida = {
  fecha: "2036-01-01",
  evaluacion: { evaluadaAhora: true, resultado: "SIN_BAJO_MINIMO" },
  cerrados: 0,
  cierrePendiente: false,
  lotesSinIniciar: 0,
  detenidaPor: null,
  incidente: null,
  lotes: {},
  destinatarios: {},
  diaSano: true,
  motivos: [],
  ultimaDeLaVentana: false,
};

describe("ruta del resumen diario", () => {
  it("sin secreto, con uno incorrecto o con CRON_SECRET corto responde 401 sin detalles ni leer la base (prueba 13)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fecha = nuevaFecha();
    const corrida = vi.fn();
    const crearEnviador = vi.fn();
    const casos: [string | undefined, string][] = [
      [undefined, SECRETO],
      ["", SECRETO],
      ["Bearer ", SECRETO],
      [SECRETO, SECRETO],
      [`Bearer ${SECRETO.slice(1)}`, SECRETO],
      [`Bearer ${SECRETO}x`, SECRETO],
      [`bearer ${SECRETO}`, SECRETO],
      ["Bearer corto", "corto"],
      ["Bearer ", ""],
    ];
    for (const [cabecera, secreto] of casos) {
      const respuesta = await atenderTarea(peticion(cabecera), { secreto, ahora: () => aLas(fecha, "08:00"), corrida, crearEnviador });
      expect(respuesta.status, `${cabecera} / ${secreto}`).toBe(401);
      await expect(respuesta.text()).resolves.toBe("");
    }
    expect(corrida).not.toHaveBeenCalled();
    expect(crearEnviador).not.toHaveBeenCalled();
    await expect(prisma.evaluacionCorreos.count({ where: { fecha: aFechaDeBase(fecha) } })).resolves.toBe(0);
  });

  it("fuera de la ventana de 8:00 a 12:00 responde 409 en los dos extremos sin tocar la base", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fecha = nuevaFecha();
    const corrida = vi.fn();
    for (const hora of ["00:00", "02:00", "07:59", "12:00", "12:01", "23:59"]) {
      const respuesta = await atenderTarea(peticion(`Bearer ${SECRETO}`), { secreto: SECRETO, ahora: () => aLas(fecha, hora), corrida });
      expect(respuesta.status, hora).toBe(409);
      await expect(respuesta.json()).resolves.toEqual({ codigo: "FUERA_DE_VENTANA", hora });
    }
    expect(corrida).not.toHaveBeenCalled();
    expect(errores).toHaveBeenCalledWith(expect.stringContaining("fuera de la ventana"));
    await expect(prisma.evaluacionCorreos.count({ where: { fecha: aFechaDeBase(fecha) } })).resolves.toBe(0);
  });

  it("dentro de la ventana corre la corrida con la hora y el enviador, y devuelve su resumen", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fecha = nuevaFecha();
    const enviar = resendSimulado().enviar;
    for (const hora of ["08:00", "11:59"]) {
      const corrida = vi.fn().mockResolvedValue(RESUMEN);
      const reloj = () => aLas(fecha, hora);
      const respuesta = await atenderTarea(peticion(`Bearer ${SECRETO}`), { secreto: SECRETO, ahora: reloj, corrida, crearEnviador: () => enviar });
      expect(respuesta.status, hora).toBe(200);
      await expect(respuesta.json()).resolves.toEqual({ ...RESUMEN, corrida: expect.stringMatching(/^[0-9a-f-]{36}$/) });
      expect(corrida).toHaveBeenCalledWith({ ahora: reloj, plazo: expect.objectContaining({ restante: expect.any(Function) }), enviar });
    }
  });

  it("el plazo de la corrida empieza a contar al llegar la petición, no al empezar la corrida", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fecha = nuevaFecha();
    const creado = vi.fn(() => ({ restante: () => 120_000 }));
    let antesDeLaCorrida = 0;
    const corrida = vi.fn<(o: OpcionesDeCorrida) => Promise<ResumenDeCorrida>>(async () => {
      antesDeLaCorrida = creado.mock.calls.length;
      return RESUMEN;
    });
    await atenderTarea(peticion(`Bearer ${SECRETO}`), { secreto: SECRETO, ahora: () => aLas(fecha, "08:00"), plazo: creado, corrida, crearEnviador: () => resendSimulado().enviar });
    expect(antesDeLaCorrida).toBe(1);
    expect(corrida.mock.calls[0][0].plazo).toBe(creado.mock.results[0].value);
  });

  it("con la corrida real devuelve la evaluación, los lotes y destinatarios por estado, y el día sano", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fecha = nuevaFecha();
    const resend = resendSimulado();
    const respuesta = await atenderTarea(peticion(`Bearer ${SECRETO}`), { secreto: SECRETO, ahora: () => aLas(fecha, "08:00"), crearEnviador: () => resend.enviar });
    expect(respuesta.status).toBe(200);
    const cuerpo = (await respuesta.json()) as ResumenDeCorrida;
    expect(cuerpo).toMatchObject({ fecha, evaluacion: { evaluadaAhora: true, resultado: "CON_ENVIO" }, diaSano: true, motivos: [], ultimaDeLaVentana: false });
    expect(cuerpo.lotes).toEqual({ ACEPTADO: resend.peticiones.length });
    expect(cuerpo.destinatarios.ENVIADO).toBeGreaterThan(0);
    expect(info).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^\\[correo\\] corrida [0-9a-f-]{36} del ${fecha}: evaluación CON_ENVIO`)));
    expect(info.mock.calls.flat().join(" ")).not.toContain("@");
  });

  it("si la configuración o la corrida fallan responde 500 sin detalles, y una configuración rota no evalúa el día", async () => {
    const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fecha = nuevaFecha();
    const autorizada = { secreto: SECRETO, ahora: () => aLas(fecha, "08:00") };

    const corrida = vi.fn();
    const sinLlave = await atenderTarea(peticion(`Bearer ${SECRETO}`), { ...autorizada, corrida, crearEnviador: () => enviadorDeResend({}) });
    expect(sinLlave.status).toBe(500);
    const { corrida: id } = (await sinLlave.json()) as { corrida: string };
    expect(corrida).not.toHaveBeenCalled();
    expect(errores).toHaveBeenCalledWith(`[correo] corrida ${id} falló: ConfiguracionDeCorreoInvalida: RESEND_API_KEY no está definida.`);
    expect(() => enviadorDeResend({ RESEND_API_KEY: "sin-prefijo" })).toThrow(ConfiguracionDeCorreoInvalida);

    // El mensaje de un error ajeno no se registra: puede traer datos
    const ajeno = Object.assign(new Error("Key (correo)=(persona@ejemplo.test) already exists"), { code: "P2002" });
    errores.mockClear();
    const falla = await atenderTarea(peticion(`Bearer ${SECRETO}`), { ...autorizada, crearEnviador: () => resendSimulado().enviar, corrida: vi.fn().mockRejectedValue(ajeno) });
    expect(falla.status).toBe(500);
    await expect(falla.json()).resolves.toEqual({ codigo: "ERROR", corrida: expect.any(String) });
    expect(errores).toHaveBeenCalledWith(expect.stringMatching(/^\[correo\] corrida [0-9a-f-]{36} falló: Error P2002$/));
    expect(errores.mock.calls.flat().join(" ")).not.toContain("@");

    const previo = process.env.CORREO_REMITENTE;
    delete process.env.CORREO_REMITENTE;
    try {
      const rota = await atenderTarea(peticion(`Bearer ${SECRETO}`), { ...autorizada, crearEnviador: () => resendSimulado().enviar });
      expect(rota.status).toBe(500);
    } finally {
      process.env.CORREO_REMITENTE = previo;
    }
    await expect(prisma.evaluacionCorreos.count({ where: { fecha: aFechaDeBase(fecha) } })).resolves.toBe(0);
  });
});
