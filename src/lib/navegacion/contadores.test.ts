/*
  Contadores de la barra lateral contra PostgreSQL real: cada N es lo que
  muestra su pantalla con el filtro que le corresponde, y sin el permiso de
  esa pantalla el contador no se consulta. En salidas cuentan las que les
  falta un paso: ni recibidas, ni rechazadas, ni canceladas, ni revertidas.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { sembrarCapa } from "../../../pruebas/semilla-inventario";
import { como as comoEn, sembrarOperacion } from "../../../pruebas/semilla-operacion";
import type { EntornoSalidas } from "../../../pruebas/semilla-salidas";
import type { UsuarioSesion } from "../db";
import { SIN_FILTROS as SIN_FILTROS_ENTRADAS } from "../entradas/filtros";
import { aFechaDeBase } from "../fechas";
import { abrirHoja } from "../inventario/conteos";
import { crearDevolucion } from "../inventario/devoluciones";
import { revertirMovimiento } from "../inventario/reversas";
import { crearTraspaso } from "../inventario/traspasos";
import type { Permiso } from "../permisos";
import { autorizarSalida, cancelarSalida, confirmarRecepcion, rechazarSalida, retirarSalida, solicitarSalida } from "../salidas/servicio";

vi.mock("server-only", () => ({}));
const { leerContadores } = await import("./contadores");
const { listarEntradas } = await import("../entradas/repo");
const { listarHojas, listarMovimientos, listarPrestamos } = await import("../inventario/repo");
const { contarArticulosBajoMinimo } = await import("../reportes/existencias");
const { listarSalidas } = await import("../salidas/repo");
const { todasLasPaginas } = await import("../exportar/lotes");

const prisma = crearCliente(URL_PRUEBAS);
afterAll(() => prisma.$disconnect());

let e: EntornoSalidas;
let articuloId: string;
const salidas: Record<"solicitada" | "autorizada" | "retirada" | "prestamo" | "recibida" | "rechazada" | "cancelada" | "revertida", string> = {
  solicitada: "", autorizada: "", retirada: "", prestamo: "", recibida: "", rechazada: "", cancelada: "", revertida: "",
};

const como = <T>(u: UsuarioSesion, permiso: Permiso, fn: (tx: Prisma.TransactionClient) => Promise<T>) => comoEn(prisma, u, permiso, fn);
const leer = <T>(fn: (db: Prisma.TransactionClient) => Promise<T>) =>
  prisma.$transaction(async (db) => {
    await db.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return fn(db);
  });
const partida = (n = 1) => ({ articuloId, presentacion: "UNIDAD" as const, cantidadCapturada: n });

async function salida(hasta: "solicitar" | "autorizar" | "retirar", esPrestamo = false) {
  const u = e.usuarios.COMPRAS;
  const { id } = await como(u, "salidas:capturar", (tx) =>
    solicitarSalida(tx, u, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, estacionId: e.estacionId, esPrestamo }, partidas: [partida()] }),
  );
  if (hasta === "solicitar") return id;
  await como(e.autorizadores.JEFE, "salidas:autorizar", (tx) => autorizarSalida(tx, e.autorizadores.JEFE, id));
  if (hasta === "retirar") await como(u, "salidas:retirar", (tx) => retirarSalida(tx, u, id, "Mensajero"));
  return id;
}

beforeAll(async () => {
  e = await sembrarOperacion(prisma);
  const u = e.usuarios.COMPRAS;
  ({ id: articuloId } = await prisma.articulo.create({ data: { descripcion: `Contadores ${randomUUID().slice(0, 8)}`, unidadId: e.unidadId, stockMinimo: 100 } }));
  await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId, cantidad: 30, fechaOriginal: "2026-01-05", costo: ["10.00", "11.60"] });

  salidas.solicitada = await salida("solicitar");
  salidas.autorizada = await salida("autorizar");
  salidas.retirada = await salida("retirar");
  salidas.prestamo = await salida("retirar", true);
  salidas.recibida = await salida("retirar");
  await como(u, "salidas:recibir", (tx) => confirmarRecepcion(tx, u, salidas.recibida));
  salidas.rechazada = await salida("solicitar");
  await como(e.autorizadores.JEFE, "salidas:autorizar", (tx) => rechazarSalida(tx, e.autorizadores.JEFE, salidas.rechazada, "No procede"));
  salidas.cancelada = await salida("autorizar");
  await como(u, "salidas:capturar", (tx) => cancelarSalida(tx, u, salidas.cancelada, "Ya no se necesita"));
  salidas.revertida = await salida("retirar");
  const admin = e.usuarios.SUPERADMIN;
  await como(admin, "movimientos:revertir", (tx) => revertirMovimiento(tx, admin, salidas.revertida, "Error de captura"));

  // Un borrador de cada módulo
  await prisma.movimiento.create({
    data: {
      tipo: "ENTRADA", estatus: "BORRADOR", fecha: aFechaDeBase("2026-11-01"), bodegaDestinoId: e.bodegaId, proveedorId: e.proveedorId,
      moneda: "MXN", llaveIdempotencia: randomUUID(), creadoPorId: u.id,
    },
  });
  await como(u, "traspasos:capturar", (tx) =>
    crearTraspaso(tx, u, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, bodegaDestinoId: e.otraBodegaId }, partidas: [partida()] }),
  );
  await como(u, "devoluciones:capturar", (tx) =>
    crearDevolucion(tx, u, randomUUID(), { encabezado: { estacionId: e.estacionId, bodegaDestinoId: e.bodegaId, salidaId: salidas.retirada }, partidas: [partida()] }),
  );
  await como(u, "ajustes:capturar", (tx) => abrirHoja(tx, u, randomUUID(), { bodegaId: e.otraBodegaId, motivo: "Conteo mensual" }));
});

describe("contadores de la barra lateral", () => {
  it("cada N es el total de su pantalla con su filtro", async () => {
    const { n, p } = await leer(async (db) => ({
      n: await leerContadores(db, () => true),
      p: {
        entradas: (await listarEntradas(db, { ...SIN_FILTROS_ENTRADAS, estatus: "borradores" })).pagina.total,
        salidas: await todasLasPaginas((pagina, tam) => listarSalidas(db, { estatus: "todas", busqueda: "" }, pagina, tam)),
        traspasos: (await listarMovimientos(db, "TRASPASO", { estatus: "BORRADOR", busqueda: "" })).pagina.total,
        devoluciones: (await listarMovimientos(db, "DEVOLUCION", { estatus: "BORRADOR", busqueda: "" })).pagina.total,
        prestamos: (await listarPrestamos(db, "abiertos")).pagina.total,
        conteos: (await listarHojas(db, { estatus: "BORRADOR" })).pagina.total,
        bajoMinimo: await contarArticulosBajoMinimo(db),
      },
    }));

    const sinCerrar = p.salidas.filter((s) => ["SOLICITADA", "AUTORIZADA", "RETIRADA"].includes(s.estatus) && !s.canceladoPor);
    const ids = sinCerrar.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([salidas.solicitada, salidas.autorizada, salidas.retirada, salidas.prestamo]));
    for (const cerrada of [salidas.recibida, salidas.rechazada, salidas.cancelada, salidas.revertida]) expect(ids).not.toContain(cerrada);

    expect(n).toStrictEqual({
      "/entradas": p.entradas,
      "/salidas": sinCerrar.length,
      "/traspasos": p.traspasos,
      "/devoluciones": p.devoluciones,
      "/prestamos": p.prestamos,
      "/conteos": p.conteos,
      "/reportes/existencias": p.bajoMinimo,
    });
    // Con un borrador de cada módulo, ninguno está en cero
    for (const valor of Object.values(n)) expect(valor).toBeGreaterThan(0);
  });

  it("sin el permiso de su pantalla, el contador no se consulta", async () => {
    const todas = ["/entradas", "/salidas", "/traspasos", "/devoluciones", "/prestamos", "/conteos", "/reportes/existencias"];
    const casos: [Permiso, string[]][] = [
      ["entradas:leer", ["/entradas"]],
      ["salidas:leer", ["/salidas", "/prestamos"]],
      ["traspasos:leer", ["/traspasos"]],
      ["devoluciones:leer", ["/devoluciones", "/prestamos"]],
      ["ajustes:leer", ["/conteos"]],
      ["reportes:leer", ["/reportes/existencias"]],
    ];
    for (const [falta, fuera] of casos) {
      const n = await leer((db) => leerContadores(db, (permiso) => permiso !== falta));
      expect(Object.keys(n), falta).toEqual(todas.filter((ruta) => !fuera.includes(ruta)));
    }

    // Sin ningún permiso no toca la base
    const sinBase = new Proxy({}, { get: () => { throw new Error("consultó la base"); } }) as Prisma.TransactionClient;
    await expect(leerContadores(sinBase, () => false)).resolves.toStrictEqual({});
  });
});
