import { Badge, Estados } from "@/components/ui/superficies";

const ESTATUS = {
  BORRADOR: { texto: "Borrador", tono: "aviso" },
  CONFIRMADO: { texto: "Confirmado", tono: "exito" },
  CANCELADO: { texto: "Descartado", tono: "neutro" },
} as const;

/** Estatus y, si aplica, la relación con una reversa: el original no cambia de estatus al revertirse. */
export function BadgeEstatus({ estatus, revertido, esReversa }: { estatus: string; revertido?: boolean; esReversa?: boolean }) {
  const e = ESTATUS[estatus as keyof typeof ESTATUS];
  return (
    <Estados>
      <Badge tono={e?.tono ?? "neutro"}>{e?.texto ?? estatus}</Badge>
      {esReversa && <Badge tono="info">Reversa</Badge>}
      {revertido && <Badge tono="peligro">Revertido</Badge>}
    </Estados>
  );
}
