import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { POR_PAGINA } from "@/lib/paginacion";

/**
 * Lectura de identidades en Clerk.
 *
 * Vive aparte de `repo.ts` por una razón que no es de orden: esto son
 * peticiones HTTP, y **no pueden ocurrir dentro de la transacción de
 * `consultar()`**. Esa transacción es REPEATABLE READ READ ONLY, y meterle una
 * espera de red retendría una conexión de PostgreSQL mientras tanto. Se leen
 * las dos fuentes por separado y se combinan en memoria.
 */

export type IdentidadClerk = {
  clerkUserId: string;
  correo: string | null;
  nombre: string | null;
};

type UsuarioDeClerk = {
  id: string;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string }[];
  firstName: string | null;
  lastName: string | null;
};

function aIdentidad(u: UsuarioDeClerk): IdentidadClerk {
  const principal = u.emailAddresses.find((c) => c.id === u.primaryEmailAddressId);
  const nombre = [u.firstName, u.lastName].filter(Boolean).join(" ");
  return {
    clerkUserId: u.id,
    correo: principal?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null,
    nombre: nombre.length > 0 ? nombre : null,
  };
}

/** Una página de 100, como las demás listas; Clerk admite hasta 500 por petición. */
export async function listarIdentidades(pagina: number) {
  const clerk = await clerkClient();
  const { data, totalCount } = await clerk.users.getUserList({
    limit: POR_PAGINA,
    offset: (pagina - 1) * POR_PAGINA,
    orderBy: "-created_at",
  });

  return { identidades: data.map(aIdentidad), total: totalCount };
}

/**
 * Vuelve a leer la identidad en el servidor al conceder acceso.
 *
 * El `clerkUserId` y el `correo` salen de aquí y **nunca del formulario**: si
 * el correo viniera capturado, cualquiera podría enlazar una fila de acceso a
 * un correo que no es suyo. Devuelve nulo si Clerk ya no la conoce, que es el
 * caso de quien fue dado de baja allá y conserva su fila aquí.
 */
export async function obtenerIdentidad(clerkUserId: string): Promise<IdentidadClerk | null> {
  try {
    const clerk = await clerkClient();
    return aIdentidad(await clerk.users.getUser(clerkUserId));
  } catch {
    return null;
  }
}
