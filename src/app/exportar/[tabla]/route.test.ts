/*
  La ruta de descarga contra PostgreSQL real, con la sesión de Clerk simulada:
  sin sesión o sin permiso no hay archivo; con permiso, el libro trae las
  mismas filas y en el mismo orden que la pantalla, también las de páginas
  posteriores a la primera, y el texto que parece fórmula queda como texto.
  Cada usuario arma pocos libros a la vez y por minuto, el mismo pedido en
  curso se comparte, y cada descarga queda en el registro sin sus filtros.
*/

import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../../prisma/comun";
import { URL_PRUEBAS } from "../../../../pruebas/base-de-pruebas";
import { celdas, leerZip } from "../../../../pruebas/leer-xlsx";
import { sembrarCapa } from "../../../../pruebas/semilla-inventario";
import { como as comoServicio, sembrarOperacion } from "../../../../pruebas/semilla-operacion";
import type { EntornoSalidas } from "../../../../pruebas/semilla-salidas";

const sesion = vi.hoisted(() => ({ userId: null as string | null }));
const clerk = vi.hoisted(() => ({ identidades: [] as { id: string; correo: string; nombre: string }[] }));

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", async () => ({
  auth: (await import("../../../../pruebas/clerk-simulado")).authSimulado(sesion),
  clerkClient: async () => ({
    users: {
      getUserList: async ({ limit, offset }: { limit: number; offset: number }) => ({
        totalCount: clerk.identidades.length,
        data: clerk.identidades.slice(offset, offset + limit).map((i) => ({
          id: i.id,
          primaryEmailAddressId: "principal",
          emailAddresses: [{ id: "principal", emailAddress: i.correo }],
          firstName: i.nombre,
          lastName: null,
        })),
      }),
    },
  }),
}));

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
const { GET } = await import("./route");
const { listarEntradas } = await import("@/lib/entradas/repo");
const { leerFiltros } = await import("@/lib/entradas/filtros");
const { CLAVES_DE_DESCARGA, descargaDe } = await import("@/lib/exportar/descargas");
const { generaciones, GENERACIONES_POR_VENTANA } = await import("@/lib/exportar/generaciones");
const { abrirHoja } = await import("@/lib/inventario/conteos");
const { confirmarDevolucion, crearDevolucion } = await import("@/lib/inventario/devoluciones");
const { confirmarTraspaso, crearTraspaso } = await import("@/lib/inventario/traspasos");
const { autorizarSalida, retirarSalida, solicitarSalida } = await import("@/lib/salidas/servicio");

const prisma = crearCliente(URL_PRUEBAS);
let e: EntornoSalidas;
let sufijo: string;
const clerkDe: Record<string, string> = {};

beforeAll(async () => {
  e = await sembrarOperacion(prisma);
  sufijo = randomUUID().slice(0, 8);
  for (const rol of ["SUPERADMIN", "COMPRAS", "JEFE"] as const) {
    clerkDe[rol] = (await prisma.usuario.findUniqueOrThrow({ where: { id: e.usuarios[rol].id } })).clerkUserId;
  }
});
afterAll(() => prisma.$disconnect());
// Las pruebas descargan mucho más seguido que una persona: cada una empieza sin límites gastados.
beforeEach(() => generaciones.reiniciar());

const como = (rol: "SUPERADMIN" | "COMPRAS" | "JEFE" | null) => {
  sesion.userId = rol && clerkDe[rol];
};

async function pedir(ruta: string) {
  const url = new URL(ruta, "http://localhost");
  const tabla = url.pathname.split("/").pop()!;
  return GET(new NextRequest(url), { params: Promise.resolve({ tabla }) });
}

async function libro(ruta: string) {
  const r = await pedir(ruta);
  expect(r.status, await r.clone().text()).toBe(200);
  return leerZip(Buffer.from(await r.arrayBuffer()));
}

/** La tabla de una hoja: el encabezado va después de la fila en blanco que cierra los filtros. */
function datos(hojaXml: string) {
  const filas = celdas(hojaXml);
  const encabezado = filas.findIndex((f) => f.length === 0) + 1;
  return { encabezado: filas[encabezado], filas: filas.slice(encabezado + 1) };
}

