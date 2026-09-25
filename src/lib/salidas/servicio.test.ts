/*
  Solicitud, autorización, rechazo y cancelación (contrato de la fase 6, §7),
  contra PostgreSQL real y a través del servicio. `como()` imita a
  accionProtegida() —matriz real con la bandera de la sesión, transacción y
  app.usuario_id— para que lo probado sea el servicio y la base.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../../pruebas/semilla-entradas";
import { sembrarSalidas, type EntornoSalidas } from "../../../pruebas/semilla-salidas";
import type { UsuarioSesion } from "../db";
import { deFechaDeBase, hoyEnMexico } from "../fechas";
import { usuarioTienePermiso, type Permiso } from "../permisos";
import {
  autorizarSalida,
  cancelarSalida,
  rechazarSalida,
  solicitarSalida,
  type DatosSolicitud,
  type EncabezadoSolicitado,
} from "./servicio";

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
let compras: UsuarioSesion;
let jefe: UsuarioSesion;

beforeAll(async () => {
  e = await sembrarSalidas(prisma);
  compras = e.usuarios.COMPRAS;
  jefe = e.autorizadores.JEFE;
});
afterAll(() => prisma.$disconnect());

class SinPermiso extends Error {}

function como<T>(usuario: UsuarioSesion, permiso: Permiso, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (!usuarioTienePermiso(usuario, permiso)) return Promise.reject(new SinPermiso(permiso));
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.usuario_id', ${usuario.id}, true)`;
    return fn(tx);
  });
}

// 2 cajas de 12 y 3 piezas sueltas, para la estación, con área y solicitante.
function datos(extra: Partial<EncabezadoSolicitado> = {}, partidas?: DatosSolicitud["partidas"]): DatosSolicitud {
  return {
    encabezado: {
      bodegaOrigenId: e.bodegaId,
      estacionId: e.estacionId,
      areaId: e.areaId,
      solicitadoPorId: e.personaId,
      esPrestamo: false,
      observaciones: "Para mantenimiento",
      ...extra,
    },
    partidas: partidas ?? [
      { articuloId: e.articuloCajaId, presentacion: "CAJA", cantidadCapturada: 2 },
      { articuloId: e.articuloSueltoId, presentacion: "UNIDAD", cantidadCapturada: 3 },
    ],
  };
}

const solicitar = (d = datos(), llave: string = randomUUID(), usuario = compras) =>
  como(usuario, "salidas:capturar", (tx) => solicitarSalida(tx, usuario, llave, d));
const autorizar = (id: string, usuario = jefe) => como(usuario, "salidas:autorizar", (tx) => autorizarSalida(tx, usuario, id));
const rechazar = (id: string, motivo: string, usuario = jefe) =>
  como(usuario, "salidas:autorizar", (tx) => rechazarSalida(tx, usuario, id, motivo));
const cancelar = (id: string, motivo: string, usuario = compras) =>
  como(usuario, "salidas:capturar", (tx) => cancelarSalida(tx, usuario, id, motivo));

const leer = (id: string) => prisma.movimiento.findUniqueOrThrow({ where: { id }, include: { partidas: { orderBy: { orden: "asc" } } } });
const existencias = (bodegaId: string) => prisma.existencia.findMany({ where: { bodegaId }, orderBy: { articuloId: "asc" } });
const folioSalida = async () => (await prisma.folio.findUniqueOrThrow({ where: { tipo: "SALIDA" } })).siguiente;

describe("solicitud", () => {
  it("nace SOLICITADA con partidas en unidad base, sin folio ni efecto en inventario", async () => {
    const antes = await existencias(e.bodegaId);
    const folio = await folioSalida();
    const { id, repetido } = await solicitar();
    expect(repetido).toBe(false);

    const m = await leer(id);
    expect(m).toMatchObject({
      tipo: "SALIDA",
      estatus: "SOLICITADA",
      folio: null,
      creadoPorId: compras.id,
      bodegaOrigenId: e.bodegaId,
      estacionId: e.estacionId,
      areaId: e.areaId,
      solicitadoPorId: e.personaId,
      autorizadoPorId: null,
      entregadoPorId: null,
    });
    expect(deFechaDeBase(m.fecha)).toBe(hoyEnMexico());
    expect(m.partidas.map((p) => [p.orden, p.presentacionCapturada, p.cantidadCapturada, p.factorConversion, p.cantidad])).toEqual([
      [1, "CAJA", 2, 12, 24],
      [2, "UNIDAD", 3, 1, 3],
    ]);
    expect(m.partidas.every((p) => p.costoUnitario === null && p.costoUnitarioCapturado === null)).toBe(true);
    await expect(existencias(e.bodegaId)).resolves.toEqual(antes);
    await expect(folioSalida()).resolves.toBe(folio);
    await expect(prisma.consumoCapa.count({ where: { partida: { movimientoId: id } } })).resolves.toBe(0);
  });

  it("el factor sale del catálogo aunque el navegador mande otro", async () => {
    const d = datos();
    (d.partidas[0] as unknown as Record<string, unknown>).factorConversion = 99;
    (d.partidas[0] as unknown as Record<string, unknown>).cantidad = 1;
    const { id } = await solicitar(d);
    const [caja] = (await leer(id)).partidas;
    expect(caja).toMatchObject({ factorConversion: 12, cantidad: 24 });
  });

  it("el actor sale de la sesión: creadoPorId no se toma de los datos", async () => {
    const d = datos();
    (d.encabezado as unknown as Record<string, unknown>).creadoPorId = e.usuarios.SUPERADMIN.id;
    const { id } = await solicitar(d);
    await expect(leer(id)).resolves.toMatchObject({ creadoPorId: compras.id });
  });

  it("valida partidas: al menos una, sin repetir artículo, cantidades enteras y caja solo si el artículo la tiene", async () => {
    const p = datos().partidas[1];
    await expect(solicitar(datos({}, []))).rejects.toMatchObject({ codigo: "partidas" });
    await expect(solicitar(datos({}, [p, { ...p }]))).rejects.toMatchObject({ codigo: "partidas" });
    await expect(solicitar(datos({}, [{ ...p, cantidadCapturada: 1.5 }]))).rejects.toMatchObject({ codigo: "partidas" });
    await expect(solicitar(datos({}, [{ ...p, cantidadCapturada: 0 }]))).rejects.toMatchObject({ codigo: "partidas" });
    await expect(solicitar(datos({}, [{ ...p, presentacion: "CAJA" }]))).rejects.toMatchObject({ codigo: "partidas" });
  });

  it("rechaza catálogo inexistente o dado de baja; área y solicitante son opcionales", async () => {
    const baja = await articuloNuevo(prisma, e.unidadId, null);
    await prisma.articulo.update({ where: { id: baja.id }, data: { activo: false } });
    const area = await prisma.area.create({ data: { nombre: `Área baja ${randomUUID().slice(0, 8)}`, activa: false } });
    const persona = await prisma.persona.create({ data: { nombre: `Persona baja ${randomUUID().slice(0, 8)}`, activa: false } });

    await expect(solicitar(datos({}, [{ articuloId: baja.id, presentacion: "UNIDAD", cantidadCapturada: 1 }]))).rejects.toMatchObject({ codigo: "catalogo" });
    await expect(solicitar(datos({ areaId: area.id }))).rejects.toMatchObject({ codigo: "catalogo" });
    await expect(solicitar(datos({ solicitadoPorId: persona.id }))).rejects.toMatchObject({ codigo: "catalogo" });
    await expect(solicitar(datos({ estacionId: randomUUID() }))).rejects.toMatchObject({ codigo: "catalogo" });
    await expect(solicitar(datos({ bodegaOrigenId: randomUUID() }))).rejects.toMatchObject({ codigo: "catalogo" });

    const { id } = await solicitar(datos({ areaId: null, solicitadoPorId: null, esPrestamo: true }));
    await expect(leer(id)).resolves.toMatchObject({ areaId: null, solicitadoPorId: null, esPrestamo: true });
  });

  it("JEFE no captura, aunque pueda autorizar", async () => {
    await expect(solicitar(datos(), randomUUID(), jefe)).rejects.toBeInstanceOf(SinPermiso);
  });

  it("el servicio limita las partidas aunque se invoque sin pasar por el formulario", async () => {
    const partidas = Array.from({ length: 201 }, () => ({
      articuloId: randomUUID(), presentacion: "UNIDAD" as const, cantidadCapturada: 1,
    }));
    await expect(solicitar(datos({}, partidas))).rejects.toMatchObject({
      codigo: "partidas", message: "Demasiadas partidas en una sola salida.",
    });
  });

  it("una baja de artículo espera a que confirme la captura que ya lo validó", async () => {
    const articulo = await articuloNuevo(prisma, e.unidadId, null);
    const d = datos({}, [{ articuloId: articulo.id, presentacion: "UNIDAD", cantidadCapturada: 1 }]);
    let baja!: Promise<string>;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.usuario_id', ${compras.id}, true)`;
      await solicitarSalida(tx, compras, randomUUID(), d);
      baja = prisma.articulo.update({ where: { id: articulo.id }, data: { activo: false } }).then(() => "aplicada");
      const espera = new Promise<string>((r) => setTimeout(() => r("bloqueada"), 300));
      await expect(Promise.race([baja, espera])).resolves.toBe("bloqueada");
    });
    await expect(baja).resolves.toBe("aplicada");
  });
});

describe("idempotencia del alta", () => {
  it("repetir la llave con la misma captura devuelve la misma solicitud", async () => {
    const llave = randomUUID();
    const primero = await solicitar(datos(), llave);
    await expect(solicitar(datos(), llave)).resolves.toEqual({ id: primero.id, repetido: true });
    await expect(prisma.movimiento.count({ where: { llaveIdempotencia: llave } })).resolves.toBe(1);
  });

  it("también cuando llegan al mismo tiempo", async () => {
    const llave = randomUUID();
    const resultados = await Promise.all([solicitar(datos(), llave), solicitar(datos(), llave), solicitar(datos(), llave)]);
    expect(new Set(resultados.map((r) => r.id)).size).toBe(1);
    expect(resultados.filter((r) => r.repetido)).toHaveLength(2);
  });

  it("la llave no concede acceso: otra captura, otro usuario o una llave de entrada son conflicto", async () => {
    const llave = randomUUID();
    await solicitar(datos(), llave);
    await expect(solicitar(datos({ observaciones: "otra cosa" }), llave)).rejects.toMatchObject({ codigo: "conflicto-idempotencia" });
    await expect(solicitar(datos(), llave, e.usuarios.SUPERADMIN)).rejects.toMatchObject({ codigo: "conflicto-idempotencia" });

    const llaveDeEntrada = randomUUID();
    await prisma.movimiento.create({
      data: {
        tipo: "ENTRADA", estatus: "BORRADOR", fecha: new Date("2026-09-10"), moneda: "MXN",
        proveedorId: e.proveedorId, bodegaDestinoId: e.bodegaId, creadoPorId: compras.id, llaveIdempotencia: llaveDeEntrada,
      },
    });
    await expect(solicitar(datos(), llaveDeEntrada)).rejects.toMatchObject({ codigo: "conflicto-idempotencia" });
  });

  it("la firma cubre cada dato capturado, y no depende de espacios ni mayúsculas del UUID", async () => {
    const llave = randomUUID();
    const { id } = await solicitar(datos(), llave);
    const d = datos({ observaciones: "  Para mantenimiento ", estacionId: e.estacionId.toUpperCase() });
    await expect(solicitar(d, llave)).resolves.toEqual({ id, repetido: true });

    const variantes: [string, DatosSolicitud][] = [
      ["préstamo", datos({ esPrestamo: true })],
      ["área", datos({ areaId: null })],
      ["solicitante", datos({ solicitadoPorId: null })],
      ["cantidad", datos({}, [{ articuloId: e.articuloCajaId, presentacion: "CAJA", cantidadCapturada: 3 }, datos().partidas[1]])],
      ["presentación", datos({}, [{ articuloId: e.articuloCajaId, presentacion: "UNIDAD", cantidadCapturada: 2 }, datos().partidas[1]])],
      ["observaciones de partida", datos({}, [{ ...datos().partidas[0], observaciones: "urgente" }, datos().partidas[1]])],
    ];
    for (const [nombre, variante] of variantes) {
      await expect(solicitar(variante, llave), nombre).rejects.toMatchObject({ codigo: "conflicto-idempotencia" });
    }
  });

  it("un reintento después de una baja de catálogo devuelve la solicitud guardada", async () => {
    const articulo = await articuloNuevo(prisma, e.unidadId, null);
    const d = datos({}, [{ articuloId: articulo.id, presentacion: "UNIDAD", cantidadCapturada: 1 }]);
    const llave = randomUUID();
    const { id } = await solicitar(d, llave);
    await prisma.articulo.update({ where: { id: articulo.id }, data: { activo: false } });
    await expect(solicitar(d, llave)).resolves.toEqual({ id, repetido: true });
  });
});

describe("autorización", () => {
  it("guarda actor e instante sin descontar existencia ni asignar folio", async () => {
    const { id } = await solicitar();
    const antes = await existencias(e.bodegaId);
    const folio = await folioSalida();
    await expect(autorizar(id)).resolves.toEqual({ id, estatus: "AUTORIZADA", repetido: false });
    const m = await leer(id);
    expect(m).toMatchObject({ estatus: "AUTORIZADA", autorizadoPorId: jefe.id, folio: null });
    expect(m.autorizadoEn).not.toBeNull();
    await expect(existencias(e.bodegaId)).resolves.toEqual(antes);
    await expect(folioSalida()).resolves.toBe(folio);
  });

  it("repetir devuelve el resultado original sin cambiar actor ni instante, también en doble clic", async () => {
    const { id } = await solicitar();
    const resultados = await Promise.all([autorizar(id), autorizar(id)]);
    expect(resultados.map((r) => r.repetido).sort()).toEqual([false, true]);
    const original = await leer(id);
    await expect(autorizar(id, e.autorizadores.COMPRAS)).resolves.toEqual({ id, estatus: "AUTORIZADA", repetido: true });
    await expect(leer(id)).resolves.toMatchObject({ autorizadoPorId: original.autorizadoPorId, autorizadoEn: original.autorizadoEn });
  });

  it("sin la bandera ningún rol autoriza ni rechaza; con ella, cualquiera", async () => {
    for (const rol of ["SUPERADMIN", "COMPRAS", "JEFE"] as const) {
      const { id } = await solicitar();
      await expect(autorizar(id, e.usuarios[rol]), rol).rejects.toBeInstanceOf(SinPermiso);
      await expect(rechazar(id, "no", e.usuarios[rol]), rol).rejects.toBeInstanceOf(SinPermiso);
      await expect(autorizar(id, e.autorizadores[rol]), rol).resolves.toMatchObject({ estatus: "AUTORIZADA", repetido: false });
    }
  });

  it("no autoriza lo rechazado ni lo cancelado; una salida inexistente o de otro tipo no existe", async () => {
    const a = await solicitar();
    await rechazar(a.id, "No procede");
    await expect(autorizar(a.id)).rejects.toMatchObject({ codigo: "estado" });
    const b = await solicitar();
    await cancelar(b.id, "Error de captura");
    await expect(autorizar(b.id)).rejects.toMatchObject({ codigo: "estado" });
    await expect(autorizar(randomUUID())).rejects.toMatchObject({ codigo: "no-encontrado" });
    const entrada = await prisma.movimiento.create({
      data: {
        tipo: "ENTRADA", estatus: "BORRADOR", fecha: new Date("2026-09-10"), moneda: "MXN",
        proveedorId: e.proveedorId, bodegaDestinoId: e.bodegaId, creadoPorId: compras.id, llaveIdempotencia: randomUUID(),
      },
    });
    await expect(autorizar(entrada.id)).rejects.toMatchObject({ codigo: "no-encontrado", message: "La salida no existe." });
  });
});

describe("rechazo y cancelación", () => {
  it("rechazar exige motivo, es terminal y repetirlo con otro motivo es conflicto", async () => {
    const { id } = await solicitar();
    await expect(rechazar(id, "   ")).rejects.toMatchObject({ codigo: "datos" });
    await expect(rechazar(id, " Sin presupuesto ")).resolves.toEqual({ id, estatus: "RECHAZADA", repetido: false });
    const m = await leer(id);
    expect(m).toMatchObject({ estatus: "RECHAZADA", motivoRechazo: "Sin presupuesto", rechazadoPorId: jefe.id });

    await expect(rechazar(id, "Sin presupuesto", e.autorizadores.COMPRAS)).resolves.toEqual({ id, estatus: "RECHAZADA", repetido: true });
    await expect(leer(id)).resolves.toMatchObject({ rechazadoPorId: jefe.id, rechazadoEn: m.rechazadoEn });
    await expect(rechazar(id, "Otro motivo")).rejects.toMatchObject({ codigo: "conflicto" });
    await expect(cancelar(id, "x")).rejects.toMatchObject({ codigo: "estado" });
  });

  it("no se rechaza una salida ya autorizada", async () => {
    const { id } = await solicitar();
    await autorizar(id);
    await expect(rechazar(id, "tarde")).rejects.toMatchObject({ codigo: "estado" });
  });

  it("cancela solicitadas y autorizadas, con motivo y actor, sin mover inventario", async () => {
    const antes = await existencias(e.bodegaId);
    const a = await solicitar();
    const b = await solicitar();
    await autorizar(b.id);
    await expect(cancelar(a.id, "")).rejects.toMatchObject({ codigo: "datos" });
    for (const { id } of [a, b]) {
      await expect(cancelar(id, "Error de captura")).resolves.toEqual({ id, estatus: "CANCELADO", repetido: false });
      await expect(leer(id)).resolves.toMatchObject({ estatus: "CANCELADO", motivoCancelacion: "Error de captura", canceladoPorId: compras.id });
      await expect(cancelar(id, "Error de captura", e.usuarios.SUPERADMIN)).resolves.toMatchObject({ repetido: true });
      await expect(cancelar(id, "Otro motivo")).rejects.toMatchObject({ codigo: "conflicto" });
    }
    // La autorización histórica sobrevive a la cancelación.
    await expect(leer(b.id)).resolves.toMatchObject({ autorizadoPorId: jefe.id });
    await expect(existencias(e.bodegaId)).resolves.toEqual(antes);
  });

  it("JEFE no cancela, aunque pueda autorizar", async () => {
    const { id } = await solicitar();
    await expect(cancelar(id, "no", jefe)).rejects.toBeInstanceOf(SinPermiso);
  });
});

describe("bitácora", () => {
  it("cada transición queda anotada con su actor", async () => {
    const { id } = await solicitar();
    await autorizar(id);
    await cancelar(id, "Ya no se necesita");
    const renglones = await prisma.bitacora.findMany({ where: { tabla: "Movimiento", registroId: id }, orderBy: { ocurridoEn: "asc" } });
    const estatus = (r: (typeof renglones)[number]) => (r.despues as { estatus?: string } | null)?.estatus;
    expect(renglones.map((r) => [r.accion, estatus(r), r.usuarioId])).toEqual([
      ["INSERTAR", "SOLICITADA", compras.id],
      ["ACTUALIZAR", "AUTORIZADA", jefe.id],
      ["ACTUALIZAR", "CANCELADO", compras.id],
    ]);
  });
});
