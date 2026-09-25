/*
  Pruebas de aceptación de la fase 5 (11 §12), contra PostgreSQL real y a
  través del servicio. Sin Clerk: `como()` hace lo que accionProtegida() —
  verifica el permiso con la matriz real, abre la transacción y fija
  app.usuario_id— para que lo que se prueba sea el servicio y la base.
*/

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearCliente } from "../../../prisma/comun";
import { URL_PRUEBAS } from "../../../pruebas/base-de-pruebas";
import { articuloNuevo, sembrarEntorno, type Entorno } from "../../../pruebas/semilla-entradas";
import { sembrarCapa } from "../../../pruebas/semilla-inventario";
import type { UsuarioSesion } from "../db";
import { deFechaDeBase, hoyEnMexico } from "../fechas";
import { rolTienePermiso, type Permiso } from "../permisos";
import { confirmarEntrada, crearBorrador, descartarBorrador, guardarBorrador, type DatosBorrador } from "./servicio";

const prisma = crearCliente(URL_PRUEBAS);
let e: Entorno;
let compras: UsuarioSesion;

beforeAll(async () => {
  e = await sembrarEntorno(prisma);
  compras = e.usuarios.COMPRAS;
});
afterAll(() => prisma.$disconnect());

class SinPermiso extends Error {}

function como<T>(usuario: UsuarioSesion, permiso: Permiso, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (!rolTienePermiso(usuario.rol, permiso)) return Promise.reject(new SinPermiso(permiso));
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.usuario_id', ${usuario.id}, true)`;
    return fn(tx);
  });
}

// 3 cajas de 12 a $120 la caja + 5 piezas sueltas a $7.50, IVA 16 %, MXN.
function datos(extra: Partial<DatosBorrador["encabezado"]> = {}, partidas?: DatosBorrador["partidas"]): DatosBorrador {
  return {
    encabezado: {
      proveedorId: e.proveedorId,
      bodegaDestinoId: e.bodegaId,
      fecha: "2026-09-10",
      moneda: "MXN",
      referencia: "F-1001",
      ...extra,
    },
    partidas: partidas ?? [
      { articuloId: e.articuloCajaId, presentacion: "CAJA", cantidadCapturada: 3, costoUnitarioCapturado: "120", tasaIva: "0.16" },
      { articuloId: e.articuloSueltoId, presentacion: "UNIDAD", cantidadCapturada: 5, costoUnitarioCapturado: "7.5", tasaIva: "0.16" },
    ],
  };
}

const crear = (d = datos(), llave = randomUUID(), usuario = compras) =>
  como(usuario, "entradas:capturar", (tx) => crearBorrador(tx, usuario, llave, d));
const confirmar = (id: string, usuario = compras) =>
  como(usuario, "entradas:confirmar", (tx) => confirmarEntrada(tx, usuario, id));

async function existencia(bodegaId: string, articuloId: string) {
  const x = await prisma.existencia.findUnique({ where: { bodegaId_articuloId: { bodegaId, articuloId } } });
  return x?.cantidad ?? 0;
}

/** Invariante 9: la existencia es exactamente la suma de lo que queda en sus capas. */
async function invariante9(bodegaId: string) {
  const filas = await prisma.$queryRaw<{ articuloId: string; existencia: number; capas: number }[]>`
    SELECT e."articuloId", e.cantidad AS existencia, coalesce(sum(c."cantidadRestante"), 0)::int AS capas
    FROM "Existencia" e
    LEFT JOIN "CapaCosto" c ON c."bodegaId" = e."bodegaId" AND c."articuloId" = e."articuloId"
    WHERE e."bodegaId" = ${bodegaId}::uuid
    GROUP BY e."articuloId", e.cantidad`;
  for (const f of filas) expect(f.capas, f.articuloId).toBe(f.existencia);
}

