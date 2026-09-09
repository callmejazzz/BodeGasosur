import "server-only";
import type { Prisma } from "@prisma/client";
import type { FuenteOpciones, ValoresCatalogo } from "./definiciones";

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

/**
 * El cliente llega como parámetro; este módulo ya no lo importa.
 *
 * Es lo que vuelve mecanismo la regla de §4.1: la única forma de obtener un
 * `TransactionClient` es pasando por `consultar()` —que lo entrega en solo
 * lectura— o por `accionProtegida()` —que antes verificó el permiso—. Un repo
 * no puede escribir por su cuenta porque no tiene a qué llamarle.
 *
 * `Prisma.TransactionClient` y no `PrismaClient` a propósito: no expone
 * `$transaction`, así que tampoco puede abrir una transacción anidada.
 */
export type RepoCatalogo = {
  /**
   * `obtener` incluye las relaciones igual que `listar`, y a propósito: la
   * vista de detalle muestra la relación leyéndola del propio registro, no de
   * la lista de opciones —que filtra por activo y se dejaría fuera lo que se
   * dio de baja—.
   */
  listar: (db: Prisma.TransactionClient) => Promise<RegistroCatalogo[]>;
  obtener: (db: Prisma.TransactionClient, id: string) => Promise<RegistroCatalogo | null>;
  crear: (db: Prisma.TransactionClient, datos: ValoresCatalogo) => Promise<void>;
  actualizar: (
    db: Prisma.TransactionClient,
    id: string,
    datos: ValoresCatalogo,
  ) => Promise<void>;
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
    listar: (db) => db.empresa.findMany({ orderBy: { razonSocial: "asc" } }),
    obtener: (db, id) => db.empresa.findUnique({ where: { id } }),
    crear: async (db, d) => {
      await db.empresa.create({
        data: {
          razonSocial: texto(d.razonSocial),
          rfc: rfc(d.rfc),
          activa: bool(d.activa),
        },
      });
    },
    actualizar: async (db, id, d) => {
      await db.empresa.update({
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
    listar: (db) => db.bodega.findMany({ orderBy: { clave: "asc" } }),
    obtener: (db, id) => db.bodega.findUnique({ where: { id } }),
    crear: async (db, d) => {
      await db.bodega.create({
        data: {
          clave: texto(d.clave).toUpperCase(),
          nombre: texto(d.nombre),
          ubicacion: textoOpcional(d.ubicacion),
          activa: bool(d.activa),
        },
      });
    },
    actualizar: async (db, id, d) => {
      await db.bodega.update({
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
    listar: (db) =>
      db.estacion.findMany({ orderBy: { numero: "asc" }, include: { empresa: true } }),
    obtener: (db, id) =>
      db.estacion.findUnique({ where: { id }, include: { empresa: true } }),
    crear: async (db, d) => {
      await db.estacion.create({
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
    actualizar: async (db, id, d) => {
      await db.estacion.update({
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
    listar: (db) => db.area.findMany({ orderBy: { nombre: "asc" } }),
    obtener: (db, id) => db.area.findUnique({ where: { id } }),
    crear: async (db, d) => {
      await db.area.create({
        data: { nombre: texto(d.nombre), activa: bool(d.activa) },
      });
    },
    actualizar: async (db, id, d) => {
      await db.area.update({
        where: { id },
        data: { nombre: texto(d.nombre), activa: bool(d.activa) },
      });
    },
  },

  unidades: {
    listar: (db) => db.unidadMedida.findMany({ orderBy: { clave: "asc" } }),
    obtener: (db, id) => db.unidadMedida.findUnique({ where: { id } }),
    crear: async (db, d) => {
      await db.unidadMedida.create({
        data: {
          clave: texto(d.clave).toUpperCase(),
          nombre: texto(d.nombre),
          activa: bool(d.activa),
        },
      });
    },
    actualizar: async (db, id, d) => {
      await db.unidadMedida.update({
        where: { id },
        data: { nombre: texto(d.nombre), activa: bool(d.activa) },
      });
    },
  },

  categorias: {
    listar: (db) => db.categoriaArticulo.findMany({ orderBy: { nombre: "asc" } }),
    obtener: (db, id) => db.categoriaArticulo.findUnique({ where: { id } }),
    crear: async (db, d) => {
      await db.categoriaArticulo.create({
        data: { nombre: texto(d.nombre), activa: bool(d.activa) },
      });
    },
    actualizar: async (db, id, d) => {
      await db.categoriaArticulo.update({
        where: { id },
        data: { nombre: texto(d.nombre), activa: bool(d.activa) },
      });
    },
  },

  articulos: {
    listar: (db) =>
      db.articulo.findMany({
        orderBy: { clave: "asc" },
        include: { unidad: true, categoria: true },
      }),
    obtener: (db, id) =>
      db.articulo.findUnique({ where: { id }, include: { unidad: true, categoria: true } }),
    crear: async (db, d) => {
      // Sin `clave`: la asigna la secuencia de PostgreSQL.
      await db.articulo.create({
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
    actualizar: async (db, id, d) => {
      await db.articulo.update({
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
    listar: (db) =>
      db.proveedor.findMany({
        orderBy: { nombreComercial: "asc" },
        include: { empresa: true },
      }),
    obtener: (db, id) =>
      db.proveedor.findUnique({ where: { id }, include: { empresa: true } }),
    crear: async (db, d) => {
      await db.proveedor.create({
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
    actualizar: async (db, id, d) => {
      await db.proveedor.update({
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
    listar: (db) => db.persona.findMany({ orderBy: { nombre: "asc" } }),
    obtener: (db, id) => db.persona.findUnique({ where: { id } }),
    crear: async (db, d) => {
      await db.persona.create({
        data: {
          nombre: texto(d.nombre),
          puesto: textoOpcional(d.puesto),
          activa: bool(d.activa),
        },
      });
    },
    actualizar: async (db, id, d) => {
      await db.persona.update({
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

/**
 * Opciones para los campos de tipo `select`.
 *
 * Filtrar por activo es lo correcto al dar de alta: una baja lógica significa
 * «ya no se puede elegir al capturar» (prisma/sql/despues/40-bajas.sql).
 *
 * Al EDITAR era un defecto. Un registro que ya apuntaba a algo dado de baja no
 * encontraba su valor en la lista, el navegador caía en «Sin especificar» y
 * guardar rompía el vínculo: con el campo obligatorio, con un mensaje que no
 * explicaba nada; con el campo opcional —`Articulo.categoriaId`—, **en
 * silencio**.
 *
 * `conservar` deja pasar, además de las activas, aquello que el registro que se
 * está editando ya tiene asignado. Se marca como dado de baja, y solo aparece
 * en ese registro: sigue sin poder asignarse a ninguno nuevo.
 */
export async function cargarOpciones(
  db: Prisma.TransactionClient,
  conservar: Partial<Record<FuenteOpciones, string>> = {},
): Promise<Record<string, Opcion[]>> {
  const filtro = (id: string | undefined) =>
    id ? { OR: [{ activa: true }, { id }] } : { activa: true };

  const marcar = (etiqueta: string, activa: boolean) =>
    activa ? etiqueta : `${etiqueta} — dada de baja`;

  const [unidades, categorias, empresas] = await Promise.all([
    db.unidadMedida.findMany({ where: filtro(conservar.unidades), orderBy: { clave: "asc" } }),
    db.categoriaArticulo.findMany({
      where: filtro(conservar.categorias),
      orderBy: { nombre: "asc" },
    }),
    db.empresa.findMany({ where: filtro(conservar.empresas), orderBy: { razonSocial: "asc" } }),
  ]);

  return {
    unidades: unidades.map((u) => ({
      valor: u.id,
      etiqueta: marcar(`${u.clave} — ${u.nombre}`, u.activa),
    })),
    categorias: categorias.map((c) => ({
      valor: c.id,
      etiqueta: marcar(c.nombre, c.activa),
    })),
    empresas: empresas.map((e) => ({
      valor: e.id,
      etiqueta: marcar(e.rfc ? `${e.razonSocial} — ${e.rfc}` : e.razonSocial, e.activa),
    })),
  };
}

/** Conteos para el índice de catálogos y el tablero. */
export async function contarCatalogos(db: Prisma.TransactionClient) {
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
    db.empresa.count(),
    db.bodega.count(),
    db.estacion.count(),
    db.area.count(),
    db.unidadMedida.count(),
    db.categoriaArticulo.count(),
    db.articulo.count(),
    db.proveedor.count(),
    db.persona.count(),
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
