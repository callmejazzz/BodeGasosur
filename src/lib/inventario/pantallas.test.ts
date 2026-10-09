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
import type { EstadoPrestamo } from "./repo";
import { revertirMovimiento } from "./reversas";
import { confirmarTraspaso, crearTraspaso, descartarTraspaso } from "./traspasos";

vi.mock("server-only", () => ({}));
vi.mock("./repo", async (original) => {
  const real = await original<typeof import("./repo")>();
  return {
    ...real,
    opcionesDeArticulos: vi.fn(real.opcionesDeArticulos),
    existenciasPorBodega: vi.fn(real.existenciasPorBodega),
    salidaParaDevolver: vi.fn(real.salidaParaDevolver),
    listarSalidasDevolvibles: vi.fn(real.listarSalidasDevolvibles),
    reversaDe: vi.fn(real.reversaDe),
    devolucionesDe: vi.fn(real.devolucionesDe),
  };
});
const repo = await import("./repo");
const { datosDeDetalle, datosDeHoja, datosDeLista, datosDeListaHojas, relacionesDeSalida, salidaDelEnlace, salidasDelSelector } = await import("./pantallas");
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

async function salidaRetirada(cantidad: number, esPrestamo = true, estacionId = e.estacionId) {
  const u = e.usuarios.COMPRAS;
  const { id } = await como(prisma, u, "salidas:capturar", (tx) =>
    solicitarSalida(tx, u, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, estacionId, esPrestamo }, partidas: unidades(cantidad) }),
  );
  await como(prisma, e.autorizadores.JEFE, "salidas:autorizar", (tx) => autorizarSalida(tx, e.autorizadores.JEFE, id));
  await como(prisma, u, "salidas:retirar", (tx) => retirarSalida(tx, u, id, "Mensajero"));
  return id;
}

