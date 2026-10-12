// Readiness y liveness del contenedor. No consulta la base a propósito: si
// Supabase cae, reiniciar la aplicación en bucle no arregla nada.
export function GET() {
  return Response.json({ estado: "ok" });
}
