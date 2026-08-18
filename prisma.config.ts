import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 saca la URL de conexión del schema.prisma y la trae aquí.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
