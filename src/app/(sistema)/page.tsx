import { TarjetaEntradas, TarjetaExistencias, TarjetaGasto, TarjetaPrestamos, TarjetaSalidas } from "@/components/tablero";
import { EncabezadoPagina } from "@/components/ui/superficies";
import { consultar } from "@/lib/db";
import { usuarioTienePermiso } from "@/lib/permisos";
import { leerTablero } from "@/lib/tablero/repo";

export const dynamic = "force-dynamic";

export default async function Tablero() {
  const t = await consultar("catalogos:leer", (db, yo) => leerTablero(db, (permiso) => usuarioTienePermiso(yo, permiso)));

  return (
    <>
      <EncabezadoPagina titulo="Tablero operativo" descripcion="Resumen de existencias, salidas, préstamos, entradas y gasto por estación"/>
      <div className="grid gap-6 lg:grid-cols-2">
        {t.existencias && <TarjetaExistencias filas={t.existencias} />}
        {t.salidas && <TarjetaSalidas filas={t.salidas} />}
        {t.prestamos && <TarjetaPrestamos filas={t.prestamos} />}
        {t.entradas && <TarjetaEntradas filas={t.entradas} />}
        {t.gasto && <TarjetaGasto datos={t.gasto} />}
      </div>
    </>
  );
}