describe("1. un borrador no tiene folio ni cambia inventario", () => {
  it("crea el borrador con partidas normalizadas y sin efecto en existencias", async () => {
    const antes = await existencia(e.bodegaId, e.articuloCajaId);
    const { id, repetido } = await crear();
    expect(repetido).toBe(false);
    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id }, include: { partidas: true, capas: true } });
    expect(m).toMatchObject({ estatus: "BORRADOR", folio: null, confirmadoPorId: null, tipo: "ENTRADA" });
    expect(m.capas).toHaveLength(0);
    expect(m.partidas).toHaveLength(2);
    await expect(existencia(e.bodegaId, e.articuloCajaId)).resolves.toBe(antes);
    // Los totales sí se calculan en el borrador, para mostrarlos.
    expect([m.subtotal, m.iva, m.total].map(String)).toEqual(["397.5", "63.6", "461.1"]);
  });

  it("la bitácora sabe quién capturó", async () => {
    const { id } = await crear();
    const renglones = await prisma.bitacora.findMany({ where: { tabla: "Movimiento", registroId: id } });
    expect(renglones.length).toBeGreaterThan(0);
    expect(renglones.every((r) => r.usuarioId === compras.id)).toBe(true);
  });
});

describe("2 y 3. confirmar crea una capa por partida, incrementa la existencia exacta y cuadra", () => {
  it("36 piezas de cajas y 5 sueltas", async () => {
    const antesCaja = await existencia(e.bodegaId, e.articuloCajaId);
    const antesSuelto = await existencia(e.bodegaId, e.articuloSueltoId);
    const { id } = await crear();
    const r = await confirmar(id);
    expect(r).toMatchObject({ id, repetido: false });
    expect(r.folio).toMatch(/^E-\d{6}$/);

    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id }, include: { partidas: true, capas: true } });
    expect(m).toMatchObject({ estatus: "CONFIRMADO", folio: r.folio, confirmadoPorId: compras.id });
    expect(m.confirmadoEn).not.toBeNull();
    expect(m.capas).toHaveLength(m.partidas.length);
    for (const p of m.partidas) {
      const capa = m.capas.find((c) => c.articuloId === p.articuloId)!;
      expect(capa).toMatchObject({ cantidadInicial: p.cantidad, cantidadRestante: p.cantidad, bodegaId: e.bodegaId });
      expect(String(capa.costoUnitario)).toBe(String(p.costoUnitario));
      expect(deFechaDeBase(capa.fechaOriginal)).toBe("2026-09-10");
    }
    await expect(existencia(e.bodegaId, e.articuloCajaId)).resolves.toBe(antesCaja + 36);
    await expect(existencia(e.bodegaId, e.articuloSueltoId)).resolves.toBe(antesSuelto + 5);
    await invariante9(e.bodegaId);
  });
});

describe("4. dos primeras entradas simultáneas del mismo artículo/bodega", () => {
  it("suman ambas cantidades sin perder actualizaciones", async () => {
    const bodega = await prisma.bodega.create({ data: { nombre: `Bodega nueva ${randomUUID().slice(0, 8)}` } });
    const partidas = (n: number): DatosBorrador["partidas"] => [
      { articuloId: e.articuloSueltoId, presentacion: "UNIDAD", cantidadCapturada: n, costoUnitarioCapturado: "1", tasaIva: "0" },
    ];
    const [a, b] = await Promise.all([
      crear(datos({ bodegaDestinoId: bodega.id }, partidas(7))),
      crear(datos({ bodegaDestinoId: bodega.id }, partidas(11))),
    ]);
    const [ra, rb] = await Promise.all([confirmar(a.id), confirmar(b.id)]);
    expect(ra.folio).not.toBe(rb.folio);
    await expect(existencia(bodega.id, e.articuloSueltoId)).resolves.toBe(18);
    await invariante9(bodega.id);
  });
});

describe("5. dos movimientos con partidas en orden inverso", () => {
  it("no se interbloquean: los dos confirman", async () => {
    const x = await articuloNuevo(prisma, e.unidadId, null);
    const y = await articuloNuevo(prisma, e.unidadId, null);
    const partida = (articuloId: string, n: number): DatosBorrador["partidas"][number] => ({
      articuloId,
      presentacion: "UNIDAD",
      cantidadCapturada: n,
      costoUnitarioCapturado: "2",
      tasaIva: "0.16",
    });
    const [a, b] = await Promise.all([
      crear(datos({}, [partida(x.id, 1), partida(y.id, 2)])),
      crear(datos({}, [partida(y.id, 3), partida(x.id, 4)])),
    ]);
    const resultados = await Promise.all(
      Array.from({ length: 3 }, () => Promise.all([confirmar(a.id), confirmar(b.id)])),
    );
    const folios = new Set(resultados.flat().map((r) => r.folio));
    expect(folios.size).toBe(2);
    await expect(existencia(e.bodegaId, x.id)).resolves.toBe(5);
    await expect(existencia(e.bodegaId, y.id)).resolves.toBe(5);
    await invariante9(e.bodegaId);
  });
});

