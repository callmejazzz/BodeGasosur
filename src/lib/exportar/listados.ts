import "server-only";
import type { Prisma } from "@prisma/client";
import { catalogoPorSlug, type CampoDef, type CatalogoDef } from "@/lib/catalogos/definiciones";
import { filtrarCatalogo, leerRuta, REPOS, type RegistroCatalogo } from "@/lib/catalogos/repos";
import type { UsuarioSesion } from "@/lib/db";
import { ESTATUS as ESTATUS_ENTRADAS, leerFiltros as leerFiltrosEntradas, REFERENCIA, type FiltroEntradas } from "@/lib/entradas/filtros";
import { listarEntradas, type EntradaResumen } from "@/lib/entradas/repo";
import { TEXTO_DEVOLUCION, TEXTO_ESTATUS_ENTRADA, TEXTO_ESTATUS_MOVIMIENTO, TEXTO_ESTATUS_SALIDA } from "@/lib/estatus";
import { formatearFecha } from "@/lib/fechas";
import { ESTATUS as ESTATUS_INVENTARIO, estatusDeFiltro, leerFiltros as leerFiltrosInventario, leerFiltrosDeHojas } from "@/lib/inventario/filtros";
import { devolucionDeSalidas, listarHojas, listarMovimientos, listarPrestamos, type EstadoDevolucion, type EstadoPrestamo, type HojaResumen, type MovimientoResumen, type Prestamo, type TipoInventario } from "@/lib/inventario/repo";
import { usuarioTienePermiso } from "@/lib/permisos";
import { aFiltroDeRepo, ESTATUS as ESTATUS_SALIDAS, leerFiltros as leerFiltrosSalidas } from "@/lib/salidas/filtros";
import { listarSalidas, seccionDeBandeja, seccionesDe, type SalidaResumen } from "@/lib/salidas/repo";
import { listarIdentidades, type IdentidadClerk } from "@/lib/usuarios/clerk";
import type { UsuarioAdministrable } from "@/lib/usuarios/repo";
import { hoja, type Columna, type Hoja } from "./hoja";
import { completa, DemasiadasFilas, MAXIMO_DE_FILAS, todasLasPaginas } from "./lotes";

/*
  Las listas que ya existían, en Excel (contrato de la fase 8, §4): los mismos
  filtros, orden y columnas de datos que su pantalla, leídos por lotes con
  sus propias consultas. Una celda que en pantalla junta varios datos se
  separa en sus columnas; las insignias de estatus van como texto.
*/

type Db = Prisma.TransactionClient;
type Params = Record<string, string | string[] | undefined>;

const ninguno = (texto: string) => texto || "—";
const juntos = (...partes: (string | false | null | undefined)[]) => partes.filter(Boolean).join(" · ");
const fecha = (f: string) => (f ? formatearFecha(f) : "—");

// ──────────────────────────────── Entradas ───────────────────────────────────

const COLUMNAS_ENTRADAS: Columna<EntradaResumen>[] = [
  { titulo: "Folio", formato: "texto", valor: (e) => e.folio ?? (e.estatus === "BORRADOR" ? "Borrador" : "Sin folio") },
  { titulo: "Fecha", formato: "fecha", valor: (e) => e.fecha },
  { titulo: "Proveedor", formato: "texto", valor: (e) => e.proveedor?.nombreComercial },
  { titulo: "Referencia", formato: "texto", valor: (e) => e.referencia },
  { titulo: "Bodega", formato: "texto", valor: (e) => e.bodegaDestino?.nombre },
  { titulo: "Partidas", formato: "entero", valor: (e) => e._count.partidas },
  { titulo: "Total", formato: "importe", valor: (e) => (e.total === null ? null : String(e.total)) },
  { titulo: "Moneda", formato: "texto", valor: (e) => (e.total === null ? null : (e.moneda ?? "MXN")) },
  { titulo: "Estatus", formato: "texto", valor: (e) => juntos(TEXTO_ESTATUS_ENTRADA[e.estatus], !!e.canceladoPor && "Revertida") },
];

export async function hojasEntradas(db: Db, params: Params): Promise<Hoja<unknown>[]> {
  const f: FiltroEntradas = leerFiltrosEntradas(params);
  return [
    hoja({
      nombre: "Entradas",
      titulo: "Entradas",
      filtros: [
        ["Búsqueda", ninguno(f.busqueda)],
        ["Estatus", ESTATUS_ENTRADAS.find((e) => e.valor === f.estatus)!.etiqueta],
        ["Referencia", REFERENCIA.find((r) => r.valor === f.referencia)!.etiqueta],
        ["Desde", fecha(f.desde)],
        ["Hasta", fecha(f.hasta)],
      ],
      columnas: COLUMNAS_ENTRADAS,
      filas: await todasLasPaginas((n, t) => listarEntradas(db, f, n, t)),
    }),
  ];
}

