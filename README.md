# BodeGasosur

Sistema de control de inventario para las bodegas del grupo gasolinero **Gasosur**.

Controla la entrada y salida de material entre bodegas y estaciones, registrando hacia qué estación se envía, quién lo autoriza, quién lo entrega, cuándo, en qué cantidad, a qué costo unitario, a qué área se destina y con qué observaciones.

**Versión actual: `v0.5.0`** - ver [CHANGELOG.md](CHANGELOG.md).

**Estado:** fases 0 a 6 construidas en desarrollo. Salidas ya tiene pantallas, dominio transaccional, conciliación SQL y Server Actions con pruebas; siguen los traspasos de la fase 7. Ver [entregables por fase](docs/entregables-fases/README.md).

**Entorno:** local mientras dure el desarrollo. Dónde se despliega se decide antes de la
`v1.0.0` — ver [versionado y despliegue](docs/05-versionado-y-despliegue.md) y el hallazgo
**D1** de la [auditoría](docs/cimientos-word/04-auditoria-arquitectura.docx).

## Arranque

Requiere Node 20+ y Docker.

```bash
npm install
cp .env.example .env      # Asigna un nombre y puerto propios antes de seguir.
npm run db:up
npm run db:reset
npm run dev
```

Cada desarrollador tiene que usar su propio `COMPOSE_PROJECT_NAME`, `POSTGRES_PORT` y
`POSTGRES_DB` en `.env`; las dos URLs de base deben referirse a ese mismo nombre y puerto.
Así Docker crea un contenedor y volumen independientes y `db:reset` solo borra esa base
local. La guía completa, incluida la forma de entrar como Superadmin en un entorno de
desarrollo aislado, está en [colaboración de desarrollo](docs/decisiones-otros/03-colaboracion-desarrollo.md).

La aplicación queda en <http://localhost:3000>.

