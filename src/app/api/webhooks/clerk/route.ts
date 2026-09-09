import { verifyWebhook, type WebhookEvent } from "@clerk/nextjs/webhooks";
import type { Prisma, TipoEventoAcceso } from "@prisma/client";
import type { NextRequest } from "next/server";
import { escrituraDeSistema, type ClienteWebhook } from "@/lib/db";

/**
 * La segunda puerta (01 §4.1): Clerk escribiendo desde fuera, sin sesión.
 *
 * Las cuatro respuestas posibles, y por qué cada una:
 *
 *   400  firma inválida o sin `svix-id` — no se toca la base
 *   200  `svix-id` repetido: Clerk reintenta algo que ya salió bien
 *   500  cualquier fallo al aplicar — rollback completo, Clerk reintenta
 *   200  todo bien
 *
 * El 200 del segundo caso no es indulgencia: como las tres operaciones van en
 * una sola transacción, que el renglón exista DEMUESTRA que el cambio se
 * aplicó. Responder 500 ahí haría que Clerk reintentara en círculos una
 * entrega ya procesada.
 */

/** Se lanza cuando la entrega ya estaba registrada. No es un error. */
class EntregaRepetida extends Error {}

function esViolacionDeUnicidad(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

const TIPO_POR_EVENTO = {
  "session.created": "SESION_INICIADA",
  "session.ended": "SESION_TERMINADA",
  "session.removed": "SESION_REMOVIDA",
  "session.revoked": "SESION_REVOCADA",
} as const satisfies Record<string, TipoEventoAcceso>;

type IdentidadClerk = {
  primary_email_address_id: string | null;
  email_addresses: { id: string; email_address: string }[];
};

/** El correo principal, que es la copia que `Usuario` sincroniza. */
function correoPrincipal(datos: IdentidadClerk): string | null {
  const principal = datos.email_addresses.find((c) => c.id === datos.primary_email_address_id);
  return principal?.email_address ?? datos.email_addresses[0]?.email_address ?? null;
}

async function registrarSesion(
  db: ClienteWebhook,
  evento: Extract<WebhookEvent, { type: keyof typeof TIPO_POR_EVENTO }>,
) {
  const clerkUserId = evento.data.user_id;
  const usuario = await db.usuario.findUnique({
    where: { clerkUserId },
    select: { id: true },
  });

  // Sin fila local no se registra. `EventoAcceso` responde «quién entró al
  // sistema», no «quién inició sesión en Clerk»: de esas identidades ya queda
  // el ACCESO_DENEGADO del momento en que tocan la puerta.
  if (!usuario) return;

  const http = evento.event_attributes?.http_request;
  await db.eventoAcceso.create({
    data: {
      clerkUserId,
      usuarioId: usuario.id,
      tipo: TIPO_POR_EVENTO[evento.type],
      ip: http?.client_ip || undefined,
      agente: http?.user_agent || undefined,
    },
  });
}

async function aplicar(db: ClienteWebhook, evento: WebhookEvent) {
  switch (evento.type) {
    // Registrarse en Clerk NO da acceso: sin fila en `Usuario` no se entra, y
    // esa fila la crea el Superadmin. Crearla aquí volvería automático el
    // acceso de cualquiera que se registre y borraría la negación por omisión.
    // Cuando exista `InvitacionAcceso`, este es el evento que la consumirá:
    // Clerk no emite ningún evento propio al aceptarse una invitación.
    case "user.created":
      return;

    case "user.updated": {
      const correo = correoPrincipal(evento.data);
      if (!correo) return;
      // updateMany y no update: sin fila local no hay nada que sincronizar, y
      // `update` lanzaría P2025 por un caso que es normal, no excepcional.
      await db.usuario.updateMany({
        where: { clerkUserId: evento.data.id },
        data: { correo },
      });
      return;
    }

    // Nunca borra. De `Usuario` cuelgan la bitácora y siete relaciones de
    // `Movimiento`: la cuenta de Clerk puede desaparecer, el libro no (01 §3.6).
    case "user.deleted": {
      if (!evento.data.id) return;
      await db.usuario.updateMany({
        where: { clerkUserId: evento.data.id },
        data: { activo: false },
      });
      return;
    }

    case "session.created":
    case "session.ended":
    case "session.removed":
    case "session.revoked":
      await registrarSesion(db, evento);
      return;

    // Del resto queda la entrega registrada y nada más.
    default:
      return;
  }
}

export async function POST(peticion: NextRequest) {
  const svixId = peticion.headers.get("svix-id");

  let evento: WebhookEvent;
  try {
    evento = await verifyWebhook(peticion);
  } catch (error) {
    console.error("Webhook de Clerk con firma inválida:", error);
    return new Response("Firma inválida", { status: 400 });
  }

  // Sin identificador de entrega no hay idempotencia posible, y sin ella una
  // reentrega duplicaría el efecto. Mejor rechazar que procesar a ciegas.
  if (!svixId) {
    return new Response("Falta la cabecera svix-id", { status: 400 });
  }

  try {
    await escrituraDeSistema("clerk-webhook", async (db) => {
      try {
        await db.eventoWebhook.create({
          data: {
            eventoId: svixId,
            tipo: evento.type,
            payload: evento as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        // El P2002 se interpreta SOLO aquí. Uno más adelante —el índice del
        // correo activo, por ejemplo— es un fallo de verdad y debe dar 500.
        if (esViolacionDeUnicidad(error)) throw new EntregaRepetida();
        throw error;
      }

      await aplicar(db, evento);

      await db.eventoWebhook.update({
        where: { eventoId: svixId },
        data: { procesadoEn: new Date() },
      });
    });
  } catch (error) {
    if (error instanceof EntregaRepetida) {
      return new Response("Entrega ya procesada", { status: 200 });
    }
    console.error(`Webhook ${evento.type} (${svixId}) falló; se revirtió todo:`, error);
    return new Response("No se pudo procesar", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
