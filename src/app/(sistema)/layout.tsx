import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Navegacion } from "@/components/navegacion";
import { RefrescarAlEnfocar } from "@/components/refrescar-al-enfocar";
import { ControlesSesion } from "@/components/sesion";
import { consultarMiCuenta } from "@/lib/cuenta/consultas";
import { consultar, registrarAccesoDenegado, sesionActual } from "@/lib/db";
import { leerContadores } from "@/lib/navegacion/contadores";
import { usuarioTienePermiso } from "@/lib/permisos";

/**
 * El sistema. Dibuja la barra lateral y decide quién la ve.
 *
 * ATENCIÓN — esto NO es la frontera de autorización:
 *
 *   · Las acciones de servidor son URLs propias e invocables directamente y no
 *     pasan por ningún layout. Es la clase de defecto del CVE-2025-29927.
 *   · Next.js no vuelve a ejecutar los layouts al navegar entre rutas
 *     hermanas, así que un acceso revocado sobrevive hasta que se recargue.
 *
 * La frontera real son `consultar()` y `accionProtegida()`, que verifican en
 * cada lectura y en cada escritura. Lo de aquí es que nadie se quede mirando
 * un sistema al que no puede entrar.
 */
export default async function LayoutSistema({ children }: { children: ReactNode }) {
  const sesion = await sesionActual();

  if (sesion.estado === "sin-sesion") redirect("/sign-in");

  if (sesion.estado === "sin-acceso") {
    // La identidad y el usuarioId los resuelve la base a partir del token.
    await registrarAccesoDenegado();
    redirect("/acceso-denegado");
  }
  
  const miCuenta = usuarioTienePermiso(sesion.usuario, "cuenta:editar")
    ? consultarMiCuenta().catch((error: unknown) => {
        console.error("Fallo al leer las preferencias:", error);
        return null;
      })
    : null;

  // Se actualizan al recargar o al volver a la pestaña: el layout no se vuelve a ejecutar al navegar
  const contadores = usuarioTienePermiso(sesion.usuario, "catalogos:leer")
    ? consultar("catalogos:leer", (db, yo) => leerContadores(db, (permiso) => usuarioTienePermiso(yo, permiso))).catch((error: unknown) => {
        console.error("Fallo al contar lo pendiente de la barra lateral:", error);
        return {};
      })
    : null;

  return (
    <>
      <RefrescarAlEnfocar />

      {/* La decisión de permisos se toma aquí, en el servidor. Al cliente solo
          cruza un booleano: la matriz no viaja, y la barra lateral dibuja lo
          que le dicen en vez de decidir quién ve qué. */}
      <Navegacion
        accesos={{
          salidas: usuarioTienePermiso(sesion.usuario, "salidas:leer"),
          traspasos: usuarioTienePermiso(sesion.usuario, "traspasos:leer"),
          devoluciones: usuarioTienePermiso(sesion.usuario, "devoluciones:leer"),
          prestamos: usuarioTienePermiso(sesion.usuario, "devoluciones:leer") && usuarioTienePermiso(sesion.usuario, "salidas:leer"),
          ajustes: usuarioTienePermiso(sesion.usuario, "ajustes:leer"),
          reportes: usuarioTienePermiso(sesion.usuario, "reportes:leer"),
          usuarios: usuarioTienePermiso(sesion.usuario, "usuarios:administrar"),
        }}
        sesion={<ControlesSesion rol={sesion.usuario.rol} miCuenta={miCuenta} />}
        contadores={contadores}
      >
        {children}
      </Navegacion>
    </>
  );
}
