"use server";

import { consultarDesdeAccion } from "@/lib/db";
import { mensajeSeguro } from "@/lib/inventario/acciones";
import { salidasDelSelector, type PaginaDeSalidas } from "@/lib/inventario/pantallas";
import { acotarPagina } from "@/lib/paginacion";

// Lecturas bajo demanda del formulario de devoluciones. No escriben: van por
// consultarDesdeAccion(), que comprueba sesión y permiso antes de leer la búsqueda.

export async function buscarSalidas(busqueda: unknown): Promise<PaginaDeSalidas> {
  try {
    return await consultarDesdeAccion("devoluciones:capturar", (db) => salidasDelSelector(db, busqueda));
  } catch (error) {
    return { salidas: [], pagina: acotarPagina(1, 0), aviso: mensajeSeguro(error, "La salida no existe.") };
  }
}
