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
import { setTimeout as esperar } from "node:timers/promises";
import { inspect } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { crearCliente } from "../../../../prisma/comun";
import { URL_PRUEBAS } from "../../../../pruebas/base-de-pruebas";
import { celdas, leerZip } from "../../../../pruebas/leer-xlsx";
import { sembrarCapa } from "../../../../pruebas/semilla-inventario";
import { como as comoServicio, sembrarOperacion } from "../../../../pruebas/semilla-operacion";
import type { EntornoSalidas } from "../../../../pruebas/semilla-salidas";

const sesion = vi.hoisted(() => ({ userId: null as string | null }));
const clerk = vi.hoisted(() => ({ identidades: [] as { id: string; correo: string; nombre: string }[] }));
const lecturasDeUsuario = vi.hoisted(() => ({ n: 0 }));
/** Clerk que no responde: cuenta las llamadas y nunca contesta. */
const clerkColgado = vi.hoisted(() => ({ activo: false, llamadas: 0 }));

vi.mock("server-only", () => ({}));
// La base se consulta por usuario solo si el intento pasa el límite de peticiones.
vi.mock("@/lib/db", async (original) => {
  const db = await original<typeof import("@/lib/db")>();
  return {
    ...db,
    usuarioParaDescarga: (...a: Parameters<typeof db.usuarioParaDescarga>) => {
      lecturasDeUsuario.n++;
      return db.usuarioParaDescarga(...a);
    },
  };
});
vi.mock("@clerk/nextjs/server", async () => ({
  auth: (await import("../../../../pruebas/clerk-simulado")).authSimulado(sesion),
  clerkClient: async () => ({
    users: {
      getUserList: async ({ limit, offset }: { limit: number; offset: number }) => {
        if (clerkColgado.activo) {
          clerkColgado.llamadas++;
          return new Promise<never>(() => {});
        }
        return {
          totalCount: clerk.identidades.length,
          data: clerk.identidades.slice(offset, offset + limit).map((i) => ({
            id: i.id,
            primaryEmailAddressId: "principal",
            emailAddresses: [{ id: "principal", emailAddress: i.correo }],
            firstName: i.nombre,
            lastName: null,
          })),
        };
      },
    },
  }),
}));