// ──────────────────────────────── Salidas ────────────────────────────────────

type SalidaConDevolucion = SalidaResumen & { devolucion?: EstadoDevolucion };

const COLUMNAS_SALIDAS: Columna<SalidaConDevolucion>[] = [
  { titulo: "Folio", formato: "texto", valor: (s) => s.folio ?? "Sin folio" },
  { titulo: "Fecha", formato: "fecha", valor: (s) => s.fecha },
  { titulo: "Bodega origen", formato: "texto", valor: (s) => s.bodegaOrigen?.nombre },
  { titulo: "Estación", formato: "texto", valor: (s) => s.estacion?.alias },
  { titulo: "Solicitante", formato: "texto", valor: (s) => s.solicitadoPor?.nombre },
  { titulo: "Partidas", formato: "entero", valor: (s) => s._count.partidas },
  {
    titulo: "Estatus",
    formato: "texto",
    valor: (s) => juntos(TEXTO_ESTATUS_SALIDA[s.estatus], s.esPrestamo && "Préstamo", s.devolucion && TEXTO_DEVOLUCION[s.devolucion], !!s.canceladoPor && "Revertida"),
  },
];

export async function hojasSalidas(db: Db, usuario: UsuarioSesion, params: Params): Promise<Hoja<unknown>[]> {
  const f = leerFiltrosSalidas(params);
  const salidas = await todasLasPaginas((n, t) => listarSalidas(db, aFiltroDeRepo(f), n, t));
  // Lo devuelto, como en la pantalla: solo a quien puede ver devoluciones.
  const devoluciones = usuarioTienePermiso(usuario, "devoluciones:leer") ? await devolucionDeSalidas(db, salidas.map((s) => s.id)) : {};
  return [
    hoja({
      nombre: "Salidas",
      titulo: "Salidas",
      filtros: [
        ["Búsqueda", ninguno(f.busqueda)],
        ["Estatus", ESTATUS_SALIDAS.find((e) => e.valor === f.estatus)!.etiqueta],
        ["Solo préstamos", f.prestamo ? "Sí" : "No"],
      ],
      columnas: COLUMNAS_SALIDAS,
      filas: salidas.map((s): SalidaConDevolucion => ({ ...s, devolucion: devoluciones[s.id] })),
    }),
  ];
}

const SECCION = {
  porAutorizar: { titulo: "Por autorizar", desde: (s: SalidaResumen) => s.createdAt },
  porRetirar: { titulo: "Por retirar", desde: (s: SalidaResumen) => s.autorizadoEn },
  porRecibir: { titulo: "Por confirmar recepción", desde: (s: SalidaResumen) => s.entregadoEn },
} as const;

/** Una hoja por sección en la que el usuario puede actuar, como la pantalla. */
export async function hojasPendientes(db: Db, usuario: UsuarioSesion): Promise<Hoja<unknown>[]> {
  const hojas: Hoja<unknown>[] = [];
  for (const { clave, estatus } of seccionesDe(usuario)) {
    const { titulo, desde } = SECCION[clave];
    hojas.push(
      hoja<SalidaResumen>({
        nombre: titulo,
        titulo: `Salidas pendientes: ${titulo.toLowerCase()}`,
        filtros: [["Orden", "La más antigua primero"]],
        columnas: [
          { titulo: "Salida", formato: "texto", valor: (s) => juntos(s.folio ?? "Sin folio", s.esPrestamo && "préstamo") },
          { titulo: "Espera desde", formato: "instante", valor: desde },
          { titulo: "Bodega origen", formato: "texto", valor: (s) => s.bodegaOrigen?.nombre },
          { titulo: "Estación", formato: "texto", valor: (s) => s.estacion?.alias },
          { titulo: "Solicitante", formato: "texto", valor: (s) => s.solicitadoPor?.nombre },
          { titulo: "Partidas", formato: "entero", valor: (s) => s._count.partidas },
        ],
        filas: await todasLasPaginas((n, t) => seccionDeBandeja(db, estatus, n, t)),
      }),
    );
  }
  if (hojas.length === 0) {
    hojas.push(hoja({ nombre: "Pendientes", titulo: "Salidas pendientes", filtros: [["Secciones", "Tu cuenta no autoriza, retira ni confirma recepciones"]], columnas: [], filas: [] }));
  }
  return hojas;
}

// ─────────────────────── Traspasos, devoluciones y ajustes ───────────────────

const NOMBRE_INVENTARIO: Record<TipoInventario, string> = { TRASPASO: "Traspasos", DEVOLUCION: "Devoluciones", AJUSTE: "Ajustes" };

