import "server-only";
import { prisma } from "@/lib/db";
import type { ValoresCatalogo } from "./definiciones";

/**
 * Acceso a datos de los catálogos.
 *
 * Cada catálogo mapea sus campos explícitamente en lugar de pasar el objeto
 * validado tal cual: es unas líneas más, pero deja que TypeScript verifique que
 * lo que se escribe coincide con el modelo, y hace evidente qué se guarda.
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
const numero = (v: unknown): number => (typeof v === "number" ? v : 0);
const bool = (v: unknown): boolean => v === true;

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
  bodegas: {
    listar: () => prisma.bodega.findMany({ orderBy: { clave: "asc" } }),
    obtener: (id) => prisma.bodega.findUnique({ where: { id } }),
    crear: async (d) => {
      await prisma.bodega.create({
        data: {
          clave: texto(d.clave),
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
          clave: texto(d.clave),
          nombre: texto(d.nombre),
          ubicacion: textoOpcional(d.ubicacion),
          activa: bool(d.activa),
        },
      });
    },
  },

  estaciones: {
    listar: () => prisma.estacion.findMany({ orderBy: { clave: "asc" } }),
    obtener: (id) => prisma.estacion.findUnique({ where: { id } }),
    crear: async (d) => {
      await prisma.estacion.create({
        data: {
          clave: texto(d.clave),
          nombre: texto(d.nombre),
          ubicacion: textoOpcional(d.ubicacion),
          activa: bool(d.activa),
        },
      });
    },
    actualizar: async (id, d) => {
      await prisma.estacion.update({
        where: { id },
        data: {
          clave: texto(d.clave),
          nombre: texto(d.nombre),
          ubicacion: textoOpcional(d.ubicacion),
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
        data: {
          clave: texto(d.clave).toUpperCase(),
          nombre: texto(d.nombre),
          activa: bool(d.activa),
        },
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
      await prisma.articulo.create({
        data: {
          clave: texto(d.clave).toUpperCase(),
          descripcion: texto(d.descripcion),
          unidadId: texto(d.unidadId),
          categoriaId: textoOpcional(d.categoriaId),
          stockMinimo: numero(d.stockMinimo),
          activo: bool(d.activo),
        },
      });
    },
    actualizar: async (id, d) => {
      await prisma.articulo.update({
        where: { id },
        data: {
          clave: texto(d.clave).toUpperCase(),
          descripcion: texto(d.descripcion),
          unidadId: texto(d.unidadId),
          categoriaId: textoOpcional(d.categoriaId),
          stockMinimo: numero(d.stockMinimo),
          activo: bool(d.activo),
        },
      });
    },
  },

  proveedores: {
    listar: () => prisma.proveedor.findMany({ orderBy: { razonSocial: "asc" } }),
    obtener: (id) => prisma.proveedor.findUnique({ where: { id } }),
    crear: async (d) => {
      await prisma.proveedor.create({
        data: {
          razonSocial: texto(d.razonSocial),
          rfc: textoOpcional(d.rfc),
          contacto: textoOpcional(d.contacto),
          telefono: textoOpcional(d.telefono),
          activo: bool(d.activo),
        },
      });
    },
    actualizar: async (id, d) => {
      await prisma.proveedor.update({
        where: { id },
        data: {
          razonSocial: texto(d.razonSocial),
          rfc: textoOpcional(d.rfc),
          contacto: textoOpcional(d.contacto),
          telefono: textoOpcional(d.telefono),
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
          esTransportista: bool(d.esTransportista),
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
          esTransportista: bool(d.esTransportista),
          activa: bool(d.activa),
        },
      });
    },
  },
};

/** Opciones para los campos de tipo `select`. */
export async function cargarOpciones(): Promise<Record<string, Opcion[]>> {
  const [unidades, categorias] = await Promise.all([
    prisma.unidadMedida.findMany({ where: { activa: true }, orderBy: { clave: "asc" } }),
    prisma.categoriaArticulo.findMany({ where: { activa: true }, orderBy: { nombre: "asc" } }),
  ]);

  return {
    unidades: unidades.map((u) => ({ valor: u.id, etiqueta: `${u.clave} — ${u.nombre}` })),
    categorias: categorias.map((c) => ({ valor: c.id, etiqueta: c.nombre })),
  };
}

/** Conteos para el índice de catálogos y el tablero. */
export async function contarCatalogos() {
  const [bodegas, estaciones, areas, unidades, categorias, articulos, proveedores, personas] =
    await Promise.all([
      prisma.bodega.count(),
      prisma.estacion.count(),
      prisma.area.count(),
      prisma.unidadMedida.count(),
      prisma.categoriaArticulo.count(),
      prisma.articulo.count(),
      prisma.proveedor.count(),
      prisma.persona.count(),
    ]);

  return { bodegas, estaciones, areas, unidades, categorias, articulos, proveedores, personas };
}
