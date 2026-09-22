import { notFound } from "next/navigation";
import { confirmarRecepcion, descartarEntrada, guardarEntrada } from "../actions";
import { AccionesBorrador } from "@/components/entradas/acciones-borrador";
import { EncabezadoEntrada, EntradasRelacionadas, PartidasEntrada } from "@/components/entradas/detalle-entrada";
import { FormularioEntrada } from "@/components/entradas/formulario-entrada";
import { Card, CardHeader, EncabezadoPagina } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { uuid, type ValoresEntrada } from "@/lib/entradas/formulario";
import { cargarOpcionesDeCaptura, entradasRelacionadas, obtenerEntrada, type EntradaDetalle } from "@/lib/entradas/repo";
import { deFechaDeBase } from "@/lib/fechas";
import { rolTienePermiso } from "@/lib/permisos";
import { decimalEnTexto } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** El borrador tal como se capturó, para editarlo: texto plano, nada derivado. */
function valoresDe(e: EntradaDetalle): ValoresEntrada {
  return {
    encabezado: {
      proveedorId: e.proveedorId ?? "",
      bodegaDestinoId: e.bodegaDestinoId ?? "",
      fecha: deFechaDeBase(e.fecha),
      moneda: e.moneda === "USD" ? "USD" : "MXN",
      tipoCambio: decimalEnTexto(e.tipoCambio),
      referencia: e.referencia ?? "",
      observaciones: e.observaciones ?? "",
    },
    partidas: e.partidas.map((p) => ({
      articuloId: p.articuloId,
      presentacion: p.presentacionCapturada,
      cantidadCapturada: String(p.cantidadCapturada),
      costoUnitarioCapturado: decimalEnTexto(p.costoUnitarioCapturado),
      tasaIva: p.tasaIva ? String(p.tasaIva) : "0.16",
      numeroSerie: p.numeroSerie ?? "",
      observaciones: p.observaciones ?? "",
    })),
  };
}

export default async function PaginaEntrada({ params }: PageProps<"/entradas/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const datos = await consultar("entradas:leer", async (db, usuario) => {
    const entrada = await obtenerEntrada(db, id);
    if (!entrada) return null;
    const puedeCapturar = rolTienePermiso(usuario.rol, "entradas:capturar");
    const puedeConfirmar = rolTienePermiso(usuario.rol, "entradas:confirmar");
    const editable = entrada.estatus === "BORRADOR" && puedeCapturar;
    const opciones = editable
      ? await cargarOpcionesDeCaptura(db, {
          proveedorId: entrada.proveedorId,
          bodegaId: entrada.bodegaDestinoId,
          articuloIds: entrada.partidas.map((p) => p.articuloId),
        })
      : null;
    const relacionadas = await entradasRelacionadas(db, entrada);
    return { entrada, opciones, relacionadas, puedeCapturar, puedeConfirmar };
  });
  if (!datos) notFound();
  const { entrada, opciones, relacionadas, puedeCapturar, puedeConfirmar } = datos;

  const titulo = entrada.folio ? `Entrada ${entrada.folio}` : "Borrador de entrada";

  return (
    <>
      <EncabezadoPagina
        titulo={titulo}
        descripcion={
          entrada.estatus === "BORRADOR"
            ? "Sin folio y sin efecto en existencias hasta confirmar la recepción."
            : entrada.estatus === "CONFIRMADO"
              ? "Recepción confirmada: el material ya está en la bodega y sus capas de costo existen. No se edita."
              : "Borrador descartado. No tuvo efecto en existencias."
        }
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader titulo="Recepción" />
          <EncabezadoEntrada entrada={entrada} />
          {entrada.estatus === "BORRADOR" && puedeCapturar && (
            <div className="border-t border-border">
              <AccionesBorrador id={entrada.id} puedeConfirmar={puedeConfirmar} confirmar={confirmarRecepcion} descartar={descartarEntrada} />
            </div>
          )}
        </Card>

        {opciones ? (
          <Card>
            <CardHeader titulo="Editar borrador" descripcion="Guardar reemplaza el encabezado y las partidas. El factor de caja y los costos en pesos se recalculan al guardar." />
            <FormularioEntrada
              // Tras guardar, la página vuelve con otro updatedAt y el
              // formulario remonta con lo que quedó en la base.
              key={entrada.updatedAt.toISOString()}
              opciones={opciones}
              valores={valoresDe(entrada)}
              accion={guardarEntrada.bind(null, entrada.id)}
              textoGuardar="Guardar cambios"
              cancelarHref="/entradas"
            />
          </Card>
        ) : (
          <Card>
            <CardHeader titulo="Partidas" descripcion="Costos base en pesos por unidad base; importes en la moneda de la factura." />
            <PartidasEntrada entrada={entrada} />
          </Card>
        )}

        {relacionadas.length > 0 && (
          <Card>
            <CardHeader
              titulo="Otras recepciones de la misma factura"
              descripcion="Mismo proveedor y referencia. Se muestran, no se descuentan: sin orden de compra no hay pendiente por recibir."
            />
            <EntradasRelacionadas entradas={relacionadas} />
          </Card>
        )}
      </div>
    </>
  );
}
