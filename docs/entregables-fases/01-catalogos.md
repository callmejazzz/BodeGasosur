# Fase 1 — Catálogos

| Campo | Referencia |
|---|---|
| Estado | Construida |
| Versión | `v0.1.0` |
| Commit de implementación | `fc28e83` |
| Etiqueta Git | `v0.1.0` → `6879a62` |

## Construido

- Catálogos declarativos con alta, edición, búsqueda y baja lógica.
- Una definición compartida produce columnas, controles de formulario y esquema Zod.
- Formularios que conservan la captura cuando falla una acción de servidor.
- Repositorios de lectura y escritura por catálogo.
- Datos demostrativos para operar la primera demo.

## Archivos principales

| Archivo | Función |
|---|---|
| [`src/lib/catalogos/definiciones.ts`](../../src/lib/catalogos/definiciones.ts) | Definición tipada de los catálogos y validación |
| [`src/lib/catalogos/repos.ts`](../../src/lib/catalogos/repos.ts) | Operaciones de persistencia y opciones relacionadas |
| [`src/lib/catalogos/formulario.ts`](../../src/lib/catalogos/formulario.ts) | Estado compartido del formulario |
| [`src/components/catalogos/formulario-catalogo.tsx`](../../src/components/catalogos/formulario-catalogo.tsx) | Formulario genérico |
| [`src/app/(sistema)/catalogos/`](<../../src/app/(sistema)/catalogos/>) | Listados, altas, detalle y edición |
| [`prisma/fixtures.ts`](../../prisma/fixtures.ts) | Datos demostrativos vigentes |

## Ajustes posteriores que afectan esta entrega

- La fase 2 agregó `Empresa` y dejó nueve catálogos sobre el modelo corregido.
- La fase 3 movió las pantallas al grupo `(sistema)` y aplicó permisos por rol.
- La fase 4 sustituyó el antiguo `prisma/seed.ts` por configuración y fixtures separados.
