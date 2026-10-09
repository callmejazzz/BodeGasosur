/*
  La lista de entradas: búsqueda tolerante (clave_normalizada), filtros de
  referencia y fechas, y el orden —borradores primero por último toque, el
  resto por creación—. Contra PostgreSQL real, a través del repositorio.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { sembrarEntorno, type Entorno } from "../../../pruebas/semilla-entradas";
import { SIN_FILTROS, type FiltroEntradas } from "./filtros";
import { confirmarEntrada, crearBorrador, guardarBorrador, type DatosBorrador } from "./servicio";

vi.mock("server-only", () => ({}));
const { listarEntradas } = await import("./repo");

const prisma = crearCliente(URL_PRUEBAS);
let e: Entorno;
let conReferencia: string;
let sinReferencia: string;
let borradorViejo: string;
let borradorNuevo: string;

function datos(extra: Partial<DatosBorrador["encabezado"]> = {}): DatosBorrador {
  return {
    encabezado: { proveedorId: e.proveedorId, bodegaDestinoId: e.bodegaId, fecha: "2026-09-10", moneda: "MXN", referencia: null, ...extra },
    partidas: [{ articuloId: e.articuloSueltoId, presentacion: "UNIDAD", cantidadCapturada: 1, costoUnitarioCapturado: "1", tasaIva: "0" }],
  };
}

const enTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.usuario_id', ${e.usuarios.COMPRAS.id}, true)`;
    return fn(tx);
  });

async function confirmada(extra: Partial<DatosBorrador["encabezado"]>) {
  const { id } = await enTx((tx) => crearBorrador(tx, e.usuarios.COMPRAS, randomUUID(), datos(extra)));
  await enTx((tx) => confirmarEntrada(tx, e.usuarios.COMPRAS, id));
  return id;
}

beforeAll(async () => {
  e = await sembrarEntorno(prisma);
  conReferencia = await confirmada({ referencia: "FAC-77", fecha: "2026-09-01" });
  sinReferencia = await confirmada({ fecha: "2026-09-10" });
  borradorViejo = (await enTx((tx) => crearBorrador(tx, e.usuarios.COMPRAS, randomUUID(), datos({ fecha: "2026-09-14" })))).id;
  borradorNuevo = (await enTx((tx) => crearBorrador(tx, e.usuarios.COMPRAS, randomUUID(), datos({ fecha: "2026-09-15" })))).id;
  // Tocar el viejo lo vuelve el más reciente.
  await enTx((tx) => guardarBorrador(tx, e.usuarios.COMPRAS, borradorViejo, datos({ fecha: "2026-09-13" })));
});
afterAll(() => prisma.$disconnect());

/** Solo las entradas de esta prueba: comparten proveedor. */
const listar = (f: Partial<FiltroEntradas>) =>
  prisma.$transaction((tx) => listarEntradas(tx, { ...SIN_FILTROS, ...f })).then((r) => r.filas.filter((x) => x.proveedor?.nombreComercial === e.proveedorNombre));

describe("clave_normalizada", () => {
  it("quita guiones y ceros a la izquierda del número, y no distingue mayúsculas", async () => {
    const casos = ["E-000001", "e1", "E-1", "bdg-00010", "BDG 10", "E-100", "0002", "-", ""];
    const filas = await prisma.$queryRaw<{ r: string }[]>`SELECT clave_normalizada(x) AS r FROM unnest(${casos}::text[]) AS x`;
    expect(filas.map((f) => f.r)).toEqual(["e1", "e1", "e1", "bdg10", "bdg 10", "e100", "2", "", ""]);
  });
});

describe("listarEntradas", () => {
  it("encuentra por folio tolerante, por clave y nombre de bodega, referencia y proveedor", async () => {
    const [{ folio }] = await prisma.movimiento.findMany({ where: { id: conReferencia }, select: { folio: true } });
    const numero = String(Number(folio!.replace(/\D/g, "")));
    for (const q of [folio!.toLowerCase(), `e${numero}`, `E-${numero}`, `e-000${numero}`]) {
      expect((await listar({ busqueda: q })).map((x) => x.id), q).toContain(conReferencia);
    }
    const bodega = await prisma.bodega.findUniqueOrThrow({ where: { id: e.bodegaId } });
    expect((await listar({ busqueda: bodega.clave.replace("-", "").replace(/0+/, "").toLowerCase() })).length).toBeGreaterThanOrEqual(4);
    expect((await listar({ busqueda: bodega.nombre.slice(0, 6).toUpperCase() })).length).toBeGreaterThanOrEqual(4);
    expect((await listar({ busqueda: "fac-7" })).map((x) => x.id)).toEqual([conReferencia]);
    expect((await listar({ busqueda: e.proveedorNombre })).length).toBe(4);
    expect(await listar({ busqueda: "--" })).toEqual([]);
  });

  it("con y sin referencia, y rango de fechas", async () => {
    expect((await listar({ referencia: "con" })).map((x) => x.id)).toEqual([conReferencia]);
    expect((await listar({ referencia: "sin" })).map((x) => x.id)).not.toContain(conReferencia);
    expect((await listar({ desde: "2026-09-02", hasta: "2026-09-10" })).map((x) => x.id)).toEqual([sinReferencia]);
    expect((await listar({ desde: "2026-09-13" })).map((x) => x.id).sort()).toEqual([borradorNuevo, borradorViejo].sort());
    expect((await listar({ hasta: "2026-09-01" })).map((x) => x.id)).toEqual([conReferencia]);
  });

  it("los borradores van primero por último toque; el resto por creación, la más nueva arriba", async () => {
    expect((await listar({})).map((x) => x.id)).toEqual([borradorViejo, borradorNuevo, sinReferencia, conReferencia]);
    expect((await listar({ estatus: "confirmadas" })).map((x) => x.id)).toEqual([sinReferencia, conReferencia]);
    expect((await listar({ estatus: "borradores" })).map((x) => x.id)).toEqual([borradorViejo, borradorNuevo]);
  });

  it("muestra 100 por página: la 101 abre la segunda, y pasada la última se queda en la última", async () => {
    const proveedor = await prisma.proveedor.create({ data: { nombreComercial: `Mayorista ${randomUUID().slice(0, 8)}`, razonSocial: "Mayorista SA" } });
    await prisma.movimiento.createMany({
      data: Array.from({ length: 101 }, () => ({
        tipo: "ENTRADA" as const,
        estatus: "BORRADOR" as const,
        fecha: new Date("2026-09-01T00:00:00Z"),
        moneda: "MXN",
        proveedorId: proveedor.id,
        bodegaDestinoId: e.bodegaId,
        creadoPorId: e.usuarios.COMPRAS.id,
        llaveIdempotencia: randomUUID(),
      })),
    });
    const pagina = (n: number) => prisma.$transaction((tx) => listarEntradas(tx, { ...SIN_FILTROS, busqueda: proveedor.nombreComercial }, n));
    const [primera, segunda, novena] = [await pagina(1), await pagina(2), await pagina(9)];
    expect(primera.filas).toHaveLength(100);
    expect(primera.pagina).toEqual({ actual: 1, ultima: 2, total: 101 });
    expect(segunda.filas).toHaveLength(1);
    expect(segunda.pagina).toEqual({ actual: 2, ultima: 2, total: 101 });
    expect(novena).toEqual(segunda);
    // Ninguna se repite ni se pierde entre páginas.
    expect(new Set([...primera.filas, ...segunda.filas].map((f) => f.id)).size).toBe(101);
  });
});
