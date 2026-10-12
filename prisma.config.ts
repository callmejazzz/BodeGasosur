import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 saca la URL de conexión del schema.prisma y la trae aquí.
export default defineConfig({
  schema: "prisma/schema.prisma",
  // Las migraciones corren como el dueño del esquema; la aplicación, con
  // DATABASE_URL, como un usuario sin propiedad (90-privilegios.sql).
  // process.env y no env(): `prisma generate` corre en el build de la imagen,
  // donde la credencial del dueño no existe; migrate falla sin ella.
  datasource: {
    url: paraElMotorDePrisma(process.env.DATABASE_URL_MIGRACIONES),
  },
  // Sin `seed`: `migrate reset` no siembra nada implícito. Lo que entra a la
  // base lo encadenan `db:reset` (desarrollo) y `prod:bootstrap` (producción),
  // cada uno con lo suyo — ver package.json.
  migrations: {
    path: "prisma/migrations",
  },
});

// Las URL siguen la convención de libpq y pg: sslmode=verify-full&sslrootcert=<CA>.
// El motor de migraciones de Prisma ignora verify-full sin avisar (cae a sin
// TLS si el servidor no lo ofrece) y llama sslcert al CA: se traduce aquí.
function paraElMotorDePrisma(url: string | undefined): string | undefined {
  if (!url) return url;
  const u = new URL(url);
  if (u.searchParams.get("sslmode") !== "verify-full") return url;
  const ca = u.searchParams.get("sslrootcert");
  if (!ca) throw new Error("sslmode=verify-full necesita sslrootcert con la ruta del CA (certificates/README.md).");
  u.searchParams.delete("sslrootcert");
  u.searchParams.set("sslmode", "require");
  u.searchParams.set("sslcert", ca);
  u.searchParams.set("sslaccept", "strict");
  return u.toString();
}