> PostgreSQL se publica en el puerto definido por `POSTGRES_PORT` (5433 por omisión),
> para no chocar con una instalación local que ocupe el 5432.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run db:up` / `db:down` | Levanta o baja PostgreSQL |
| `npm run db:reset` | **Desarrollo.** Borra todo, remigra, crea el usuario de ejecución, carga las llaves públicas de Clerk y encadena configuración, catálogos reales, fixtures y Superadmin |
| `npm run prod:bootstrap` | **Producción.** Manual y con confirmación: migraciones, usuario de ejecución, llaves de Clerk, configuración, catálogos reales y Superadmin. Sin fixtures — ver [Plan B](docs/decisiones-otros/01-plan-b-produccion.md) |
| `npm run db:usuario-app` / `db:llaves-clerk` | Crea el usuario de ejecución sin propiedad y carga manualmente las llaves públicas de Clerk |
| `npm run db:configuracion` | Bodegas, áreas, unidad `PZA` y folios. Solo crea lo que falta |
| `npm run datos:migrar` | Empresas, estaciones y personas desde `prisma/migracion-datos/`. Se detiene ante divergencias; `-- --sincronizar` sobrescribe, `-- --simular` solo muestra |
| `npm run db:fixtures` | Datos demostrativos para probar movimientos. Exigen `BODEGASOSUR_FIXTURES=permitidos` y una base sin operación |
| `npm run test` | Pruebas de integración contra PostgreSQL, en una base `*_prueba` que se recrea en cada corrida |
| `npm run db:studio` | Explorador visual de la base de datos |

### Migraciones

Los invariantes del sistema viven en la base como `CHECK` y triggers, y Prisma no sabe
expresarlos. Ese SQL se escribe a mano en `prisma/sql/` y se arma dentro de la migración:

```bash
./scripts/armar-migracion.sh nombre-de-la-migracion
```

El script junta `prisma/sql/antes/`, el DDL que genera Prisma desde `schema.prisma`, y
`prisma/sql/despues/`. Ver [arquitectura](docs/01-arquitectura.md) §5.

## Qué hay construido

- **Nueve catálogos** con alta, edición, búsqueda y baja lógica: empresas, bodegas, estaciones, áreas, unidades de medida, categorías, artículos, proveedores y personas.
- **Modelo de datos completo** — 19 modelos en dos esquemas de PostgreSQL, con los invariantes escritos en la base: existencia nunca negativa, autorización verificada en el instante del acto y de escritura única, claves de negocio inmutables, y una bitácora alimentada por trigger para los cambios de negocio en las tablas auditadas.
- **Entradas completas en el trabajo local** — listado, captura y edición de borradores, confirmación con folio, capas de costo, existencias y Server Actions protegidas. Los importes se calculan en PostgreSQL.
- **Salidas completas en el trabajo local** — solicitud, autorización, rechazo, cancelación, retiro PEPS y recepción, con lista filtrable y paginada, bandeja de pendientes, captura y detalle. Las Server Actions, la conciliación SQL y las pruebas protegen el flujo.
- **Actor verificable en desarrollo** — cada escritura protegida de un usuario liga en PostgreSQL un JWT RS256 de Clerk a su transacción. La bitácora y las columnas de actor usan esa identidad; las escrituras ordinarias sin liga se rechazan. Producción se desplegará al cerrar los entregables.
- **Tablero** con el avance por fases y los datos base cargados.

Los traspasos, devoluciones y conteos siguen en la fase 7. El [contrato de la fase 6](docs/decisiones-otros/04-fase-6-salidas.md) documenta el flujo de salidas construido.

**Empresas, estaciones y dos personas son las reales de Gasosur**, cargadas por [`prisma/migracion-datos/`](prisma/migracion-datos/README.md). **Artículos y proveedores son fixtures de desarrollo** (`prisma/fixtures.ts`) para probar movimientos, kardex y PEPS; producción arranca sin ellos, por el [Plan B](docs/decisiones-otros/01-plan-b-produccion.md).

## Documentación

| Documento | Contenido |
|---|---|
| [Arquitectura](docs/01-arquitectura.md) | Stack, principios rectores, capas y entorno local |
| [Modelo de datos](docs/02-modelo-de-datos.md) | Entidades, estados, invariantes, costeo PEPS y permisos |
| [Levantamiento de requerimientos](docs/cimientos-word/01-levantamiento-de-requerimientos.docx) | Cuestionario aplicado a Compras y método de levantamiento |
| [Plan de la demo](docs/cimientos-word/02-plan-demo.docx) | Plan original — referencia histórica; el estado vigente está en [entregables por fase](docs/entregables-fases/README.md) |
| [Hallazgos del levantamiento](docs/cimientos-word/03-hallazgos-levantamiento.docx) | Respuestas de Compras, veredicto de supuestos y cambios derivados |
| [Empresas y estaciones](docs/03-estaciones.md) | Catálogo global del grupo: 21 empresas, 32 estaciones |
| [Inventario actual](docs/04-datos-actuales.md) | Análisis del Excel vigente y plan de migración |
| [Versionado y despliegue](docs/05-versionado-y-despliegue.md) | Política de versiones y ramas |
| [Auditoría de arquitectura](docs/cimientos-word/04-auditoria-arquitectura.docx) | Revisión de las bases, con lo que se resolvió y lo que sigue abierto |
| [Plan B para producción](docs/decisiones-otros/01-plan-b-produccion.md) | Producción arranca sin inventario; los dos perfiles de base |
| [Contrato de la Fase 5](docs/decisiones-otros/02-fase-5-entradas.md) | Funcionamiento, decisiones, seguridad, pruebas y orden de implementación de entradas |
| [Contrato de la Fase 6](docs/decisiones-otros/04-fase-6-salidas.md) | Estados, permisos, PEPS, seguridad y pruebas de salidas |
| [Colaboración de desarrollo](docs/decisiones-otros/03-colaboracion-desarrollo.md) | Alta de desarrolladores, Clerk y bases locales aisladas |
| [Cambios](CHANGELOG.md) | Qué trae cada versión, escrito para quien usa el sistema |
| **[Entregables por fase](docs/entregables-fases/README.md)** | **Estado y plan de las fases** |

## Stack

Next.js 16 · TypeScript · Prisma 7 · PostgreSQL 16 · Tailwind CSS 4 · Clerk
