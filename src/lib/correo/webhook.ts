import "server-only";
import type { AnomaliaCorreo } from "@prisma/client";
import { Resend } from "resend";
import { escrituraDeSistema, type ClienteResendWebhook } from "@/lib/db";
import { conciliarAceptaciones } from "./conciliacion";
import { ConfiguracionDeCorreoInvalida, llaveDeResend, secretoDelWebhook } from "./configuracion";
import { claseDeRebote } from "./entrega";
import { TX_CORTA } from "./plazos";

export const TOPE_DEL_CUERPO = 64 * 1024;

type DatosDelEvento = {
  email_id?: unknown;
  to?: unknown;
  tags?: unknown;
  bounce?: { type?: unknown; subType?: unknown } | null;
  failed?: { reason?: unknown } | null;
  suppressed?: { type?: unknown } | null;
};
type EventoDeResend = { type?: unknown; created_at?: unknown; data?: DatosDelEvento | null };

export type Asociacion = "ajeno" | "asociado" | "anomalo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Solo se guarda lo que tiene forma de identificador o de código: nada con espacios ni arrobas
const IDENTIFICADOR = /^[A-Za-z0-9_-]{1,100}$/;
const CODIGO = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const TIPO = /^[a-z]+(\.[a-z_]+){0,3}$/;

const identificador = (valor: unknown) => (typeof valor === "string" && IDENTIFICADOR.test(valor) ? valor : null);
const codigo = (valor: unknown) => (typeof valor === "string" && valor !== "" ? (CODIGO.test(valor) ? valor : "OTRO") : null);
const normalizar = (correo: string) => correo.trim().toLowerCase();

async function leerConTope(peticion: Request, tope: number): Promise<string | null> {
  if (Number(peticion.headers.get("content-length")) > tope) return null;
  if (!peticion.body) return "";
  const lector = peticion.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > tope) {
      await lector.cancel();
      return null;
    }
    partes.push(value);
  }
  return Buffer.concat(partes).toString("utf8");
}

/** `presente`: si trajo la etiqueta; `valor`: solo si tiene forma de identificador. */
function etiquetaRegistro(tags: unknown): { presente: boolean; valor: string | null } {
  const crudo = Array.isArray(tags) ? tags.find((t) => t?.name === "registro")?.value : tags && typeof tags === "object" ? (tags as Record<string, unknown>).registro : undefined;
  const presente = typeof crudo === "string" && crudo !== "";
  return { presente, valor: presente ? identificador(crudo) : null };
}

// «Nombre <dir>» o «dir», ya normalizadas
function destinatarios(to: unknown): string[] {
  const lista = Array.isArray(to) ? to : [to];
  return lista.filter((d): d is string => typeof d === "string").map((d) => normalizar(/<([^>]+)>/.exec(d)?.[1] ?? d));
}

const REGISTRO = { id: true, loteId: true, correo: true, resendId: true } as const;

