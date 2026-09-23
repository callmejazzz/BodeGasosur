/* Intentos directos contra PostgreSQL: la interfaz y los permisos no participan. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aFechaDeBase, hoyEnMexico } from "../../src/lib/fechas";
import { URL_PRUEBAS } from "../../pruebas/base-de-pruebas";
import { crearCliente } from "../comun";

const prisma = crearCliente(URL_PRUEBAS);
let bodegaId: string;
let estacionId: string;
let articuloId: string;
let capturistaId: string;
let autorizadorId: string;

beforeAll(async () => {
  const sufijo = randomUUID().slice(0, 8);
  const [bodega, empresa, unidad, capturista, autorizador] = await Promise.all([
    prisma.bodega.create({ data: { nombre: `Salida ${sufijo}` } }),
    prisma.empresa.create({ data: { razonSocial: `Empresa ${sufijo}` } }),
    prisma.unidadMedida.create({ data: { clave: `S${sufijo}`, nombre: "Pieza" } }),
    prisma.usuario.create({ data: { clerkUserId: `cap_${sufijo}`, correo: `cap.${sufijo}@prueba.test`, rol: "COMPRAS" } }),
    prisma.usuario.create({ data: { clerkUserId: `aut_${sufijo}`, correo: `aut.${sufijo}@prueba.test`, rol: "JEFE", puedeAutorizar: true } }),
  ]);
  const [estacion, articulo] = await Promise.all([
    prisma.estacion.create({ data: { numero: `ES${sufijo}`, alias: `Estación ${sufijo}`, empresaId: empresa.id } }),
    prisma.articulo.create({ data: { descripcion: `Artículo salida ${sufijo}`, unidadId: unidad.id } }),
  ]);
  bodegaId = bodega.id;
  estacionId = estacion.id;
  articuloId = articulo.id;
  capturistaId = capturista.id;
  autorizadorId = autorizador.id;
});

afterAll(() => prisma.$disconnect());

async function solicitud(conPartida = true) {
  const m = await prisma.movimiento.create({
    data: {
      tipo: "SALIDA", estatus: "SOLICITADA", fecha: aFechaDeBase(hoyEnMexico()),
      bodegaOrigenId: bodegaId, estacionId, creadoPorId: capturistaId,
      llaveIdempotencia: randomUUID(),
    },
  });
  if (conPartida) {
    await prisma.movimientoPartida.create({
      data: {
        movimientoId: m.id, articuloId, orden: 1, presentacionCapturada: "UNIDAD",
        cantidadCapturada: 2, factorConversion: 1, cantidad: 2,
      },
    });
  }
  return m;
}

describe("frontera SQL de salidas", () => {
  it("el enum vigente contiene RETIRADA y ya no ENTREGADA", async () => {
    const valores = await prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'EstatusMovimiento'
    `;
    const etiquetas = valores.map((valor) => valor.enumlabel);
    expect(etiquetas).toContain("RETIRADA");
    expect(etiquetas).toContain("RECIBIDA");
    expect(etiquetas).not.toContain("ENTREGADA");
  });

  it("exige llave, estado inicial y partidas al autorizar", async () => {
    await expect(prisma.movimiento.create({
      data: { tipo: "SALIDA", estatus: "SOLICITADA", fecha: aFechaDeBase(hoyEnMexico()), bodegaOrigenId: bodegaId,
        estacionId, creadoPorId: capturistaId },
    })).rejects.toThrow();
    await expect(prisma.movimiento.create({
      data: { tipo: "SALIDA", estatus: "AUTORIZADA", fecha: aFechaDeBase(hoyEnMexico()), bodegaOrigenId: bodegaId,
        estacionId, creadoPorId: capturistaId, llaveIdempotencia: randomUUID(),
        autorizadoPorId: autorizadorId, autorizadoEn: new Date() },
    })).rejects.toThrow();
    const m = await solicitud(false);
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "AUTORIZADA", autorizadoPorId: autorizadorId, autorizadoEn: new Date(),
    } })).rejects.toThrow();
  });

  it("impide retirar sin autorizar y exige consumo para retirar una autorizada", async () => {
    const m = await solicitud();
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "RETIRADA", folio: `S-${randomUUID().slice(0, 8)}`,
      entregadoA: "Mensajero", entregadoPorId: capturistaId, entregadoEn: new Date(),
    } })).rejects.toThrow();
    await prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "AUTORIZADA", autorizadoPorId: autorizadorId, autorizadoEn: new Date(),
    } });
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "RETIRADA", folio: `S-${randomUUID().slice(0, 8)}`,
      entregadoA: "Mensajero", entregadoPorId: capturistaId, entregadoEn: new Date(),
    } })).rejects.toThrow();
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id: m.id } })).resolves.toMatchObject({
      estatus: "AUTORIZADA", folio: null,
    });
  });

  it("rechaza como autorizador a un usuario activo sin facultad, aunque pueda capturar", async () => {
    const m = await solicitud();
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "AUTORIZADA", autorizadoPorId: capturistaId, autorizadoEn: new Date(),
    } })).rejects.toThrow();
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id: m.id } })).resolves.toMatchObject({
      estatus: "SOLICITADA", autorizadoPorId: null,
    });
  });

  it("permite confirmar la recepción sin nuevo consumo y cierra en RECIBIDA", async () => {
    const m = await solicitud();
    const p = await prisma.movimientoPartida.findUniqueOrThrow({
      where: { movimientoId_articuloId: { movimientoId: m.id, articuloId } },
    });
    await prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "AUTORIZADA", autorizadoPorId: autorizadorId, autorizadoEn: new Date(),
    } });
    // La prueba prepara el mínimo consumo que exige la frontera SQL actual.
    const capa = await prisma.capaCosto.create({ data: {
      movimientoId: m.id, bodegaId, articuloId, fecha: m.fecha, fechaOriginal: m.fecha,
      cantidadInicial: 2, cantidadRestante: 0,
    } });
    await prisma.consumoCapa.create({ data: { partidaId: p.id, capaId: capa.id, cantidad: 2 } });
    await prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "RETIRADA", folio: `S-${randomUUID().slice(0, 8)}`,
      entregadoA: "Mensajero", entregadoPorId: capturistaId, entregadoEn: new Date(),
    } });
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "CANCELADO", canceladoPorId: capturistaId, canceladoEn: new Date(),
      motivoCancelacion: "El material ya salió",
    } })).rejects.toThrow();
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "RECIBIDA",
    } })).rejects.toThrow();
    const antes = await prisma.movimiento.findUniqueOrThrow({ where: { id: m.id } });
    const consumoAntes = await prisma.consumoCapa.findMany({ where: { partidaId: p.id } });
    const recibidoEn = new Date();
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "RECIBIDA", recibidoPorId: capturistaId, recibidoEn,
    } })).resolves.toMatchObject({
      estatus: "RECIBIDA", recibidoPorId: capturistaId, recibidoEn,
      folio: antes.folio, entregadoEn: antes.entregadoEn,
    });
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id: m.id } })).resolves.toMatchObject({
      estatus: "RECIBIDA", recibidoPorId: capturistaId,
    });
    expect(await prisma.consumoCapa.findMany({ where: { partidaId: p.id } })).toEqual(consumoAntes);
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: {
      recibidoPorId: autorizadorId, recibidoEn: new Date(),
    } })).rejects.toThrow();
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "CANCELADO", canceladoPorId: capturistaId, canceladoEn: new Date(),
      motivoCancelacion: "No procede",
    } })).rejects.toThrow();
  });

  it("congela encabezado y partidas autorizadas; rechazo y cancelación son terminales", async () => {
    const m = await solicitud();
    await prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "AUTORIZADA", autorizadoPorId: autorizadorId, autorizadoEn: new Date(),
    } });
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: { observaciones: "cambiadas" } })).rejects.toThrow();
    await expect(prisma.movimientoPartida.update({ where: {
      movimientoId_articuloId: { movimientoId: m.id, articuloId },
    }, data: { cantidad: 3, cantidadCapturada: 3 } })).rejects.toThrow();
    await expect(prisma.movimiento.delete({ where: { id: m.id } })).rejects.toThrow();
    await prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "CANCELADO", canceladoPorId: capturistaId, canceladoEn: new Date(), motivoCancelacion: "Error de captura",
    } });
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: {
      estatus: "AUTORIZADA",
    } })).rejects.toThrow();

    const otra = await solicitud();
    await prisma.movimiento.update({ where: { id: otra.id }, data: {
      estatus: "RECHAZADA", rechazadoPorId: autorizadorId, rechazadoEn: new Date(), motivoRechazo: "No procede",
    } });
    await expect(prisma.movimiento.update({ where: { id: otra.id }, data: { estatus: "CANCELADO",
      canceladoPorId: capturistaId, canceladoEn: new Date(), motivoCancelacion: "No procede" } })).rejects.toThrow();
  });
});