function columnasDeMovimientos(tipo: TipoInventario): Columna<MovimientoResumen>[] {
  const origen: Columna<MovimientoResumen> = { titulo: "Bodega origen", formato: "texto", valor: (m) => m.bodegaOrigen?.nombre };
  const destino: Columna<MovimientoResumen> = { titulo: "Bodega destino", formato: "texto", valor: (m) => m.bodegaDestino?.nombre };
  const estacion: Columna<MovimientoResumen> = { titulo: "Estación", formato: "texto", valor: (m) => m.estacion?.alias };
  return [
    { titulo: "Folio", formato: "texto", valor: (m) => m.folio ?? "Sin folio" },
    { titulo: "Fecha", formato: "fecha", valor: (m) => m.fecha },
    ...(tipo === "DEVOLUCION" ? [estacion, destino] : [origen, destino]),
    { titulo: "Detalle", formato: "texto", valor: (m) => (m.cancelaA ? `Reversa de ${m.cancelaA.folio}` : m.devuelveA ? `De ${m.devuelveA.folio}` : m.motivo) },
    { titulo: "Partidas", formato: "entero", valor: (m) => m._count.partidas },
    { titulo: "Estatus", formato: "texto", valor: (m) => juntos(TEXTO_ESTATUS_MOVIMIENTO[m.estatus], !!m.cancelaA && "Reversa", !!m.canceladoPor && "Revertido") },
  ];
}

export async function hojasMovimientos(db: Db, tipo: TipoInventario, params: Params): Promise<Hoja<unknown>[]> {
  const f = leerFiltrosInventario(params);
  const nombre = NOMBRE_INVENTARIO[tipo];
  return [
    hoja({
      nombre,
      titulo: nombre,
      filtros: [
        ["Búsqueda", ninguno(f.busqueda)],
        ["Estatus", ESTATUS_INVENTARIO.find((e) => e.valor === f.estatus)!.etiqueta],
      ],
      columnas: columnasDeMovimientos(tipo),
      filas: await todasLasPaginas((n, t) => listarMovimientos(db, tipo, { estatus: estatusDeFiltro(f), busqueda: f.busqueda }, n, t)),
    }),
  ];
}

// ──────────────────────────── Préstamos y conteos ────────────────────────────

const ESTADOS_PRESTAMO: Record<EstadoPrestamo, string> = { abiertos: "Abiertos", cerrados: "Cerrados", todos: "Todos" };

export async function hojasPrestamos(db: Db, usuario: UsuarioSesion, params: Params): Promise<Hoja<unknown>[]> {
  const estado = (Object.keys(ESTADOS_PRESTAMO) as EstadoPrestamo[]).find((e) => e === params.estado) ?? "abiertos";
  // Un préstamo es una salida: sin permiso de leerlas, la lista queda vacía, como en pantalla.
  const filas = usuarioTienePermiso(usuario, "salidas:leer") ? await todasLasPaginas((n, t) => listarPrestamos(db, estado, n, t)) : [];
  return [
    hoja<Prestamo>({
      nombre: "Préstamos",
      titulo: "Préstamos",
      filtros: [["Estado", ESTADOS_PRESTAMO[estado]]],
      columnas: [
        { titulo: "Salida", formato: "texto", valor: (p) => p.folio },
        { titulo: "Fecha", formato: "fecha", valor: (p) => p.fecha },
        { titulo: "Estación", formato: "texto", valor: (p) => p.estacion },
        { titulo: "Bodega", formato: "texto", valor: (p) => p.bodega },
        { titulo: "Salió", formato: "entero", valor: (p) => p.retirado },
        { titulo: "Volvió", formato: "entero", valor: (p) => p.devuelto },
        { titulo: "Falta", formato: "entero", valor: (p) => p.pendiente },
      ],
      filas,
    }),
  ];
}

export async function hojasConteos(db: Db, params: Params): Promise<Hoja<unknown>[]> {
  const f = leerFiltrosDeHojas(params);
  return [
    hoja<HojaResumen>({
      nombre: "Conteo físico",
      titulo: "Hojas de conteo físico",
      filtros: [
        ["Estatus", ESTATUS_INVENTARIO.find((e) => e.valor === f.estatus)!.etiqueta],
        ["Abiertas desde", fecha(f.desde)],
        ["Abiertas hasta", fecha(f.hasta)],
      ],
      columnas: [
        { titulo: "Abierta", formato: "instante", valor: (h) => h.createdAt },
        { titulo: "Bodega", formato: "texto", valor: (h) => h.bodega.nombre },
        { titulo: "Motivo", formato: "texto", valor: (h) => h.motivo },
        { titulo: "Artículos", formato: "entero", valor: (h) => h._count.renglones },
        { titulo: "Ajustes", formato: "entero", valor: (h) => h._count.ajustes },
        { titulo: "Estatus", formato: "texto", valor: (h) => TEXTO_ESTATUS_MOVIMIENTO[h.estatus] },
      ],
      filas: await todasLasPaginas((n, t) => listarHojas(db, { estatus: estatusDeFiltro(f), desde: f.desde, hasta: f.hasta }, n, t)),
    }),
  ];
}

