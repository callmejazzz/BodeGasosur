import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Imagen mínima para un contenedor con `node server.js` (Dockerfile). El
  // deploymentId lo fija NEXT_DEPLOYMENT_ID en el build, no aquí.
  output: "standalone",
};

export default nextConfig;
