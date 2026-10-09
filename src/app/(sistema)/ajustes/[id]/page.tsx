import { notFound } from "next/navigation";
import { revertirMovimiento } from "../../reversas/actions";
import { PaginaMovimiento } from "@/components/inventario/pagina-movimiento";
import { consultar } from "@/lib/db";
import { datosDeDetalle } from "@/lib/inventario/pantallas";
import { leerPagina } from "@/lib/paginacion";

export const dynamic = "force-dynamic";

export default async function PaginaAjuste({ params, searchParams }: PageProps<"/ajustes/[id]">) {
  const datos = await consultar("ajustes:leer", async (db, usuario) => datosDeDetalle(db, usuario, "AJUSTE", (await params).id));
  if (!datos) notFound();
  const m = datos.movimiento;
  const descripcion = m.cancelaA
    ? `Reversa de ${m.cancelaA.folio}: ${m.bodegaOrigen ? "retiró las capas exactas que creó" : "devolvió cada pieza a la capa exacta de la que salió"}. No se revierte.`
    : m.bodegaDestino
      ? "Suma lo contado de más con una capa sin costo. Se corrige con una reversa."
      : "Resta lo que faltó al contar, consumiendo PEPS. Se corrige con una reversa.";

  return <PaginaMovimiento datos={datos} nombre={m.cancelaA ? "Reversa" : "Ajuste"} lista={{ href: "/ajustes", texto: "Todos los ajustes" }} descripcion={descripcion} revertir={revertirMovimiento} paginaPartidas={leerPagina((await searchParams).partidas)} />;
}
