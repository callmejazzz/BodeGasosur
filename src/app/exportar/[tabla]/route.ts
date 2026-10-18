import type { NextRequest } from "next/server";
import { consultarParaDescarga, SinAcceso, SinPermiso, usuarioParaDescarga, type UsuarioSesion } from "@/lib/db";
import { descargaDe, type Descarga, type Params } from "@/lib/exportar/descargas";
import { claveDeGeneracion, generaciones } from "@/lib/exportar/generaciones";
import { DemasiadasFilas } from "@/lib/exportar/lotes";
import { libroXlsx } from "@/lib/exportar/xlsx";
import { relojDeMexico } from "@/lib/fechas";

// La descarga en Excel de una tabla: vuelve a exigir sesión y permiso, lee los
// filtros de la URL como la pantalla y arma el libro completo antes de
// responder. Si algo falla, responde un error con su mensaje, nunca un archivo a medias.
// Cada usuario arma pocos libros a la vez y por minuto; el mismo pedido en
// curso se comparte en vez de repetirse.

export const dynamic = "force-dynamic";

const PRIVADO = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

const error = (status: number, mensaje: string, encabezados?: Record<string, string>) =>
  Response.json({ mensaje }, { status, headers: { ...PRIVADO, ...encabezados } });

const LIMITADA = {
  "en-curso": () => "Ya tienes dos descargas en curso. Espera a que termine alguna e inténtalo de nuevo.",
  frecuencia: (s: number) => `Pediste demasiadas descargas seguidas. Inténtalo de nuevo en ${s} s.`,
};

/** Como los searchParams de una página: un valor repetido llega como lista. */
function parametrosDe(busqueda: URLSearchParams): Params {
  const params: Params = {};
  for (const clave of new Set(busqueda.keys())) {
    const valores = busqueda.getAll(clave);
    params[clave] = valores.length === 1 ? valores[0] : valores;
  }
  return params;
}

type Archivo = { contenido: Buffer; nombre: string; filas: number; ms: number };

async function generar(descarga: Descarga, params: Params): Promise<Archivo | null> {
  const inicio = Date.now();
  const libro = await descarga.libro((fn) => consultarParaDescarga(descarga.permiso, fn), params);
  if (!libro) return null;
  const ahora = new Date();
  return {
    contenido: libroXlsx(libro.hojas, ahora, descarga.titulo),
    nombre: `${libro.archivo ?? descarga.archivo}-${relojDeMexico(ahora).fecha}.xlsx`.replace(/[^A-Za-z0-9._-]+/g, "-"),
    filas: libro.hojas.reduce((n, h) => n + h.filas.length, 0),
    ms: Date.now() - inicio,
  };
}

/** Quién y qué tabla; ni filtros ni filas. */
const quien = (u: UsuarioSesion | undefined) => (u ? `usuario ${u.id} (${u.rol})` : "sin usuario");

export async function GET(request: NextRequest, ctx: RouteContext<"/exportar/[tabla]">) {
  const { tabla } = await ctx.params;
  const descarga = descargaDe(tabla);
  if (!descarga) return error(404, "Esta tabla no se puede descargar.");
  const params = parametrosDe(request.nextUrl.searchParams);

  let usuario: UsuarioSesion | undefined;
  try {
    usuario = await usuarioParaDescarga(descarga.permiso);
    const turno = generaciones.turno(usuario.id, claveDeGeneracion(usuario.id, tabla, params), () => generar(descarga, params));
    if (turno.estado === "limitada") {
      console.warn(`[exportar] ${tabla}: rechazada por ${turno.motivo}, ${quien(usuario)}`);
      return error(429, LIMITADA[turno.motivo](turno.reintentarEn), { "Retry-After": String(turno.reintentarEn) });
    }
    const archivo = await turno.resultado;
    if (!archivo) return error(404, "Lo que se quiere descargar no existe.");
    console.info(
      `[exportar] ${tabla}: ${archivo.nombre} para ${quien(usuario)}, ${archivo.filas} filas, ${archivo.contenido.length} bytes, ${archivo.ms} ms` +
        (turno.estado === "compartida" ? ", compartida con otra petición en curso" : ""),
    );
    return new Response(new Uint8Array(archivo.contenido), {
      headers: {
        ...PRIVADO,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${archivo.nombre}"`,
        "Content-Length": String(archivo.contenido.length),
      },
    });
  } catch (e) {
    if (e instanceof SinAcceso) return error(401, "La sesión terminó o ya no tiene acceso. Vuelve a entrar.");
    if (e instanceof SinPermiso) return error(403, "No tienes permiso para descargar esta tabla.");
    if (e instanceof DemasiadasFilas) return error(413, e.message);
    console.error(`[exportar] ${tabla}, ${quien(usuario)}:`, e);
    return error(500, "No se pudo generar el archivo. Inténtalo de nuevo; si vuelve a fallar, acota los filtros.");
  }
}
