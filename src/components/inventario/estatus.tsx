import { Badge, Estados } from "@/components/ui/superficies";
import { TEXTO_ESTATUS_MOVIMIENTO } from "@/lib/estatus";

const TONO = { BORRADOR: "aviso", CONFIRMADO: "exito", CANCELADO: "neutro" } as const;

/** Estatus y, si aplica, la relación con una reversa: el original no cambia de estatus al revertirse. */
export function BadgeEstatus({ estatus, revertido, esReversa }: { estatus: string; revertido?: boolean; esReversa?: boolean }) {
  return (
    <Estados>
      <Badge tono={TONO[estatus as keyof typeof TONO] ?? "neutro"}>{TEXTO_ESTATUS_MOVIMIENTO[estatus] ?? estatus}</Badge>
      {esReversa && <Badge tono="info">Reversa</Badge>}
      {revertido && <Badge tono="peligro">Revertido</Badge>}
    </Estados>
  );
}
