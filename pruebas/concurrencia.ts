import { Client } from "pg";

// Carreras deterministas: una conexión aparte sostiene un candado y se espera
// a que PostgreSQL diga quién quedó detrás de ella, sin temporizadores.

export type Conexion = Client & { pid: number };

export async function conexion(url: string): Promise<Conexion> {
  const cliente = new Client({ connectionString: url }) as Conexion;
  await cliente.connect();
  cliente.pid = (await cliente.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  return cliente;
}

/** El pid de la primera sesión que quede esperando un candado de `pid`. */
export async function bloqueadaPor(observador: Client, pid: number): Promise<number> {
  for (let intento = 0; intento < 200; intento++) {
    const { rows } = await observador.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
      [pid],
    );
    if (rows[0]) return rows[0].pid;
    await new Promise((listo) => setTimeout(listo, 20));
  }
  throw new Error(`Ninguna sesión quedó esperando a ${pid}.`);
}

/** El desenlace de una promesa sin dejarla rechazada y sin atender mientras se espera. */
export function desenlace<T>(promesa: Promise<T>): Promise<{ ok: true; valor: T } | { ok: false; error: unknown }> {
  return promesa.then(
    (valor) => ({ ok: true as const, valor }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}
