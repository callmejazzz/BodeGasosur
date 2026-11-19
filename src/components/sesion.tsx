"use client";

import { UserButton } from "@clerk/nextjs";
import { SlidersHorizontal } from "lucide-react";
import { Suspense } from "react";
import { guardarPreferencia } from "@/app/(sistema)/cuenta/actions";
import { Preferencias } from "@/components/cuenta/preferencias";
import type { MiCuenta } from "@/lib/cuenta/formulario";

/**
 * Controles de sesión de la barra lateral.
 *
 * Ya no tiene rama de «sin sesión»: solo se dibuja dentro de (sistema), donde
 * la puerta del layout garantiza que hay alguien con fila en `Usuario`. Los
 * botones de entrar y registrarse desaparecieron por construcción, no por una
 * bandera que haya que acordarse de apagar.
 *
 * Debajo del nombre va la versión con su commit: así un reporte dice qué versión
 * estaba viendo quien lo hace.
 *
 * `miCuenta` es null sin `cuenta:editar`: entonces el perfil no lleva el
 * apartado «Preferencias».
 */
export function ControlesSesion({ version, miCuenta }: { version: string; miCuenta: Promise<MiCuenta | null> | null }) {
  return (
    <div className="mt-4 border-t border-white/10 px-3 pt-4">
      <UserButton
        showName
        // Clerk pone sus estilos fuera de las capas de Tailwind: sin «!» ganan los suyos
        appearance={{
          elements: {
            rootBox: "w-full!",
            userButtonTrigger: "w-full!",
            userButtonBox: "w-full! justify-between!",
            userButtonOuterIdentifier: "min-w-0! truncate! pl-1! text-sm! text-white!",
            userButtonAvatarBox: "shrink-0!",
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
      <p className="mt-1.5 pl-1 text-xs text-white/40 tabular-nums">{version}</p>
    </div>
  );
}
