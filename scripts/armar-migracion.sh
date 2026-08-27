#!/usr/bin/env bash
#
# Arma prisma/migrations/<sello>_inicial/migration.sql a partir de tres piezas:
#
#   prisma/sql/antes/*.sql     lo que tiene que existir antes de las tablas
#   (generado por Prisma)      el DDL que sale de schema.prisma
#   prisma/sql/despues/*.sql   invariantes, triggers, vistas y permisos
#
# Existe porque Prisma no sabe expresar un CHECK, un trigger ni un GRANT, y
# porque pegar 300 líneas de SQL a mano al final de un archivo generado las
# vuelve irrevisables. Aquí el SQL a mano se lee como código, en archivos con
# nombre, y la migración sigue siendo un solo artefacto.
#
# Uso:  ./scripts/armar-migracion.sh [nombre-de-la-migracion]

set -euo pipefail
cd "$(dirname "$0")/.."

NOMBRE="${1:-inicial}"
SELLO="$(date +%Y%m%d%H%M%S)"
DESTINO="prisma/migrations/${SELLO}_${NOMBRE}"

mkdir -p "$DESTINO"
SALIDA="$DESTINO/migration.sql"

{
  echo "-- BodeGasosur — migración «${NOMBRE}»"
  echo "-- Armada por scripts/armar-migracion.sh. No editar a mano:"
  echo "-- el SQL a mano vive en prisma/sql/ y se vuelve a armar desde ahí."
  echo
  echo "-- ═══ prisma/sql/antes ═══"
  echo
  cat prisma/sql/antes/*.sql
  echo
  echo "-- ═══ generado desde schema.prisma ═══"
  echo
} > "$SALIDA"

npx prisma migrate diff \
  --from-empty \
  --to-schema prisma/schema.prisma \
  --script >> "$SALIDA"

{
  echo
  echo "-- ═══ prisma/sql/despues ═══"
  echo
  cat prisma/sql/despues/*.sql
} >> "$SALIDA"

echo "Migración armada: $SALIDA ($(wc -l < "$SALIDA" | tr -d ' ') líneas)"
