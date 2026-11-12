import "server-only";
import type { EstadoLote, EstadoRegistroCorreo, ResultadoEvaluacion } from "@prisma/client";
import { escrituraDeSistema } from "@/lib/db";
import { aFechaDeBase, relojDeMexico, sumarDias } from "@/lib/fechas";
import { cerrarDiasAnteriores, enviarLote, lotesPorEnviar } from "./envio";
import { COSTO_MS, ESPERA_DE_RESEND_MS, TX_CORTA, type Plazo } from "./plazos";
import type { EnviadorDeLotes, TipoDeIncidente } from "./resend";
import { evaluarYReservar, type ResultadoReserva } from "./reserva";

export const INICIO_DE_VENTANA = 8 * 60;
export const FIN_DE_VENTANA = 12 * 60;
export const ULTIMA_CORRIDA = 11 * 60 + 45;

export const enVentana = (ahora: Date) => {
  const { minuto } = relojDeMexico(ahora);
  return minuto >= INICIO_DE_VENTANA && minuto < FIN_DE_VENTANA;
};

export type MotivoDiaNoSano = "SIN_EVALUACION" | "PENDIENTES" | "RECHAZADOS" | "SIN_CONFIRMAR" | "INCIDENTE";
export type DetenidaPor = "PLAZO" | "MEDIODIA" | "INCIDENTE";

export type ResumenDeCorrida = {
  fecha: string;
  evaluacion: { evaluadaAhora: boolean; resultado: ResultadoEvaluacion | null };
  cerrados: number;
  cierrePendiente: boolean;
  lotesSinIniciar: number;
  detenidaPor: DetenidaPor | null;
  incidente: TipoDeIncidente | null;
  lotes: Partial<Record<EstadoLote, number>>;
  destinatarios: Partial<Record<EstadoRegistroCorreo, number>>;
  diaSano: boolean;
  motivos: MotivoDiaNoSano[];
  ultimaDeLaVentana: boolean;
};

export type OpcionesDeCorrida = {
  ahora: () => Date;
  plazo: Plazo;
  enviar: EnviadorDeLotes;
  esperaMs?: number;
};

async function avisarSiAyerNoSeEvaluo(hoy: string) {
  const ayer = sumarDias(hoy, -1);
  const { anterior, deAyer } = await escrituraDeSistema(
    "resumen-diario",
    async (db) => ({
      anterior: await db.evaluacionCorreos.findFirst({ where: { fecha: { lt: aFechaDeBase(hoy) } }, select: { id: true } }),
      deAyer: await db.evaluacionCorreos.findUnique({ where: { fecha: aFechaDeBase(ayer) }, select: { id: true } }),
    }),
    TX_CORTA,
  );
  // Sin ninguna evaluación anterior es el primer día de la alerta, no una falla
  if (anterior && !deAyer) console.error(`[correo] el ${ayer} no tuvo evaluación: ese día no salió la alerta`);
}

function estadoDelDia(dia: Date) {
  return escrituraDeSistema(
    "resumen-diario",
    async (db) => {
      const evaluacion = await db.evaluacionCorreos.findUnique({ where: { fecha: dia }, select: { resultado: true } });
      const lotes = await db.loteCorreos.groupBy({ by: ["estado"], where: { fecha: dia }, _count: { _all: true } });
      const registros = await db.registroCorreos.groupBy({ by: ["estado"], where: { fecha: dia }, _count: { _all: true } });
      return {
        evaluacion,
        lotes: Object.fromEntries(lotes.map((l) => [l.estado, l._count._all])) as ResumenDeCorrida["lotes"],
        destinatarios: Object.fromEntries(registros.map((r) => [r.estado, r._count._all])) as ResumenDeCorrida["destinatarios"],
      };
    },
    TX_CORTA,
  );
}

export function motivosDelDia(d: Pick<ResumenDeCorrida, "lotes" | "destinatarios"> & { evaluado: boolean; incidente?: TipoDeIncidente | null }): MotivoDiaNoSano[] {
  const motivos: MotivoDiaNoSano[] = [];
  if (!d.evaluado) motivos.push("SIN_EVALUACION");
  if (d.lotes.PENDIENTE || d.destinatarios.PENDIENTE) motivos.push("PENDIENTES");
  if (d.lotes.RECHAZADO || d.destinatarios.FALLIDO) motivos.push("RECHAZADOS");
  if (d.lotes.SIN_CONFIRMAR || d.destinatarios.SIN_CONFIRMAR) motivos.push("SIN_CONFIRMAR");
  if (d.incidente) motivos.push("INCIDENTE");
  return motivos;
}

// Los atrasos solo usan lo que sobra después de apartar la evaluación y un lote de hoy
const APARTADO_PARA_HOY = COSTO_MS.tanda + COSTO_MS.reserva + COSTO_MS.lectura + COSTO_MS.lote + COSTO_MS.final;

export async function ejecutarCorrida(o: OpcionesDeCorrida): Promise<ResumenDeCorrida> {
  const { fecha, minuto } = relojDeMexico(o.ahora());
  const dia = aFechaDeBase(fecha);
  let detenidaPor = null as DetenidaPor | null;
  // Un paso empieza solo antes del mediodía y si cabe completo, dejando con qué cerrar la corrida
  const puede = (costo: number) => {
    if (detenidaPor) return false;
    if (!enVentana(o.ahora())) detenidaPor = "MEDIODIA";
    else if (o.plazo.restante() < costo + COSTO_MS.final) detenidaPor = "PLAZO";
    return detenidaPor === null;
  };

  const cierre = await cerrarDiasAnteriores(dia, () => o.plazo.restante() >= APARTADO_PARA_HOY);

  let reserva: ResultadoReserva = { evaluadaAhora: false };
  if (puede(COSTO_MS.reserva)) {
    reserva = await evaluarYReservar(fecha);
    if (reserva.evaluadaAhora) await avisarSiAyerNoSeEvaluo(fecha);
  }

  let lotesSinIniciar = 0;
  let incidente: TipoDeIncidente | null = null;
  if (puede(COSTO_MS.lectura)) {
    const pendientes = await lotesPorEnviar(dia);
    for (const [i, { id }] of pendientes.entries()) {
      if (!puede(COSTO_MS.lote)) {
        lotesSinIniciar = pendientes.length - i;
        break;
      }
      const envio = await enviarLote(id, dia, o.enviar, o.esperaMs ?? ESPERA_DE_RESEND_MS);
      if (envio.tipo === "incidente") {
        incidente = envio.incidente;
        detenidaPor = "INCIDENTE";
        lotesSinIniciar = pendientes.length - i - 1;
        break;
      }
    }
  }

  const { evaluacion, lotes, destinatarios } = await estadoDelDia(dia);
  const motivos = motivosDelDia({ evaluado: evaluacion !== null, lotes, destinatarios, incidente });
  return {
    fecha,
    evaluacion: { evaluadaAhora: reserva.evaluadaAhora, resultado: evaluacion?.resultado ?? null },
    cerrados: cierre.cerrados,
    cierrePendiente: cierre.quedan,
    lotesSinIniciar,
    detenidaPor,
    incidente,
    lotes,
    destinatarios,
    diaSano: motivos.length === 0,
    motivos,
    ultimaDeLaVentana: minuto >= ULTIMA_CORRIDA,
  };
}
