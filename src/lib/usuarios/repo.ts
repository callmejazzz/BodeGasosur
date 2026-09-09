import "server-only";
import type { Prisma, Rol } from "@prisma/client";

/**
 * Acceso a datos de la pantalla de usuarios.
 *
 * Recibe el cliente en vez de importarlo, igual que `catalogos/repos.ts`: la
 * única forma de obtenerlo es pasando por `consultar()` o `accionProtegida()`.
 */

const CAMPOS = {
  id: true,
  clerkUserId: true,
  correo: true,
  rol: true,
  puedeAutorizar: true,
  activo: true,
} as const;

export type UsuarioAdministrable = {
  id: string;
  clerkUserId: string;
  correo: string;
  rol: Rol;
  puedeAutorizar: boolean;
  activo: boolean;
};

export function listarUsuarios(db: Prisma.TransactionClient): Promise<UsuarioAdministrable[]> {
  return db.usuario.findMany({
    select: CAMPOS,
    orderBy: [{ activo: "desc" }, { correo: "asc" }],
  });
}

export function buscarPorClerkId(db: Prisma.TransactionClient, clerkUserId: string) {
  return db.usuario.findUnique({ where: { clerkUserId }, select: CAMPOS });
}

/**
 * Serializa las degradaciones de Superadmin.
 *
 * Sin esto, dos transacciones concurrentes que degraden a dos superadmins
 * distintos verían cada una que «todavía queda el otro» y ambas confirmarían,
 * dejando el sistema en cero. Es el sesgo de escritura clásico, y en READ
 * COMMITTED —el modo de `accionProtegida`— la cuenta posterior no lo detecta.
 * Con el bloqueo, la segunda espera a la primera y vuelve a contar.
 */
export async function bloquearSuperadmins(db: Prisma.TransactionClient) {
  await db.$queryRaw`SELECT id FROM "Usuario" WHERE rol = 'SUPERADMIN' AND activo FOR UPDATE`;
}

export function contarSuperadminsActivos(db: Prisma.TransactionClient) {
  return db.usuario.count({ where: { rol: "SUPERADMIN", activo: true } });
}

export async function guardarAcceso(
  db: Prisma.TransactionClient,
  datos: {
    clerkUserId: string;
    correo: string;
    rol: Rol;
    puedeAutorizar: boolean;
    activo: boolean;
  },
) {
  const { clerkUserId, ...resto } = datos;
  await db.usuario.upsert({
    where: { clerkUserId },
    update: resto,
    create: { clerkUserId, ...resto },
  });
}