describe("5b. el catálogo queda bloqueado mientras se confirma", () => {
  // [nombre, baja, qué pasa con la baja cuando la confirmación suelta el candado]
  type Baja = [string, () => Promise<unknown>, "aplicada" | "rechazada"];

  it("dar de baja proveedor, bodega o artículo espera a la confirmación en curso", async () => {
    const proveedor = await prisma.proveedor.create({ data: { nombreComercial: `P ${randomUUID().slice(0, 8)}`, razonSocial: "x" } });
    const bodega = await prisma.bodega.create({ data: { nombre: `B ${randomUUID().slice(0, 8)}` } });
    const articulo = await articuloNuevo(prisma, e.unidadId, 12);
    const bajas: Baja[] = [
      ["proveedor", () => prisma.proveedor.update({ where: { id: proveedor.id }, data: { activo: false } }), "aplicada"],
      // Al soltar el candado la bodega ya tiene existencia, y otro invariante
      // (impedir_baja_de_bodega_con_existencia) la rechaza: también correcto.
      ["bodega", () => prisma.bodega.update({ where: { id: bodega.id }, data: { activa: false } }), "rechazada"],
      ["artículo", () => prisma.articulo.update({ where: { id: articulo.id }, data: { activo: false } }), "aplicada"],
      ["piezasPorCaja", () => prisma.articulo.update({ where: { id: articulo.id }, data: { piezasPorCaja: 24 } }), "aplicada"],
    ];

    for (const [nombre, baja, despues] of bajas) {
      const { id } = await crear(
        datos({ proveedorId: proveedor.id, bodegaDestinoId: bodega.id }, [
          { articuloId: articulo.id, presentacion: "CAJA", cantidadCapturada: 1, costoUnitarioCapturado: "12", tasaIva: "0.16" },
        ]),
      );
      let intento!: Promise<string>;
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.usuario_id', ${compras.id}, true)`;
        await confirmarEntrada(tx, compras, id);
        // La confirmación ya tomó sus candados y aún no confirma la transacción.
        intento = baja().then(
          () => "aplicada",
          () => "rechazada",
        );
        const espera = new Promise<string>((r) => setTimeout(() => r("bloqueada"), 300));
        await expect(Promise.race([intento, espera]), nombre).resolves.toBe("bloqueada");
      });
      await expect(intento, nombre).resolves.toBe(despues);
      await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } }), nombre).resolves.toMatchObject({ estatus: "CONFIRMADO" });
      // Se restaura para la siguiente vuelta.
      await prisma.proveedor.update({ where: { id: proveedor.id }, data: { activo: true } });
      await prisma.bodega.update({ where: { id: bodega.id }, data: { activa: true } });
      await prisma.articulo.update({ where: { id: articulo.id }, data: { activo: true, piezasPorCaja: 12 } });
    }
  });

  it("si la baja gana, la confirmación la ve y se rechaza", async () => {
    const proveedor = await prisma.proveedor.create({ data: { nombreComercial: `P ${randomUUID().slice(0, 8)}`, razonSocial: "x" } });
    const bodega = await prisma.bodega.create({ data: { nombre: `B ${randomUUID().slice(0, 8)}` } });
    const a = await crear(datos({ proveedorId: proveedor.id }));
    const b = await crear(datos({ bodegaDestinoId: bodega.id }));
    await prisma.proveedor.update({ where: { id: proveedor.id }, data: { activo: false } });
    await prisma.bodega.update({ where: { id: bodega.id }, data: { activa: false } });
    await expect(confirmar(a.id)).rejects.toMatchObject({ codigo: "catalogo" });
    await expect(confirmar(b.id)).rejects.toMatchObject({ codigo: "catalogo" });
  });
});

