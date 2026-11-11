import "server-only";
import { Prisma, type ResultadoEvaluacion } from "@prisma/client";
import { escrituraDeSistema } from "@/lib/db";
import { aFechaDeBase } from "@/lib/fechas";
import { aParametrosExistencias } from "@/lib/reportes/filtros";
import { configuracionDeCorreo } from "./configuracion";
import { generarResumen, TOPE_RENGLONES } from "./plantilla";

export const POR_LOTE = 100;

export type ResultadoReserva =
  | { evaluadaAhora: false }
  | { evaluadaAhora: true; resultado: ResultadoEvaluacion; articulos: number; renglones: number; destinatarios: number; lotes: number };

export const llaveDelLote = (fecha: string, numero: number) => `resumen-${fecha}-${numero}`;

export function enlaceAlReporte(urlAplicacion: URL): string {
  const enlace = new URL("/reportes/existencias", urlAplicacion);
  enlace.search = aParametrosExistencias({ bodegaId: "", busqueda: "", bajoMinimo: true }).toString();
  return enlace.toString();
}

function enLotes<T>(elementos: T[]): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < elementos.length; i += POR_LOTE) lotes.push(elementos.slice(i, i + POR_LOTE));
  return lotes;
}

export async function evaluarYReservar(fecha: string): Promise<ResultadoReserva> {
  // Antes de evaluar: una configuración rota no debe gastar la evaluación del día
  const { remitente, urlAplicacion } = configuracionDeCorreo();
  const dia = aFechaDeBase(fecha);

  return escrituraDeSistema(
    "resumen-diario",
    async (db): Promise<ResultadoReserva> => {
      await db.candadoDelDia(dia);
      if (await db.evaluacionCorreos.findUnique({ where: { fecha: dia }, select: { id: true } })) return { evaluadaAhora: false };

      const bajoMinimo = await db.leerExistenciasBajoMinimo(TOPE_RENGLONES);
      // La evaluación va al final: con ella se cierran los lotes y destinatarios del día.
      const evaluar = async (resultado: ResultadoEvaluacion, destinatarios = 0, lotes = 0): Promise<ResultadoReserva> => {
        const cifras = { articulos: bajoMinimo.articulos, renglones: bajoMinimo.totalRenglones, destinatarios, lotes };
        await db.evaluacionCorreos.create({ data: { fecha: dia, resultado, ...cifras }, select: { id: true } });
        return { evaluadaAhora: true, resultado, ...cifras };
      };

      if (bajoMinimo.articulos === 0) return evaluar("SIN_BAJO_MINIMO");
      const destinatarios = await db.leerDestinatarios();
      if (destinatarios.length === 0) return evaluar("SIN_DESTINATARIOS");

      const { asunto, html, texto } = await generarResumen({
        fecha,
        articulos: bajoMinimo.articulos,
        totalRenglones: bajoMinimo.totalRenglones,
        renglones: bajoMinimo.renglones,
        urlReporte: enlaceAlReporte(urlAplicacion),
      });
      const lotes = enLotes(destinatarios);
      for (const [i, integrantes] of lotes.entries()) {
        const numero = i + 1;
        const lote = await db.loteCorreos.create({
          data: { fecha: dia, numero, llave: llaveDelLote(fecha, numero), remitente, asunto, html, texto, articulos: bajoMinimo.articulos },
          select: { id: true },
        });
        await db.registroCorreos.createMany({
          data: integrantes.map((d, posicion) => ({ loteId: lote.id, fecha: dia, posicion, usuarioId: d.usuarioId, correo: d.correo })),
        });
      }
      return evaluar("CON_ENVIO", destinatarios.length, lotes.length);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000, maxWait: 5_000 },
  );
}