describe("quién descarga", () => {
  it("sin sesión no hay archivo: 401 con mensaje y sin caché", async () => {
    como(null);
    const r = await pedir("/exportar/semanal");
    expect(r.status).toBe(401);
    expect(r.headers.get("Content-Type")).toMatch(/^application\/json/);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await r.json()).toEqual({ mensaje: expect.stringMatching(/sesión/) });
  });

  it("sin el permiso de la pantalla no hay archivo: 403", async () => {
    como("JEFE");
    for (const tabla of ["usuarios"]) expect((await pedir(`/exportar/${tabla}`)).status, tabla).toBe(403);
    como("COMPRAS");
    expect((await pedir("/exportar/usuarios")).status).toBe(403);
  });

  it("los tres roles descargan los reportes, sin caché y como adjunto", async () => {
    for (const rol of ["SUPERADMIN", "COMPRAS", "JEFE"] as const) {
      como(rol);
      const r = await pedir("/exportar/semanal");
      expect(r.status, rol).toBe(200);
      expect(r.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(r.headers.get("Cache-Control")).toBe("private, no-store");
      expect(r.headers.get("Content-Disposition")).toMatch(/^attachment; filename="reporte-semanal-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    }
  });

  it("una tabla que no está en la lista o un detalle que no existe: 404", async () => {
    como("SUPERADMIN");
    for (const ruta of ["/exportar/Movimiento", "/exportar/constructor", "/exportar/__proto__", "/exportar/kardex", `/exportar/kardex?articulo=${randomUUID()}`, `/exportar/entrada?id=${randomUUID()}`, "/exportar/salida?id=' OR 1=1 --", "/exportar/catalogo?catalogo=Usuario"]) {
      expect((await pedir(ruta)).status, ruta).toBe(404);
    }
  });
});

describe("lo mismo que la pantalla", () => {
  it("todas las filas filtradas, en el orden de la lista, también después de la primera página", async () => {
    const bodega = await prisma.bodega.create({ data: { nombre: `Excel ${sufijo}` } });
    const articulo = await prisma.articulo.create({ data: { descripcion: `Excel ${sufijo}`, unidadId: e.unidadId } });
    for (let i = 0; i < 120; i++) {
      await sembrarCapa(prisma, e, { bodegaId: bodega.id, articuloId: articulo.id, cantidad: 1, fechaOriginal: "2026-09-01", costo: ["1.5000", "1.7400"] });
    }
    como("JEFE");
    const params = { q: bodega.nombre, estatus: "confirmadas" };
    const { filas, encabezado } = datos((await libro(`/exportar/entradas?${new URLSearchParams(params)}`))["xl/worksheets/sheet1.xml"]);
    expect(encabezado).toEqual(["Folio", "Fecha", "Proveedor", "Referencia", "Bodega", "Partidas", "Total", "Moneda", "Estatus"]);

    const filtros = leerFiltros(params);
    const pantalla = await prisma.$transaction(async (db) => [...(await listarEntradas(db, filtros, 1)).filas, ...(await listarEntradas(db, filtros, 2)).filas]);
    expect(pantalla).toHaveLength(120);
    expect(filas.map((f) => f[0])).toEqual(pantalla.map((p) => p.folio));
    // Fecha de Excel, número y texto donde van.
    expect(filas[0][1]).toBe("46266");
    expect(filas[0][5]).toBe("1");
    expect(filas[0][8]).toBe("Confirmada");
  });

  it("el reporte trae sus dos hojas y las filas de la pantalla", async () => {
    como("COMPRAS");
    const archivos = await libro(`/exportar/semanal?viernes=2026-09-04&q=Excel%20${sufijo}`);
    expect(archivos["xl/workbook.xml"]).toMatch(/<sheet name="Semanal".*<sheet name="Por artículo"/);
    const { filas } = datos(archivos["xl/worksheets/sheet1.xml"]);
    expect(filas).toHaveLength(1);
    // Bodega, clave, descripción, unidad, inicial 0, compras 120… valor 180.00 y 0 sin costo.
    expect(filas[0].slice(4, 6)).toEqual(["0", "120"]);
    expect(filas[0].slice(-3)).toEqual(["180.00", "208.80", "0"]);
  });

  it("el texto que parece fórmula se escribe como texto literal", async () => {
    const articulo = await prisma.articulo.create({ data: { descripcion: `=HYPERLINK("http://x";"${sufijo}")`, unidadId: e.unidadId, stockMinimo: 1 } });
    await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId: articulo.id, cantidad: 3, fechaOriginal: "2026-09-01", costo: null });
    como("JEFE");
    const hoja = (await libro(`/exportar/existencias?bodega=${e.bodegaId}&q=${sufijo}`))["xl/worksheets/sheet1.xml"];
    expect(hoja).toMatch(/<c r="C\d+" t="inlineStr" s="7"><is><t>=HYPERLINK\(&quot;http:\/\/x&quot;;&quot;/);
    expect(hoja).not.toContain("<f>");
  });

  it("usuarios: con acceso desde la base y sin acceso desde Clerk, sin datos que la pantalla no muestra", async () => {
    const conAcceso = await prisma.usuario.findUniqueOrThrow({ where: { id: e.usuarios.COMPRAS.id } });
    clerk.identidades = [
      { id: conAcceso.clerkUserId, correo: conAcceso.correo, nombre: "Ya tiene acceso" },
      { id: `user_sin_${sufijo}`, correo: `sin.${sufijo}@prueba.test`, nombre: "Pendiente" },
    ];
    como("SUPERADMIN");
    const archivos = await libro("/exportar/usuarios");
    const sinAcceso = datos(archivos["xl/worksheets/sheet2.xml"]);
    expect(sinAcceso.encabezado).toEqual(["Correo", "Nombre"]);
    expect(sinAcceso.filas).toEqual([[`sin.${sufijo}@prueba.test`, "Pendiente"]]);
    expect(Object.values(archivos).join("")).not.toContain("user_sin_");
  });
});

describe("cada tabla registrada", () => {
  it("se descarga completa con el Superadmin, listas y detalles", async () => {
    const u = e.usuarios.COMPRAS;
    const articuloId = (await prisma.articulo.create({ data: { descripcion: `Humo ${sufijo}`, unidadId: e.unidadId } })).id;
    const entrada = await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId, cantidad: 10, fechaOriginal: "2026-09-01", costo: ["2.0000", "2.3200"] });
    const ajuste = await sembrarCapa(prisma, e, { bodegaId: e.bodegaId, articuloId, cantidad: 2, fechaOriginal: "2026-09-02", costo: null });
    const partidas = (n: number) => [{ articuloId, presentacion: "UNIDAD" as const, cantidadCapturada: n }];
    const { id: salida } = await comoServicio(prisma, u, "salidas:capturar", (tx) =>
      solicitarSalida(tx, u, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, estacionId: e.estacionId, esPrestamo: true }, partidas: partidas(3) }),
    );
    await comoServicio(prisma, e.autorizadores.JEFE, "salidas:autorizar", (tx) => autorizarSalida(tx, e.autorizadores.JEFE, salida));
    await comoServicio(prisma, u, "salidas:retirar", (tx) => retirarSalida(tx, u, salida, "Mensajero"));
    const { id: traspaso } = await comoServicio(prisma, u, "traspasos:capturar", (tx) =>
      crearTraspaso(tx, u, randomUUID(), { encabezado: { bodegaOrigenId: e.bodegaId, bodegaDestinoId: e.otraBodegaId }, partidas: partidas(2) }),
    );
    await comoServicio(prisma, u, "traspasos:confirmar", (tx) => confirmarTraspaso(tx, u, traspaso));
    const { id: devolucion } = await comoServicio(prisma, u, "devoluciones:capturar", (tx) =>
      crearDevolucion(tx, u, randomUUID(), { encabezado: { estacionId: e.estacionId, bodegaDestinoId: e.bodegaId, salidaId: salida }, partidas: partidas(1) }),
    );
    await comoServicio(prisma, u, "devoluciones:confirmar", (tx) => confirmarDevolucion(tx, u, devolucion));
    const { id: hoja } = await comoServicio(prisma, u, "ajustes:capturar", (tx) => abrirHoja(tx, u, randomUUID(), { bodegaId: e.bodegaId, motivo: `Humo ${sufijo}` }));

    const rutas: Record<string, string> = {
      kardex: `?articulo=${articuloId}`,
      entrada: `?id=${entrada.movimientoId}`,
      salida: `?id=${salida}`,
      traspaso: `?id=${traspaso}`,
      devolucion: `?id=${devolucion}`,
      ajuste: `?id=${ajuste.movimientoId}`,
      conteo: `?id=${hoja}`,
      catalogo: "?catalogo=articulos",
      gasto: "?detalle=1",
      prestamos: "?estado=todos",
    };
    clerk.identidades = [];
    como("SUPERADMIN");
    for (const clave of CLAVES_DE_DESCARGA) {
      generaciones.reiniciar();
      const archivos = await libro(`/exportar/${clave}${rutas[clave] ?? ""}`);
      expect(archivos["xl/worksheets/sheet1.xml"], clave).toContain("<sheetData>");
    }
    const salidaXlsx = await libro(`/exportar/salida?id=${salida}`);
    expect(salidaXlsx["xl/workbook.xml"]).toMatch(/Partidas.*Capas consumidas.*Préstamo.*Devoluciones/);
    expect(datos(salidaXlsx["xl/worksheets/sheet3.xml"]).filas).toEqual([[expect.any(String), `Humo ${sufijo}`, expect.any(String), "3", "1", "2"]]);
    const traspasoXlsx = await libro(`/exportar/traspaso?id=${traspaso}`);
    expect(datos(traspasoXlsx["xl/worksheets/sheet2.xml"]).filas.map((f) => f[1]).sort()).toEqual(["Entró", "Salió"]);
  });
});

