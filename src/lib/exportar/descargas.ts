import "server-only";
import type { Prisma } from "@prisma/client";
import type { UsuarioSesion } from "@/lib/db";
import type { TipoInventario } from "@/lib/inventario/repo";
import type { Permiso } from "@/lib/permisos";
import { hojasExistencias, hojasFrecuencia, hojasGasto, hojasKardex, hojasSemanal } from "@/lib/reportes/pantallas";
import { listarUsuarios } from "@/lib/usuarios/repo";
import { libroConteo, libroEntrada, libroMovimiento, libroSalida } from "./detalles";
import type { Hoja } from "./hoja";
import { hojaConAcceso, hojasCatalogo, hojasConteos, hojasEntradas, hojasMovimientos, hojasPendientes, hojasPrestamos, hojasSalidas, hojaSinAcceso, identidadesSinAcceso } from "./listados";

/*
  Las tablas que se descargan en Excel, por nombre fijo: el navegador elige
  una de esta lista, nunca una tabla ni una consulta. Cada una exige el mismo
  permiso que su pantalla y lee dentro de la puerta que le da la ruta.
*/

type Db = Prisma.TransactionClient;
export type Params = Record<string, string | string[] | undefined>;

/** La puerta de lectura con el permiso de la descarga: solo ella entrega el cliente. */
export type Lector = <T>(fn: (db: Db, usuario: UsuarioSesion) => Promise<T>) => Promise<T>;

/** Las hojas del libro y, si lo identifica algo más que la fecha, el nombre del archivo. */
export type Libro = { hojas: Hoja<unknown>[]; archivo?: string };

export type Descarga = {
  permiso: Permiso;
  /** Nombre base del archivo; la ruta le agrega la fecha. */
  archivo: string;
  titulo: string;
  /** null: lo pedido no existe. */
  libro: (leer: Lector, params: Params) => Promise<Libro | null>;
};

const reporte = (archivo: string, titulo: string, hojas: (db: Db, params: Params) => Promise<Hoja<unknown>[] | null>): Descarga => ({
  permiso: "reportes:leer",
  archivo,
  titulo,
  libro: async (leer, params) => {
    const h = await leer((db) => hojas(db, params));
    return h && { hojas: h };
  },
});

/** Una lista o un detalle que solo lee la base, con el permiso de su pantalla. */
const tabla = (permiso: Permiso, archivo: string, titulo: string, libro: (db: Db, usuario: UsuarioSesion, params: Params) => Promise<Libro | Hoja<unknown>[] | null>): Descarga => ({
  permiso,
  archivo,
  titulo,
  libro: async (leer, params) => {
    const r = await leer((db, usuario) => libro(db, usuario, params));
    return Array.isArray(r) ? { hojas: r } : r;
  },
});

const movimientos = (tipo: TipoInventario, permiso: Permiso, archivo: string, titulo: string) => ({
  lista: tabla(permiso, archivo, titulo, (db, _u, p) => hojasMovimientos(db, tipo, p)),
  detalle: tabla(permiso, archivo, titulo, (db, u, p) => libroMovimiento(db, u, tipo, p)),
});
const traspasos = movimientos("TRASPASO", "traspasos:leer", "traspasos", "Traspasos");
const devoluciones = movimientos("DEVOLUCION", "devoluciones:leer", "devoluciones", "Devoluciones");
const ajustes = movimientos("AJUSTE", "ajustes:leer", "ajustes", "Ajustes");

const DESCARGAS: Record<string, Descarga> = {
  semanal: reporte("reporte-semanal", "Reporte semanal", hojasSemanal),
  existencias: reporte("existencias", "Existencias por bodega y mínimo", hojasExistencias),
  kardex: reporte("kardex", "Kardex", hojasKardex),
  gasto: reporte("gasto-por-estacion", "Gasto acumulado por estación", hojasGasto),
  frecuencia: reporte("frecuencia-de-consumo", "Frecuencia de consumo", hojasFrecuencia),

  entradas: tabla("entradas:leer", "entradas", "Entradas", (db, _u, p) => hojasEntradas(db, p)),
  entrada: tabla("entradas:leer", "entrada", "Entrada", (db, _u, p) => libroEntrada(db, p)),
  salidas: tabla("salidas:leer", "salidas", "Salidas", (db, u, p) => hojasSalidas(db, u, p)),
  salida: tabla("salidas:leer", "salida", "Salida", (db, u, p) => libroSalida(db, u, p)),
  pendientes: tabla("salidas:leer", "salidas-pendientes", "Salidas pendientes", (db, u) => hojasPendientes(db, u)),
  traspasos: traspasos.lista,
  traspaso: traspasos.detalle,
  devoluciones: devoluciones.lista,
  devolucion: devoluciones.detalle,
  ajustes: ajustes.lista,
  ajuste: ajustes.detalle,
  // Préstamo es una salida y lo que vuelve una devolución: la lista pide los dos permisos de lectura.
  prestamos: tabla("devoluciones:leer", "prestamos", "Préstamos", (db, u, p) => hojasPrestamos(db, u, p)),
  conteos: tabla("ajustes:leer", "conteo-fisico", "Conteo físico", (db, _u, p) => hojasConteos(db, p)),
  conteo: tabla("ajustes:leer", "conteo", "Hoja de conteo", (db, u, p) => libroConteo(db, u, p)),
  catalogo: tabla("catalogos:leer", "catalogo", "Catálogo", async (db, _u, p) => {
    const c = await hojasCatalogo(db, p);
    return c && { hojas: c.hojas, archivo: c.slug };
  }),
  usuarios: {
    permiso: "usuarios:administrar",
    archivo: "usuarios",
    titulo: "Usuarios",
    libro: async (leer) => {
      const usuarios = await leer((db) => listarUsuarios(db));
      // Clerk ya fuera de la transacción: es una petición HTTP.
      return { hojas: [hojaConAcceso(usuarios), hojaSinAcceso(await identidadesSinAcceso(usuarios))] };
    },
  },
};

export function descargaDe(clave: string): Descarga | null {
  return Object.hasOwn(DESCARGAS, clave) ? DESCARGAS[clave] : null;
}

export const CLAVES_DE_DESCARGA = Object.keys(DESCARGAS);
