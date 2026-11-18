import { atenderWebhookDeResend } from "@/lib/correo/webhook";

export const dynamic = "force-dynamic";

export function POST(peticion: Request) {
  return atenderWebhookDeResend(peticion);
}