describe("6. repetir el alta con la misma llave", () => {
  it("devuelve el mismo borrador y no crea otro", async () => {
    const llave = randomUUID();
    const d = datos();
    const primero = await crear(d, llave);
    const segundo = await crear(d, llave);
    expect(segundo).toEqual({ id: primero.id, repetido: true });
    await expect(prisma.movimiento.count({ where: { llaveIdempotencia: llave } })).resolves.toBe(1);
  });

  it("también cuando las dos llegan al mismo tiempo", async () => {
    const llave = randomUUID();
    const d = datos();
    const resultados = await Promise.all([crear(d, llave), crear(d, llave), crear(d, llave)]);
    expect(new Set(resultados.map((r) => r.id)).size).toBe(1);
    expect(resultados.filter((r) => r.repetido)).toHaveLength(2);
  });

  it("con datos distintos es conflicto, y con otro usuario también", async () => {
    const llave = randomUUID();
    await crear(datos(), llave);
    await expect(crear(datos({ referencia: "F-9999" }), llave)).rejects.toMatchObject({ codigo: "conflicto-idempotencia" });
    await expect(crear(datos(), llave, e.usuarios.SUPERADMIN)).rejects.toMatchObject({ codigo: "conflicto-idempotencia" });
  });

  it("la firma cubre observaciones del encabezado, serie y observaciones de la partida", async () => {
    const base = () => {
      const d = datos({ observaciones: "llegó en dos bultos" });
      d.partidas[0] = { ...d.partidas[0], numeroSerie: "SN-1", observaciones: "caja golpeada" };
      return d;
    };
    const llave = randomUUID();
    const { id } = await crear(base(), llave);
    await expect(crear(base(), llave)).resolves.toEqual({ id, repetido: true });

    const variantes: [string, () => DatosBorrador][] = [
      ["observaciones del encabezado", () => ({ ...base(), encabezado: { ...base().encabezado, observaciones: "otra cosa" } })],
      ["numeroSerie de la partida", () => { const d = base(); d.partidas[0] = { ...d.partidas[0], numeroSerie: "SN-2" }; return d; }],
      ["observaciones de la partida", () => { const d = base(); d.partidas[0] = { ...d.partidas[0], observaciones: "intacta" }; return d; }],
      ["cantidad", () => { const d = base(); d.partidas[0] = { ...d.partidas[0], cantidadCapturada: 4 }; return d; }],
      ["tasa de IVA", () => { const d = base(); d.partidas[1] = { ...d.partidas[1], tasaIva: "0.08" }; return d; }],
    ];
    for (const [nombre, variante] of variantes) {
      await expect(crear(variante(), llave), nombre).rejects.toMatchObject({ codigo: "conflicto-idempotencia" });
    }
    await expect(prisma.movimiento.count({ where: { llaveIdempotencia: llave } })).resolves.toBe(1);
  });

  it("la firma no depende de lo derivado: espacios, ceros y tipo de cambio en MXN no cuentan", async () => {
    const llave = randomUUID();
    const { id } = await crear(datos({ referencia: "F-7", tipoCambio: "17.5" }), llave);
    const d = datos({ referencia: "  F-7 ", tipoCambio: null });
    d.partidas[0] = { ...d.partidas[0], costoUnitarioCapturado: "120.0000", tasaIva: "0.1600" };
    await expect(crear(d, llave)).resolves.toEqual({ id, repetido: true });
  });

  it("no hay colisión artificial: un separador dentro de un texto libre no iguala dos capturas", async () => {
    const llave = randomUUID();
    const a = datos({ observaciones: "x" });
    a.partidas[0] = { ...a.partidas[0], numeroSerie: "A", observaciones: "B" };
    await crear(a, llave);
    // Mismos caracteres en total, repartidos distinto entre los campos, con
    // cualquier separador que se le ocurra a alguien.
    for (const sep of ["\u001f", "\u001e", "\u001d", "|", ",", '","']) {
      const b = datos({ observaciones: "x" });
      b.partidas[0] = { ...b.partidas[0], numeroSerie: `A${sep}B`, observaciones: "" };
      await expect(crear(b, llave), JSON.stringify(sep)).rejects.toMatchObject({ codigo: "conflicto-idempotencia" });
      const c = datos({ observaciones: `x${sep}A` });
      c.partidas[0] = { ...c.partidas[0], numeroSerie: "", observaciones: "B" };
      await expect(crear(c, llave), JSON.stringify(sep)).rejects.toMatchObject({ codigo: "conflicto-idempotencia" });
    }
  });

  it("un reintento después de dar de baja un artículo devuelve el borrador, no un error de catálogo", async () => {
    const articulo = await articuloNuevo(prisma, e.unidadId, null);
    const d = datos({}, [{ articuloId: articulo.id, presentacion: "UNIDAD", cantidadCapturada: 2, costoUnitarioCapturado: "3", tasaIva: "0.16" }]);
    const llave = randomUUID();
    const { id } = await crear(d, llave);
    await prisma.articulo.update({ where: { id: articulo.id }, data: { activo: false } });
    await expect(crear(d, llave)).resolves.toEqual({ id, repetido: true });
    // Con otra llave sí es la validación de catálogo la que manda.
    await expect(crear(d, randomUUID())).rejects.toMatchObject({ codigo: "catalogo" });
  });
});

