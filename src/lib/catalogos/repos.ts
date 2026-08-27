import "server-only";
import { prisma } from "@/lib/db";
import type { ValoresCatalogo } from "./definiciones";

/**
 * Acceso a datos de los catálogos.
 *
 * Cada catálogo mapea sus campos explícitamente en lugar de pasar el objeto
 * validado tal cual: es unas líneas más, pero deja que TypeScript verifique que
 * lo que se escribe coincide con el modelo, y hace evidente qué se guarda.
 *
 * Dos ausencias son deliberadas y conviene no «arreglarlas»:
 *
 *   · `actualizar` nunca escribe una clave de negocio (Bodega.clave,
 *     Estacion.numero, UnidadMedida.clave). Un trigger de PostgreSQL lo
 *     impide de todos modos; aquí simplemente no se intenta.
 *
 *   · `crear` de artículos no manda `clave`. La genera la base por secuencia
 *     —ART-00001, ART-00002…— y por eso el formulario la muestra de solo
 *     lectura.
 */

export type RegistroCatalogo = { id: string };

export type Opcion = { valor: string; etiqueta: string };

export type RepoCatalogo = {
  listar: () => Promise<RegistroCatalogo[]>;
  obtener: (id: string) => Promise<RegistroCatalogo | null>;
  crear: (datos: ValoresCatalogo) => Promise<void>;
  actualizar: (id: string, datos: ValoresCatalogo) => Promise<void>;
};

// ── Lectores tolerantes: el valor ya pasó por Zod, aquí solo se le da tipo ──

const texto = (v: unknown): string => (typeof v === "string" ? v : "");
const textoOpcional = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const entero = (v: unknown): number => (typeof v === "number" ? Math.trunc(v) : 0);
const enteroOpcional = (v: unknown): number | null =>
  typeof v === "number" ? Math.trunc(v) : null;
const bool = (v: unknown): boolean => v === true;

/** Mayúsculas, sin guiones ni espacios: así se guarda el RFC en el catálogo global. */
const rfc = (v: unknown): string | null => {
  const crudo = textoOpcional(v);
  return crudo ? crudo.toUpperCase().replace(/[\s-]/g, "") : null;
};

/** Lee `unidad.clave` sobre un registro cuyo tipo estático no expone la relación. */
export function leerRuta(registro: unknown, ruta: string): unknown {
  return ruta.split(".").reduce<unknown>((actual, llave) => {
    if (actual && typeof actual === "object" && llave in actual) {
      return (actual as Record<string, unknown>)[llave];
    }
    return undefined;
  }, registro);
}

