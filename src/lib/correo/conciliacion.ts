import "server-only";
import type { ClienteResumenDiario } from "@/lib/db";

export type ClienteDeConciliacion = Pick<ClienteResumenDiario, "loteCorreos" | "registroCorreos" | "bloquearLote">;

export type Aceptacion = { registroId: string; resendId: string };

export class LoteInexistente extends Error {
  constructor() {
    super("El lote a conciliar no existe.");
    this.name = "LoteInexistente";
  }
}

async function bloquear(db: ClienteDeConciliacion, loteId: string) {
  const lote = await db.bloquearLote(loteId);
  if (!lote) throw new LoteInexistente();
  return lote;
}

// Un identificador distinto no se sobrescribe: vuelve como discrepancia. Al aceptarse, el motivo de un fallo anterior se borra
export async function conciliarAceptaciones(db: ClienteDeConciliacion, loteId: string, aceptaciones: Aceptacion[]): Promise<{ discrepancias: string[] }> {
  const lote = await bloquear(db, loteId);
  const registros = new Map(lote.registros.map((r) => [r.id, r]));
  const discrepancias: string[] = [];
  let aceptado = lote.registros.some((r) => r.resendId !== null);

  for (const { registroId, resendId } of aceptaciones) {
    const registro = registros.get(registroId);
    if (!registro) throw new Error("El registro no pertenece al lote que se concilia.");
    if (registro.resendId === null) {
      await db.registroCorreos.update({ where: { id: registroId }, data: { estado: "ENVIADO", resendId, motivo: null }, select: { id: true } });
      aceptado = true;
    } else if (registro.resendId !== resendId) {
      discrepancias.push(registroId);
    }
  }

  if (aceptado && lote.estado !== "ACEPTADO") {
    await db.loteCorreos.update({ where: { id: loteId }, data: { estado: "ACEPTADO", resueltoEn: new Date(), motivo: null }, select: { id: true } });
  }
  return { discrepancias };
}

export async function conciliarRechazo(db: ClienteDeConciliacion, loteId: string, motivo: string, como: "RECHAZADO" | "SIN_CONFIRMAR"): Promise<void> {
  const lote = await bloquear(db, loteId);
  if (lote.estado === "PENDIENTE") {
    await db.loteCorreos.update({ where: { id: loteId }, data: { estado: como, motivo, resueltoEn: new Date() }, select: { id: true } });
    await db.registroCorreos.updateMany({ where: { loteId, estado: "PENDIENTE" }, data: { estado: como === "RECHAZADO" ? "FALLIDO" : "SIN_CONFIRMAR", motivo } });
  } else if (lote.estado === "ACEPTADO") {
    // El lote ya fue aceptado: sus huecos pudieron salir, así que quedan sin confirmar y no se vuelven a pedir
    await db.registroCorreos.updateMany({ where: { loteId, estado: "PENDIENTE" }, data: { estado: "SIN_CONFIRMAR", motivo } });
  }
}
