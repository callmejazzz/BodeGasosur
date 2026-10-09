import Link from "next/link";
import type { ReactNode } from "react";
import { enlaceDePagina, PARAMETRO_PAGINA, rangoDe, type Pagina } from "@/lib/paginacion";
import { cn } from "@/lib/utils";

export const ESTILO_PASO = "rounded-md px-2 py-1 text-primary hover:bg-surface-muted hover:underline";

/**
 * El pie de una lista paginada: qué registros se ven y el paso a la página
 * anterior y la siguiente. `paso` dibuja cada paso posible: un enlace en el
 * servidor, un botón en un formulario.
 */
export function PiePaginacion({
  pagina,
  sustantivo,
  paso,
  children,
  className,
}: {
  pagina: Pagina;
  /** En plural: con más de una página siempre son varios. */
  sustantivo: string;
  paso: (n: number, texto: string, etiqueta: string) => ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { desde, hasta } = rangoDe(pagina);
  const inactivo = (texto: string) => (
    <span className="rounded-md px-2 py-1 text-muted/60" aria-hidden>
      {texto}
    </span>
  );
  return (
    <nav aria-label={`Páginas de ${sustantivo}`} className={cn("flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-sm text-muted", className)}>
      <span className="tabular">
        {desde}–{hasta} de {pagina.total} {sustantivo}
      </span>
      {children}
      <span className="flex items-center gap-1">
        {pagina.actual > 1 ? paso(pagina.actual - 1, "‹ Anterior", "Página anterior") : inactivo("‹ Anterior")}
        <span className="tabular px-2" aria-current="page">
          Página {pagina.actual} de {pagina.ultima}
        </span>
        {pagina.actual < pagina.ultima ? paso(pagina.actual + 1, "Siguiente ›", "Página siguiente") : inactivo("Siguiente ›")}
      </span>
    </nav>
  );
}

/*
  Una lista paginada en el servidor: los enlaces conservan los filtros de la
  URL. Con una sola página no hay nada que mostrar.
*/
export function Paginacion({
  pagina,
  ruta,
  parametros,
  parametro = PARAMETRO_PAGINA,
  ancla,
  sustantivo,
}: {
  pagina: Pagina;
  ruta: string;
  /** Los filtros vigentes, y las páginas de las otras listas: cada enlace los conserva. */
  parametros: URLSearchParams;
  /** Con varias listas en una pantalla, cada una lleva el suyo. */
  parametro?: string;
  /** El id de la sección: dentro de un detalle, el enlace vuelve a ella y no al inicio. */
  ancla?: string;
  sustantivo: string;
}) {
  if (pagina.ultima <= 1) return null;
  const enlace = (n: number) => enlaceDePagina(ruta, parametros, n, parametro) + (ancla ? `#${ancla}` : "");
  return (
    <PiePaginacion
      pagina={pagina}
      sustantivo={sustantivo}
      paso={(n, texto, etiqueta) => (
        <Link href={enlace(n)} className={ESTILO_PASO} aria-label={etiqueta}>
          {texto}
        </Link>
      )}
    />
  );
}
