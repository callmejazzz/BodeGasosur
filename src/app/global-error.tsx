"use client";

import "./globals.css";
import { Button } from "@/components/ui/button";

// Si falla el layout raíz, esta página lo reemplaza: por eso trae su propio html y body
export default function ErrorGlobal({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="flex min-h-full items-center justify-center bg-background px-4 py-10 text-foreground">
        <main className="w-full max-w-md rounded-lg border border-border bg-surface px-6 py-10 text-center shadow-sm">
          <h1 className="text-base font-semibold">BodeGasosur no pudo cargar</h1>
          <p className="mt-2 text-sm text-muted">Hubo un fallo del servidor o de la red. Inténtalo de nuevo; si sigue pasando, avisa al Superadmin.</p>
          <Button className="mt-5" onClick={() => reset()}>
            Reintentar
          </Button>
        </main>
      </body>
    </html>
  );
}
