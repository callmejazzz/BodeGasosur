import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 saca la URL de conexión del schema.prisma y la trae aquí.
export default defineConfig({
  schema: "prisma/schema.prisma",
  // Las migraciones corren como el dueño del esquema; la aplicación, con
  // DATABASE_URL, como un usuario sin propiedad (90-privilegios.sql).
  datasource: {
    url: env("DATABASE_URL_MIGRACIONES"),
  },
  // Sin `seed`: `migrate reset` no siembra nada implícito. Lo que entra a la
  // base lo encadenan `db:reset` (desarrollo) y `prod:bootstrap` (producción),
  // cada uno con lo suyo — ver package.json.
  migrations: {
    path: "prisma/migrations",
  },
});
