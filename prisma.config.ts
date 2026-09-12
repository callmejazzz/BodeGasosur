import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 saca la URL de conexión del schema.prisma y la trae aquí.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  // Sin `seed`: `migrate reset` no siembra nada implícito. Lo que entra a la
  // base lo encadenan `db:reset` (desarrollo) y `prod:bootstrap` (producción),
  // cada uno con lo suyo — ver package.json.
  migrations: {
    path: "prisma/migrations",
  },
});
