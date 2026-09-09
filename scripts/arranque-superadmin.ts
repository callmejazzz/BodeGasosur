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

import "dotenv/config";
import { createClerkClient } from "@clerk/backend";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const correo = process.argv[2] ?? process.env.CLERK_SUPERADMIN_CORREO;
  const secretKey = process.env.CLERK_SECRET_KEY;

  // Salida silenciosa y en verde: `db:reset` encadena este comando, y una
  // máquina sin Clerk configurado tiene que poder resetear su base igual.
  if (!correo || !secretKey) {
    console.log(
      "· Arranque omitido: falta CLERK_SUPERADMIN_CORREO o CLERK_SECRET_KEY en .env.\n" +
        "  La base quedó sembrada; nadie tiene acceso todavía.",
    );
    return;
  }

  console.log(`Buscando ${correo} en Clerk…`);
  const clerk = createClerkClient({ secretKey });
  const { data: identidades } = await clerk.users.getUserList({ emailAddress: [correo] });

  if (identidades.length === 0) {
    console.error(
      `✗ Clerk no conoce a ${correo}.\n` +
        "  Esa persona tiene que registrarse en Clerk antes de que se le conceda acceso:\n" +
        "  el identificador de Clerk es lo único que enlaza las dos mitades, y no se inventa.",
    );
    process.exitCode = 1;
    return;
  }

  if (identidades.length > 1) {
    console.error(`✗ ${correo} devuelve ${identidades.length} identidades en Clerk. Ambiguo; se detiene.`);
    process.exitCode = 1;
    return;
  }

  const clerkUserId = identidades[0].id;

  const otroSuperadmin = await prisma.usuario.findFirst({
    where: { rol: "SUPERADMIN", activo: true, NOT: { clerkUserId } },
  });

  if (otroSuperadmin) {
    console.error(
      `✗ Ya hay un Superadmin activo (${otroSuperadmin.correo}).\n` +
        "  Este comando es para arrancar el sistema, no para repartir privilegios:\n" +
        "  los superadmins siguientes se dan de alta desde la pantalla de usuarios,\n" +
        "  que sí deja constancia de quién los nombró.",
    );
    process.exitCode = 1;
    return;
  }

  const previo = await prisma.usuario.findUnique({ where: { clerkUserId } });

  await prisma.$transaction(async (tx) => {
    // Sin esto la bitácora registraría el alta como «escritura-directa».
    // Mismo contrato que cumplen la siembra y, más adelante, accionProtegida.
    await tx.$executeRawUnsafe("SET LOCAL app.origen = 'arranque'");

    await tx.usuario.upsert({
      where: { clerkUserId },
      update: { correo, rol: "SUPERADMIN", puedeAutorizar: true, activo: true },
      create: { clerkUserId, correo, rol: "SUPERADMIN", puedeAutorizar: true },
    });
  });

  if (!previo) {
    console.log(`  ✓ Superadmin creado: ${correo} (${clerkUserId})`);
  } else if (previo.rol !== "SUPERADMIN" || !previo.activo) {
    console.log(`  ✓ ${correo} era ${previo.rol}${previo.activo ? "" : " (inactivo)"}; ahora es SUPERADMIN`);
  } else {
    console.log(`  · ${correo} ya era Superadmin. Nada que cambiar.`);
  }

  console.log("  · puedeAutorizar = true. Es una bandera, no parte del rol: se edita después.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
