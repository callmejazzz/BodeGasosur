/*
  Los invariantes de la fase 5 escritos en la base (11 §1, §4, §5, §8, §9, §10),
  probados escribiendo directo con Prisma, sin capa de servicios: es la
  escritura que los CHECK y triggers existen para atajar.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { aFechaDeBase, deFechaDeBase } from "../../src/lib/fechas";
import { URL_PRUEBAS } from "../../pruebas/base-de-pruebas";
import { crearCliente } from "../comun";

const prisma = crearCliente(URL_PRUEBAS);

let usuarioId: string;
let bodegaId: string;
let proveedorId: string;
let unidadId: string;
let articuloId: string;

beforeAll(async () => {
  const sufijo = randomUUID().slice(0, 8);
  const [usuario, bodega, proveedor, unidad] = await Promise.all([
    prisma.usuario.create({
      // Con facultad de autorizar: así lo que rechaza a un autorizador en una
      // ENTRADA es el CHECK de tipo, no el trigger de la facultad.
      data: { clerkUserId: `user_${sufijo}`, correo: `${sufijo}@prueba.test`, rol: "COMPRAS", puedeAutorizar: true },
    }),
    prisma.bodega.create({ data: { nombre: `Bodega ${sufijo}` } }),
    prisma.proveedor.create({
      data: { nombreComercial: `Proveedor ${sufijo}`, razonSocial: `Proveedor ${sufijo} SA` },
    }),
    prisma.unidadMedida.create({ data: { clave: `U${sufijo}`, nombre: "Pieza" } }),
  ]);
  unidadId = unidad.id;
  const articulo = await prisma.articulo.create({
    data: { descripcion: `Artículo ${sufijo}`, unidadId, piezasPorCaja: 12 },
  });
  usuarioId = usuario.id;
  bodegaId = bodega.id;
  proveedorId = proveedor.id;
  articuloId = articulo.id;
});

afterAll(() => prisma.$disconnect());

const zonaOriginal = process.env.TZ;
afterEach(() => {
  if (zonaOriginal === undefined) delete process.env.TZ;
  else process.env.TZ = zonaOriginal;
});

function entrada(extra: Partial<Prisma.MovimientoUncheckedCreateInput> = {}) {
  return prisma.movimiento.create({
    data: {
      tipo: "ENTRADA",
      estatus: "BORRADOR",
      fecha: aFechaDeBase("2026-09-14"),
      moneda: "MXN",
      bodegaDestinoId: bodegaId,
      proveedorId,
      creadoPorId: usuarioId,
      llaveIdempotencia: randomUUID(),
      ...extra,
    },
  });
}

// 3 CAJA de 12 a $120 la caja: 36 piezas a $10 MXN sin IVA.
function partida(movimientoId: string, extra: Partial<Prisma.MovimientoPartidaUncheckedCreateInput> = {}) {
  return prisma.movimientoPartida.create({
    data: {
      movimientoId,
      articuloId,
      orden: 1,
      presentacionCapturada: "CAJA",
      cantidadCapturada: 3,
      factorConversion: 12,
      cantidad: 36,
      costoUnitarioCapturado: "120.0000",
      tasaIva: "0.1600",
      costoUnitario: "10.0000",
      costoUnitarioConIva: "11.6000",
      ...extra,
    },
  });
}

const CONFIRMACION = () => ({
  estatus: "CONFIRMADO" as const,
  folio: `E-${randomUUID().slice(0, 8)}`,
  confirmadoPorId: usuarioId,
  confirmadoEn: new Date(),
  subtotal: "360.00",
  iva: "57.60",
  total: "417.60",
});

/** Lo que deja la recepción: una capa por partida, con su existencia (995-entrada-con-sus-capas.sql). */
async function recibir(tx: Prisma.TransactionClient, id: string) {
  const m = await tx.movimiento.findUniqueOrThrow({ where: { id }, include: { partidas: true } });
  for (const p of m.partidas) {
    await tx.capaCosto.create({
      data: {
        bodegaId, articuloId: p.articuloId, movimientoId: id, fecha: m.fecha, fechaOriginal: m.fecha,
        cantidadInicial: p.cantidad, cantidadRestante: p.cantidad, costoUnitario: p.costoUnitario, costoUnitarioConIva: p.costoUnitarioConIva,
      },
    });
    await tx.existencia.upsert({
      where: { bodegaId_articuloId: { bodegaId, articuloId: p.articuloId } },
      create: { bodegaId, articuloId: p.articuloId, cantidad: p.cantidad },
      update: { cantidad: { increment: p.cantidad } },
    });
  }
}