describe("solicitudes repetidas y abuso", () => {
  /** Detiene la lectura del libro de una tabla hasta soltarla. */
  function retener(tabla: string) {
    const d = descargaDe(tabla)!;
    const original = d.libro;
    let abrir!: () => void;
    const puerta = new Promise<void>((resolve) => (abrir = resolve));
    const espia = vi.spyOn(d, "libro").mockImplementation(async (leer, params) => {
      await puerta;
      return original.call(d, leer, params);
    });
    return { espia, soltar: () => abrir() };
  }

  /** El estado de una descarga ya recibida completa. */
  const recibir = async (ruta: string) => {
    const r = await pedir(ruta);
    await r.arrayBuffer();
    return r.status;
  };

  it("un segundo clic u otra pestaña espera el mismo libro; no arma otro", async () => {
    como("JEFE");
    const r = retener("existencias");
    const admitir = vi.spyOn(generaciones, "admitir");
    try {
      const primera = pedir("/exportar/existencias?q=casco");
      const segunda = pedir("/exportar/existencias?pagina=2&q=%20casco%20");
      await vi.waitFor(() => expect(admitir).toHaveBeenCalledTimes(2));
      r.soltar();
      const [a, b] = await Promise.all([primera, segunda]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(Buffer.from(await b.arrayBuffer())).toEqual(Buffer.from(await a.arrayBuffer()));
      expect(r.espia).toHaveBeenCalledTimes(1);
    } finally {
      r.espia.mockRestore();
      admitir.mockRestore();
    }
  });

  it("las respuestas que comparten libro leen la misma memoria, sin copiarlo", async () => {
    como("JEFE");
    const r = retener("existencias");
    const admitir = vi.spyOn(generaciones, "admitir");
    try {
      const primera = pedir("/exportar/existencias?q=memoria");
      const segunda = pedir("/exportar/existencias?q=memoria");
      await vi.waitFor(() => expect(admitir).toHaveBeenCalledTimes(2));
      r.soltar();
      const lectores = (await Promise.all([primera, segunda])).map((x) => x.body!.getReader());
      const [a, b] = await Promise.all(lectores.map(async (l) => (await l.read()).value!));
      expect(a.buffer).toBe(b.buffer);
      await Promise.all(lectores.map((l) => l.cancel()));
    } finally {
      r.espia.mockRestore();
      admitir.mockRestore();
    }
  });

  it("una descarga está activa hasta terminar de enviarse: con dos, la tercera responde 429 con Retry-After", async () => {
    como("JEFE");
    const a = await pedir("/exportar/existencias?q=a");
    const b = await pedir("/exportar/existencias?q=b");
    expect([a.status, b.status]).toEqual([200, 200]);
    // Las dos ya se armaron, pero nadie ha leído su respuesta.
    for (const ruta of ["/exportar/existencias?q=c", "/exportar/existencias?q=a"]) {
      const r = await pedir(ruta);
      expect(r.status, ruta).toBe(429);
      expect(r.headers.get("Retry-After")).toBe("5");
      expect(r.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await r.json()).toEqual({ mensaje: expect.stringMatching(/dos descargas en curso/) });
    }
    await a.arrayBuffer();
    const c = await pedir("/exportar/existencias?q=c");
    expect(c.status).toBe(200);
    expect((await pedir("/exportar/existencias?q=d")).status).toBe(429);
    // Cortar una descarga también libera su lugar.
    await b.body!.cancel();
    expect(await recibir("/exportar/existencias?q=d")).toBe(200);
    await c.arrayBuffer();
  });

  it(`más de ${GENERACIONES_POR_VENTANA} libros nuevos en un minuto: 429 con Retry-After, solo para ese usuario`, async () => {
    como("JEFE");
    for (let i = 0; i < GENERACIONES_POR_VENTANA; i++) expect(await recibir(`/exportar/existencias?q=f${i}`), `#${i + 1}`).toBe(200);
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const r = await pedir("/exportar/existencias?q=otra");
      expect(r.status).toBe(429);
      const espera = Number(r.headers.get("Retry-After"));
      expect(espera).toBeGreaterThan(0);
      expect(espera).toBeLessThanOrEqual(60);
      expect(await r.json()).toEqual({ mensaje: expect.stringContaining(`${espera} s`) });
      // El rechazo se registra una vez por ventana, no en cada intento.
      expect((await pedir("/exportar/existencias?q=otra")).status).toBe(429);
      expect(aviso.mock.calls).toEqual([[`[exportar] existencias: rechazada por generaciones, usuario ${e.usuarios.JEFE.id} (JEFE)`]]);
    } finally {
      aviso.mockRestore();
    }
    como("COMPRAS");
    expect(await recibir("/exportar/existencias?q=otra")).toBe(200);
  });

  it("registra quién descargó al terminar de enviar, o hasta dónde llegó si se cortó; sin filtros ni filas", async () => {
    como("JEFE");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const r = await pedir(`/exportar/existencias?q=Secreto${sufijo}`);
      expect(info).not.toHaveBeenCalled();
      await r.arrayBuffer();
      const cortada = await pedir(`/exportar/existencias?q=Otro${sufijo}`);
      await cortada.body!.cancel();
      const [entregado, cortado] = info.mock.calls.map((c) => String(c[0]));
      const archivo = "existencias-\\d{4}-\\d{2}-\\d{2}\\.xlsx";
      const usuario = `usuario ${e.usuarios.JEFE.id} \\(JEFE\\)`;
      expect(entregado).toMatch(new RegExp(`^\\[exportar\\] existencias: ${archivo} entregado a ${usuario}, \\d+ filas, \\d+ bytes, generado en \\d+ ms$`));
      expect(cortado).toMatch(new RegExp(`^\\[exportar\\] existencias: ${archivo} cortado tras \\d+ de \\d+ bytes, ${usuario}$`));
      expect(info.mock.calls.join(" ")).not.toMatch(new RegExp(`Secreto|Otro${sufijo}`));
    } finally {
      info.mockRestore();
    }
  });
});
