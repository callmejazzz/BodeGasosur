import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Card, EstadoVacio } from "@/components/ui/superficies";

export const metadata: Metadata = { title: "Página no encontrada — BodeGasosur" };

// Una dirección que no existe: fuera del sistema, sin barra lateral
export default function NoEncontrado() {
  return (
    <main className="flex min-h-full w-full items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <EstadoVacio
          titulo="Esta página no existe"
          descripcion="Revisa la dirección o vuelve al tablero."
          accion={<ButtonLink href="/">Ir al tablero</ButtonLink>}
        />
      </Card>
    </main>
  );
}