describe("7. repetir la confirmación", () => {
  it("no consume otro folio ni duplica capas o existencia, ni en doble clic simultáneo", async () => {
    const { id } = await crear();
    const antes = await existencia(e.bodegaId, e.articuloCajaId);
    const [r1, r2] = await Promise.all([confirmar(id), confirmar(id)]);
    expect(r1.folio).toBe(r2.folio);
    expect([r1.repetido, r2.repetido].sort()).toEqual([false, true]);
    const r3 = await confirmar(id);
    expect(r3).toEqual({ id, folio: r1.folio, repetido: true });

    await expect(prisma.capaCosto.count({ where: { movimientoId: id } })).resolves.toBe(2);
    await expect(existencia(e.bodegaId, e.articuloCajaId)).resolves.toBe(antes + 36);
    const siguiente = await confirmar((await crear()).id);
    expect(Number(siguiente.folio.slice(2))).toBe(Number(r1.folio.slice(2)) + 1);
  });
});

describe("8. una factura en dólares", () => {
  it("conserva los totales originales y crea partidas y capas en MXN", async () => {
    // 2 cajas a 12.50 USD y 3 piezas a 0.335 USD, tipo de cambio 17.5.
    const { id } = await crear(
      datos({ moneda: "USD", tipoCambio: "17.5" }, [
        { articuloId: e.articuloCajaId, presentacion: "CAJA", cantidadCapturada: 2, costoUnitarioCapturado: "12.5", tasaIva: "0.16" },
        { articuloId: e.articuloSueltoId, presentacion: "UNIDAD", cantidadCapturada: 3, costoUnitarioCapturado: "0.335", tasaIva: "0" },
      ]),
    );
    await confirmar(id);
    const m = await prisma.movimiento.findUniqueOrThrow({
      where: { id },
      include: { partidas: { orderBy: { cantidad: "desc" } }, capas: { orderBy: { cantidadInicial: "desc" } } },
    });
    expect(m.moneda).toBe("USD");
    expect(String(m.tipoCambio)).toBe("17.5");
    // En USD: 25.00 + 1.01 (1.005 redondeado hacia arriba); IVA 4.00 + 0.
    expect([m.subtotal, m.iva, m.total].map(String)).toEqual(["26.01", "4", "30.01"]);
    // En MXN por pieza: 12.5 × 17.5 / 12 = 18.2292; 0.335 × 17.5 = 5.8625.
    expect(m.partidas.map((p) => [String(p.costoUnitarioCapturado), String(p.costoUnitario), String(p.costoUnitarioConIva)])).toEqual([
      ["12.5", "18.2292", "21.1458"],
      ["0.335", "5.8625", "5.8625"],
    ]);
    expect(m.capas.map((c) => String(c.costoUnitario))).toEqual(["18.2292", "5.8625"]);
  });

  it("sin tipo de cambio no se guarda; en pesos el tipo de cambio se ignora", async () => {
    await expect(crear(datos({ moneda: "USD" }))).rejects.toMatchObject({ codigo: "moneda" });
    await expect(crear(datos({ moneda: "USD", tipoCambio: "0" }))).rejects.toMatchObject({ codigo: "moneda" });
    const { id } = await crear(datos({ moneda: "MXN", tipoCambio: "17.5" }));
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ tipoCambio: null });
  });
});

