"use client";

import { useEffect, useRef, useState } from "react";
import { ESTILO_PASO, PiePaginacion } from "@/components/ui/paginacion";
import { acotarPagina, paginaDeFila, POR_PAGINA, saltoDe, type Pagina } from "@/lib/paginacion";

/*
  Páginas de 100 en una lista que se edita en el formulario. Las filas de
  otras páginas siguen en el formulario, ocultas: lo capturado no se pierde y
  se envía completo. Cada fila marca su posición con `data-fila`.
*/
export function usePaginaLocal(total: number) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [pedida, setPedida] = useState(1);
  const pagina = acotarPagina(pedida, total);
  const desde = saltoDe(pagina);

  const irA = (n: number) => {
    setPedida(n);
    contenedor.current?.scrollIntoView({ block: "start" });
  };

  // Un campo inválido en una página oculta: el navegador no puede mostrar su
  // aviso, así que se abre esa página y se muestra ahí.
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    let saltando = false;
    const alInvalido = (ev: Event) => {
      const fila = (ev.target as HTMLElement).closest<HTMLElement>("[data-fila]");
      // Una fila de la página que se ve tiene caja; una oculta, no.
      if (!fila || fila.offsetParent !== null || saltando) return;
      saltando = true;
      setPedida(paginaDeFila(Number(fila.dataset.fila)));
      requestAnimationFrame(() => {
        saltando = false;
        (ev.target as HTMLInputElement).reportValidity?.();
      });
    };
    el.addEventListener("invalid", alInvalido, true);
    return () => el.removeEventListener("invalid", alInvalido, true);
  }, []);

  return {
    contenedor,
    pagina,
    irA,
    /** La fila `i` (desde 0) está en la página que se ve. */
    visible: (i: number) => i >= desde && i < desde + POR_PAGINA,
    /** Al agregar una fila, la última página, donde queda. */
    alFinal: (nuevoTotal: number) => setPedida(paginaDeFila(nuevoTotal - 1)),
  };
}

/** El pie de una lista del formulario. `conErrores` son las páginas con algo que corregir. */
export function PaginacionLocal({
  pagina,
  irA,
  sustantivo,
  conErrores = [],
  className,
}: {
  pagina: Pagina;
  irA: (n: number) => void;
  sustantivo: string;
  conErrores?: number[];
  className?: string;
}) {
  if (pagina.ultima <= 1) return null;
  const otras = [...new Set(conErrores)].filter((n) => n !== pagina.actual).sort((a, b) => a - b);
  return (
    <PiePaginacion
      pagina={pagina}
      sustantivo={sustantivo}
      className={className}
      paso={(n, texto, etiqueta) => (
        <button type="button" onClick={() => irA(n)} className={ESTILO_PASO} aria-label={etiqueta}>
          {texto}
        </button>
      )}
    >
      {otras.length > 0 && (
        <span className="font-medium text-danger">
          Hay que corregir {otras.length === 1 ? "la página" : "las páginas"}{" "}
          {otras.map((n, i) => (
            <span key={n}>
              {i > 0 && ", "}
              <button type="button" onClick={() => irA(n)} className="underline">{n}</button>
            </span>
          ))}
        </span>
      )}
    </PiePaginacion>
  );
}