function confirmar(id: string, extra: Partial<Prisma.MovimientoUncheckedUpdateInput> = {}) {
  return prisma.$transaction(async (tx) => {
    await recibir(tx, id);
    return tx.movimiento.update({ where: { id }, data: { ...CONFIRMACION(), ...extra } });
  });
}

async function confirmada() {
  const m = await entrada();
  await partida(m.id);
  return confirmar(m.id);
}

function articuloNuevo(piezasPorCaja: number | null) {
  return prisma.articulo.create({
    data: { descripcion: `Artículo ${randomUUID().slice(0, 8)}`, unidadId, piezasPorCaja },
  });
}

describe("llave de idempotencia", () => {
  it("una ENTRADA la exige", async () => {
    await expect(entrada({ llaveIdempotencia: null })).rejects.toThrow(/movimiento_entrada_llave_ck/);
  });

  it("es única", async () => {
    const llave = randomUUID();
    await entrada({ llaveIdempotencia: llave });
    await expect(entrada({ llaveIdempotencia: llave })).rejects.toThrow(/Unique constraint/);
  });
});

describe("normalización a la unidad base", () => {
  it("acepta 3 CAJA × 12 = 36", async () => {
    const m = await entrada();
    await expect(partida(m.id)).resolves.toMatchObject({ cantidad: 36 });
  });

  it("rechaza una cantidad que no sea captura × factor", async () => {
    const m = await entrada();
    await expect(partida(m.id, { cantidad: 30 })).rejects.toThrow(/partida_cantidad_normalizada_ck/);
  });

  it("UNIDAD exige factor 1", async () => {
    const m = await entrada();
    await expect(
      partida(m.id, { presentacionCapturada: "UNIDAD", cantidadCapturada: 5, factorConversion: 12, cantidad: 60 }),
    ).rejects.toThrow(/partida_factor_unidad_ck/);
  });

  it("captura y factor son positivos", async () => {
    const m = await entrada();
    await expect(partida(m.id, { cantidadCapturada: 0, cantidad: 0 })).rejects.toThrow(
      /partida_captura_positiva_ck|partida_cantidad_positiva_ck/,
    );
  });

  it("un costo capturado sin costo canónico no tiene sentido", async () => {
    const m = await entrada();
    await expect(partida(m.id, { costoUnitario: null, costoUnitarioConIva: null })).rejects.toThrow(
      /partida_costo_capturado_ck/,
    );
  });
});

describe("el factor de una CAJA sale del catálogo", () => {
  it("un factor que no es piezasPorCaja se rechaza al guardar", async () => {
    const m = await entrada();
    await expect(partida(m.id, { factorConversion: 10, cantidad: 30 })).rejects.toThrow(/no es el del catálogo/);
  });

  it("un artículo sin piezasPorCaja no se captura por caja", async () => {
    const m = await entrada();
    const suelto = await articuloNuevo(null);
    await expect(partida(m.id, { articuloId: suelto.id })).rejects.toThrow(/no se maneja por caja/);
  });

  it("si el catálogo cambia con la partida en borrador, la confirmación se rechaza", async () => {
    const articulo = await articuloNuevo(12);
    const m = await entrada();
    await partida(m.id, { articuloId: articulo.id });
    await prisma.articulo.update({ where: { id: articulo.id }, data: { piezasPorCaja: 24 } });
    await expect(confirmar(m.id)).rejects.toThrow(/pasó de 12 a 24 piezas por caja/);
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id: m.id } })).resolves.toMatchObject({
      estatus: "BORRADOR",
      folio: null,
    });
  });
});

describe("la confirmación es completa o no es", () => {
  it("un movimiento nace en BORRADOR", async () => {
    await expect(entrada({ ...CONFIRMACION() })).rejects.toThrow(/nace en BORRADOR/);
  });

  it("un borrador no tiene confirmador", async () => {
    await expect(entrada({ confirmadoPorId: usuarioId, confirmadoEn: new Date() })).rejects.toThrow(
      /movimiento_borrador_sin_confirmador_ck/,
    );
  });

  it("sin folio, sin actor o sin instante no hay CONFIRMADO", async () => {
    const m = await entrada();
    await partida(m.id);
    await expect(confirmar(m.id, { folio: null })).rejects.toThrow(/movimiento_confirmado_completo_ck/);
    await expect(confirmar(m.id, { confirmadoPorId: null, confirmadoEn: null })).rejects.toThrow(
      /movimiento_confirmado_completo_ck/,
    );
    await expect(confirmar(m.id, { confirmadoEn: null })).rejects.toThrow(/movimiento_confirmado_par_ck/);
  });

  it("sin partidas no hay CONFIRMADO", async () => {
    const m = await entrada();
    await expect(confirmar(m.id)).rejects.toThrow(/sin partidas no se confirma/);
  });

  it("una entrada confirmada trae importes y cada partida trae costo y tasa", async () => {
    const m = await entrada();
    await partida(m.id);
    await expect(confirmar(m.id, { subtotal: null, iva: null, total: null })).rejects.toThrow(
      /movimiento_entrada_confirmada_importes_ck/,
    );
    const sinIva = await entrada();
    await partida(sinIva.id, { tasaIva: null });
    await expect(confirmar(sinIva.id)).rejects.toThrow(/costo y tasa de IVA/);
  });

  it("completa, se confirma", async () => {
    await expect(confirmada()).resolves.toMatchObject({ estatus: "CONFIRMADO" });
  });
});

