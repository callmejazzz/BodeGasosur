/*
  Evaluación y reserva del día (contrato fase 9, §3.4), contra PostgreSQL y con
  el usuario de ejecución, por la puerta del origen `resumen-diario`.

  · Prueba 2: quién queda reservado.
  · Pruebas 3 y 4, la parte de la base: dos corridas, seguidas o simultáneas.
  · Pruebas 10 y 11, la parte de la base: días sin bajo mínimo o sin destinatarios.

  La alerta lee toda la base. Para los días sin bajo mínimo o sin destinatarios
  se apaga lo ajeno y se restaura al terminar: los archivos de prueba corren uno
  a la vez (vitest.config.mts), así que nadie más escribe mientras tanto.
*/

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { aFechaDeBase } from "../fechas";
import { asuntoDelResumen } from "./plantilla";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
process.env.CORREO_REMITENTE = "BodeGasosur <avisos@avisos.prueba.test>";
process.env.URL_APLICACION = "https://bodegasosur.prueba.test";
const { evaluarYReservar, POR_LOTE } = await import("./reserva");
const { ConfiguracionDeCorreoInvalida, configuracionDeCorreo } = await import("./configuracion");

const prisma = crearCliente(URL_PRUEBAS);
const sufijo = randomUUID().slice(0, 8);
let unidadId: string;
let conAlerta: { id: string; correo: string };

let dias = 0;
/** Una fecha distinta por corrida: el día se evalúa una sola vez. */
const nuevaFecha = () => new Date(Date.UTC(2034, 0, 1 + dias++)).toISOString().slice(0, 10);

async function usuarioNuevo(datos: { alertasCorreo?: boolean; activo?: boolean } = {}) {
  const clerk = `user_rs_${randomUUID().slice(0, 8)}`;
  return prisma.usuario.create({ data: { clerkUserId: clerk, correo: `${clerk}@prueba.test`, rol: "COMPRAS", ...datos }, select: { id: true, correo: true } });
}

const articuloBajoMinimo = (descripcion: string) =>
  prisma.articulo.create({ data: { descripcion: `${descripcion} ${sufijo}`, unidadId, stockMinimo: 3 }, select: { id: true } });

async function cifras(fecha: string) {
  const where = { fecha: aFechaDeBase(fecha) };
  const [evaluaciones, lotes, registros] = await Promise.all([
    prisma.evaluacionCorreos.count({ where }),
    prisma.loteCorreos.count({ where }),
    prisma.registroCorreos.count({ where }),
  ]);
  return { evaluaciones, lotes, registros };
}

const registrosDe = (fecha: string) =>
  prisma.registroCorreos.findMany({ where: { fecha: aFechaDeBase(fecha) }, include: { lote: true }, orderBy: [{ lote: { numero: "asc" } }, { posicion: "asc" }] });

/** Toda la base sin artículos bajo mínimo mientras corre `fn`. */
async function sinBajoMinimo(fn: () => Promise<void>) {
  const previos = await prisma.articulo.findMany({ where: { stockMinimo: { gt: 0 } }, select: { id: true, stockMinimo: true } });
  const ids = previos.map((a) => a.id);
  await prisma.$executeRaw`UPDATE "Articulo" SET "stockMinimo" = 0 WHERE id = ANY(${ids}::uuid[])`;
  try {
    await fn();
  } finally {
    await prisma.$executeRaw`
      UPDATE "Articulo" a SET "stockMinimo" = v.minimo
      FROM unnest(${ids}::uuid[], ${previos.map((a) => a.stockMinimo)}::int[]) AS v(id, minimo) WHERE a.id = v.id`;
  }
}

/** Nadie con la alerta encendida mientras corre `fn`. */
async function sinDestinatarios(fn: () => Promise<void>) {
  const ids = (await prisma.usuario.findMany({ where: { alertasCorreo: true }, select: { id: true } })).map((u) => u.id);
  await prisma.$executeRaw`UPDATE "Usuario" SET "alertasCorreo" = false WHERE id = ANY(${ids}::uuid[])`;
  try {
    await fn();
  } finally {
    await prisma.$executeRaw`UPDATE "Usuario" SET "alertasCorreo" = true WHERE id = ANY(${ids}::uuid[])`;
  }
}

beforeAll(async () => {
  unidadId = (await prisma.unidadMedida.create({ data: { clave: `U${sufijo}`, nombre: "Pieza" } })).id;
  // Sin existencia en una bodega activa: bajo mínimo.
  await prisma.bodega.create({ data: { nombre: `Bodega alerta ${sufijo}` } });
  await articuloBajoMinimo("Faltante de la alerta");
  conAlerta = await usuarioNuevo({ alertasCorreo: true });
});
afterAll(() => prisma.$disconnect());

