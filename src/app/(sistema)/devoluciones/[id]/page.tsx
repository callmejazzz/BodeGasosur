import { notFound } from "next/navigation";
import { confirmarDevolucion, descartarDevolucion, guardarDevolucion } from "../actions";
import { buscarSalidas } from "../consultas";
import { revertirMovimiento } from "../../reversas/actions";
import { FormularioDevolucion } from "@/components/inventario/formulario-devolucion";
import { PaginaMovimiento } from "@/components/inventario/pagina-movimiento";
import { Card, CardHeader } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { datosDeDetalle } from "@/lib/inventario/pantallas";
import { leerPagina } from "@/lib/paginacion";

export const dynamic = "force-dynamic";

const DESCRIPCION: Record<string, string> = {
  BORRADOR: "Sin folio y sin efecto en existencias ni en el préstamo hasta confirmarse.",
  CONFIRMADO: "El material ya está en la bodega. No se edita: se corrige con una reversa, que vuelve a abrir el saldo del préstamo.",
  CANCELADO: "Borrador descartado. No tuvo efecto.",
};

export default async function PaginaDevolucion({ params, searchParams }: PageProps<"/devoluciones/[id]">) {
  const datos = await consultar("devoluciones:leer", async (db, usuario) => datosDeDetalle(db, usuario, "DEVOLUCION", (await params).id));
  if (!datos) notFound();
  const m = datos.movimiento;

  return (
    <PaginaMovimiento
      datos={datos}
      nombre="Devolución"
      lista={{ href: "/devoluciones", texto: "Todas las devoluciones" }}
      descripcion={DESCRIPCION[m.estatus]}
      borrador={{
        confirmar: confirmarDevolucion,
        descartar: descartarDevolucion,
        aviso: m.devuelveA
          ? `¿Confirmas que el material ya volvió? Entra con el costo de ${m.devuelveA.folio} y reduce lo que falta por volver. Después no se edita.`
          : "¿Confirmas que el material ya volvió? Entra sin costo, como procedencia no comprobada. Después no se edita.",
        texto: "Confirmar devolución",
      }}
      revertir={revertirMovimiento}
      paginaPartidas={leerPagina((await searchParams).partidas)}
      edicion={
        datos.opciones && (
          <Card>
            <CardHeader titulo="Editar borrador" descripcion="Guardar reemplaza la estación, la salida y las partidas." />
            <FormularioDevolucion
              key={m.updatedAt.toISOString()}
              opciones={datos.opciones}
              vinculada={datos.vinculada}
              buscar={buscarSalidas}
              accion={guardarDevolucion.bind(null, m.id)}
              valores={{
                estacionId: m.estacionId ?? "",
                bodegaDestinoId: m.bodegaDestinoId ?? "",
                observaciones: m.observaciones ?? "",
                partidas: m.partidas.map((p) => ({ articuloId: p.articuloId, presentacion: p.presentacionCapturada, cantidadCapturada: String(p.cantidadCapturada), observaciones: p.observaciones ?? "" })),
              }}
              textoGuardar="Guardar cambios"
              cancelarHref="/devoluciones"
            />
          </Card>
        )
      }
    />
  );
}
