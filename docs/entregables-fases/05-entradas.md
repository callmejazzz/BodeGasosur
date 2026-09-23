# Fase 5 — Entradas

| Campo | Referencia |
|---|---|
| Estado | Construida |
| Versión | `v0.5.0` en `main` desde `d831f1e` |
| Commit histórico | `4a46976`, retirado de `main`; entrega vigente `d831f1e` |
| Etiqueta Git | Pendiente; no existe `v0.5.0` en el repositorio |
| Contrato | [Fase 5: Entradas](../decisiones-otros/02-fase-5-entradas.md) |

## Construido

- Alta idempotente de borradores y edición completa de encabezado y partidas.
- Captura por unidad o caja, conservando presentación, factor y orden originales.
- Moneda MXN/USD, tipo de cambio, IVA y totales exactos calculados en PostgreSQL.
- Confirmación transaccional con folio, capas de costo y actualización de existencias.
- Bloqueos ordenados, validación de capacidad y protección contra doble clic o carreras.
- Descarte de borradores y detalle de entradas confirmadas.
- Listado con búsqueda tolerante, filtros combinables, rango de fechas y paginación.
- Server Actions protegidas para crear, guardar, confirmar y descartar.
- Formularios controlados que conservan la captura después de una acción.
- Consultas relacionales en una sola sentencia mediante `relationJoins`.
- 142 pruebas sobre esquema, servicios, acciones, repositorios y PostgreSQL real.

## Archivos principales

| Área | Archivos |
|---|---|
| Dominio | [`src/lib/entradas/`](../../src/lib/entradas/) |
| Server Actions y páginas | [`src/app/(sistema)/entradas/`](<../../src/app/(sistema)/entradas/>) |
| Interfaz | [`src/components/entradas/`](../../src/components/entradas/) |
| Calendario de rango | [`src/components/ui/selector-rango.tsx`](../../src/components/ui/selector-rango.tsx) |
| Fecha operativa | [`src/lib/fechas.ts`](../../src/lib/fechas.ts) |
| Dinero | [`prisma/sql/despues/60-dinero.sql`](../../prisma/sql/despues/60-dinero.sql) |
| Búsqueda | [`prisma/sql/despues/70-busqueda.sql`](../../prisma/sql/despues/70-busqueda.sql) |
| Esquema e invariantes | [`prisma/schema.prisma`](../../prisma/schema.prisma), [`prisma/sql/despues/10-invariantes.sql`](../../prisma/sql/despues/10-invariantes.sql) y [`30-inmutabilidad.sql`](../../prisma/sql/despues/30-inmutabilidad.sql) |
| Pruebas de frontera | [`prisma/sql/fase5-esquema.test.ts`](../../prisma/sql/fase5-esquema.test.ts), [`prisma/relaciones-en-transaccion.test.ts`](../../prisma/relaciones-en-transaccion.test.ts) y [`src/app/(sistema)/entradas/actions.test.ts`](<../../src/app/(sistema)/entradas/actions.test.ts>) |

## Referencias de trabajo anteriores

El cierre consolidado `4a46976` y los commits previos se retiraron de `main` al volver
a `9ea85b5`. Estos SHA sirven como referencia histórica del trabajo local; la rama
`respaldo-fase-5-previo-squash` ya fue eliminada.

- `d58b0f6` — fechas y permisos.
- `155dfe6` — contrato de la fase.
- `c5cfab4` — esquema y restricciones.
- `a687443` — primitivas, servicio y pruebas.
- `4ec0522` — aislamiento de entornos.
- `8868d59` — esquema Zod y estado de formulario.
- `c641024` — migración, pantallas y Server Actions.

## Ajustes respecto al plan inicial de la fase

Además de la captura y confirmación previstas, la implementación incorporó idempotencia,
concurrencia, dinero exacto, formulario controlado, filtros combinables, paginación y
`relationJoins`. Estas piezas cerraron problemas observados durante las pruebas y quedaron
dentro del contrato definitivo de la fase.
