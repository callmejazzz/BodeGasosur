// Arranque del primer Superadmin.
//
// El problema que resuelve es de huevo y gallina: la negación por omisión dice
// que sin fila en `Usuario` no se entra, y el alta de usuarios la hace el
// Superadmin desde una pantalla. Sin este comando no habría forma de crear al
// primero, porque nadie podría entrar a crearlo.
//
// Tres decisiones que lo separan de una puerta trasera:
//
//   1. No inventa la identidad: la busca en Clerk por correo. Si esa persona no
//      se ha registrado, el comando falla en vez de crear un acceso fantasma.
//   2. Se niega a correr si ya hay OTRO Superadmin activo. Eso es lo que impide
//      que se use para escalar privilegios una vez que el sistema está en pie.
//   3. Escribe declarando su origen, así que el alta queda en la bitácora igual
//      que cualquier otra escritura. Un arranque que no deja rastro no sirve.
//
// Uso:  npm run acceso:arranque -- correo@ejemplo.com
//       npm run acceso:arranque              (toma CLERK_SUPERADMIN_CORREO)

import { createClerkClient } from "@clerk/backend";
import type { PrismaClient } from "@prisma/client";
import { crearCliente, esEjecucionDirecta } from "../prisma/comun";

export type ResultadoArranque =
  | { estado: "creado"; clerkUserId: string }
  | { estado: "promovido"; antes: string }
  | { estado: "sin-cambio" };

/**
 * Enlaza el correo con su identidad de Clerk y le da la fila de Superadmin.
 * Lanza error si Clerk no conoce el correo, si es ambiguo, o si ya hay OTRO
 * Superadmin activo. Lo llama la línea de comandos de abajo y el bootstrap
 * de producción.
 */
export async function arrancarSuperadmin(
  prisma: PrismaClient,
  { correo, secretKey }: { correo: string; secretKey: string },
): Promise<ResultadoArranque> {
  const clerk = createClerkClient({ secretKey });
  const { data: identidades } = await clerk.users.getUserList({ emailAddress: [correo] });

  if (identidades.length === 0) {
    throw new Error(
      `Clerk no conoce a ${correo}.\n` +
        "  Esa persona tiene que registrarse en Clerk antes de que se le conceda acceso:\n" +
        "  el identificador de Clerk es lo único que enlaza las dos mitades, y no se inventa.",
    );
  }
  if (identidades.length > 1) {
    throw new Error(`${correo} devuelve ${identidades.length} identidades en Clerk. Ambiguo; se detiene.`);
  }

  const clerkUserId = identidades[0].id;

  const otroSuperadmin = await prisma.usuario.findFirst({
    where: { rol: "SUPERADMIN", activo: true, NOT: { clerkUserId } },
  });
  if (otroSuperadmin) {
    throw new Error(
      `Ya hay un Superadmin activo (${otroSuperadmin.correo}).\n` +
        "  Este comando es para arrancar el sistema, no para repartir privilegios:\n" +
        "  los superadmins siguientes se dan de alta desde la pantalla de usuarios,\n" +
        "  que sí deja constancia de quién los nombró.",
    );
  }

  const previo = await prisma.usuario.findUnique({ where: { clerkUserId } });

  await prisma.$transaction(async (tx) => {
    // Sin esto la bitácora registraría el alta como «escritura-directa».
    // Mismo contrato que cumplen la configuración y accionProtegida.
    await tx.$executeRawUnsafe("SET LOCAL app.origen = 'arranque'");

    await tx.usuario.upsert({
      where: { clerkUserId },
      update: { correo, rol: "SUPERADMIN", puedeAutorizar: true, activo: true },
      create: { clerkUserId, correo, rol: "SUPERADMIN", puedeAutorizar: true },
    });
  });

  if (!previo) return { estado: "creado", clerkUserId };
  if (previo.rol !== "SUPERADMIN" || !previo.activo) {
    return { estado: "promovido", antes: `${previo.rol}${previo.activo ? "" : " (inactivo)"}` };
  }
  return { estado: "sin-cambio" };
}

export function describirArranque(correo: string, r: ResultadoArranque): string {
  switch (r.estado) {
    case "creado":
      return `  ✓ Superadmin creado: ${correo} (${r.clerkUserId})`;
    case "promovido":
      return `  ✓ ${correo} era ${r.antes}; ahora es SUPERADMIN`;
    case "sin-cambio":
      return `  · ${correo} ya era Superadmin. Nada que cambiar.`;
  }
}

async function main() {
  const correo = process.argv[2] ?? process.env.CLERK_SUPERADMIN_CORREO;
  const secretKey = process.env.CLERK_SECRET_KEY;

  // Salida silenciosa y en verde: `db:reset` encadena este comando, y una
  // máquina sin Clerk configurado tiene que poder resetear su base igual.
  if (!correo || !secretKey) {
    console.log(
      "· Arranque omitido: falta CLERK_SUPERADMIN_CORREO o CLERK_SECRET_KEY en .env.\n" +
        "  La base quedó lista; nadie tiene acceso todavía.",
    );
    return;
  }

  const prisma = crearCliente();
  try {
    console.log(`Buscando ${correo} en Clerk…`);
    const r = await arrancarSuperadmin(prisma, { correo, secretKey });
    console.log(describirArranque(correo, r));
    console.log("  · puedeAutorizar = true. Es una bandera, no parte del rol: se edita después.");
  } finally {
    await prisma.$disconnect();
  }
}

if (esEjecucionDirecta(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? `✗ ${e.message}` : e);
    process.exit(1);
  });
}
