/*
  El script del cron contra un servidor local: códigos de salida, tiempo
  máximo, redirecciones y que nunca registre el secreto.
*/

import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { disparar, SALIDA } from "./disparar-resumen.mjs";

const SECRETO = "secreto-del-cron-que-nunca-debe-aparecer";
let atender: (peticion: IncomingMessage, respuesta: ServerResponse) => void = () => undefined;
let servidor: Server;
let base: string;
const recibidas: { metodo?: string; ruta?: string; autorizacion?: string }[] = [];

beforeAll(async () => {
  servidor = createServer((peticion, respuesta) => {
    recibidas.push({ metodo: peticion.method, ruta: peticion.url, autorizacion: peticion.headers.authorization });
    atender(peticion, respuesta);
  });
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => {
  servidor.closeAllConnections();
  return new Promise<void>((listo) => servidor.close(() => listo()));
});

const json = (estado: number, cuerpo: unknown) => (_p: IncomingMessage, r: ServerResponse) => r.writeHead(estado, { "content-type": "application/json" }).end(JSON.stringify(cuerpo));
const CORRIDA = "0b6c1f1e-3a7d-4c55-9a0e-6f1d2b3c4d5e";
const resumen = (cambios: Record<string, unknown> = {}) => ({
  corrida: CORRIDA,
  fecha: "2026-11-11",
  evaluacion: { evaluadaAhora: true, resultado: "CON_ENVIO" },
  lotes: { ACEPTADO: 1 },
  destinatarios: { ENVIADO: 3 },
  diaSano: true,
  motivos: [],
  ultimaDeLaVentana: false,
  ...cambios,
});

async function correr(entorno: Record<string, string | undefined> = {}, plazoMs?: number) {
  const lineas: string[] = [];
  const codigo = await disparar({ entorno: { URL_APLICACION: base, CRON_SECRET: SECRETO, ...entorno }, plazoMs, registrar: (l: string) => lineas.push(l) });
  return { codigo, lineas };
}

describe("script del cron", () => {
  it("una corrida completa sale con 0, con una sola línea y el secreto solo en el encabezado", async () => {
    atender = json(200, resumen());
    recibidas.length = 0;
    const { codigo, lineas } = await correr();
    expect(codigo).toBe(SALIDA.completa);
    expect(recibidas).toEqual([{ metodo: "POST", ruta: "/api/tareas/resumen-diario", autorizacion: `Bearer ${SECRETO}` }]);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatch(new RegExp(`^\\[resumen-diario\\] corrida ${CORRIDA} del 2026-11-11: evaluación CON_ENVIO, .* día sano en \\d+\\.\\d s$`));
    expect(lineas[0]).not.toContain(SECRETO);
    expect(lineas[0]).not.toContain(base);
  });

  it("un día no sano solo falla en la última corrida de la ventana", async () => {
    atender = json(200, resumen({ diaSano: false, motivos: ["PENDIENTES"] }));
    await expect(correr()).resolves.toMatchObject({ codigo: SALIDA.completa });
    atender = json(200, resumen({ diaSano: false, motivos: ["PENDIENTES"], ultimaDeLaVentana: true }));
    const { codigo, lineas } = await correr();
    expect(codigo).toBe(SALIDA.diaNoSano);
    expect(lineas[0]).toContain("día no sano (PENDIENTES)");
  });

  it("un incidente operativo sale con 5 en cualquier corrida, para que Sevalla la marque fallida", async () => {
    atender = json(200, resumen({ diaSano: false, motivos: ["PENDIENTES", "INCIDENTE"], incidente: "AUTENTICACION", detenidaPor: "INCIDENTE" }));
    const { codigo, lineas } = await correr();
    expect(codigo).toBe(SALIDA.incidente);
    expect(lineas[0]).toContain("incidente AUTENTICACION, detenida por INCIDENTE");
  });

  it("si la ruta rechaza la corrida sale con 2 y registra el estado y el código", async () => {
    for (const [estado, cuerpo] of [[401, null], [409, { codigo: "FUERA_DE_VENTANA", hora: "02:00" }], [500, { codigo: "ERROR", corrida: CORRIDA }], [200, null]] as const) {
      atender = cuerpo === null ? (_p, r) => r.writeHead(estado).end() : json(estado, cuerpo);
      const { codigo, lineas } = await correr();
      expect(codigo, String(estado)).toBe(SALIDA.rechazo);
      expect(lineas.join(" ")).toContain(String(estado));
      if (cuerpo) expect(lineas.join(" ")).toContain(cuerpo.codigo);
      expect(lineas.join(" ")).not.toContain(SECRETO);
    }
  });

  it("sin respuesta a tiempo, o ante una redirección, sale con 3 sin seguirla", async () => {
    atender = () => undefined;
    const lento = await correr({}, 200);
    expect(lento).toMatchObject({ codigo: SALIDA.red, lineas: ["[resumen-diario] sin respuesta en 0.2 s"] });

    recibidas.length = 0;
    atender = (_p, r) => r.writeHead(307, { location: "https://otro.ejemplo.test/robar" }).end();
    const redirigido = await correr();
    expect(redirigido.codigo).toBe(SALIDA.red);
    expect(recibidas).toHaveLength(1);
    expect(redirigido.lineas.join(" ")).not.toContain(SECRETO);
  });

  it("sin variables, con una URL inválida o con http en producción sale con 1 sin llamar a nadie", async () => {
    recibidas.length = 0;
    for (const entorno of [{ URL_APLICACION: undefined }, { CRON_SECRET: undefined }, { URL_APLICACION: "no es url" }, { NODE_ENV: "production" }, { URL_APLICACION: "http://bodegasosur.prueba.test" }]) {
      const { codigo, lineas } = await correr(entorno);
      expect(codigo, JSON.stringify(entorno)).toBe(SALIDA.configuracion);
      expect(lineas.join(" ")).not.toContain(SECRETO);
    }
    expect(recibidas).toHaveLength(0);
  });

  it("al ejecutarse con node devuelve el código como salida del proceso", async () => {
    atender = json(200, resumen({ diaSano: false, ultimaDeLaVentana: true }));
    const script = fileURLToPath(new URL("./disparar-resumen.mjs", import.meta.url));
    const salida = await new Promise<{ codigo: number | null; texto: string }>((listo) => {
      const entorno = { PATH: process.env.PATH, URL_APLICACION: base, CRON_SECRET: SECRETO } as unknown as NodeJS.ProcessEnv;
      const hijo = spawn(process.execPath, [script], { env: entorno, stdio: ["ignore", "pipe", "pipe"] });
      let texto = "";
      hijo.stdout.on("data", (d: Buffer) => (texto += d));
      hijo.stderr.on("data", (d: Buffer) => (texto += d));
      hijo.on("close", (codigo) => listo({ codigo, texto }));
    });
    expect(salida.codigo).toBe(SALIDA.diaNoSano);
    expect(salida.texto).toContain("[resumen-diario]");
    expect(salida.texto).not.toContain(SECRETO);
  });
});