describe("9, 10 y 11. presentación, factor y fotografía del catálogo", () => {
  it("se convierte exactamente a piezas y conserva la captura original", async () => {
    const { id } = await crear();
    const [caja] = await prisma.movimientoPartida.findMany({ where: { movimientoId: id, articuloId: e.articuloCajaId } });
    expect(caja).toMatchObject({ presentacionCapturada: "CAJA", cantidadCapturada: 3, factorConversion: 12, cantidad: 36 });
    expect(String(caja.costoUnitarioCapturado)).toBe("120");
    expect(String(caja.costoUnitario)).toBe("10");
    expect(String(caja.costoUnitarioConIva)).toBe("11.6");
  });

  it("las partidas conservan el orden en que se capturaron, también al volver a guardar", async () => {
    const { id } = await crear();
    const d = datos();
    d.partidas = [d.partidas[1], d.partidas[0]];
    await como(compras, "entradas:capturar", (tx) => guardarBorrador(tx, compras, id, d));
    const partidas = await prisma.movimientoPartida.findMany({ where: { movimientoId: id }, orderBy: { orden: "asc" } });
    expect(partidas.map((p) => [p.orden, p.articuloId])).toEqual([[1, e.articuloSueltoId], [2, e.articuloCajaId]]);
  });

  it("el factor viene del catálogo aunque el navegador mande otra cosa", async () => {
    const enviado = datos();
    (enviado.partidas[0] as unknown as Record<string, unknown>).factorConversion = 99;
    const { id } = await crear(enviado);
    const [caja] = await prisma.movimientoPartida.findMany({ where: { movimientoId: id, articuloId: e.articuloCajaId } });
    expect(caja.factorConversion).toBe(12);
  });

  it("un artículo sin piezas por caja no se captura por caja", async () => {
    await expect(
      crear(datos({}, [{ articuloId: e.articuloSueltoId, presentacion: "CAJA", cantidadCapturada: 1, costoUnitarioCapturado: "1", tasaIva: "0" }])),
    ).rejects.toMatchObject({ codigo: "partidas" });
  });

  it("si el catálogo cambia con el borrador abierto, la confirmación pide volver a guardar", async () => {
    const articulo = await articuloNuevo(prisma, e.unidadId, 12);
    const d = datos({}, [{ articuloId: articulo.id, presentacion: "CAJA", cantidadCapturada: 1, costoUnitarioCapturado: "120", tasaIva: "0.16" }]);
    const { id } = await crear(d);
    await prisma.articulo.update({ where: { id: articulo.id }, data: { piezasPorCaja: 24 } });
    await expect(confirmar(id)).rejects.toMatchObject({ codigo: "factor-desactualizado" });
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ estatus: "BORRADOR", folio: null });
    // Volver a guardar toma la fotografía nueva y entonces sí confirma.
    await como(compras, "entradas:capturar", (tx) => guardarBorrador(tx, compras, id, d));
    const [p] = await prisma.movimientoPartida.findMany({ where: { movimientoId: id } });
    expect(p).toMatchObject({ factorConversion: 24, cantidad: 24 });
    await expect(confirmar(id)).resolves.toMatchObject({ repetido: false });
  });
});

describe("12. una entrada confirmada no puede editarse ni eliminarse", () => {
  it("guardar y descartar se rechazan como dominio, y la base tampoco lo permite directo", async () => {
    const { id } = await crear();
    await confirmar(id);
    await expect(como(compras, "entradas:capturar", (tx) => guardarBorrador(tx, compras, id, datos()))).rejects.toMatchObject({
      codigo: "ya-confirmado",
    });
    await expect(como(compras, "entradas:capturar", (tx) => descartarBorrador(tx, compras, id, "x"))).rejects.toMatchObject({
      codigo: "ya-confirmado",
    });
    await expect(prisma.movimiento.delete({ where: { id } })).rejects.toThrow(/no se borra/);
  });

  it("un borrador sí se edita y se descarta", async () => {
    const { id } = await crear();
    await como(compras, "entradas:capturar", (tx) => guardarBorrador(tx, compras, id, datos({ referencia: "F-2" })));
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ referencia: "F-2" });
    await como(compras, "entradas:capturar", (tx) => descartarBorrador(tx, compras, id, "capturado por error"));
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({
      estatus: "CANCELADO",
      canceladoPorId: compras.id,
    });
    await expect(confirmar(id)).rejects.toMatchObject({ codigo: "cancelado" });
  });
});

