# Fase 2 — Cimientos corregidos

| Campo | Referencia |
|---|---|
| Estado | Construida |
| Versión | `v0.2.0` |
| Commits | `04986fe` — implementación; `4bfab71` — corrección de `db:reset` |
| Etiqueta Git | `v0.2.0` → `4bfab71` |

## Construido

- Llaves primarias UUIDv7 y claves de negocio inmutables.
- Esquema compartido `catalogo_gasosur`, vistas versionadas y rol lector.
- Modelo de movimientos con fechas calendario, actores y marcas de transición.
- Tablas de capas PEPS, consumos, bitácora y eventos de acceso/webhook.
- Invariantes expresados como `CHECK`, índices y triggers de PostgreSQL.
- Auditoría de cambios, control de bajas y secuencias para claves de negocio.
- Ensamblado reproducible del SQL que Prisma no puede describir.

## Archivos principales

| Archivo | Función |
|---|---|
| [`prisma/schema.prisma`](../../prisma/schema.prisma) | Modelo canónico |
| [`prisma/sql/antes/00-secuencias.sql`](../../prisma/sql/antes/00-secuencias.sql) | Secuencias y funciones previas al DDL |
| [`prisma/sql/despues/10-invariantes.sql`](../../prisma/sql/despues/10-invariantes.sql) | Reglas de integridad |
| [`prisma/sql/despues/20-bitacora.sql`](../../prisma/sql/despues/20-bitacora.sql) | Bitácora por trigger |
| [`prisma/sql/despues/30-inmutabilidad.sql`](../../prisma/sql/despues/30-inmutabilidad.sql) | Inmutabilidad y transiciones protegidas |
| [`prisma/sql/despues/40-bajas.sql`](../../prisma/sql/despues/40-bajas.sql) | Reglas de baja lógica |
| [`prisma/sql/despues/50-catalogo-compartido.sql`](../../prisma/sql/despues/50-catalogo-compartido.sql) | Vistas y rol de solo lectura |
| [`scripts/armar-migracion.sh`](../../scripts/armar-migracion.sh) | Construcción de la migración inicial |

La migración vigente es
[`20260919135100_inicial`](../../prisma/migrations/20260919135100_inicial/migration.sql):
incorpora estas reglas y las ampliaciones de fases posteriores.

## Cambio respecto al plan anterior

El plan de la demo colocaba Entradas en este punto. El levantamiento y la auditoría
obligaron a insertar primero esta corrección estructural para que las fases de movimientos
no escribieran sobre un modelo inválido.
