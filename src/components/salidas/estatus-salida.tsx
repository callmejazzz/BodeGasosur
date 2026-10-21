import { Badge } from "@/components/ui/superficies";

const ESTATUS = {
  SOLICITADA: { texto: "Solicitada", tono: "aviso" },
  AUTORIZADA: { texto: "Autorizada", tono: "info" },
  RECHAZADA: { texto: "Rechazada", tono: "peligro" },
  RETIRADA: { texto: "Retirada", tono: "info" },
  RECIBIDA: { texto: "Recibida", tono: "exito" },
  CANCELADO: { texto: "Cancelada", tono: "neutro" },
} as const;

export function BadgeEstatusSalida({ estatus }: { estatus: string }) {
  const e = ESTATUS[estatus as keyof typeof ESTATUS];
  return <Badge tono={e?.tono ?? "neutro"}>{e?.texto ?? estatus}</Badge>;
}

/** Lo que volvió en devoluciones vigentes ligadas a la salida. */
export function BadgeDevolucion({ estado }: { estado: "completa" | "parcial" }) {
  return estado === "completa" ? <Badge tono="info">Devuelto</Badge> : <Badge tono="aviso">Devuelto parcial</Badge>;
}
