import { Badge } from "@/components/ui/superficies";
import { TEXTO_DEVOLUCION, TEXTO_ESTATUS_SALIDA } from "@/lib/estatus";

const TONO = { SOLICITADA: "aviso", AUTORIZADA: "info", RECHAZADA: "peligro", RETIRADA: "info", RECIBIDA: "exito", CANCELADO: "neutro" } as const;

export function BadgeEstatusSalida({ estatus }: { estatus: string }) {
  return <Badge tono={TONO[estatus as keyof typeof TONO] ?? "neutro"}>{TEXTO_ESTATUS_SALIDA[estatus] ?? estatus}</Badge>;
}

/** Lo que volvió en devoluciones vigentes ligadas a la salida. */
export function BadgeDevolucion({ estado }: { estado: "completa" | "parcial" }) {
  return <Badge tono={estado === "completa" ? "info" : "aviso"}>{TEXTO_DEVOLUCION[estado]}</Badge>;
}
