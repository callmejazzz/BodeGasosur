import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

/**
 * El commit corto del build, leído de .git sin el programa git, que la imagen no trae.
 * El .dockerignore deja pasar solo HEAD y las refs; sin .git, queda vacío y se muestra solo la versión.
 */
function commitDelBuild(): string {
  try {
    const head = readFileSync(".git/HEAD", "utf8").trim();
    if (!head.startsWith("ref: ")) return head.slice(0, 7);
    const ref = head.slice(5);
    try {
      return readFileSync(`.git/${ref}`, "utf8").trim().slice(0, 7);
    } catch {
      const linea = readFileSync(".git/packed-refs", "utf8").split("\n").find((l) => l.endsWith(` ${ref}`));
      return linea ? linea.slice(0, 7) : "";
    }
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  // Imagen mínima para un contenedor con `node server.js` (Dockerfile). El
  // deploymentId lo fija NEXT_DEPLOYMENT_ID en el build, no aquí.
  output: "standalone",
  // La app no usa next/image: /_next/image responde 404 y sharp no procesa
  // nada que llegue de la red.
  images: { unoptimized: true },
  env: { COMMIT_DEL_BUILD: commitDelBuild() },
};

export default nextConfig;
