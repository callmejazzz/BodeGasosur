import "server-only";
import { escrituraDeSistema, type ClienteResumenDiario, type LoteArrendado } from "@/lib/db";
import { conciliarAceptaciones, conciliarRechazo } from "./conciliacion";
import { ESPERA_DE_RESEND_MS, TX_CORTA } from "./plazos";
import type { CorreoDelLote, EnviadorDeLotes, TipoDeIncidente } from "./resend";

export const NO_SE_ENVIO_A_TIEMPO = "No se envió a tiempo";
const SIN_RESPUESTA = "Terminó su día sin respuesta de Resend";
export const TANDA_DE_CIERRE = 20;

export type ResultadoDeEnvio =
  | { tipo: "aceptado" | "rechazado" | "sin-confirmar" | "pasajero" | "ocupado" }
  | { tipo: "incidente"; incidente: TipoDeIncidente };

export const correosDelLote = (lote: LoteArrendado): CorreoDelLote[] =>
  lote.integrantes.map((i) => ({
    from: lote.remitente,
    to: [i.correo],
    subject: lote.asunto,
    html: lote.html,
    text: lote.texto,
    tags: [{ name: "registro", value: i.registroId }],
  }));

export async function enviarLote(loteId: string, fecha: Date, enviar: EnviadorDeLotes, esperaMs = ESPERA_DE_RESEND_MS): Promise<ResultadoDeEnvio> {
  const lote = await escrituraDeSistema("resumen-diario", (db) => db.arrendarLote(loteId, fecha), TX_CORTA);
  if (!lote) return { tipo: "ocupado" };

  const respuesta = await enviar(correosDelLote(lote), { llave: lote.llave, signal: AbortSignal.timeout(esperaMs) });
  switch (respuesta.tipo) {
    case "pasajero":
      console.error(`[correo] ${lote.llave}: fallo pasajero (${respuesta.codigo}); se reintenta al vencer el arriendo`);
      return { tipo: "pasajero" };
    case "incidente":
      // No depende de los destinatarios: el lote sigue pendiente y se reintenta cuando se corrija
      console.error(`[correo] ${lote.llave}: incidente ${respuesta.incidente} (${respuesta.codigo}); el lote sigue pendiente`);
      await escrituraDeSistema(
        "resumen-diario",
        (db) => db.loteCorreos.updateMany({ where: { id: lote.id, estado: "PENDIENTE" }, data: { motivo: respuesta.motivo } }),
        TX_CORTA,
      );
      return { tipo: "incidente", incidente: respuesta.incidente };
    case "aceptado": {
      if (respuesta.ids.length !== lote.integrantes.length) {
        console.error(`[correo] ${lote.llave}: Resend devolvió ${respuesta.ids.length} identificadores para ${lote.integrantes.length} correos`);
        return { tipo: "pasajero" };
      }
      const aceptaciones = lote.integrantes.map((i, posicion) => ({ registroId: i.registroId, resendId: respuesta.ids[posicion] }));
      const { discrepancias } = await escrituraDeSistema("resumen-diario", (db) => conciliarAceptaciones(db, lote.id, aceptaciones), TX_CORTA);
      for (const registro of discrepancias) {
        console.error(`[correo] ${lote.llave}: la respuesta trae otro identificador para el registro ${registro}; no se sobrescribe`);
      }
      return { tipo: "aceptado" };
    }
    case "rechazado":
      console.error(`[correo] ${lote.llave}: rechazo definitivo (${respuesta.codigo})`);
      await escrituraDeSistema("resumen-diario", (db) => conciliarRechazo(db, lote.id, respuesta.motivo, "RECHAZADO"), TX_CORTA);
      return { tipo: "rechazado" };
    case "cuerpo-distinto":
      console.error(`[correo] ${lote.llave}: otro cuerpo con la misma llave (${respuesta.codigo}); queda sin confirmar y no se reenvía`);
      await escrituraDeSistema("resumen-diario", (db) => conciliarRechazo(db, lote.id, respuesta.motivo, "SIN_CONFIRMAR"), TX_CORTA);
      return { tipo: "sin-confirmar" };
  }
}

/* Cierre de lotes */
async function cerrarLote(db: ClienteResumenDiario, loteId: string): Promise<boolean> {
  const lote = await db.bloquearLote(loteId);
  if (!lote) return false;
  if (lote.estado === "PENDIENTE") {
    // Sin intentos nunca llegó a Resend; con intentos pudo haber llegado
    const vencido = lote.intentos === 0;
    const motivo = vencido ? NO_SE_ENVIO_A_TIEMPO : SIN_RESPUESTA;
    await db.loteCorreos.update({ where: { id: loteId }, data: { estado: vencido ? "VENCIDO" : "SIN_CONFIRMAR", motivo, resueltoEn: new Date() }, select: { id: true } });
    await db.registroCorreos.updateMany({ where: { loteId, estado: "PENDIENTE" }, data: { estado: vencido ? "FALLIDO" : "SIN_CONFIRMAR", motivo } });
    return true;
  }
  if (lote.estado === "ACEPTADO") {
    const { count } = await db.registroCorreos.updateMany({ where: { loteId, estado: "PENDIENTE" }, data: { estado: "SIN_CONFIRMAR", motivo: SIN_RESPUESTA } });
    return count > 0;
  }
  return false;
}

const SIN_RESPUESTA_COMPLETA = [{ estado: "PENDIENTE" as const }, { estado: "ACEPTADO" as const, registros: { some: { estado: "PENDIENTE" as const } } }];

/** Cierra en tandas mientras `hayTiempo`; lo que quede lo cierra la siguiente corrida. */
export async function cerrarDiasAnteriores(hoy: Date, hayTiempo: () => boolean = () => true): Promise<{ cerrados: number; quedan: boolean }> {
  let cerrados = 0;
  while (hayTiempo()) {
    const tanda = await escrituraDeSistema(
      "resumen-diario",
      async (db) => {
        // Por fecha y número: dos corridas toman los candados en el mismo orden
        const lotes = await db.loteCorreos.findMany({
          where: { fecha: { lt: hoy }, OR: SIN_RESPUESTA_COMPLETA },
          orderBy: [{ fecha: "asc" }, { numero: "asc" }],
          take: TANDA_DE_CIERRE,
          select: { id: true },
        });
        let n = 0;
        for (const { id } of lotes) if (await cerrarLote(db, id)) n++;
        return { leidos: lotes.length, cerrados: n };
      },
      TX_CORTA,
    );
    cerrados += tanda.cerrados;
    if (tanda.leidos < TANDA_DE_CIERRE) return { cerrados, quedan: false };
  }
  return { cerrados, quedan: true };
}

export function lotesPorEnviar(hoy: Date): Promise<{ id: string }[]> {
  return escrituraDeSistema(
    "resumen-diario",
    (db) => db.loteCorreos.findMany({ where: { fecha: hoy, OR: SIN_RESPUESTA_COMPLETA }, orderBy: { numero: "asc" }, select: { id: true } }),
    TX_CORTA,
  );
}