process.env.DATABASE_URL = inject("urlEjecucionPruebas");
const { GET } = await import("./route");
const { listarEntradas } = await import("@/lib/entradas/repo");
const { leerFiltros } = await import("@/lib/entradas/filtros");
const { CLAVES_DE_DESCARGA, descargaDe } = await import("@/lib/exportar/descargas");
const { DescargaVencida, generaciones, GENERACIONES_POR_VENTANA, MAXIMO_ACTIVAS, MAXIMO_GENERANDO, PETICIONES_POR_VENTANA, PLAZO_GENERACION_MS, VIDA_MAXIMA_MS } = await import("@/lib/exportar/generaciones");
const { hoja } = await import("@/lib/exportar/hoja");
const { ESPERA_DE_CLERK_MS } = await import("@/lib/exportar/listados");
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
    const espia = vi.spyOn(d, "libro").mockImplementation(async (leer, params, senial) => {
      await puerta;
      return original.call(d, leer, params, senial);
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

  it(`cada intento con sesión cuenta, también los 429: el ${PETICIONES_POR_VENTANA + 1}.º del minuto se rechaza sin consultar la base`, async () => {
    como("JEFE");
    const a = await pedir("/exportar/existencias?q=a");
    const b = await pedir("/exportar/existencias?q=b");
    // Con dos activas, los siguientes intentos se rechazan, pero cuentan.
    for (let i = 2; i < PETICIONES_POR_VENTANA; i++) {
      const r = await pedir(`/exportar/existencias?q=${i}`);
      expect(r.status, `#${i + 1}`).toBe(429);
      expect(await r.json()).toEqual({ mensaje: expect.stringMatching(/dos descargas en curso/) });
    }
    const lecturas = lecturasDeUsuario.n;
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await a.arrayBuffer();
      const r = await pedir("/exportar/existencias?q=otra");
      expect(r.status).toBe(429);
      expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(await r.json()).toEqual({ mensaje: expect.stringMatching(/demasiadas descargas seguidas/) });
      expect(lecturasDeUsuario.n).toBe(lecturas);
      expect(aviso).toHaveBeenCalledWith(`[exportar] existencias: rechazada por peticiones, sesión ${clerkDe.JEFE}`);
    } finally {
      aviso.mockRestore();
    }
    await b.arrayBuffer();
    como(null);
    expect((await pedir("/exportar/existencias")).status).toBe(401);
  });

  it("al vencer el plazo, la respuesta se corta, el cupo vuelve y queda registrado; si vence antes de enviarse, 503", async () => {
    como("JEFE");
    const real = generaciones.admitir.bind(generaciones);
    const plazos: AbortController[] = [];
    const admitir = vi.spyOn(generaciones, "admitir").mockImplementation(((usuarioId: string, clave: string, generar: (senial: AbortSignal) => Promise<unknown>) => {
      const a = real(usuarioId, clave, generar);
      if (a.estado === "limitada") return a;
      const plazo = new AbortController();
      plazos.push(plazo);
      return { ...a, plazo: plazo.signal };
    }) as typeof generaciones.admitir);
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    let r: ReturnType<typeof retener> | undefined;
    try {
      const abierta = await pedir("/exportar/existencias?q=lenta");
      const otra = await pedir("/exportar/existencias?q=otra");
      expect([abierta.status, otra.status]).toEqual([200, 200]);
      expect((await pedir("/exportar/existencias?q=tercera")).status).toBe(429);
      plazos[0].abort(new DescargaVencida());
      await expect(abierta.arrayBuffer()).rejects.toThrow("La descarga llegó a su plazo máximo.");
      expect(aviso).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^\\[exportar\\] existencias: existencias-[\\d-]+\\.xlsx cortado por plazo tras \\d+ de \\d+ bytes, usuario ${e.usuarios.JEFE.id} \\(JEFE\\)$`)));
      // El cupo que dejó el corte se puede volver a usar.
      r = retener("existencias");
      const tarde = pedir("/exportar/existencias?q=tarde");
      await vi.waitFor(() => expect(plazos).toHaveLength(3));
      // Responde al vencer sin esperar al libro, que sigue retenido.
      plazos[2].abort(new DescargaVencida());
      const vencida = await tarde;
      expect(vencida.status).toBe(503);
      expect(await vencida.json()).toEqual({ mensaje: expect.stringMatching(/tardó demasiado/) });
      expect(aviso).toHaveBeenCalledWith(`[exportar] existencias: vencida antes de enviarse, usuario ${e.usuarios.JEFE.id} (JEFE)`);
      await otra.arrayBuffer();
    } finally {
      r?.soltar();
      r?.espia.mockRestore();
      admitir.mockRestore();
      aviso.mockRestore();
    }
  });

  /** Deja correr la cola de eventos hasta que se cumpla la condición; sirve con setTimeout falso. */
  const cuando = async (condicion: () => boolean) => {
    while (!condicion()) await new Promise<void>((listo) => setImmediate(listo));
  };

  it("el libro que no termina vence a su plazo: quienes esperan reciben 503, el trabajo recibe la señal y el cupo del proceso vuelve", async () => {
    const d = descargaDe("existencias")!;
    const original = d.libro;
    const seniales: AbortSignal[] = [];
    const libro = vi.spyOn(d, "libro").mockImplementation(async (leer, params, senial) => {
      if (!String(params.q).startsWith("atascado")) return original.call(d, leer, params, senial);
      seniales.push(senial);
      // Atiende la señal, como la compresión y la espera a Clerk.
      return new Promise<never>((_, rechazar) => senial.addEventListener("abort", () => rechazar(senial.reason), { once: true }));
    });
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // Tres usuarios, tres libros atascados: el cupo del proceso se llena.
      const esperas: Promise<Response>[] = [];
      for (const [i, rol] of (["JEFE", "COMPRAS", "SUPERADMIN"] as const).entries()) {
        como(rol);
        esperas.push(pedir(`/exportar/existencias?q=atascado${i}`));
        await cuando(() => seniales.length === i + 1);
      }
      expect(seniales).toHaveLength(MAXIMO_GENERANDO);
      como("JEFE");
      const llena = await pedir("/exportar/existencias?q=libre");
      expect(llena.status).toBe(429);
      expect(await llena.json()).toEqual({ mensaje: expect.stringMatching(/armando otros archivos/) });

      vi.advanceTimersByTime(PLAZO_GENERACION_MS);
      expect(seniales.every((s) => s.aborted)).toBe(true);
      expect((await Promise.all(esperas)).map((r) => r.status)).toEqual([503, 503, 503]);
      expect(aviso).toHaveBeenCalledWith(`[exportar] existencias: el libro no se terminó de armar en su plazo, usuario ${e.usuarios.JEFE.id} (JEFE)`);
      // Los trabajos se detuvieron: un libro nuevo ya cabe.
      const libre = await pedir("/exportar/existencias?q=libre");
      expect(libre.status).toBe(200);
      await libre.arrayBuffer();
    } finally {
      vi.useRealTimers();
      libro.mockRestore();
      aviso.mockRestore();
    }
  });

  it(`si Clerk no responde, el libro de usuarios deja de esperarlo a los ${ESPERA_DE_CLERK_MS / 1000} s: 500 y el motivo en el registro`, async () => {
    como("SUPERADMIN");
    clerk.identidades = [];
    clerkColgado.activo = true;
    clerkColgado.llamadas = 0;
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let respondio = false;
      const respuesta = pedir("/exportar/usuarios").finally(() => (respondio = true));
      await cuando(() => clerkColgado.llamadas > 0);
      vi.advanceTimersByTime(ESPERA_DE_CLERK_MS - 1);
      await new Promise<void>((listo) => setImmediate(listo));
      expect(respondio).toBe(false);
      vi.advanceTimersByTime(1);
      expect((await respuesta).status).toBe(500);
      expect(clerkColgado.llamadas).toBe(1);
      expect(inspect(registro.mock.calls)).toContain(`Clerk no respondió en ${ESPERA_DE_CLERK_MS / 1000} s.`);
    } finally {
      vi.useRealTimers();
      clerkColgado.activo = false;
      registro.mockRestore();
    }
  });

  // Optativa: tarda dos minutos reales. Con --reporter=verbose se ven sus mensajes:
  // PROBAR_PLAZO_REAL=1 npm test -- route.test.ts -t 'plazo real' --reporter=verbose
  it.runIf(process.env.PROBAR_PLAZO_REAL === "1")("plazo real: corta una descarga aún abierta a los dos minutos", async () => {
    como("JEFE");
    const d = descargaDe("existencias")!;
    const filas = Array.from({ length: 16_000 }, (_, i) => ({ valor: `${i}-${randomUUID()}` }));
    const libro = vi.spyOn(d, "libro").mockResolvedValue({
      hojas: [hoja({ nombre: "Prueba", titulo: "Prueba de plazo", filtros: [], columnas: [{ titulo: "Dato", formato: "texto", valor: (f: { valor: string }) => f.valor }], filas })],
    });
    const admitirOriginal = generaciones.admitir.bind(generaciones);
    let admitidoEn = 0;
    const admitir = vi.spyOn(generaciones, "admitir").mockImplementation(((...args: Parameters<typeof generaciones.admitir>) => {
      const resultado = admitirOriginal(...args);
      if (resultado.estado !== "limitada" && admitidoEn === 0) admitidoEn = performance.now();
      return resultado;
    }) as typeof generaciones.admitir);
    const aviso = vi.spyOn(console, "warn");
    let lector: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const respuesta = await pedir("/exportar/existencias?q=plazo-real");
      expect(respuesta.status).toBe(200);
      const bytes = Number(respuesta.headers.get("Content-Length"));
      expect(bytes).toBeGreaterThan(4 * 64 * 1024);
      lector = respuesta.body!.getReader();
      const transcurrido = () => performance.now() - admitidoEn;
      const cierre = lector.closed.then(
        () => ({ fin: "completo", ms: transcurrido() }),
        () => ({ fin: "vencido", ms: transcurrido() }),
      );
      const hasta = async (ms: number) => esperar(Math.max(0, ms - transcurrido()));

      expect((await lector.read()).value?.length).toBeGreaterThan(0);
      await hasta(50_000);
      expect((await lector.read()).value?.length).toBeGreaterThan(0);
      await hasta(100_000);
      expect((await lector.read()).value?.length).toBeGreaterThan(0);
      await hasta(115_000);
      expect(await Promise.race([cierre, esperar(100).then(() => "abierto")])).toBe("abierto");
      console.info("[plazo real] 115 s: el libro sigue abierto después de recibir tres trozos.");

      await hasta(122_000);
      const corte = await cierre;
      expect(corte.fin).toBe("vencido");
      // El plazo corre desde la admisión; el margen cubre la demora del temporizador.
      expect(corte.ms).toBeGreaterThanOrEqual(VIDA_MAXIMA_MS - 50);
      expect(corte.ms).toBeLessThan(VIDA_MAXIMA_MS + 1_000);
      await expect(lector.read()).rejects.toThrow("La descarga llegó a su plazo máximo.");
      // Tomó tres trozos de 64 KiB; el cuarto quedó en cola sin leerse.
      const nombre = /filename="([^"]+)"/.exec(respuesta.headers.get("Content-Disposition") ?? "")?.[1];
      expect(aviso).toHaveBeenCalledWith(`[exportar] existencias: ${nombre} cortado por plazo tras ${3 * 64 * 1024} de ${bytes} bytes, usuario ${e.usuarios.JEFE.id} (JEFE)`);
      console.info(`[plazo real] ${(corte.ms / 1000).toFixed(1)} s: la transferencia se cortó por plazo.`);

      // El cupo volvió: caben dos descargas nuevas y la siguiente se rechaza.
      const nuevas: Response[] = [];
      for (let i = 0; i < MAXIMO_ACTIVAS; i++) nuevas.push(await pedir(`/exportar/existencias?q=plazo-real-${i}`));
      expect(nuevas.map((r) => r.status)).toEqual(Array(MAXIMO_ACTIVAS).fill(200));
      expect((await pedir("/exportar/existencias?q=plazo-real-otra")).status).toBe(429);
      await Promise.all(nuevas.map((r) => r.body!.cancel()));
    } finally {
      await lector?.cancel().catch(() => {});
      libro.mockRestore();
      admitir.mockRestore();
      aviso.mockRestore();
    }
  }, 130_000);

  it("un valor que no se puede escribir se registra con su formato, sin el valor", async () => {
    como("JEFE");
    const d = descargaDe("existencias")!;
    const libro = vi.spyOn(d, "libro").mockResolvedValue({
      hojas: [hoja({ nombre: "x", titulo: "x", filtros: [], columnas: [{ titulo: "Importe", formato: "importe", valor: (f: { v: string }) => f.v }], filas: [{ v: "SECRETO-4471" }] })],
    });
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await pedir("/exportar/existencias?q=valor");
      expect(r.status).toBe(500);
      const escrito = registro.mock.calls.map((c) => c.map((x) => inspect(x)).join(" ")).join("\n");
      expect(escrito).toContain("ValorNoExportable");
      expect(escrito).toContain("importe");
      expect(escrito).not.toContain("SECRETO-4471");
    } finally {
      libro.mockRestore();
      registro.mockRestore();
    }
  });
});
