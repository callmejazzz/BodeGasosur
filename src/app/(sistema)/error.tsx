"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, EstadoVacio } from "@/components/ui/superficies";
import { DIGEST } from "@/lib/mensajes";

const NEGATIVAS: Record<string, { titulo: string; descripcion: string }> = {
  [DIGEST.sinPermiso]: {
    titulo: "No tienes permiso para ver esta pantalla",
    descripcion: "Tu rol no incluye esta consulta. Si la necesitas, pide al Superadmin que revise tu acceso.",
  },
  [DIGEST.sinSesion]: { titulo: "Tu sesión terminó", descripcion: "Vuelve a iniciar sesión para continuar." },
  [DIGEST.sinAcceso]: { titulo: "Tu usuario ya no tiene acceso", descripcion: "Pide al Superadmin que revise tu acceso al sistema." },
};

const FALLO = {
  titulo: "No se pudo cargar esta pantalla",
  descripcion: "Hubo un fallo del servidor o de la red. Inténtalo de nuevo; si sigue pasando, avisa al Superadmin.",
};

export default function ErrorDelSistema({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const negativa = error.digest ? NEGATIVAS[error.digest] : undefined;

  useEffect(() => {
    if (!negativa) console.error(error);
  }, [error, negativa]);

  // Un error del servidor se vuelve a pedir: reset solo no repite la lectura
  const reintentar = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });

  return (
    <Card>
      <EstadoVacio
        titulo={(negativa ?? FALLO).titulo}
        descripcion={(negativa ?? FALLO).descripcion}
        accion={
          <div className="flex flex-wrap justify-center gap-2">
            {!negativa && <Button onClick={reintentar}>Reintentar</Button>}
            {error.digest === DIGEST.sinSesion ? (
              <ButtonLink href="/sign-in">Iniciar sesión</ButtonLink>
            ) : (
              <ButtonLink href="/" variante="secundario">Ir al tablero</ButtonLink>
            )}
          </div>
        }
      />
    </Card>
  );
}
