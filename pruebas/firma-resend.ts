/** Eventos del webhook de Resend firmados como lo hace Resend */

import { createHmac, randomUUID } from "node:crypto";

export const SECRETO_DEL_WEBHOOK = `whsec_${Buffer.from("secreto-de-prueba-del-webhook-de-resend").toString("base64")}`;

export type EventoDePrueba = {
  tipo: string;
  emailId?: string | null;
  para?: string[];
  registro?: string | null;
  datos?: Record<string, unknown>;
};

export function cuerpoDelEvento({ tipo, emailId, para = [], registro, datos = {} }: EventoDePrueba) {
  return {
    type: tipo,
    created_at: new Date().toISOString(),
    data: {
      ...(emailId === null ? {} : { email_id: emailId ?? `re_${randomUUID()}` }),
      to: para,
      subject: "Stock bajo mínimo: 1 artículo",
      ...(registro ? { tags: { registro } } : {}),
      ...datos,
    },
  };
}

export function peticionFirmada(cuerpo: unknown, opciones: { svixId?: string; secreto?: string; alterar?: boolean } = {}): Request {
  const svixId = opciones.svixId ?? `msg_${randomUUID()}`;
  const instante = String(Math.floor(Date.now() / 1000));
  const texto = JSON.stringify(cuerpo);
  const llave = Buffer.from((opciones.secreto ?? SECRETO_DEL_WEBHOOK).slice("whsec_".length), "base64");
  const firma = createHmac("sha256", llave).update(`${svixId}.${instante}.${texto}`).digest("base64");
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    body: opciones.alterar ? texto.replace("}", ', "alterado": true}') : texto,
    headers: { "content-type": "application/json", "svix-id": svixId, "svix-timestamp": instante, "svix-signature": `v1,${firma}` },
  });
}
