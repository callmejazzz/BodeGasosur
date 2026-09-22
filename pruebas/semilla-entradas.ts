/*
  Lo mínimo para probar entradas contra la base de pruebas, que nace vacía:
  un usuario por rol, una bodega, un proveedor, artículos con y sin caja y el
  consecutivo de folio. Cada llamada crea su propio juego con sufijo, así los
  archivos de prueba no se pisan.
*/

import type { PrismaClient, Rol } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { UsuarioSesion } from "../src/lib/db";

export type Entorno = {
  usuarios: Record<Rol, UsuarioSesion>;
  bodegaId: string;
  otraBodegaId: string;
  proveedorId: string;
  proveedorNombre: string;
  unidadId: string;
  /** piezasPorCaja = 12 */
  articuloCajaId: string;
  /** piezasPorCaja = null */
  articuloSueltoId: string;
};

export async function sembrarEntorno(prisma: PrismaClient): Promise<Entorno> {
  const sufijo = randomUUID().slice(0, 8);

  await prisma.folio.upsert({
    where: { tipo: "ENTRADA" },
    update: {},
    create: { tipo: "ENTRADA", prefijo: "E" },
  });

  const roles: Rol[] = ["SUPERADMIN", "COMPRAS", "JEFE"];
  const usuarios = {} as Record<Rol, UsuarioSesion>;
  for (const rol of roles) {
    const u = await prisma.usuario.create({
      data: { clerkUserId: `user_${rol}_${sufijo}`, correo: `${rol}.${sufijo}@prueba.test`, rol },
    });
    usuarios[rol] = { id: u.id, rol, puedeAutorizar: false };
  }

  const [bodega, otraBodega, proveedor, unidad] = await Promise.all([
    prisma.bodega.create({ data: { nombre: `Bodega ${sufijo}` } }),
    prisma.bodega.create({ data: { nombre: `Otra bodega ${sufijo}` } }),
    prisma.proveedor.create({
      data: { nombreComercial: `Proveedor ${sufijo}`, razonSocial: `Proveedor ${sufijo} SA de CV` },
    }),
    prisma.unidadMedida.create({ data: { clave: `U${sufijo}`, nombre: "Pieza" } }),
  ]);
  const [caja, suelto] = await Promise.all([
    prisma.articulo.create({ data: { descripcion: `Artículo caja ${sufijo}`, unidadId: unidad.id, piezasPorCaja: 12 } }),
    prisma.articulo.create({ data: { descripcion: `Artículo suelto ${sufijo}`, unidadId: unidad.id } }),
  ]);

  return {
    usuarios,
    bodegaId: bodega.id,
    otraBodegaId: otraBodega.id,
    proveedorId: proveedor.id,
    proveedorNombre: proveedor.nombreComercial,
    unidadId: unidad.id,
    articuloCajaId: caja.id,
    articuloSueltoId: suelto.id,
  };
}

export function articuloNuevo(prisma: PrismaClient, unidadId: string, piezasPorCaja: number | null) {
  return prisma.articulo.create({
    data: { descripcion: `Artículo ${randomUUID().slice(0, 8)}`, unidadId, piezasPorCaja },
  });
}
