# Fase 0 — Cimientos

| Campo | Referencia |
|---|---|
| Estado | Construida |
| Versión | `v0.1.0` |
| Commit de implementación | `fc28e83` |
| Etiqueta Git | `v0.1.0` → `6879a62` |

## Construido

- Aplicación Next.js 16 con App Router, TypeScript estricto y Tailwind CSS 4.
- PostgreSQL 16 en Docker, expuesto localmente en el puerto `5433`.
- Prisma 7 con `@prisma/adapter-pg` y configuración externa en `prisma.config.ts`.
- Estructura inicial de navegación, layout, componentes visuales y tablero.
- Primer modelo de movimientos, partidas, existencias y folios.

## Archivos principales

| Archivo | Función |
|---|---|
| [`package.json`](../../package.json) | Dependencias, versión y comandos del proyecto |
| [`docker-compose.yml`](../../docker-compose.yml) | PostgreSQL local y base de pruebas |
| [`prisma.config.ts`](../../prisma.config.ts) | Configuración de Prisma 7 |
| [`prisma/schema.prisma`](../../prisma/schema.prisma) | Modelo de datos vigente |
| [`src/app/layout.tsx`](../../src/app/layout.tsx) | Layout raíz |
| [`src/app/globals.css`](../../src/app/globals.css) | Estilos globales |
| [`src/components/ui/`](../../src/components/ui/) | Primitivas visuales reutilizables |

## Ajuste respecto al primer diseño

El modelo inicial de la demo fue reemplazado por la migración corregida de la fase 2. Se
mantuvieron el stack, la estructura de aplicación y las primitivas de interfaz construidas
en esta fase.
