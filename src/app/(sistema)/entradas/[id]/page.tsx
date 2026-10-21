import { notFound } from "next/navigation";
import { confirmarRecepcion, descartarEntrada, guardarEntrada } from "../actions";
import { revertirMovimiento } from "../../reversas/actions";
import { AvisoDeReversa } from "@/components/inventario/relaciones";
import { RevertirMovimiento } from "@/components/inventario/revertir";
import { AccionesBorrador } from "@/components/entradas/acciones-borrador";
import { EncabezadoEntrada, EntradasRelacionadas, PartidasEntrada } from "@/components/entradas/detalle-entrada";
import { FormularioEntrada } from "@/components/entradas/formulario-entrada";
import { Paginacion } from "@/components/ui/paginacion";
import { Card, CardHeader, EncabezadoPagina } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { uuid, type ValoresEntrada } from "@/lib/entradas/formulario";
import { cargarOpcionesDeCaptura, entradasRelacionadas, obtenerEntrada, type EntradaDetalle } from "@/lib/entradas/repo";
import { datosDeReversa } from "@/lib/inventario/pantallas";
import { deFechaDeBase } from "@/lib/fechas";
import { leerPagina, paginar, parametrosDePaginas } from "@/lib/paginacion";
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

export default async function PaginaEntrada({ params, searchParams }: PageProps<"/entradas/[id]">) {
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
    const reversa = await datosDeReversa(db, usuario, { id: entrada.id, tipo: "ENTRADA", estatus: entrada.estatus, cancelaAId: null });
    return { entrada, opciones, relacionadas, puedeCapturar, puedeConfirmar, reversa };
  });
  if (!datos) notFound();
  const { entrada, opciones, relacionadas, puedeCapturar, puedeConfirmar, reversa } = datos;

  const titulo = entrada.folio ? `Entrada ${entrada.folio}` : "Borrador de entrada";
  // Cada lista del detalle pagina por su cuenta: ?partidas=2&relacionadas=3
  const sp = await searchParams;
  const partidas = paginar(entrada.partidas, leerPagina(sp.partidas));
  const otras = paginar(relacionadas, leerPagina(sp.relacionadas));
  const paginas = parametrosDePaginas({ partidas: partidas.pagina, relacionadas: otras.pagina });
  const ruta = `/entradas/${entrada.id}`;

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
          {reversa.reversa && <AvisoDeReversa reversa={reversa.reversa} />}
          {reversa.revertir && entrada.folio && <RevertirMovimiento id={entrada.id} folio={entrada.folio} revertir={revertirMovimiento} />}
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
          <Card id="partidas" className="scroll-mt-4">
            <CardHeader titulo="Partidas" descripcion="Costos base en pesos por unidad base; importes en la moneda de la factura." />
            <PartidasEntrada
              entrada={{ ...entrada, partidas: partidas.filas }}
              pie={<Paginacion pagina={partidas.pagina} ruta={ruta} parametros={paginas} parametro="partidas" ancla="partidas" sustantivo="partidas" />}
            />
          </Card>
        )}

        {relacionadas.length > 0 && (
          <Card id="relacionadas" className="scroll-mt-4">
            <CardHeader
              titulo="Otras recepciones de la misma factura"
              descripcion="Mismo proveedor y referencia. Se muestran, no se descuentan: sin orden de compra no hay pendiente por recibir."
            />
            <EntradasRelacionadas entradas={otras.filas} />
            <Paginacion pagina={otras.pagina} ruta={ruta} parametros={paginas} parametro="relacionadas" ancla="relacionadas" sustantivo="recepciones" />
          </Card>
        )}
      </div>
    </>
  );
}
