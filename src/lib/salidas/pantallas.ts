import "server-only";
import type { EstatusMovimiento, Prisma } from "@prisma/client";
import { uuid } from "@/lib/movimientos/formulario";
import { usuarioTienePermiso, type SujetoDePermisos } from "@/lib/permisos";
import { aFiltroDeRepo, leerFiltros } from "./filtros";
import { contarPendientes, existenciasDeSalida, listarSalidas, obtenerSalida, valuarSalida, type SalidaDetalle } from "./repo";

// Lo que lee cada pantalla de salidas. Corre dentro de consultar(), que ya
// comprobó sesión y permiso de lectura; lo que el usuario no puede ver ni usar
// no se consulta.

type Db = Prisma.TransactionClient;

export async function datosDeLista(db: Db, usuario: SujetoDePermisos, params: Record<string, string | string[] | undefined>) {
  const filtros = leerFiltros(params);
  const cursor = typeof params.cursor === "string" ? uuid.safeParse(params.cursor) : null;
  const { filas, hayMas, cursorActual, cursorSiguiente } = await listarSalidas(db, { ...aFiltroDeRepo(filtros), cursor: cursor?.success ? cursor.data : undefined });
  return {
    filtros,
    filas,
    hayMas,
    cursorActual,
    cursorSiguiente,
    puedeCapturar: usuarioTienePermiso(usuario, "salidas:capturar"),
    pendientes: await contarPendientes(db, usuario),
  };
}

export type Facultades = { autorizar: boolean; cancelar: boolean; retirar: boolean; recibir: boolean };

/** Qué botones ve el usuario. Presentación: la puerta de cada acción lo vuelve a exigir. */
export function facultadesSobre(usuario: SujetoDePermisos, estatus: EstatusMovimiento): Facultades {
  const abierta = estatus === "SOLICITADA" || estatus === "AUTORIZADA";
  return {
    autorizar: estatus === "SOLICITADA" && usuarioTienePermiso(usuario, "salidas:autorizar"),
    cancelar: abierta && usuarioTienePermiso(usuario, "salidas:capturar"),
    retirar: estatus === "AUTORIZADA" && usuarioTienePermiso(usuario, "salidas:retirar"),
    recibir: estatus === "RETIRADA" && usuarioTienePermiso(usuario, "salidas:recibir"),
  };
}

/** Lo que haría fallar el retiro con el catálogo de hoy. El servicio lo vuelve a revisar bajo candado. */
export function avisosDeRetiro(s: SalidaDetalle): string[] {
  const avisos: string[] = [];
  if (!s.bodegaOrigen?.activa) avisos.push("La bodega de origen está dada de baja.");
  if (!s.estacion?.activa) avisos.push("La estación está dada de baja.");
  if (s.area && !s.area.activa) avisos.push("El área está dada de baja.");
  if (s.solicitadoPor && !s.solicitadoPor.activa) avisos.push("El solicitante está dado de baja.");
  for (const p of s.partidas) {
    if (!p.articulo.activo) avisos.push(`${p.articulo.clave} está dado de baja.`);
    if (p.presentacionCapturada === "CAJA" && p.factorConversion !== p.articulo.piezasPorCaja) {
      avisos.push(`${p.articulo.clave} pasó de ${p.factorConversion} a ${p.articulo.piezasPorCaja ?? "ninguna"} piezas por caja.`);
    }
  }
  return avisos;
}

export async function datosDeDetalle(db: Db, usuario: SujetoDePermisos, idCrudo: string) {
  const id = uuid.safeParse(idCrudo);
  if (!id.success) return null;
  const salida = await obtenerSalida(db, id.data);
  if (!salida) return null;
  const puede = facultadesSobre(usuario, salida.estatus);
  const retirada = salida.estatus === "RETIRADA" || salida.estatus === "RECIBIDA";
  return {
    salida,
    puede,
    // Solo para quien puede retirarla, y solo mientras se puede.
    existencias: puede.retirar ? await existenciasDeSalida(db, salida.id) : null,
    valuacion: retirada ? await valuarSalida(db, salida.id) : null,
    avisos: salida.estatus === "SOLICITADA" || salida.estatus === "AUTORIZADA" ? avisosDeRetiro(salida) : [],
  };
}