// 13 (sin permiso sobre la Server Action real) vive en
// src/app/(sistema)/entradas/actions.test.ts: aquí `como()` solo imita a
// accionProtegida() y probarlo sería probar al helper.

describe("14. la fecha operativa", () => {
  it("no cambia al cruzar formulario, Prisma y PostgreSQL, y hoy en México entra", async () => {
    for (const fecha of ["2026-02-28", "2024-02-29", "2000-01-01", hoyEnMexico()]) {
      const { id } = await crear(datos({ fecha }));
      const m = await prisma.movimiento.findUniqueOrThrow({ where: { id } });
      expect(deFechaDeBase(m.fecha), fecha).toBe(fecha);
    }
  });

  it("rechaza futuras, anteriores al 2000 e inexistentes", async () => {
    for (const fecha of ["2099-01-01", "1999-12-31", "2026-02-30", "10/09/2026"]) {
      await expect(crear(datos({ fecha })), fecha).rejects.toMatchObject({ codigo: "fecha" });
    }
  });
});

describe("límites de la base, comprobados antes de escribir", () => {
  const TOPE = 2_147_483_647;

  async function folioSiguiente() {
    return (await prisma.folio.findUniqueOrThrow({ where: { tipo: "ENTRADA" } })).siguiente;
  }

  it("existencia al límite: la entrada que lo rebasa no cambia existencia ni folio; la que cabe, sí", async () => {
    const bodega = await prisma.bodega.create({ data: { nombre: `Bodega tope ${randomUUID().slice(0, 8)}` } });
    const articulo = await articuloNuevo(prisma, e.unidadId, null);
    await sembrarCapa(prisma, e, { bodegaId: bodega.id, articuloId: articulo.id, cantidad: TOPE - 10, fechaOriginal: "2026-09-01", costo: null });
    const entradaDe = (n: number) =>
      crear(datos({ bodegaDestinoId: bodega.id }, [{ articuloId: articulo.id, presentacion: "UNIDAD", cantidadCapturada: n, costoUnitarioCapturado: "1", tasaIva: "0" }]));

    const rebasa = await entradaDe(11);
    const folioAntes = await folioSiguiente();
    await expect(confirmar(rebasa.id)).rejects.toMatchObject({ codigo: "partidas", message: expect.stringContaining("rebasa") });
    await expect(existencia(bodega.id, articulo.id)).resolves.toBe(TOPE - 10);
    await expect(folioSiguiente()).resolves.toBe(folioAntes);
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id: rebasa.id } })).resolves.toMatchObject({ estatus: "BORRADOR", folio: null });
    await expect(prisma.capaCosto.count({ where: { movimientoId: rebasa.id } })).resolves.toBe(0);

    const cabe = await entradaDe(10);
    await expect(confirmar(cabe.id)).resolves.toMatchObject({ repetido: false });
    await expect(existencia(bodega.id, articulo.id)).resolves.toBe(TOPE);
    await expect(folioSiguiente()).resolves.toBe(folioAntes + 1);
  });

  it("dinero: un importe que no cabe en numeric(14,2) se rechaza al guardar, sin escribir nada", async () => {
    const llave = randomUUID();
    await expect(
      crear(datos({}, [{ articuloId: e.articuloSueltoId, presentacion: "UNIDAD", cantidadCapturada: 1_000_000, costoUnitarioCapturado: "1000000", tasaIva: "0.16" }]), llave),
    ).rejects.toMatchObject({ codigo: "partidas", message: expect.stringContaining("importes") });
    await expect(prisma.movimiento.count({ where: { llaveIdempotencia: llave } })).resolves.toBe(0);
    // Justo debajo del tope sí entra: 999 999 × 999 999.99 = 999 998 990 000.01 sin IVA.
    await expect(
      crear(datos({}, [{ articuloId: e.articuloSueltoId, presentacion: "UNIDAD", cantidadCapturada: 999_999, costoUnitarioCapturado: "999999.99", tasaIva: "0" }])),
    ).resolves.toMatchObject({ repetido: false });
  });

  it("dinero: un costo por unidad que no cabe en numeric(14,4) se rechaza al guardar", async () => {
    const llave = randomUUID();
    await expect(
      crear(datos({ moneda: "USD", tipoCambio: "99999999" }, [{ articuloId: e.articuloSueltoId, presentacion: "UNIDAD", cantidadCapturada: 1, costoUnitarioCapturado: "1000000", tasaIva: "0" }]), llave),
    ).rejects.toMatchObject({ codigo: "partidas", message: expect.stringContaining("costo por unidad") });
    await expect(prisma.movimiento.count({ where: { llaveIdempotencia: llave } })).resolves.toBe(0);
  });

  it("dinero: un tipo de cambio cambiado en el borrador se vuelve a comprobar al guardar y al confirmar", async () => {
    const { id } = await crear(datos({ moneda: "USD", tipoCambio: "17.5" }, [{ articuloId: e.articuloSueltoId, presentacion: "UNIDAD", cantidadCapturada: 1, costoUnitarioCapturado: "1000000", tasaIva: "0" }]));
    await expect(
      como(compras, "entradas:capturar", (tx) =>
        guardarBorrador(tx, compras, id, datos({ moneda: "USD", tipoCambio: "99999999" }, [{ articuloId: e.articuloSueltoId, presentacion: "UNIDAD", cantidadCapturada: 1, costoUnitarioCapturado: "1000000", tasaIva: "0" }])),
      ),
    ).rejects.toMatchObject({ codigo: "partidas" });
    await expect(prisma.movimiento.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ tipoCambio: expect.anything() });
    expect(String((await prisma.movimiento.findUniqueOrThrow({ where: { id } })).tipoCambio)).toBe("17.5");
  });
});

