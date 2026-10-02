import Link from "next/link";
import { notFound } from "next/navigation";
import { actualizarHoja, confirmarConteo, descartarHoja, guardarConteo } from "../actions";
import { BadgeEstatus } from "@/components/inventario/estatus";
import { Historial } from "@/components/inventario/detalle-movimiento";
import { HojaConteo } from "@/components/inventario/hoja-conteo";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, CardHeader, EncabezadoPagina } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { datosDeHoja } from "@/lib/inventario/pantallas";

export const dynamic = "force-dynamic";

const DESCRIPCION = {
  BORRADOR: "Captura lo contado y guarda. Si la existencia cambia antes de confirmar, actualiza la hoja y revisa las diferencias.",
  CONFIRMADO: "Confirmada: las diferencias ya son ajustes y la existencia quedó en lo contado. No se edita.",
  CANCELADO: "Hoja descartada. No tuvo efecto en existencias.",
} as const;

export default async function PaginaHoja({ params }: PageProps<"/conteos/[id]">) {
  const datos = await consultar("ajustes:leer", async (db, usuario) => datosDeHoja(db, usuario, (await params).id));
  if (!datos) notFound();
  const { hoja: h, puede, articulos } = datos;

  const pasos = [{ etiqueta: "Abrió", quien: h.creadoPor.correo, cuando: h.createdAt }];
  if (h.confirmadoPor && h.confirmadoEn) pasos.push({ etiqueta: "Confirmó", quien: h.confirmadoPor.correo, cuando: h.confirmadoEn });
  if (h.canceladoPor && h.canceladoEn) pasos.push({ etiqueta: `Descartó: ${h.motivoCancelacion}`, quien: h.canceladoPor.correo, cuando: h.canceladoEn });

  return (
    <>
      <EncabezadoPagina
        titulo={`Conteo de ${h.bodega.nombre}`}
        descripcion={DESCRIPCION[h.estatus]}
        acciones={<ButtonLink href="/conteos" variante="secundario">Todas las hojas</ButtonLink>}
      />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader
            titulo={<span className="flex items-center gap-2">Hoja <BadgeEstatus estatus={h.estatus} /></span>}
            descripcion={`Motivo: ${h.motivo}${h.observaciones ? ` · ${h.observaciones}` : ""}`}
          />
          {h.ajustes.length > 0 && (
            <div className="flex flex-wrap gap-4 px-5 py-4 text-sm">
              {h.ajustes.map((a) => (
                <span key={a.id} className="flex items-center gap-2">
                  <Link href={`/ajustes/${a.id}`} className="font-medium text-primary hover:underline">{a.folio}</Link>
                  <span className="text-muted">{a.bodegaDestinoId ? "suma" : "resta"} {a._count.partidas} artículo{a._count.partidas === 1 ? "" : "s"}</span>
                  {a.canceladoPor && <Badge tono="peligro">Revertido con {a.canceladoPor.folio}</Badge>}
                </span>
              ))}
            </div>
          )}
          {h.estatus === "CONFIRMADO" && h.ajustes.length === 0 && <p className="px-5 py-4 text-sm text-muted">Sin diferencias: no se generó ningún ajuste.</p>}
        </Card>

        <Card>
          <CardHeader titulo="Artículos" descripcion="«Esperada» es la existencia que leyó el sistema al abrir o actualizar la hoja." />
          <HojaConteo
            key={h.revision}
            id={h.id}
            revision={h.revision}
            renglones={h.renglones.map((r) => ({
              articuloId: r.articuloId,
              clave: r.articulo.clave,
              descripcion: r.articulo.descripcion,
              unidad: r.articulo.unidad.clave,
              esperada: r.cantidadEsperada,
              contada: r.cantidadContada === null ? "" : String(r.cantidadContada),
              observaciones: r.observaciones ?? "",
            }))}
            editable={puede.capturar}
            puedeConfirmar={puede.confirmar}
            articulos={articulos}
            guardar={guardarConteo.bind(null, h.id)}
            actualizar={actualizarHoja}
            confirmar={confirmarConteo}
            descartar={descartarHoja}
          />
        </Card>

        <Card>
          <CardHeader titulo="Historial" />
          <Historial pasos={pasos} />
        </Card>
      </div>
    </>
  );
}
