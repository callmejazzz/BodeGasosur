// Comprueba un token real de la plantilla bodegasosur-db contra las llaves
// cargadas, sin ligarlo a nada: confirma kid, iss, aud y la firma antes de
// depender del verificador.
//
// El token se pega en la terminal y no se muestra. Para obtener uno, con la
// sesión abierta en la aplicación, en la consola del navegador:
//
//   await window.Clerk.session.getToken({ template: "bodegasosur-db" })
//
// Uso:  npm run db:probar-token

import "dotenv/config";
import { Client } from "pg";
import { stdin, stdout } from "node:process";

/** Lee una línea sin eco: el token es una credencial vigente durante un minuto. */
function leerOculto(pregunta: string): Promise<string> {
  return new Promise((resolver, rechazar) => {
    if (!stdin.isTTY) {
      let datos = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (d) => (datos += d));
      stdin.on("end", () => resolver(datos.trim()));
      stdin.on("error", rechazar);
      return;
    }
    stdout.write(pregunta);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let valor = "";
    const alTeclear = (tecla: string) => {
      for (const c of tecla) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", alTeclear);
          stdout.write("\n");
          return resolver(valor.trim());
        }
        if (c === "\u0003") {
          stdin.setRawMode(false);
          return rechazar(new Error("Cancelado."));
        }
        valor = c === "\u007f" ? valor.slice(0, -1) : valor + c;
      }
    };
    stdin.on("data", alTeclear);
  });
}

async function main() {
  const urlDueno = process.env.DATABASE_URL_MIGRACIONES;
  if (!urlDueno) throw new Error("Falta DATABASE_URL_MIGRACIONES.");
  const token = await leerOculto("Pega el token (no se mostrará) y presiona Enter: ");
  if (!token) throw new Error("No se recibió ningún token.");

  const dueno = new Client({ connectionString: urlDueno });
  await dueno.connect();
  try {
    const { rows } = await dueno.query<{ kid: string; sub: string; vida_segundos: number; expira: Date }>(
      "SELECT * FROM seguridad.probar_token($1)",
      [token],
    );
    const r = rows[0];
    console.log("✓ Token válido: firma, kid, iss, aud y tiempos correctos.");
    console.log(`  kid   ${r.kid}`);
    console.log(`  sub   ${r.sub}`);
    console.log(`  vida  ${r.vida_segundos} s (expira ${r.expira.toISOString()})`);
  } catch (error) {
    const e = error as { code?: string; message?: string };
    throw new Error(`Token rechazado (${e.code ?? "sin código"}): ${e.message ?? error}`);
  } finally {
    await dueno.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? `✗ ${e.message}` : e);
  process.exit(1);
});
