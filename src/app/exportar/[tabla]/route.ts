import type { NextRequest } from "next/server";
import { consultarParaDescarga, SinAcceso, SinPermiso } from "@/lib/db";
import { descargaDe, type Params } from "@/lib/exportar/descargas";
import { DemasiadasFilas } from "@/lib/exportar/lotes";
import { libroXlsx } from "@/lib/exportar/xlsx";
import { relojDeMexico } from "@/lib/fechas";

// La descarga en Excel de una tabla: vuelve a exigir sesión y permiso, lee los
// filtros de la URL como la pantalla y arma el libro completo antes de
// responder. Si algo falla, responde un error con su mensaje, nunca un archivo a medias.

export const dynamic = "force-dynamic";

const PRIVADO = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

const error = (status: number, mensaje: string) => Response.json({ mensaje }, { status, headers: PRIVADO });

/** Como los searchParams de una página: un valor repetido llega como lista. */
function parametrosDe(busqueda: URLSearchParams): Params {
  const params: Params = {};
  for (const clave of new Set(busqueda.keys())) {
    const valores = busqueda.getAll(clave);
    params[clave] = valores.length === 1 ? valores[0] : valores;
  }
  return params;
}

export async function GET(request: NextRequest, ctx: RouteContext<"/exportar/[tabla]">) {
  const { tabla } = await ctx.params;
  const descarga = descargaDe(tabla);
  if (!descarga) return error(404, "Esta tabla no se puede descargar.");

  try {
    const libro = await descarga.libro((fn) => consultarParaDescarga(descarga.permiso, fn), parametrosDe(request.nextUrl.searchParams));
    if (!libro) return error(404, "Lo que se quiere descargar no existe.");
    const ahora = new Date();
    const contenido = libroXlsx(libro.hojas, ahora, descarga.titulo);
    const nombre = `${libro.archivo ?? descarga.archivo}-${relojDeMexico(ahora).fecha}.xlsx`.replace(/[^A-Za-z0-9._-]+/g, "-");
    return new Response(new Uint8Array(contenido), {
      headers: {
        ...PRIVADO,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Content-Length": String(contenido.length),
      },
    });
  } catch (e) {
    if (e instanceof SinAcceso) return error(401, "La sesión terminó o ya no tiene acceso. Vuelve a entrar.");
    if (e instanceof SinPermiso) return error(403, "No tienes permiso para descargar esta tabla.");
    if (e instanceof DemasiadasFilas) return error(413, e.message);
    console.error(`[exportar] ${tabla}:`, e);
    return error(500, "No se pudo generar el archivo. Inténtalo de nuevo; si vuelve a fallar, acota los filtros.");
  }
}