// ──────────────────────────────── Catálogos ──────────────────────────────────

function columnaDeCatalogo(campo: CampoDef, def: CatalogoDef): Columna<RegistroCatalogo> {
  const valor = (r: RegistroCatalogo) => leerRuta(r, campo.rutaTabla ?? campo.nombre);
  if (campo.esEstado) {
    const fin = def.genero === "f" ? "a" : "o";
    return { titulo: campo.etiqueta, formato: "texto", valor: (r) => (valor(r) === true ? `Activ${fin}` : `Inactiv${fin}`) };
  }
  if (campo.tipo === "booleano") return { titulo: campo.etiqueta, formato: "texto", valor: (r) => (valor(r) === true ? "Sí" : "No") };
  if (campo.tipo === "numero") return { titulo: campo.etiqueta, formato: "entero", valor: (r) => (typeof valor(r) === "number" ? (valor(r) as number) : null) };
  return { titulo: campo.etiqueta, formato: "texto", valor: (r) => (valor(r) === null || valor(r) === undefined ? null : String(valor(r))) };
}

/** null: el catálogo pedido no existe. */
export async function hojasCatalogo(db: Db, params: Params): Promise<{ hojas: Hoja<unknown>[]; slug: string } | null> {
  const slug = typeof params.catalogo === "string" ? params.catalogo : "";
  const def = catalogoPorSlug(slug);
  const repo = Object.hasOwn(REPOS, slug) ? REPOS[slug] : undefined;
  if (!def || !repo) return null;
  const busqueda = typeof params.q === "string" ? params.q.trim() : "";
  const filas = completa(filtrarCatalogo(await repo.listar(db), def, busqueda));
  return {
    slug,
    hojas: [
      hoja({
        nombre: def.titulo,
        titulo: def.titulo,
        filtros: [["Búsqueda", ninguno(busqueda)]],
        columnas: def.campos.filter((c) => !c.ocultarEnTabla).map((c) => columnaDeCatalogo(c, def)),
        filas,
      }),
    ],
  };
}

// ──────────────────────────────── Usuarios ───────────────────────────────────

const ROL = { SUPERADMIN: "Superadmin", COMPRAS: "Compras", JEFE: "Jefe" } as const;

export const hojaConAcceso = (usuarios: UsuarioAdministrable[]) =>
  hoja<UsuarioAdministrable>({
    nombre: "Con acceso",
    titulo: "Usuarios con acceso",
    filtros: [],
    columnas: [
      { titulo: "Correo", formato: "texto", valor: (u) => u.correo },
      { titulo: "Rol", formato: "texto", valor: (u) => ROL[u.rol] },
      { titulo: "Puede autorizar", formato: "texto", valor: (u) => (u.puedeAutorizar ? "Sí" : "No") },
      { titulo: "Activo", formato: "texto", valor: (u) => (u.activo ? "Sí" : "No") },
    ],
    filas: completa(usuarios),
  });

/** Lo que la pantalla muestra de cada identidad sin acceso: correo y nombre, nada más. */
export const hojaSinAcceso = (identidades: IdentidadClerk[]) =>
  hoja<IdentidadClerk>({
    nombre: "Sin acceso",
    titulo: "Identidades en Clerk sin acceso",
    filtros: [],
    columnas: [
      { titulo: "Correo", formato: "texto", valor: (i) => i.correo ?? "sin correo en Clerk" },
      { titulo: "Nombre", formato: "texto", valor: (i) => i.nombre },
    ],
    filas: identidades,
  });

/** Clerk, fuera de la transacción: todas sus páginas, sin quienes ya tienen acceso. */
export async function identidadesSinAcceso(usuarios: UsuarioAdministrable[]): Promise<IdentidadClerk[]> {
  const conAcceso = new Set(usuarios.map((u) => u.clerkUserId));
  const tamano = 500;
  const primera = await listarIdentidades(1, tamano);
  if (primera.total > MAXIMO_DE_FILAS) throw new DemasiadasFilas(primera.total);
  const todas = [...primera.identidades];
  for (let n = 2; (n - 1) * tamano < primera.total; n++) todas.push(...(await listarIdentidades(n, tamano)).identidades);
  return todas.filter((i) => !conAcceso.has(i.clerkUserId));
}