describe("el esquema del formulario y el servicio hablan el mismo idioma", () => {
  it("lo que pasa por esquemaBorrador se guarda y confirma sin más conversión", async () => {
    const { esquemaBorrador } = await import("./formulario");
    const d = esquemaBorrador.parse({
      encabezado: { proveedorId: e.proveedorId, bodegaDestinoId: e.bodegaId, fecha: hoyEnMexico(), moneda: "USD", tipoCambio: "17.5", referencia: " F-9 " },
      partidas: [
        { articuloId: e.articuloCajaId, presentacion: "CAJA", cantidadCapturada: "2", costoUnitarioCapturado: "12.5", tasaIva: "0.16", observaciones: " " },
        { articuloId: e.articuloSueltoId, presentacion: "UNIDAD", cantidadCapturada: "3", costoUnitarioCapturado: "0.335", tasaIva: "0" },
      ],
    });
    const { id } = await crear(d);
    await expect(confirmar(id)).resolves.toMatchObject({ repetido: false });
    const m = await prisma.movimiento.findUniqueOrThrow({ where: { id } });
    expect([m.subtotal, m.iva, m.total].map(String)).toEqual(["26.01", "4", "30.01"]);
    expect(m.referencia).toBe("F-9");
  });
});

describe("validaciones y traducción de errores", () => {
  it("artículo repetido, catálogo dado de baja y borrador inexistente", async () => {
    const p = datos().partidas[0];
    await expect(crear(datos({}, [p, { ...p }]))).rejects.toMatchObject({ codigo: "partidas" });

    const baja = await articuloNuevo(prisma, e.unidadId, null);
    await prisma.articulo.update({ where: { id: baja.id }, data: { activo: false } });
    await expect(crear(datos({}, [{ ...p, articuloId: baja.id, presentacion: "UNIDAD" }]))).rejects.toMatchObject({ codigo: "catalogo" });

    await expect(confirmar(randomUUID())).rejects.toMatchObject({ codigo: "no-encontrado" });
  });

  it("un artículo dado de baja después de guardar detiene la confirmación", async () => {
    const articulo = await articuloNuevo(prisma, e.unidadId, null);
    const { id } = await crear(datos({}, [{ articuloId: articulo.id, presentacion: "UNIDAD", cantidadCapturada: 1, costoUnitarioCapturado: "1", tasaIva: "0" }]));
    await prisma.articulo.update({ where: { id: articulo.id }, data: { activo: false } });
    await expect(confirmar(id)).rejects.toMatchObject({ codigo: "catalogo" });
  });
});
