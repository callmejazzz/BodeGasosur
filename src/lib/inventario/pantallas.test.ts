/*
  Lo que lee cada pantalla de la fase 7 según quién la abre, contra
  PostgreSQL real. Lo que el usuario no puede ver ni usar no se consulta: se
  espía el repositorio para comprobar que esas lecturas ni siquiera se hacen.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { articuloNuevo } from "../../../pruebas/semilla-entradas";
import { sembrarCapa } from "../../../pruebas/semilla-inventario";
import { como, sembrarOperacion } from "../../../pruebas/semilla-operacion";
import type { EntornoSalidas } from "../../../pruebas/semilla-salidas";
import type { UsuarioSesion } from "../db";
import { aFechaDeBase, deFechaDeBase, hoyEnMexico } from "../fechas";
import { autorizarSalida, retirarSalida, solicitarSalida } from "../salidas/servicio";
import { confirmarDevolucion, crearDevolucion } from "./devoluciones";
import { revertirMovimiento } from "./reversas";
import { confirmarTraspaso, crearTraspaso, descartarTraspaso } from "./traspasos";

vi.mock("server-only", () => ({}));
vi.mock("./repo", async (original) => {
  const real = await original<typeof import("./repo")>();
  return {
    ...real,
    opcionesDeArticulos: vi.fn(real.opcionesDeArticulos),
    existenciasPorBodega: vi.fn(real.existenciasPorBodega),
    salidasDevolvibles: vi.fn(real.salidasDevolvibles),
    reversaDe: vi.fn(real.reversaDe),
    devolucionesDe: vi.fn(real.devolucionesDe),
  };
});
const repo = await import("./repo");
const { datosDeDetalle, datosDeHoja, datosDeLista, datosDeListaHojas, relacionesDeSalida } = await import("./pantallas");
const salidas = await import("../salidas/pantallas");

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
let articuloId: string;

beforeAll(async () => {
  e = await sembrarOperacion(prisma);
  articuloId = (await articuloNuevo(prisma, e.unidadId, null)).id;
  await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId, cantidad: 100, fechaOriginal: "2026-08-01", costo: ["3.0000", "3.4800"] });
});
beforeEach(() => vi.clearAllMocks());
afterAll(() => prisma.$disconnect());

const leer = <T>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
const unidades = (n: number) => [{ articuloId, presentacion: "UNIDAD" as const, cantidadCapturada: n }];

async function traspaso(confirmado: boolean) {
  const u = e.usuarios.COMPRAS;
  const { id } = await como(prisma, u, "traspasos:capturar", (tx) =>
    crearTraspaso(tx, u, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, bodegaDestinoId: e.otraBodegaId }, partidas: unidades(2) }),
  );
  if (confirmado) await como(prisma, u, "traspasos:confirmar", (tx) => confirmarTraspaso(tx, u, id));
  return id;
}

async function salidaRetirada(cantidad: number, esPrestamo = true) {
  const u = e.usuarios.COMPRAS;
  const { id } = await como(prisma, u, "salidas:capturar", (tx) =>
    solicitarSalida(tx, u, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, estacionId: e.estacionId, esPrestamo }, partidas: unidades(cantidad) }),
  );
  await como(prisma, e.autorizadores.JEFE, "salidas:autorizar", (tx) => autorizarSalida(tx, e.autorizadores.JEFE, id));
  await como(prisma, u, "salidas:retirar", (tx) => retirarSalida(tx, u, id, "Mensajero"));
  return id;
}

async function devolver(salidaId: string | null, cantidad: number) {
  const u = e.usuarios.COMPRAS;
  const { id } = await como(prisma, u, "devoluciones:capturar", (tx) =>
    crearDevolucion(tx, u, randomUUID(), { encabezado: { estacionId: e.estacionId, bodegaDestinoId: e.bodegaId, salidaId }, partidas: unidades(cantidad) }),
  );
  await como(prisma, u, "devoluciones:confirmar", (tx) => confirmarDevolucion(tx, u, id));
  return id;
}

const detalle = (u: UsuarioSesion, id: string) => leer((db) => datosDeDetalle(db, u, "TRASPASO", id));

describe("detalle de un borrador", () => {
  it("Jefe lo ve sin catálogos, existencias ni nada para editar o confirmar", async () => {
    const id = await traspaso(false);
    const d = await detalle(e.usuarios.JEFE, id);
    expect(d).toMatchObject({ puede: { editar: false, confirmar: false, revertir: false }, opciones: null, existencias: null, saldo: null });
    expect(repo.opcionesDeArticulos).not.toHaveBeenCalled();
    expect(repo.existenciasPorBodega).not.toHaveBeenCalled();
  });

  it("Compras recibe lo que necesita para editar y confirmar", async () => {
    const id = await traspaso(false);
    const d = await detalle(e.usuarios.COMPRAS, id);
    expect(d?.puede).toEqual({ editar: true, confirmar: true, revertir: false });
    expect(d?.opciones?.articulos.some((a) => a.id === articuloId)).toBe(true);
    expect(d?.existencias?.[articuloId]).toBeGreaterThan(0);
  });

  it("un id que no es UUID, de otro tipo o inexistente no llega a consultar el detalle", async () => {
    await expect(detalle(e.usuarios.COMPRAS, "' OR 1=1 --")).resolves.toBeNull();
    await expect(detalle(e.usuarios.COMPRAS, randomUUID())).resolves.toBeNull();
    const salida = await salidaRetirada(1);
    await expect(detalle(e.usuarios.COMPRAS, salida)).resolves.toBeNull();
  });
});

describe("reversa en pantalla", () => {
  it("solo el Superadmin la ve disponible, y ya revertido nadie", async () => {
    const id = await traspaso(true);
    await expect(detalle(e.usuarios.COMPRAS, id)).resolves.toMatchObject({ puede: { revertir: false }, valuacion: expect.any(Object) });
    await expect(detalle(e.usuarios.SUPERADMIN, id)).resolves.toMatchObject({ puede: { revertir: true }, reversa: null });
    const admin = e.usuarios.SUPERADMIN;
    const r = await como(prisma, admin, "movimientos:revertir", (tx) => revertirMovimiento(tx, admin, id, "Prueba"));
    await expect(detalle(admin, id)).resolves.toMatchObject({ puede: { revertir: false }, reversa: { id: r.id, folio: r.folio } });
    const reversa = await detalle(admin, r.id);
    expect(reversa).toMatchObject({ puede: { revertir: false, editar: false } });
    expect(reversa?.movimiento.cancelaA?.id).toBe(id);
  });

  it("la valuación de un traspaso sale y entra por lo mismo", async () => {
    const d = await detalle(e.usuarios.COMPRAS, await traspaso(true));
    expect(d?.valuacion?.salio).toEqual(d?.valuacion?.entro);
    expect(d?.valuacion?.salio).toMatchObject({ importe: "6.00", importeConIva: "6.96", piezasSinCosto: 0 });
  });
});

describe("préstamos y salidas devolvibles", () => {
  it("abierto mientras falte algo; la devolución sin salida no lo cierra; la salida revertida deja de contar", async () => {
    const s = await salidaRetirada(3);
    const abiertos = () => leer((db) => repo.listarPrestamos(db, "abiertos"));
    const cerrados = () => leer((db) => repo.listarPrestamos(db, "cerrados"));
    await expect(abiertos()).resolves.toContainEqual(expect.objectContaining({ id: s, retirado: 3, devuelto: 0, pendiente: 3 }));

    await devolver(null, 3);
    await expect(abiertos()).resolves.toContainEqual(expect.objectContaining({ id: s, pendiente: 3 }));
    await devolver(s, 2);
    await expect(abiertos()).resolves.toContainEqual(expect.objectContaining({ id: s, devuelto: 2, pendiente: 1 }));
    await expect(leer((db) => repo.salidasDevolvibles(db, e.estacionId))).resolves.toContainEqual(expect.objectContaining({ id: s, pendientes: { [articuloId]: 1 } }));
    await devolver(s, 1);
    await expect(abiertos()).resolves.not.toContainEqual(expect.objectContaining({ id: s }));
    await expect(cerrados()).resolves.toContainEqual(expect.objectContaining({ id: s, pendiente: 0 }));
    await expect(leer((db) => repo.salidasDevolvibles(db, e.estacionId))).resolves.not.toContainEqual(expect.objectContaining({ id: s }));

    const otra = await salidaRetirada(1);
    const admin = e.usuarios.SUPERADMIN;
    await como(prisma, admin, "movimientos:revertir", (tx) => revertirMovimiento(tx, admin, otra, "No salió"));
    const todos = await leer((db) => repo.listarPrestamos(db, "todos"));
    expect(todos.some((p) => p.id === otra)).toBe(false);
  });

  it("la lista y el detalle de salidas marcan devuelto parcial o completo; sin salida o revertida no cuenta", async () => {
    const s = await salidaRetirada(3, false);
    const jefe = e.usuarios.JEFE;
    const enLista = () => leer((db) => salidas.datosDeLista(db, jefe, {})).then((l) => l.devoluciones[s]);
    const enDetalle = () => leer((db) => relacionesDeSalida(db, jefe, { id: s, estatus: "RETIRADA" })).then((r) => r?.devolucion);
    await expect(enLista()).resolves.toBeUndefined();
    await devolver(null, 3);
    await expect(enLista()).resolves.toBeUndefined();
    await expect(enDetalle()).resolves.toBeNull();

    const primera = await devolver(s, 1);
    await expect(enLista()).resolves.toBe("parcial");
    await expect(enDetalle()).resolves.toBe("parcial");
    await devolver(s, 2);
    await expect(enLista()).resolves.toBe("completa");
    await expect(enDetalle()).resolves.toBe("completa");

    const admin = e.usuarios.SUPERADMIN;
    await como(prisma, admin, "movimientos:revertir", (tx) => revertirMovimiento(tx, admin, primera, "Capturada de más"));
    await expect(enLista()).resolves.toBe("parcial");
    await expect(enDetalle()).resolves.toBe("parcial");
  });

  it("una salida que no es préstamo no aparece como préstamo, pero sí admite devoluciones", async () => {
    const s = await salidaRetirada(2, false);
    await expect(leer((db) => repo.listarPrestamos(db, "todos"))).resolves.not.toContainEqual(expect.objectContaining({ id: s }));
    await expect(leer((db) => repo.salidasDevolvibles(db))).resolves.toContainEqual(expect.objectContaining({ id: s, esPrestamo: false }));
  });

  it("las relaciones de una salida retirada; una sin retirar no consulta nada", async () => {
    const s = await salidaRetirada(2);
    await devolver(s, 1);
    const r = await leer((db) => relacionesDeSalida(db, e.usuarios.JEFE, { id: s, estatus: "RETIRADA" }));
    expect(r).toMatchObject({ reversa: null, revertir: false, puedeDevolver: false, saldo: [{ retirado: 2, devuelto: 1, pendiente: 1 }] });
    expect(r?.devoluciones).toHaveLength(1);
    await expect(leer((db) => relacionesDeSalida(db, e.usuarios.COMPRAS, { id: s, estatus: "RETIRADA" }))).resolves.toMatchObject({ puedeDevolver: true });
    vi.clearAllMocks();
    await expect(leer((db) => relacionesDeSalida(db, e.usuarios.SUPERADMIN, { id: s, estatus: "AUTORIZADA" }))).resolves.toBeNull();
    expect(repo.reversaDe).not.toHaveBeenCalled();
    expect(repo.devolucionesDe).not.toHaveBeenCalled();
  });
});

describe("hoja de conteo", () => {
  it("el catálogo para agregar artículos solo se carga a quien captura en una hoja abierta", async () => {
    const u = e.usuarios.COMPRAS;
    const { abrirHoja } = await import("./conteos");
    const h = await como(prisma, u, "ajustes:capturar", (tx) => abrirHoja(tx, u, randomUUID(), { bodegaId: e.bodegaId, motivo: "Pantallas" }));
    await expect(leer((db) => datosDeHoja(db, e.usuarios.JEFE, h.id))).resolves.toMatchObject({ puede: { capturar: false, confirmar: false }, articulos: null });
    expect(repo.opcionesDeArticulos).not.toHaveBeenCalled();
    const d = await leer((db) => datosDeHoja(db, u, h.id));
    expect(d?.puede).toEqual({ capturar: true, confirmar: true });
    expect(d?.hoja.renglones.some((r) => r.articuloId === articuloId)).toBe(true);
  });
});

describe("listas", () => {
  it("traspasos: borradores, luego por folio del más alto al más bajo, al final descartados; se buscan sin acentos", async () => {
    const u = e.usuarios.COMPRAS;
    const marca = `Revisión Peñasco ${randomUUID().slice(0, 8)}`;
    const alta = async () =>
      (await como(prisma, u, "traspasos:capturar", (tx) =>
        crearTraspaso(tx, u, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, bodegaDestinoId: e.otraBodegaId, observaciones: marca }, partidas: unidades(1) }),
      )).id;
    const confirmar = (id: string) => como(prisma, u, "traspasos:confirmar", (tx) => confirmarTraspaso(tx, u, id));
    const viejo = await alta();
    await confirmar(viejo);
    const descartado = await alta();
    await como(prisma, u, "traspasos:capturar", (tx) => descartarTraspaso(tx, u, descartado, "Duplicado"));
    const borrador = await alta();
    const nuevo = await alta();
    await confirmar(nuevo);

    const q = marca.replace("Revisión Peñasco", "revision PENASCO");
    const r = await leer((db) => datosDeLista(db, u, "TRASPASO", { q }));
    expect(r.filas.map((f) => f.id)).toEqual([borrador, nuevo, viejo, descartado]);

    // La reversa no es otra fila: queda en el historial del revertido, y su folio lo encuentra.
    const admin = e.usuarios.SUPERADMIN;
    const reversa = await como(prisma, admin, "movimientos:revertir", (tx) => revertirMovimiento(tx, admin, viejo, "Destino equivocado"));
    const despues = await leer((db) => datosDeLista(db, u, "TRASPASO", { q }));
    expect(despues.filas.map((f) => f.id)).toEqual([borrador, nuevo, viejo, descartado]);
    expect(despues.filas.find((f) => f.id === viejo)?.canceladoPor?.folio).toBe(reversa.folio);
    await expect(leer((db) => datosDeLista(db, u, "TRASPASO", { q: reversa.folio })).then((l) => l.filas.map((f) => f.id))).resolves.toEqual([viejo]);
    await expect(leer((db) => datosDeLista(db, u, "TRASPASO", { estatus: "confirmados", q })).then((l) => l.filas.map((f) => f.id))).resolves.toEqual([nuevo, viejo]);
    await expect(detalle(admin, viejo).then((d) => d?.reversa)).resolves.toMatchObject({ id: reversa.id, folio: reversa.folio, motivo: "Destino equivocado" });
  });

  it("las hojas de conteo se filtran por el día de México en que se abrieron", async () => {
    const u = e.usuarios.COMPRAS;
    const { abrirHoja } = await import("./conteos");
    const h = await como(prisma, u, "ajustes:capturar", (tx) => abrirHoja(tx, u, randomUUID(), { bodegaId: e.otraBodegaId, motivo: "Filtro por fecha" }));
    const hoy = hoyEnMexico();
    const ayer = deFechaDeBase(new Date(aFechaDeBase(hoy).getTime() - 86_400_000));
    const ids = (params: Record<string, string>) => leer((db) => datosDeListaHojas(db, u, params)).then((l) => l.filas.map((f) => f.id));
    await expect(ids({ desde: hoy, hasta: hoy })).resolves.toContain(h.id);
    await expect(ids({ desde: hoy })).resolves.toContain(h.id);
    await expect(ids({ hasta: ayer })).resolves.not.toContain(h.id);
    await expect(ids({ desde: "2000-01-01", hasta: ayer })).resolves.not.toContain(h.id);
    // Lo que no es fecha operativa se descarta, como en entradas.
    await expect(leer((db) => datosDeListaHojas(db, u, { desde: "2026-02-30", hasta: "mañana", q: "x" })).then((l) => l.filtros)).resolves.toEqual({
      estatus: "todos",
      busqueda: "",
      desde: "",
      hasta: "",
    });
  });
});
