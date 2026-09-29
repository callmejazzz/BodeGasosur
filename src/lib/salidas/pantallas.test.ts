/*
  Lo que lee cada pantalla según quién la abre, contra PostgreSQL real. Lo
  que el usuario no puede ver ni usar no se consulta: se espía el repositorio
  para comprobar que esas lecturas ni siquiera se hacen.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../../pruebas/semilla-entradas";
import { sembrarCapa } from "../../../pruebas/semilla-inventario";
import { sembrarSalidas, type EntornoSalidas } from "../../../pruebas/semilla-salidas";
import type { UsuarioSesion } from "@/lib/db";
import { autorizarSalida, retirarSalida, solicitarSalida, type PartidaSolicitada } from "./servicio";

vi.mock("server-only", () => ({}));
vi.mock("./repo", async (original) => {
  const real = await original<typeof import("./repo")>();
  return {
    ...real,
    obtenerSalida: vi.fn(real.obtenerSalida),
    existenciasDeSalida: vi.fn(real.existenciasDeSalida),
    valuarSalida: vi.fn(real.valuarSalida),
  };
});
const repo = await import("./repo");
const { datosDeDetalle, datosDeLista, facultadesSobre } = await import("./pantallas");

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
let articuloId: string;
let solicitada: string;
let autorizada: string;
let retirada: string;

const enTx = <T>(usuarioId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.usuario_id', ${usuarioId}, true)`;
    return fn(tx);
  });

async function nueva(hasta: "SOLICITADA" | "AUTORIZADA" | "RETIRADA", partidas: PartidaSolicitada[] = [{ articuloId, presentacion: "UNIDAD", cantidadCapturada: 1 }]) {
  const compras = e.usuarios.COMPRAS;
  const jefe = e.autorizadores.JEFE;
  const { id } = await enTx(compras.id, (tx) =>
    solicitarSalida(tx, compras, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, estacionId: e.estacionId }, partidas }),
  );
  if (hasta === "SOLICITADA") return id;
  await enTx(jefe.id, (tx) => autorizarSalida(tx, jefe, id));
  if (hasta === "RETIRADA") await enTx(compras.id, (tx) => retirarSalida(tx, compras, id, "Mensajero"));
  return id;
}

const detalle = (u: UsuarioSesion, id: string) => prisma.$transaction((tx) => datosDeDetalle(tx, u, id));

beforeAll(async () => {
  e = await sembrarSalidas(prisma);
  articuloId = (await articuloNuevo(prisma, e.unidadId, null)).id;
  await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId, cantidad: 10, fechaOriginal: "2026-09-01", costo: ["2.0000", "2.3200"] });
  solicitada = await nueva("SOLICITADA");
  autorizada = await nueva("AUTORIZADA");
  retirada = await nueva("RETIRADA");
});
afterAll(() => prisma.$disconnect());
beforeEach(() => vi.clearAllMocks());

describe("botones por estatus y permiso", () => {
  it("cada quien ve solo lo que puede hacer en ese estatus", () => {
    const { usuarios: u, autorizadores: a } = e;
    const nada = { autorizar: false, cancelar: false, retirar: false, recibir: false };
    expect(facultadesSobre(u.JEFE, "SOLICITADA")).toEqual(nada);
    expect(facultadesSobre(a.JEFE, "SOLICITADA")).toEqual({ ...nada, autorizar: true });
    expect(facultadesSobre(u.COMPRAS, "SOLICITADA")).toEqual({ ...nada, cancelar: true });
    expect(facultadesSobre(a.COMPRAS, "SOLICITADA")).toEqual({ ...nada, autorizar: true, cancelar: true });
    expect(facultadesSobre(a.JEFE, "AUTORIZADA")).toEqual(nada);
    expect(facultadesSobre(u.COMPRAS, "AUTORIZADA")).toEqual({ ...nada, cancelar: true, retirar: true });
    expect(facultadesSobre(u.COMPRAS, "RETIRADA")).toEqual({ ...nada, recibir: true });
    for (const estatus of ["RECIBIDA", "RECHAZADA", "CANCELADO"] as const) {
      expect(facultadesSobre(a.SUPERADMIN, estatus), estatus).toEqual(nada);
    }
  });
});

describe("detalle", () => {
  it("la existencia solo se consulta para quien puede retirar, y solo mientras se puede", async () => {
    const jefe = await detalle(e.autorizadores.JEFE, autorizada);
    expect(jefe?.existencias).toBeNull();
    expect(repo.existenciasDeSalida).not.toHaveBeenCalled();

    const antesDeAutorizar = await detalle(e.usuarios.COMPRAS, solicitada);
    expect(antesDeAutorizar?.existencias).toBeNull();
    expect(repo.existenciasDeSalida).not.toHaveBeenCalled();

    const compras = await detalle(e.usuarios.COMPRAS, autorizada);
    const hay = await prisma.existencia.findUniqueOrThrow({ where: { bodegaId_articuloId: { bodegaId: e.bodegaId, articuloId } } });
    expect(compras?.existencias).toEqual({ [articuloId]: hay.cantidad });
    expect(repo.existenciasDeSalida).toHaveBeenCalledTimes(1);
  });

  it("la valuación solo se consulta cuando ya salió material", async () => {
    await detalle(e.autorizadores.SUPERADMIN, autorizada);
    expect(repo.valuarSalida).not.toHaveBeenCalled();
    const d = await detalle(e.usuarios.JEFE, retirada);
    expect(d?.valuacion).toEqual({ importe: "2.00", importeConIva: "2.32", piezasSinCosto: 0 });
  });

  it("un id que no es UUID no llega a la base; uno ajeno es null", async () => {
    await expect(detalle(e.usuarios.COMPRAS, "no-es-uuid")).resolves.toBeNull();
    expect(repo.obtenerSalida).not.toHaveBeenCalled();
    await expect(detalle(e.usuarios.COMPRAS, randomUUID())).resolves.toBeNull();
  });

  it("avisa antes de retirar lo que el catálogo cambió desde la solicitud", async () => {
    const caja = await articuloNuevo(prisma, e.unidadId, 12);
    await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: caja.id, cantidad: 24, fechaOriginal: "2026-09-01", costo: null });
    const id = await nueva("AUTORIZADA", [{ articuloId: caja.id, presentacion: "CAJA", cantidadCapturada: 1 }]);
    await expect(detalle(e.usuarios.COMPRAS, id).then((d) => d?.avisos)).resolves.toEqual([]);

    await prisma.articulo.update({ where: { id: caja.id }, data: { piezasPorCaja: 10, activo: false } });
    await expect(detalle(e.usuarios.COMPRAS, id).then((d) => d?.avisos)).resolves.toEqual([
      `${caja.clave} está dado de baja.`,
      `${caja.clave} pasó de 12 a 10 piezas por caja.`,
    ]);
    // Ya retirada no hay nada que avisar.
    await expect(detalle(e.usuarios.COMPRAS, retirada).then((d) => d?.avisos)).resolves.toEqual([]);
  });
});

describe("lista", () => {
  it("lee los filtros de la URL y solo cuenta pendientes a quien puede atenderlos", async () => {
    const lista = (u: UsuarioSesion, params: Record<string, string>) => prisma.$transaction((tx) => datosDeLista(tx, u, params));

    const jefe = await lista(e.usuarios.JEFE, { estatus: "autorizadas", q: "  " });
    expect(jefe).toMatchObject({ filtros: { estatus: "autorizadas", busqueda: "" }, puedeCapturar: false, pendientes: null });
    expect(jefe.filas.every((f) => f.estatus === "AUTORIZADA")).toBe(true);
    expect(jefe.filas.map((f) => f.id)).toContain(autorizada);

    const compras = await lista(e.usuarios.COMPRAS, {});
    expect(compras).toMatchObject({ puedeCapturar: true, pendientes: expect.any(Number) });
  });
});
