// Se ejecuta una vez al arrancar cada servidor de Next.js.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { vigilarLlavesDeClerk } = await import("./lib/seguridad/llaves");
  vigilarLlavesDeClerk();
}