describe("evaluación y reserva del día", () => {
  it("reserva solo a los activos con la alerta encendida, con el contenido del día fijo en el lote (prueba 2)", async () => {
    const [apagada, inactivo, nuevo] = [await usuarioNuevo(), await usuarioNuevo({ alertasCorreo: true, activo: false }), await usuarioNuevo()];
    const fecha = nuevaFecha();

    const resultado = await evaluarYReservar(fecha);
    expect(resultado).toMatchObject({ evaluadaAhora: true, resultado: "CON_ENVIO" });

    const registros = await registrosDe(fecha);
    const usuarios = registros.map((r) => r.usuarioId);
    expect(usuarios).toContain(conAlerta.id);
    for (const u of [apagada, inactivo, nuevo]) expect(usuarios).not.toContain(u.id);
    expect(new Set(usuarios).size).toBe(usuarios.length);

    const evaluacion = await prisma.evaluacionCorreos.findUniqueOrThrow({ where: { fecha: aFechaDeBase(fecha) } });
    expect(evaluacion).toMatchObject({ resultado: "CON_ENVIO", destinatarios: registros.length, lotes: Math.ceil(registros.length / POR_LOTE) });
    expect(resultado).toMatchObject({ articulos: evaluacion.articulos, renglones: evaluacion.renglones, destinatarios: registros.length });

    const propio = registros.find((r) => r.usuarioId === conAlerta.id)!;
    expect(propio).toMatchObject({ estado: "PENDIENTE", resendId: null, correo: conAlerta.correo });
    expect(propio.lote).toMatchObject({
      estado: "PENDIENTE",
      intentos: 0,
      arrendadoHasta: null,
      llave: `resumen-${fecha}-${propio.lote.numero}`,
      remitente: "BodeGasosur <avisos@avisos.prueba.test>",
      asunto: asuntoDelResumen(evaluacion.articulos),
      articulos: evaluacion.articulos,
    });
    expect(propio.lote.html).toContain('href="https://bodegasosur.prueba.test/reportes/existencias?bajo=1"');
    expect(propio.lote.texto).toContain("https://bodegasosur.prueba.test/reportes/existencias?bajo=1");
  });

  it("dos corridas el mismo día, simultáneas o seguidas, evalúan una vez y no agregan filas (pruebas 3 y 4)", async () => {
    const fecha = nuevaFecha();
    const corridas = await Promise.all([evaluarYReservar(fecha), evaluarYReservar(fecha)]);
    expect(corridas.filter((c) => c.evaluadaAhora)).toHaveLength(1);
    expect(corridas).toContainEqual({ evaluadaAhora: false });

    const despues = await cifras(fecha);
    expect(despues.evaluaciones).toBe(1);
    await expect(evaluarYReservar(fecha)).resolves.toEqual({ evaluadaAhora: false });
    await expect(cifras(fecha)).resolves.toEqual(despues);
  });

  it("reparte a los destinatarios por id en lotes de 100, con número, llave y posiciones consecutivas", async () => {
    const extra = Array.from({ length: POR_LOTE + 1 }, () => `user_rs_lote_${randomUUID().slice(0, 12)}`);
    await prisma.usuario.createMany({ data: extra.map((c) => ({ clerkUserId: c, correo: `${c}@prueba.test`, rol: "JEFE" as const, alertasCorreo: true })) });
    try {
      const fecha = nuevaFecha();
      const resultado = await evaluarYReservar(fecha);
      const registros = await registrosDe(fecha);
      const lotes = [...new Map(registros.map((r) => [r.lote.numero, r.lote])).values()];

      expect(lotes.length).toBeGreaterThanOrEqual(2);
      expect(resultado).toMatchObject({ resultado: "CON_ENVIO", destinatarios: registros.length, lotes: lotes.length });
      expect(lotes.map((l) => l.numero)).toEqual(lotes.map((_, i) => i + 1));
      expect(lotes.map((l) => l.llave)).toEqual(lotes.map((_, i) => `resumen-${fecha}-${i + 1}`));
      for (const l of lotes) {
        const posiciones = registros.filter((r) => r.loteId === l.id).map((r) => r.posicion);
        expect(posiciones).toEqual(posiciones.map((_, i) => i));
        expect(posiciones.length).toBe(l.numero < lotes.length ? POR_LOTE : registros.length - POR_LOTE * (lotes.length - 1));
        expect({ asunto: l.asunto, html: l.html, texto: l.texto }).toEqual({ asunto: lotes[0].asunto, html: lotes[0].html, texto: lotes[0].texto });
      }
      const usuarios = registros.map((r) => r.usuarioId);
      expect(usuarios).toEqual([...usuarios].sort());
    } finally {
      await prisma.usuario.updateMany({ where: { clerkUserId: { in: extra } }, data: { alertasCorreo: false } });
    }
  });

  it("un día sin bajo mínimo queda evaluado sin lotes, y no se reevalúa aunque después aparezca uno (prueba 10)", async () => {
    const fecha = nuevaFecha();
    await sinBajoMinimo(async () => {
      const corridas = await Promise.all([evaluarYReservar(fecha), evaluarYReservar(fecha)]);
      expect(corridas).toContainEqual({ evaluadaAhora: true, resultado: "SIN_BAJO_MINIMO", articulos: 0, renglones: 0, destinatarios: 0, lotes: 0 });
      expect(corridas).toContainEqual({ evaluadaAhora: false });

      // A las 8:15 ya hay un artículo bajo mínimo: el día ya se evaluó.
      await articuloBajoMinimo("Bajó después de evaluar");
      await expect(evaluarYReservar(fecha)).resolves.toEqual({ evaluadaAhora: false });
    });
    await expect(cifras(fecha)).resolves.toEqual({ evaluaciones: 1, lotes: 0, registros: 0 });

    // Al día siguiente sí evalúa y reserva.
    const siguiente = nuevaFecha();
    await expect(evaluarYReservar(siguiente)).resolves.toMatchObject({ resultado: "CON_ENVIO" });
    expect((await registrosDe(siguiente)).map((r) => r.usuarioId)).toContain(conAlerta.id);
  });

  it("un día sin destinatarios queda evaluado; quien enciende la alerta después empieza al día siguiente (prueba 11)", async () => {
    const fecha = nuevaFecha();
    let tarde = { id: "" };
    await sinDestinatarios(async () => {
      await expect(evaluarYReservar(fecha)).resolves.toMatchObject({ evaluadaAhora: true, resultado: "SIN_DESTINATARIOS", destinatarios: 0, lotes: 0 });

      // La enciende a las 8:05; la corrida de las 8:15 no reevalúa ni le reserva.
      tarde = await usuarioNuevo();
      await prisma.usuario.update({ where: { id: tarde.id }, data: { alertasCorreo: true } });
      await expect(evaluarYReservar(fecha)).resolves.toEqual({ evaluadaAhora: false });
    });
    await expect(cifras(fecha)).resolves.toEqual({ evaluaciones: 1, lotes: 0, registros: 0 });

    const siguiente = nuevaFecha();
    await evaluarYReservar(siguiente);
    expect((await registrosDe(siguiente)).map((r) => r.usuarioId)).toContain(tarde.id);
  });
});