describe("los datos de otro estado o tipo no se precargan", () => {
  const cancelacion = () => ({ motivoCancelacion: "x", canceladoPorId: usuarioId, canceladoEn: new Date() });
  const actoresDeSalida = (): Prisma.MovimientoUncheckedCreateInput[] => [
    { autorizadoPorId: usuarioId, autorizadoEn: new Date() } as Prisma.MovimientoUncheckedCreateInput,
    { rechazadoPorId: usuarioId, rechazadoEn: new Date(), motivoRechazo: "x" } as Prisma.MovimientoUncheckedCreateInput,
    { entregadoPorId: usuarioId, entregadoEn: new Date() } as Prisma.MovimientoUncheckedCreateInput,
    { recibidoPorId: usuarioId, recibidoEn: new Date() } as Prisma.MovimientoUncheckedCreateInput,
    { entregadoA: "Recep. Magallanes" } as Prisma.MovimientoUncheckedCreateInput,
    { motivo: "conteo" } as Prisma.MovimientoUncheckedCreateInput,
  ];

  it("un borrador no acepta datos de cancelación, ni al crearse ni al guardarse", async () => {
    await expect(entrada(cancelacion())).rejects.toThrow(/movimiento_cancelacion_solo_cancelado_ck/);
    const m = await entrada();
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: cancelacion() })).rejects.toThrow(
      /movimiento_cancelacion_solo_cancelado_ck/,
    );
    await expect(
      prisma.movimiento.update({ where: { id: m.id }, data: { motivoCancelacion: "x" } }),
    ).rejects.toThrow(/movimiento_cancelacion_solo_cancelado_ck/);
  });

  it("una confirmación no cuela datos de cancelación", async () => {
    const m = await entrada();
    await partida(m.id);
    await expect(confirmar(m.id, cancelacion())).rejects.toThrow(/movimiento_cancelacion_solo_cancelado_ck/);
    await expect(confirmar(m.id)).resolves.toMatchObject({
      estatus: "CONFIRMADO",
      motivoCancelacion: null,
      canceladoPorId: null,
      canceladoEn: null,
    });
  });

  it("una entrada nunca lleva actores ni campos de salida o ajuste", async () => {
    const m = await entrada();
    await partida(m.id);
    for (const datos of actoresDeSalida()) {
      const etiqueta = JSON.stringify(datos);
      await expect(entrada(datos), etiqueta).rejects.toThrow(/movimiento_entrada_sin_datos_ajenos_ck/);
      await expect(prisma.movimiento.update({ where: { id: m.id }, data: datos }), etiqueta).rejects.toThrow(
        /movimiento_entrada_sin_datos_ajenos_ck/,
      );
      await expect(confirmar(m.id, datos), etiqueta).rejects.toThrow(/movimiento_entrada_sin_datos_ajenos_ck/);
    }
    await expect(confirmar(m.id)).resolves.toMatchObject({ estatus: "CONFIRMADO", recibidoPorId: null });
  });

  it("descartar un borrador sí es BORRADOR → CANCELADO con sus datos, y exige actor", async () => {
    const m = await entrada();
    await expect(
      prisma.movimiento.update({ where: { id: m.id }, data: { estatus: "CANCELADO", motivoCancelacion: "x" } }),
    ).rejects.toThrow(/movimiento_cancelacion_solo_cancelado_ck/);
    await expect(
      prisma.movimiento.update({ where: { id: m.id }, data: { estatus: "CANCELADO", ...cancelacion() } }),
    ).resolves.toMatchObject({ estatus: "CANCELADO" });
  });
});

