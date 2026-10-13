#!/usr/bin/env bash
# Aplica las migraciones a una base remota (Supabase) desde un contenedor Linux.
#
# En macOS, el motor de migraciones de Prisma valida TLS con el sistema, que
# rechaza el certificado de Supabase (cinco años de vigencia, sin EKU
# serverAuth). OpenSSL en Linux lo verifica con el mismo CA. pg, en los demás
# scripts, ya usa OpenSSL y no necesita esto.
#
# Solo DATABASE_URL_MIGRACIONES entra al contenedor, por un archivo temporal que
# se borra al salir. Se lee del archivo indicado y no del entorno, que en una
# terminal de VS Code puede traer las variables del .env local.
#
# Uso:  npm run db:migrar-remota -- .env.supabase           (migrate deploy)
#       npm run db:migrar-remota -- .env.supabase status
set -euo pipefail

archivo="${1:?Indica el archivo de entorno, p. ej. .env.supabase}"
accion="${2:-deploy}"
case "$accion" in deploy | status) ;; *) echo "✗ Acción desconocida: $accion (deploy o status)" >&2; exit 1 ;; esac
cd "$(dirname "$0")/.."

temporal="$(mktemp)"
trap 'rm -f "$temporal"' EXIT
chmod 600 "$temporal"

# El CA se monta en /app/certificates: la URL se reescribe con esa ruta.
node -e '
  const { parse } = require("dotenv");
  const url = parse(require("fs").readFileSync(process.argv[1])).DATABASE_URL_MIGRACIONES;
  if (!url) { console.error("✗ " + process.argv[1] + " no define DATABASE_URL_MIGRACIONES."); process.exit(1); }
  const u = new URL(url);
  if (["localhost", "127.0.0.1"].includes(u.hostname)) { console.error("✗ Es una base local: usa npx prisma migrate deploy."); process.exit(1); }
  const ca = u.searchParams.get("sslrootcert");
  if (ca) u.searchParams.set("sslrootcert", "/app/certificates/" + require("path").basename(ca));
  process.stdout.write("DATABASE_URL_MIGRACIONES=" + u.toString() + "\n");
' "$archivo" > "$temporal"

docker build -q --target dependencias -t bodegasosur:dependencias . > /dev/null
docker run --rm --env-file "$temporal" \
  -v "$PWD/prisma:/app/prisma:ro" \
  -v "$PWD/prisma.config.ts:/app/prisma.config.ts:ro" \
  -v "$PWD/certificates:/app/certificates:ro" \
  bodegasosur:dependencias npx prisma migrate "$accion"