describe("configuración del correo", () => {
  it("acepta un remitente con nombre y una URL https o local", () => {
    expect(configuracionDeCorreo({ CORREO_REMITENTE: " avisos@avisos.prueba.test ", URL_APLICACION: "https://bodegasosur.prueba.test/" })).toMatchObject({
      remitente: "avisos@avisos.prueba.test",
    });
    expect(configuracionDeCorreo({ CORREO_REMITENTE: "BodeGasosur <a@b.test>", URL_APLICACION: "http://localhost:3000" }).urlAplicacion.origin).toBe("http://localhost:3000");
  });

  it("en producción exige https, también para la propia máquina", () => {
    const produccion = (url: string) => () => configuracionDeCorreo({ NODE_ENV: "production", CORREO_REMITENTE: "a@b.test", URL_APLICACION: url });
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
      expect(produccion(url), url).toThrow(new ConfiguracionDeCorreoInvalida("URL_APLICACION", "debe usar https en producción"));
    }
    expect(produccion("https://bodegasosur.prueba.test")().urlAplicacion.origin).toBe("https://bodegasosur.prueba.test");
  });

  it("una configuración inválida falla antes de evaluar, sin gastar el día ni mostrar el valor", async () => {
    const fecha = nuevaFecha();
    const invalidas: [string, string | undefined][] = [
      ["CORREO_REMITENTE", undefined],
      ["CORREO_REMITENTE", "BodeGasosur <avisos@avisos.prueba.test>\r\nBcc: espia@otro.test"],
      ["CORREO_REMITENTE", "sin-arroba"],
      ["URL_APLICACION", "http://bodegasosur.prueba.test"],
      ["URL_APLICACION", "https://usuario:secreta@bodegasosur.prueba.test"],
      ["URL_APLICACION", "https://bodegasosur.prueba.test/privado?x=1"],
      ["URL_APLICACION", "no es url"],
    ];
    for (const [variable, valor] of invalidas) {
      const previo = process.env[variable];
      if (valor === undefined) delete process.env[variable];
      else process.env[variable] = valor;
      try {
        const error = await evaluarYReservar(fecha).then(
          () => null,
          (e: unknown) => e,
        );
        expect(error, `${variable}=${valor}`).toBeInstanceOf(ConfiguracionDeCorreoInvalida);
        expect((error as Error).message).toContain(variable);
        for (const fragmento of ["espia", "secreta", "privado", "sin-arroba"]) expect((error as Error).message).not.toContain(fragmento);
      } finally {
        process.env[variable] = previo;
      }
    }
    await expect(cifras(fecha)).resolves.toEqual({ evaluaciones: 0, lotes: 0, registros: 0 });
  });
});
