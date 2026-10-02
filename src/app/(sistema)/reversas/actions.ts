"use server";

import { revalidatePath } from "next/cache";
import { ejecutar, protegida, type ResultadoAccion } from "@/lib/inventario/acciones";
import { esquemaReversa } from "@/lib/inventario/formulario";
import * as servicio from "@/lib/inventario/reversas";

// La reversa de cualquier movimiento que afectó el inventario. Solo el
// Superadmin: la puerta exige movimientos:revertir antes de leer nada.

const NO_EXISTE = "El movimiento no existe.";

const revertir = protegida("movimientos:revertir", esquemaReversa, (tx, u, d) => servicio.revertirMovimiento(tx, u, d.id, d.motivo));

/** Una reversa toca dos pantallas cualesquiera y existencias: se refresca todo el sistema. */
function refrescar() {
  revalidatePath("/", "layout");
}

/** La reversa de un traspaso no tiene fila propia: se ve en el historial del traspaso revertido. */
export async function revertirMovimiento(id: string, motivo: string): Promise<ResultadoAccion> {
  return ejecutar(() => revertir({ id, motivo }), NO_EXISTE, refrescar, (r) => (r.tipo === "TRASPASO" ? `/traspasos/${r.revierteA}` : `/ajustes/${r.id}`));
}
