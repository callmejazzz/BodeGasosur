"use server";

import { z } from "zod";
import type { PaginaDeOpciones } from "@/components/ui/selector-buscable";
import { consultarDesdeAccion, SinAcceso, SinPermiso } from "@/lib/db";
import { acotarPagina } from "@/lib/paginacion";
import { articulosDelSelector, type OpcionArticulo } from "@/lib/reportes/pantallas";

// Lecturas bajo demanda de los filtros de reportes. No escriben: van por
// consultarDesdeAccion(), que comprueba sesión y permiso antes de leer la búsqueda.

const busqueda = z.object({ texto: z.string().max(40), pagina: z.number().int().min(1).max(999_999) });

export async function buscarArticulos(texto: unknown, pagina: unknown): Promise<PaginaDeOpciones<OpcionArticulo>> {
  const vacia = (aviso: string) => ({ opciones: [], pagina: acotarPagina(1, 0), aviso });
  try {
    return await consultarDesdeAccion("reportes:leer", async (db) => {
      const b = busqueda.safeParse({ texto, pagina });
      if (!b.success) return vacia("Busca por clave o descripción.");
      const { filas, pagina: p } = await articulosDelSelector(db, b.data.texto, b.data.pagina);
      return { opciones: filas, pagina: p, aviso: null };
    });
  } catch (error) {
    if (error instanceof SinAcceso || error instanceof SinPermiso) return vacia("Sin permiso para consultar artículos.");
    throw error;
  }
}
