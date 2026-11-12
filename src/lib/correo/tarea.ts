import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { relojDeMexico } from "@/lib/fechas";
import { ConfiguracionDeCorreoInvalida } from "./configuracion";
import { ejecutarCorrida, enVentana, type OpcionesDeCorrida, type ResumenDeCorrida } from "./corrida";
import { plazoDesde, type Plazo } from "./plazos";
import { enviadorDeResend, type EnviadorDeLotes } from "./resend";

export const LARGO_MINIMO_DEL_SECRETO = 32;

export type DependenciasDeTarea = {
  ahora?: () => Date;
  plazo?: () => Plazo;
  secreto?: string;
  crearEnviador?: () => EnviadorDeLotes;
  corrida?: (o: OpcionesDeCorrida) => Promise<ResumenDeCorrida>;
};

const huella = (texto: string) => createHash("sha256").update(texto).digest();

// Huellas de largo fijo: la comparación no revela el largo del secreto
function autorizada(cabecera: string | null, secreto: string | undefined): boolean {
  if (!secreto || secreto.length < LARGO_MINIMO_DEL_SECRETO) {
    console.error(`[correo] CRON_SECRET no está definida o tiene menos de ${LARGO_MINIMO_DEL_SECRETO} caracteres`);
    return false;
  }
  const recibido = cabecera?.startsWith("Bearer ") ? cabecera.slice("Bearer ".length) : "";
  return timingSafeEqual(huella(recibido), huella(secreto)) && recibido.length > 0;
}

const hora = (ahora: Date) => {
  const { minuto } = relojDeMexico(ahora);
  return `${String(Math.floor(minuto / 60)).padStart(2, "0")}:${String(minuto % 60).padStart(2, "0")}`;
};

// Solo la clase y el código: el mensaje de un error de la base o de una librería puede traer datos
function clase(error: unknown): string {
  if (error instanceof ConfiguracionDeCorreoInvalida) return `${error.name}: ${error.message}`;
  if (!(error instanceof Error)) return "error desconocido";
  const codigo = (error as { code?: unknown }).code;
  return typeof codigo === "string" && /^[A-Z0-9_]{1,20}$/.test(codigo) ? `${error.name} ${codigo}` : error.name;
}

/** POST /api/tareas/resumen-diario: sin secreto válido o fuera de la ventana no toca la base */
export async function atenderTarea(peticion: Request, d: DependenciasDeTarea = {}): Promise<Response> {
  const plazo = (d.plazo ?? (() => plazoDesde()))();
  if (!autorizada(peticion.headers.get("authorization"), d.secreto ?? process.env.CRON_SECRET)) {
    return new Response(null, { status: 401 });
  }
  const reloj = d.ahora ?? (() => new Date());
  const ahora = reloj();
  if (!enVentana(ahora)) {
    console.error(`[correo] corrida fuera de la ventana de 8:00 a 12:00 (hora de México: ${hora(ahora)}); revisa la zona horaria del cron`);
    return Response.json({ codigo: "FUERA_DE_VENTANA", hora: hora(ahora) }, { status: 409 });
  }
  const corrida = randomUUID();
  try {
    const enviar = (d.crearEnviador ?? enviadorDeResend)();
    const resumen = await (d.corrida ?? ejecutarCorrida)({ ahora: reloj, plazo, enviar });
    console.info(
      `[correo] corrida ${corrida} del ${resumen.fecha}: evaluación ${resumen.evaluacion.resultado ?? "ninguna"}, lotes ${JSON.stringify(resumen.lotes)}, ` +
        `destinatarios ${JSON.stringify(resumen.destinatarios)}, día ${resumen.diaSano ? "sano" : `no sano (${resumen.motivos.join(", ")})`}` +
        (resumen.detenidaPor ? `, detenida por ${resumen.detenidaPor}` : ""),
    );
    return Response.json({ corrida, ...resumen });
  } catch (error) {
    console.error(`[correo] corrida ${corrida} falló: ${clase(error)}`);
    return Response.json({ codigo: "ERROR", corrida }, { status: 500 });
  }
}