async function devolver(salidaId: string | null, cantidad: number, estacionId = e.estacionId) {
  const u = e.usuarios.COMPRAS;
  const { id } = await como(prisma, u, "devoluciones:capturar", (tx) =>
    crearDevolucion(tx, u, randomUUID(), { encabezado: { estacionId, bodegaDestinoId: e.bodegaId, salidaId }, partidas: unidades(cantidad) }),
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

/** Todas las páginas de préstamos: la base es compartida y puede haber más de 100. */
async function prestamos(estado: EstadoPrestamo) {
  const primera = await leer((db) => repo.listarPrestamos(db, estado));
  const filas = [...primera.filas];
  for (let n = 2; n <= primera.pagina.ultima; n++) filas.push(...(await leer((db) => repo.listarPrestamos(db, estado, n))).filas);
  expect(filas).toHaveLength(primera.pagina.total);
  return filas;
}

describe("préstamos y salidas devolvibles", () => {
  it("abierto mientras falte algo; la devolución sin salida no lo cierra; la salida revertida deja de contar", async () => {
    const s = await salidaRetirada(3);
    const abiertos = () => prestamos("abiertos");
    const cerrados = () => prestamos("cerrados");
    await expect(abiertos()).resolves.toContainEqual(expect.objectContaining({ id: s, retirado: 3, devuelto: 0, pendiente: 3 }));

    await devolver(null, 3);
    await expect(abiertos()).resolves.toContainEqual(expect.objectContaining({ id: s, pendiente: 3 }));
    await devolver(s, 2);
    await expect(abiertos()).resolves.toContainEqual(expect.objectContaining({ id: s, devuelto: 2, pendiente: 1 }));
    await expect(leer((db) => repo.salidaParaDevolver(db, { id: s }))).resolves.toMatchObject({ salida: { id: s, pendientes: { [articuloId]: 1 } } });
    await devolver(s, 1);
    await expect(abiertos()).resolves.not.toContainEqual(expect.objectContaining({ id: s }));
    await expect(cerrados()).resolves.toContainEqual(expect.objectContaining({ id: s, pendiente: 0 }));
    await expect(leer((db) => repo.salidaParaDevolver(db, { id: s }))).resolves.toEqual({ motivo: expect.stringMatching(/ya volvió todo lo que salió/) });

    const otra = await salidaRetirada(1);
    const admin = e.usuarios.SUPERADMIN;
    await como(prisma, admin, "movimientos:revertir", (tx) => revertirMovimiento(tx, admin, otra, "No salió"));
    const todos = await prestamos("todos");
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
    await expect(prestamos("todos")).resolves.not.toContainEqual(expect.objectContaining({ id: s }));
    await expect(leer((db) => repo.salidaParaDevolver(db, { id: s }))).resolves.toMatchObject({ salida: { id: s, esPrestamo: false } });
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

describe("la salida de una devolución", () => {
  it("la del enlace se consulta y se valida; si no admite devolución, dice por qué", async () => {
    const s = await salidaRetirada(2);
    const enlace = (crudo: unknown) => leer((db) => salidaDelEnlace(db, crudo));
    await expect(enlace(s)).resolves.toMatchObject({
      salida: { id: s, estacion: { id: e.estacionId }, bodega: { id: e.bodegaId }, pendientes: { [articuloId]: 2 } },
      aviso: null,
    });
    await expect(enlace(undefined)).resolves.toEqual({ salida: null, aviso: null });
    expect(repo.salidaParaDevolver).toHaveBeenCalledTimes(1);
    for (const raro of ["' OR 1=1 --", ["x"], ""]) {
      await expect(enlace(raro), String(raro)).resolves.toEqual({ salida: null, aviso: "El enlace no trae una salida válida." });
    }
    expect(repo.salidaParaDevolver).toHaveBeenCalledTimes(1);
    await expect(enlace(randomUUID())).resolves.toEqual({ salida: null, aviso: "La salida del enlace no existe." });
    // Un traspaso no es una salida, aunque el id exista.
    await expect(enlace(await traspaso(true))).resolves.toEqual({ salida: null, aviso: "La salida del enlace no existe." });

    const u = e.usuarios.COMPRAS;
    const { id: solicitada } = await como(prisma, u, "salidas:capturar", (tx) =>
      solicitarSalida(tx, u, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, estacionId: e.estacionId }, partidas: unidades(1) }),
    );
    await expect(enlace(solicitada)).resolves.toMatchObject({ salida: null, aviso: expect.stringMatching(/ya retirada o recibida/) });
    const admin = e.usuarios.SUPERADMIN;
    await como(prisma, admin, "movimientos:revertir", (tx) => revertirMovimiento(tx, admin, s, "No salió"));
    await expect(enlace(s)).resolves.toMatchObject({ salida: null, aviso: expect.stringMatching(/fue revertida/) });
  });

  it("el selector lista lo devolvible de la estación, lo más reciente arriba, y se busca tecleando", async () => {
    // Estación propia: la base es compartida con las demás pruebas.
    const empresa = await prisma.empresa.create({ data: { razonSocial: `Empresa ${randomUUID().slice(0, 8)}` } });
    const estacion = (await prisma.estacion.create({ data: { numero: `ES${randomUUID().slice(0, 8)}`, alias: "Cañada Ñuñez", empresaId: empresa.id } })).id;
    const vieja = await salidaRetirada(2, true, estacion);
    const nueva = await salidaRetirada(1, false, estacion);
    const devuelta = await salidaRetirada(1, false, estacion);
    await devolver(devuelta, 1, estacion);
    const ajena = await salidaRetirada(1);
    const folioDe = async (id: string) => (await prisma.movimiento.findUniqueOrThrow({ where: { id } })).folio!;
    const selector = (texto: string, pagina = 1) => leer((db) => salidasDelSelector(db, { estacionId: estacion, texto, pagina }));

    const todo = await selector("");
    expect(todo.salidas.map((x) => x.id)).toEqual([nueva, vieja]);
    expect(todo.pagina).toEqual({ actual: 1, ultima: 1, total: 2 });
    expect(todo.salidas[1]).toMatchObject({ esPrestamo: true, estacion: { id: estacion }, bodega: { id: e.bodegaId }, pendientes: { [articuloId]: 2 } });
    // Una página que no existe muestra la última.
    await expect(selector("", 9)).resolves.toEqual(todo);

    const folio = await folioDe(vieja);
    const numero = String(Number(folio.replace(/\D/g, "")));
    for (const tecleado of [folio, folio.toLowerCase(), folio.replace("-", ""), numero]) {
      await expect(selector(tecleado).then((r) => r.salidas.map((x) => x.id)), tecleado).resolves.toContain(vieja);
    }
    // Sin acentos ni mayúsculas, también por el alias de la estación.
    await expect(selector("canada nunez").then((r) => r.salidas.length)).resolves.toBe(2);

    // Lo que no aparece, dice por qué.
    await expect(selector(await folioDe(devuelta))).resolves.toEqual({ salidas: [], pagina: expect.objectContaining({ total: 0 }), aviso: expect.stringMatching(/ya volvió todo/) });
    await expect(selector(await folioDe(ajena))).resolves.toMatchObject({ salidas: [], aviso: expect.stringMatching(/salió a/) });
    await expect(selector("zzz")).resolves.toEqual({ salidas: [], pagina: expect.objectContaining({ total: 0 }), aviso: null });
  });

  it("una búsqueda que no pasa el esquema ni llega a la base", async () => {
    vi.clearAllMocks();
    const raros: unknown[] = [
      null,
      "S-1",
      { estacionId: "' OR 1=1 --", texto: "", pagina: 1 },
      { estacionId: e.estacionId, texto: "S-1'; DROP TABLE x", pagina: 1 },
      { estacionId: e.estacionId, texto: "x".repeat(41), pagina: 1 },
      { estacionId: e.estacionId, texto: "", pagina: 0 },
      { estacionId: e.estacionId, texto: "", pagina: "2" },
      { estacionId: e.estacionId, pagina: 1 },
    ];
    for (const raro of raros) {
      await expect(leer((db) => salidasDelSelector(db, raro)), JSON.stringify(raro)).resolves.toMatchObject({ salidas: [], aviso: expect.stringMatching(/^Elige la estación/) });
    }
    expect(repo.listarSalidasDevolvibles).not.toHaveBeenCalled();
    expect(repo.salidaParaDevolver).not.toHaveBeenCalled();
  });

  it("el borrador conserva su salida aunque ya no tenga saldo, con el aviso; quien no edita no la consulta", async () => {
    const s = await salidaRetirada(2);
    const u = e.usuarios.COMPRAS;
    const { id: borrador } = await como(prisma, u, "devoluciones:capturar", (tx) =>
      crearDevolucion(tx, u, randomUUID(), { encabezado: { estacionId: e.estacionId, bodegaDestinoId: e.bodegaId, salidaId: s }, partidas: unidades(1) }),
    );
    const vinculada = (quien: UsuarioSesion) => leer((db) => datosDeDetalle(db, quien, "DEVOLUCION", borrador)).then((d) => d?.vinculada);
    await expect(vinculada(u)).resolves.toMatchObject({ salida: { id: s, pendientes: { [articuloId]: 2 } }, aviso: null });
    await devolver(s, 2);
    await expect(vinculada(u)).resolves.toEqual({
      salida: expect.objectContaining({ id: s, estacion: expect.objectContaining({ id: e.estacionId }), bodega: expect.objectContaining({ id: e.bodegaId }), pendientes: {} }),
      aviso: expect.stringMatching(/ya volvió todo lo que salió/),
    });
    vi.clearAllMocks();
    await expect(vinculada(e.usuarios.JEFE)).resolves.toBeNull();
    expect(repo.salidaParaDevolver).not.toHaveBeenCalled();
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
