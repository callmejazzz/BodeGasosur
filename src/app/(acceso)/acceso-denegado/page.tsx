import { SignOutButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";

/**
 * Dónde aterriza quien tiene sesión válida en Clerk y no tiene fila en `Usuario`.
 *
 * No es una pantalla de error: es la respuesta correcta del sistema. Se explica
 * con esas palabras para que la persona no crea que algo se rompió, y lleva el
 * botón de cerrar sesión porque sin él se queda atrapada.
 */
export default async function PaginaAccesoDenegado() {
  const identidad = await currentUser();
  const correo = identidad?.primaryEmailAddress?.emailAddress;

  return (
    <div className="w-full max-w-md rounded-xl border border-border bg-surface p-7 shadow-sm">
      <h1 className="text-lg font-semibold text-foreground">Tu cuenta todavía no tiene acceso</h1>

      <p className="mt-3 text-sm leading-relaxed text-muted-strong">
        Entraste correctamente{correo ? <> como <span className="font-medium">{correo}</span></> : null},
        pero BodeGasosur aún no te tiene dado de alta. Tener cuenta y tener acceso son
        cosas distintas: el acceso lo concede el Superadmin desde la pantalla de usuarios.
      </p>

      <p className="mt-3 text-sm leading-relaxed text-muted">
        Pide que te den de alta y vuelve a entrar. El intento quedó registrado.
      </p>

      <div className="mt-6 border-t border-border pt-5">
        {/* redirectUrl explícito: sin él, cerrar sesión deja a la persona
            mirando este mismo aviso, porque (acceso) no tiene puerta que
            la mueva de aquí. */}
        <SignOutButton redirectUrl="/sign-in">
          <button className="h-9 w-full rounded-md border border-border-strong bg-surface text-sm font-medium text-foreground transition-colors hover:bg-surface-muted">
            Cerrar sesión
          </button>
        </SignOutButton>
      </div>
    </div>
  );
}
