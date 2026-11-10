import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Imagen mínima para un contenedor con `node server.js` (Dockerfile). El
  // deploymentId lo fija NEXT_DEPLOYMENT_ID en el build, no aquí.
  output: "standalone",
  // La app no usa next/image: /_next/image responde 404 y sharp no procesa
  // nada que llegue de la red.
  images: { unoptimized: true },
};

export default nextConfig;