export const REPOS: Record<string, RepoCatalogo> = {
  empresas: {
    listar: () => prisma.empresa.findMany({ orderBy: { razonSocial: "asc" } }),
    obtener: (id) => prisma.empresa.findUnique({ where: { id } }),
    crear: async (d) => {
      await prisma.empresa.create({
        data: {
          razonSocial: texto(d.razonSocial),
          rfc: rfc(d.rfc),
          activa: bool(d.activa),
        },
      });
    },
    actualizar: async (id, d) => {
      await prisma.empresa.update({
        where: { id },
        data: {
          razonSocial: texto(d.razonSocial),
          rfc: rfc(d.rfc),
          activa: bool(d.activa),
        },
      });
    },
  },

  bodegas: {
    listar: () => prisma.bodega.findMany({ orderBy: { clave: "asc" } }),
    obtener: (id) => prisma.bodega.findUnique({ where: { id } }),
    crear: async (d) => {
      await prisma.bodega.create({
        data: {
          clave: texto(d.clave).toUpperCase(),
          nombre: texto(d.nombre),
          ubicacion: textoOpcional(d.ubicacion),
          activa: bool(d.activa),
        },
      });
    },
    actualizar: async (id, d) => {
      await prisma.bodega.update({
        where: { id },
        data: {
          nombre: texto(d.nombre),
          ubicacion: textoOpcional(d.ubicacion),
          activa: bool(d.activa),
        },
      });
    },
  },

  estaciones: {
    listar: () =>
      prisma.estacion.findMany({ orderBy: { numero: "asc" }, include: { empresa: true } }),
    obtener: (id) => prisma.estacion.findUnique({ where: { id } }),
    crear: async (d) => {
      await prisma.estacion.create({
        data: {
          numero: texto(d.numero).toUpperCase(),
          alias: texto(d.alias),
          empresaId: texto(d.empresaId),
          telefono: textoOpcional(d.telefono),
          movil: textoOpcional(d.movil),
          correo: textoOpcional(d.correo),
          activa: bool(d.activa),
        },
      });
    },
    actualizar: async (id, d) => {
      await prisma.estacion.update({
        where: { id },
        data: {
          alias: texto(d.alias),
          empresaId: texto(d.empresaId),
          telefono: textoOpcional(d.telefono),
          movil: textoOpcional(d.movil),
          correo: textoOpcional(d.correo),
          activa: bool(d.activa),
        },
      });
    },
  },

  areas: {
    listar: () => prisma.area.findMany({ orderBy: { nombre: "asc" } }),
    obtener: (id) => prisma.area.findUnique({ where: { id } }),
    crear: async (d) => {
      await prisma.area.create({
        data: { nombre: texto(d.nombre), activa: bool(d.activa) },
      });
    },
    actualizar: async (id, d) => {
      await prisma.area.update({
        where: { id },
        data: { nombre: texto(d.nombre), activa: bool(d.activa) },
      });
    },
  },

  unidades: {
    listar: () => prisma.unidadMedida.findMany({ orderBy: { clave: "asc" } }),
    obtener: (id) => prisma.unidadMedida.findUnique({ where: { id } }),
    crear: async (d) => {
      await prisma.unidadMedida.create({
        data: {
          clave: texto(d.clave).toUpperCase(),
          nombre: texto(d.nombre),
          activa: bool(d.activa),
        },
      });
    },
    actualizar: async (id, d) => {
      await prisma.unidadMedida.update({
        where: { id },
        data: { nombre: texto(d.nombre), activa: bool(d.activa) },
      });
    },
  },

  categorias: {
    listar: () => prisma.categoriaArticulo.findMany({ orderBy: { nombre: "asc" } }),
    obtener: (id) => prisma.categoriaArticulo.findUnique({ where: { id } }),
    crear: async (d) => {
      await prisma.categoriaArticulo.create({
        data: { nombre: texto(d.nombre), activa: bool(d.activa) },
      });
    },
    actualizar: async (id, d) => {
      await prisma.categoriaArticulo.update({
        where: { id },
        data: { nombre: texto(d.nombre), activa: bool(d.activa) },
      });
    },
  },

  articulos: {
    listar: () =>
      prisma.articulo.findMany({
        orderBy: { clave: "asc" },
        include: { unidad: true, categoria: true },
      }),
    obtener: (id) => prisma.articulo.findUnique({ where: { id } }),
    crear: async (d) => {
      // Sin `clave`: la asigna la secuencia de PostgreSQL.
      await prisma.articulo.create({
        data: {
          descripcion: texto(d.descripcion),
          unidadId: texto(d.unidadId),
          categoriaId: textoOpcional(d.categoriaId),
          piezasPorCaja: enteroOpcional(d.piezasPorCaja),
          stockMinimo: entero(d.stockMinimo),
          activo: bool(d.activo),
        },
      });
    },
    actualizar: async (id, d) => {
      await prisma.articulo.update({
        where: { id },
        data: {
          descripcion: texto(d.descripcion),
          unidadId: texto(d.unidadId),
          categoriaId: textoOpcional(d.categoriaId),
          piezasPorCaja: enteroOpcional(d.piezasPorCaja),
          stockMinimo: entero(d.stockMinimo),
          activo: bool(d.activo),
        },
      });
    },
  },

  proveedores: {
    listar: () =>
      prisma.proveedor.findMany({
        orderBy: { nombreComercial: "asc" },
        include: { empresa: true },
      }),
    obtener: (id) => prisma.proveedor.findUnique({ where: { id } }),
    crear: async (d) => {
      await prisma.proveedor.create({
        data: {
          empresaId: texto(d.empresaId),
          nombreComercial: texto(d.nombreComercial),
          giro: textoOpcional(d.giro),
          contacto: textoOpcional(d.contacto),
          telefono: textoOpcional(d.telefono),
          correo: textoOpcional(d.correo),
          activo: bool(d.activo),
        },
      });
    },
    actualizar: async (id, d) => {
      await prisma.proveedor.update({
        where: { id },
        data: {
          empresaId: texto(d.empresaId),
          nombreComercial: texto(d.nombreComercial),
          giro: textoOpcional(d.giro),
          contacto: textoOpcional(d.contacto),
          telefono: textoOpcional(d.telefono),
          correo: textoOpcional(d.correo),
          activo: bool(d.activo),
        },
      });
    },
  },

  personas: {
    listar: () => prisma.persona.findMany({ orderBy: { nombre: "asc" } }),
    obtener: (id) => prisma.persona.findUnique({ where: { id } }),
    crear: async (d) => {
      await prisma.persona.create({
        data: {
          nombre: texto(d.nombre),
          puesto: textoOpcional(d.puesto),
          activa: bool(d.activa),
        },
      });
    },
    actualizar: async (id, d) => {
      await prisma.persona.update({
        where: { id },
        data: {
          nombre: texto(d.nombre),
          puesto: textoOpcional(d.puesto),
          activa: bool(d.activa),
        },
      });
    },
  },
};

/** Opciones para los campos de tipo `select`. */
export async function cargarOpciones(): Promise<Record<string, Opcion[]>> {
  const [unidades, categorias, empresas] = await Promise.all([
    prisma.unidadMedida.findMany({ where: { activa: true }, orderBy: { clave: "asc" } }),
    prisma.categoriaArticulo.findMany({ where: { activa: true }, orderBy: { nombre: "asc" } }),
    prisma.empresa.findMany({ where: { activa: true }, orderBy: { razonSocial: "asc" } }),
  ]);

  return {
    unidades: unidades.map((u) => ({ valor: u.id, etiqueta: `${u.clave} — ${u.nombre}` })),
    categorias: categorias.map((c) => ({ valor: c.id, etiqueta: c.nombre })),
    empresas: empresas.map((e) => ({
      valor: e.id,
      etiqueta: e.rfc ? `${e.razonSocial} — ${e.rfc}` : e.razonSocial,
    })),
  };
}

/** Conteos para el índice de catálogos y el tablero. */
export async function contarCatalogos() {
  const [
    empresas,
    bodegas,
    estaciones,
    areas,
    unidades,
    categorias,
    articulos,
    proveedores,
    personas,
  ] = await Promise.all([
    prisma.empresa.count(),
    prisma.bodega.count(),
    prisma.estacion.count(),
    prisma.area.count(),
    prisma.unidadMedida.count(),
    prisma.categoriaArticulo.count(),
    prisma.articulo.count(),
    prisma.proveedor.count(),
    prisma.persona.count(),
  ]);

  return {
    empresas,
    bodegas,
    estaciones,
    areas,
    unidades,
    categorias,
    articulos,
    proveedores,
    personas,
  };
}