async function procesar(db: ClienteResendWebhook, svixId: string, evento: EventoDeResend): Promise<Asociacion> {
  const datos = evento.data ?? {};
  const tipo = typeof evento.type === "string" && TIPO.test(evento.type) ? evento.type : "desconocido";
  const emailId = identificador(datos.email_id);
  const etiqueta = etiquetaRegistro(datos.tags);

  const porEtiqueta = etiqueta.valor && UUID.test(etiqueta.valor) ? await db.registroCorreos.findUnique({ where: { id: etiqueta.valor }, select: REGISTRO }) : null;
  const porId = emailId ? await db.registroCorreos.findUnique({ where: { resendId: emailId }, select: REGISTRO }) : null;
  if (!etiqueta.presente && !porId) return "ajeno";

  let anomalia: AnomaliaCorreo | null = null;
  if (!porEtiqueta) anomalia = etiqueta.presente ? "ETIQUETA_DESCONOCIDA" : "SIN_ETIQUETA";
  else if (porId && porId.id !== porEtiqueta.id) anomalia = "ETIQUETA_E_ID_DISCREPAN";
  else if (!destinatarios(datos.to).includes(normalizar(porEtiqueta.correo))) anomalia = "DESTINATARIO_DISTINTO";
  else if (!emailId || (porEtiqueta.resendId !== null && porEtiqueta.resendId !== emailId)) anomalia = "ID_DISTINTO";

  // Todo evento asociado prueba la aceptación; se concilia antes de guardarlo
  if (!anomalia && porEtiqueta && emailId) {
    const { discrepancias } = await conciliarAceptaciones(db, porEtiqueta.loteId, [{ registroId: porEtiqueta.id, resendId: emailId }]);
    if (discrepancias.length) anomalia = "ID_DISTINTO";
  }

  const rebote = datos.bounce && typeof datos.bounce === "object" ? claseDeRebote(datos.bounce.type) : null;
  const ocurrido = typeof evento.created_at === "string" ? new Date(evento.created_at) : null;
  await db.eventoCorreo.createMany({
    data: [
      {
        svixId,
        tipo,
        resendId: emailId,
        rebote,
        subtipoRebote: rebote ? codigo(datos.bounce?.subType) : null,
        motivoFallo: codigo(datos.failed?.reason),
        tipoSupresion: codigo(datos.suppressed?.type),
        ocurridoEn: ocurrido && !Number.isNaN(ocurrido.getTime()) ? ocurrido : new Date(),
        ...(anomalia ? { anomalia, etiquetaRecibida: etiqueta.valor } : { registroId: porEtiqueta!.id }),
      },
    ],
    skipDuplicates: true,
  });
  if (anomalia) console.error(`[correo] evento ${tipo} anómalo (${anomalia}), svix ${svixId}: no concilia ni cuenta para la entrega`);
  return anomalia ? "anomalo" : "asociado";
}

/** POST /api/webhooks/resend: responde 200 solo después de confirmar la escritura */
export async function atenderWebhookDeResend(peticion: Request, entorno: Record<string, string | undefined> = process.env): Promise<Response> {
  const cuerpo = await leerConTope(peticion, TOPE_DEL_CUERPO);
  if (cuerpo === null) return new Response(null, { status: 413 });

  const cabeceras = { id: identificador(peticion.headers.get("svix-id")), timestamp: peticion.headers.get("svix-timestamp"), signature: peticion.headers.get("svix-signature") };
  if (!cabeceras.id || !cabeceras.timestamp || !cabeceras.signature) return new Response(null, { status: 400 });

  let evento: EventoDeResend;
  try {
    const resend = new Resend(llaveDeResend(entorno));
    const verificado = resend.webhooks.verify({ payload: cuerpo, headers: { id: cabeceras.id, timestamp: cabeceras.timestamp, signature: cabeceras.signature }, webhookSecret: secretoDelWebhook(entorno) });
    if (!verificado || typeof verificado !== "object") return new Response(null, { status: 400 });
    evento = verificado as EventoDeResend;
  } catch (error) {
    if (!(error instanceof ConfiguracionDeCorreoInvalida)) return new Response(null, { status: 400 });
    console.error(`[correo] el webhook de Resend no puede verificar firmas: ${error.message}`);
    return new Response(null, { status: 500 });
  }

  try {
    await escrituraDeSistema("resend-webhook", (db) => procesar(db, cabeceras.id!, evento), TX_CORTA);
    return new Response(null, { status: 200 });
  } catch (error) {
    // Solo la clase y el código: el mensaje de la base puede traer datos del evento
    const codigoDeError = (error as { code?: unknown })?.code;
    const clase = error instanceof Error ? `${error.name}${typeof codigoDeError === "string" && /^[A-Z0-9_]{1,20}$/.test(codigoDeError) ? ` ${codigoDeError}` : ""}` : "error desconocido";
    console.error(`[correo] el evento ${cabeceras.id} de Resend no se guardó (${clase})`);
    return new Response(null, { status: 500 });
  }
}
