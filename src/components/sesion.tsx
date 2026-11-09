"use client";

import { UserButton } from "@clerk/nextjs";
import type { Rol } from "@prisma/client";
import { SlidersHorizontal } from "lucide-react";
import { Suspense } from "react";
import { guardarPreferencia } from "@/app/(sistema)/cuenta/actions";
import { Preferencias } from "@/components/cuenta/preferencias";
import type { MiCuenta } from "@/lib/cuenta/formulario";

const ETIQUETA_ROL: Record<Rol, string> = {
  SUPERADMIN: "Superadmin",
  COMPRAS: "Compras",
  JEFE: "Jefe",
};

/**
 * Controles de sesión de la barra lateral.
 *
 * Ya no tiene rama de «sin sesión»: solo se dibuja dentro de (sistema), donde
 * la puerta del layout garantiza que hay alguien con fila en `Usuario`. Los
 * botones de entrar y registrarse desaparecieron por construcción, no por una
 * bandera que haya que acordarse de apagar.
 *
 * El rol se muestra porque se leyó de PostgreSQL en esta misma petición, no de
 * un claim de Clerk: es visible que la autorización no viaja en el token.
 *
 * `miCuenta` es null sin `cuenta:editar`: entonces el perfil no lleva el
 * apartado «Preferencias».
 */
export function ControlesSesion({ rol, miCuenta }: { rol: Rol; miCuenta: Promise<MiCuenta | null> | null }) {
  return (
    <div className="mt-4 border-t border-white/10 px-3 pt-4">
      <UserButton
        showName
        appearance={{
          elements: {
            userButtonBox: "flex-row-reverse gap-2",
            userButtonOuterIdentifier: "text-sm text-white/80",
          },
        }}
      >
        {miCuenta && (
          <UserButton.UserProfilePage label="Preferencias" url="preferencias" labelIcon={<SlidersHorizontal className="size-4" />}>
            <Suspense fallback={<p className="text-sm text-muted">Cargando…</p>}>
              <Preferencias cuenta={miCuenta} accion={guardarPreferencia} />
            </Suspense>
          </UserButton.UserProfilePage>
        )}
      </UserButton>
      <p className="mt-1.5 pl-1 text-xs text-white/40">{ETIQUETA_ROL[rol]}</p>
    </div>
  );
}
