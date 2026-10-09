import { notFound } from "next/navigation";
import { confirmarTraspaso, descartarTraspaso, guardarTraspaso } from "../actions";
import { revertirMovimiento } from "../../reversas/actions";
import { FormularioTraspaso } from "@/components/inventario/formulario-traspaso";
import { PaginaMovimiento } from "@/components/inventario/pagina-movimiento";
import { Card, CardHeader } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { datosDeDetalle } from "@/lib/inventario/pantallas";
import { leerPagina } from "@/lib/paginacion";

export const dynamic = "force-dynamic";

const DESCRIPCION: Record<string, string> = {
  BORRADOR: "Sin folio y sin efecto en existencias hasta confirmarse.",
  CONFIRMADO: "El material ya está en la bodega de destino con su fecha original y su costo. No se edita: se corrige con una reversa.",
  CANCELADO: "Borrador descartado. No tuvo efecto en existencias.",
};

export default async function PaginaTraspaso({ params, searchParams }: PageProps<"/traspasos/[id]">) {
  // Sesión y permiso primero; el id se valida ya dentro de la puerta.
  const datos = await consultar("traspasos:leer", async (db, usuario) => datosDeDetalle(db, usuario, "TRASPASO", (await params).id));
  if (!datos) notFound();
  const m = datos.movimiento;

  return (
    <PaginaMovimiento
      datos={datos}
      nombre="Traspaso"
      lista={{ href: "/traspasos", texto: "Todos los traspasos" }}
      descripcion={m.cancelaA ? `Reversa de ${m.cancelaA.folio}: devolvió el material a su bodega y a sus capas originales.` : DESCRIPCION[m.estatus]}
      borrador={{
        confirmar: confirmarTraspaso,
        descartar: descartarTraspaso,
        aviso: "¿Confirmas que el material ya se movió? Se consume por PEPS en origen, entra a destino y se asigna folio. Después no se edita.",
        texto: "Confirmar traspaso",
      }}
      revertir={revertirMovimiento}
      paginaPartidas={leerPagina((await searchParams).partidas)}
      edicion={
        datos.opciones && (
          <Card>
            <CardHeader titulo="Editar borrador" descripcion="Guardar reemplaza las bodegas y las partidas." />
            <FormularioTraspaso
              key={m.updatedAt.toISOString()}
              opciones={datos.opciones}
              accion={guardarTraspaso.bind(null, m.id)}
              valores={{
                bodegaOrigenId: m.bodegaOrigenId ?? "",
                bodegaDestinoId: m.bodegaDestinoId ?? "",
                observaciones: m.observaciones ?? "",
                partidas: m.partidas.map((p) => ({ articuloId: p.articuloId, presentacion: p.presentacionCapturada, cantidadCapturada: String(p.cantidadCapturada), observaciones: p.observaciones ?? "" })),
              }}
              textoGuardar="Guardar cambios"
              cancelarHref="/traspasos"
            />
          </Card>
        )
      }
    />
  );
}
