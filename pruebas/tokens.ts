import { createSign, randomUUID } from "node:crypto";

// Tokens como los de la plantilla bodegasosur-db, firmados con la llave de la
// corrida (pruebas/base-de-pruebas.ts). `cambios` altera encabezado o
// reclamaciones; un valor undefined quita la reclamación.

export type LlaveDePrueba = { kid: string; emisor: string; audiencia: string; privadaPem: string };

type Cambios = { encabezado?: Record<string, unknown>; carga?: Record<string, unknown>; firma?: (cuerpo: string) => string };

const b64u = (x: string | Buffer) => Buffer.from(x).toString("base64url");

export function firmarToken(llave: LlaveDePrueba, sub: string, cambios: Cambios = {}): string {
  const ahora = Math.floor(Date.now() / 1000);
  const encabezado = { alg: "RS256", typ: "JWT", kid: llave.kid, ...cambios.encabezado };
  const carga = {
    azp: "http://localhost:3000",
    iss: llave.emisor,
    aud: llave.audiencia,
    sub,
    iat: ahora,
    nbf: ahora,
    exp: ahora + 30,
    jti: randomUUID(),
    ...cambios.carga,
  };
  const cuerpo = `${b64u(JSON.stringify(encabezado))}.${b64u(JSON.stringify(carga))}`;
  const firma = cambios.firma
    ? cambios.firma(cuerpo)
    : createSign("RSA-SHA256").update(cuerpo).sign(llave.privadaPem).toString("base64url");
  return `${cuerpo}.${firma}`;
}
