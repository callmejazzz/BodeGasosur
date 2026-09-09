import type { ReactNode } from "react";

/**
 * Las pantallas de acceso: entrar, registrarse y el aviso de acceso denegado.
 *
 * No lleva barra lateral y no verifica nada. Las dos cosas son deliberadas: a
 * quien todavía no entró no se le enseña el menú del sistema, y si este grupo
 * tuviera puerta, /acceso-denegado se redirigiría a sí misma para siempre.
 */
export default function LayoutAcceso({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="text-center">
        <p className="text-2xl leading-tight font-semibold text-primary">BodeGasosur</p>
        <p className="mt-1 text-sm text-muted">Control de inventario · Grupo Gasosur</p>
      </div>
      {children}
    </div>
  );
}
