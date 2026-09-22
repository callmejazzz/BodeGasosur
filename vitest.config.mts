import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Las pruebas que valen aquí son de integración contra el PostgreSQL real de
// docker-compose (auditoría, E1), en una base aparte que se destruye y se
// vuelve a crear en cada corrida: pruebas/base-de-pruebas.ts.
export default defineConfig({
  // El alias @/ de tsconfig, para que los servicios se prueben tal como se importan.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["prisma/**/*.test.ts", "scripts/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["pruebas/base-de-pruebas.ts"],
    // Una sola base compartida: los archivos de prueba corren uno a la vez.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