describe("un movimiento confirmado es inmutable", () => {
  it("el tipo no cambia después del INSERT", async () => {
    for (const m of [await entrada(), await confirmada()]) {
      await expect(
        prisma.movimiento.update({ where: { id: m.id }, data: { tipo: "AJUSTE", moneda: null, proveedorId: null, motivo: "x" } }),
      ).rejects.toThrow(/Movimiento.tipo es inmutable/);
    }
  });

  it("un borrador sí se edita y se borra", async () => {
    const m = await entrada();
    await expect(prisma.movimiento.update({ where: { id: m.id }, data: { referencia: "F-1" } })).resolves.toBeTruthy();
    await expect(prisma.movimiento.delete({ where: { id: m.id } })).resolves.toBeTruthy();
  });

  it("el encabezado confirmado no cambia, ni siquiera hacia CANCELADO", async () => {
    const m = await confirmada();
    const cambios: Prisma.MovimientoUncheckedUpdateInput[] = [
      { referencia: "otra" },
      { estatus: "BORRADOR" },
      { estatus: "CANCELADO", motivoCancelacion: "x", canceladoPorId: usuarioId, canceladoEn: new Date() },
      { motivoCancelacion: "x", canceladoPorId: usuarioId, canceladoEn: new Date() },
    ];
    for (const data of cambios) {
      await expect(prisma.movimiento.update({ where: { id: m.id }, data }), JSON.stringify(data)).rejects.toThrow(
        /ya no se edita/,
      );
    }
  });

  it("el confirmado no se borra", async () => {
    const m = await confirmada();
    await expect(prisma.movimiento.delete({ where: { id: m.id } })).rejects.toThrow(/no se borra/);
  });

  it("sus partidas no se agregan, cambian ni quitan", async () => {
    const m = await confirmada();
    const [p] = await prisma.movimientoPartida.findMany({ where: { movimientoId: m.id } });
    await expect(prisma.movimientoPartida.update({ where: { id: p.id }, data: { observaciones: "x" } })).rejects.toThrow(
      /no se modifican/,
    );
    await expect(prisma.movimientoPartida.delete({ where: { id: p.id } })).rejects.toThrow(/no se modifican/);
    const otro = await articuloNuevo(12);
    await expect(partida(m.id, { articuloId: otro.id, orden: 2 })).rejects.toThrow(/no se modifican/);
  });

  it("una partida no se muda de un confirmado a un borrador", async () => {
    const cerrado = await confirmada();
    const borrador = await entrada();
    const [p] = await prisma.movimientoPartida.findMany({ where: { movimientoId: cerrado.id } });
    await expect(
      prisma.movimientoPartida.update({ where: { id: p.id }, data: { movimientoId: borrador.id } }),
    ).rejects.toThrow(/no se modifican/);
  });
});

describe("partidas y confirmación toman el mismo bloqueo", () => {
  it("escribir una partida espera a la confirmación en curso y después se rechaza", async () => {
    const m = await entrada();
    await partida(m.id);
    const otro = await articuloNuevo(12);

    let intento!: Promise<unknown>;
    await prisma.$transaction(async (tx) => {
      // La confirmación toma el encabezado; la partida, en otra conexión, se queda esperando.
      await tx.$executeRaw`SELECT 1 FROM "Movimiento" WHERE id = ${m.id}::uuid FOR UPDATE`;
      intento = partida(m.id, { articuloId: otro.id, orden: 2 }).then(
        () => "escribió",
        () => "rechazada",
      );
      const espera = new Promise<string>((r) => setTimeout(() => r("bloqueada"), 300));
      await expect(Promise.race([intento, espera])).resolves.toBe("bloqueada");
      await recibir(tx, m.id);
      await tx.movimiento.update({ where: { id: m.id }, data: CONFIRMACION() });
    });

    await expect(intento).resolves.toBe("rechazada");
    await expect(prisma.movimientoPartida.count({ where: { movimientoId: m.id } })).resolves.toBe(1);
  });
});

describe("fecha del movimiento", () => {
  it("antes del 2000 no hay operación", async () => {
    await expect(entrada({ fecha: aFechaDeBase("1999-12-31") })).rejects.toThrow(/movimiento_fecha_minima_ck/);
    await expect(entrada({ fecha: aFechaDeBase("2000-01-01") })).resolves.toBeTruthy();
  });

  it("no cambia de día entre formulario, Prisma y PostgreSQL, en cualquier zona del proceso", async () => {
    for (const zona of ["UTC", "Asia/Tokyo", "America/Mexico_City"]) {
      process.env.TZ = zona;
      for (const texto of ["2026-09-14", "2024-02-29", "2000-01-01", "2026-12-31"]) {
        const m = await entrada({ fecha: aFechaDeBase(texto) });
        const leida = await prisma.movimiento.findUniqueOrThrow({ where: { id: m.id } });
        expect(deFechaDeBase(leida.fecha), `${zona} ${texto} vía Prisma`).toBe(texto);
        const [fila] = await prisma.$queryRaw<{ dia: string }[]>`
          SELECT to_char(fecha, 'YYYY-MM-DD') AS dia FROM "Movimiento" WHERE id = ${m.id}::uuid`;
        expect(fila.dia, `${zona} ${texto} en PostgreSQL`).toBe(texto);
      }
    }
  });
});
