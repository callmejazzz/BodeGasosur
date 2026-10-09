# Fase 4 — Migración de catálogos (Plan B)

| Campo        | Referencia           |
| ------------ | -------------------- |
| Estado       | Construida           |
| Versión      | `v0.4.0`             |
| Commit       | `9ea85b5`            |
| Etiqueta Git | `v0.4.0` → `9ea85b5` |

## Construido

- Importación real de 21 empresas, 32 estaciones y 2 personas.
- Importador en dos pasadas, transaccional e idempotente.
- Modos `--simular` y `--sincronizar`, con detección de divergencias.
- Perfil de desarrollo con fixtures y perfil de producción sin datos operativos.
- `prod:bootstrap` con validación de entorno, confirmación y migración controlada.
- Normalización de RFC y unicidad normalizada de nombres.
- Pruebas de integración sobre PostgreSQL real para alta, repetición, divergencia,
  rollback y sincronización explícita.

## Archivos principales

| Archivo | Función |
|---|---|
| [Plan B para producción](../contratos-otros/01-plan-b-produccion.md) | Decisión operativa de producción |
| [`prisma/migracion-datos/`](../../prisma/migracion-datos/) | Importador, CSV y pruebas |
| [`prisma/configuracion.ts`](../../prisma/configuracion.ts) | Configuración mínima compartida |
| [`prisma/fixtures.ts`](../../prisma/fixtures.ts) | Datos exclusivos de desarrollo |
| [`scripts/bootstrap-produccion.ts`](../../scripts/bootstrap-produccion.ts) | Arranque seguro de producción |
| [`pruebas/base-de-pruebas.ts`](../../pruebas/base-de-pruebas.ts) | Recreación de la base de integración |
| [`src/lib/rfc.ts`](../../src/lib/rfc.ts) | Regla única para RFC |

## Cambio respecto al plan anterior

La migración completa del Excel se descartó. Producción arranca sin proveedores, artículos
ni existencias; Compras los captura en la aplicación. La fase solo migra el catálogo global
confiable y deja una futura carga operativa como tarea independiente.
