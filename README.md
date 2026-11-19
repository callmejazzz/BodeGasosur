# BodeGasosur

Sistema de control de inventario para las bodegas del grupo gasolinero **Gasosur**.

Controla la entrada y salida de material entre bodegas y estaciones, registrando hacia qué estación se envía, quién lo autoriza, quién lo entrega, cuándo, en qué cantidad, a qué costo unitario, a qué área se destina y con qué observaciones.

**Última versión etiquetada: `v0.9.0`** - ver [CHANGELOG.md](CHANGELOG.md).

**Estado:** fases 0 a 9 construidas. La fase 9 (alerta diaria de stock mínimo por correo, tablero de inicio, pendientes en la barra lateral y acabado para celular) se publica como `v0.9.0`. La fase 8 (cinco reportes, kardex y exportación a Excel de toda tabla) se publicó como `v0.8.0` (commit `58b3f75`). Antes, la fase 7 (traspasos, devoluciones, préstamos, conteo físico y reversas) se publicó como `v0.7.0` (commit `2ac6ca3`), y `v0.7.1` (commit `22c1146`) corrige lo que encontró su revisión. `main` incluye además la corrección del teclado del selector de salidas (`afcea45`), sin etiqueta nueva por decisión del proyecto. Ver [entregables por fase](docs/entregables-fases/README.md).

**Entorno:** local mientras dure el desarrollo. Producción: la aplicación en Sevalla y la
base en Supabase, con Sevalla a prueba una semana — ver [versionado y despliegue](docs/05-versionado-y-despliegue.md) §8.

## Arranque

Requiere Node 24+ y Docker.

```bash
npm install
cp .env.example .env      # Asigna un nombre y puerto propios antes de seguir.
npm run db:up
npm run db:reset
npm run dev
```

Cada desarrollador tiene que usar su propio `COMPOSE_PROJECT_NAME`, `POSTGRES_PORT` y `POSTGRES_DB` en `.env`; las dos URLs de base deben referirse a ese mismo nombre y puerto. Así Docker crea un contenedor y volumen independientes y `db:reset` solo borra esa base local. La guía completa, incluida la forma de entrar como Superadmin en un entorno de desarrollo aislado, está en [colaboración de desarrollo](docs/contratos-otros/03-colaboracion-desarrollo.md).

La aplicación queda en <http://localhost:3000>.

> PostgreSQL se publica en el puerto definido por `POSTGRES_PORT` (5433 por omisión),
> para no chocar con una instalación local que ocupe el 5432.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run db:up` / `db:down` | Levanta o baja PostgreSQL |
| `npm run db:reset` | **Desarrollo.** Borra todo, remigra, crea el usuario de ejecución, carga las llaves públicas de Clerk y encadena configuración, catálogos reales, fixtures y Superadmin |
| `npm run prod:bootstrap` | **Producción.** Manual y con confirmación: migraciones, usuario de ejecución, llaves de Clerk, configuración, catálogos reales y Superadmin. Sin fixtures — ver [Plan B](docs/contratos-otros/01-plan-b-produccion.md) |
| `npm run db:migrar-remota -- <archivo>` | Migraciones pendientes en una base remota (Supabase), desde un contenedor Linux: en macOS Prisma no acepta su certificado. Ver [docs/05](docs/05-versionado-y-despliegue.md) §8 |
| `npm run db:usuario-app` / `db:llaves-clerk` | Crea el usuario de ejecución sin propiedad, o le cambia la contraseña, y carga manualmente las llaves públicas de Clerk |
| `npm run db:configuracion` | Bodegas, áreas, unidad `PZA` y folios. Solo crea lo que falta |
| `npm run datos:migrar` | Empresas, estaciones y personas desde `prisma/migracion-datos/`. Se detiene ante divergencias; `-- --sincronizar` sobrescribe, `-- --simular` solo muestra |
| `npm run db:fixtures` | Datos demostrativos para probar movimientos. Exigen `BODEGASOSUR_FIXTURES=permitidos` y una base sin operación |
| `npm run test` | Pruebas de integración contra PostgreSQL, en una base `*_prueba` que se recrea en cada corrida |
| `npm run db:studio` | Explorador visual de la base de datos |
| `npm run correo:estados -- <correo>` / `correo:borrar-estados` | **Desarrollo.** Recorre en la base local lo que muestra «Preferencias» sobre la alerta diaria, y borra lo que creó. Ver abajo |

### Ver los estados de «Preferencias»

La base local no tiene envíos reales, así que «Preferencias» siempre dice «Todavía no has recibido ninguno». `correo:estados` crea, paso por paso, los avisos y eventos que mostrarían cada estado del último aviso, cada causa de exclusión y cada aviso del día (12 pasos).

**Antes de empezar:**
- La base local está arriba (`npm run db:up`) y `npm run dev` está corriendo.
- `.env` tiene `BODEGASOSUR_FIXTURES=permitidos`.
- Hay una **cuenta de prueba**, que no sea la del Superadmin, sin avisos previos y con la alerta encendida en Perfil → Preferencias. Inicia sesión con ella en el navegador.

**Pasos:**

```bash
npm run correo:estados -- correo-de-la-cuenta@ejemplo.com
```

1. En cada paso, la terminal dice qué debe verse en «Preferencias».
2. Recarga la página y abre Perfil → Preferencias. Cerrar y abrir el modal no basta, porque los datos se leen al cargar la página.
3. Compara con la terminal y presiona Enter para seguir. Con Ctrl+C sales cuando quieras.
4. Al terminar, o si saliste antes, deja la base como estaba:

```bash
npm run correo:borrar-estados
```

Mientras las filas existan, el día de hoy cuenta como evaluado en la base local (también lo ve el Superadmin en su apartado), y desde el paso 10 la dirección de la cuenta de prueba queda excluida. Todo eso se va con el borrado.

El script se niega a correr si `DATABASE_URL_MIGRACIONES` no apunta a `localhost` o si `NODE_ENV` es `production`. También se niega si quedaron filas de una corrida anterior, o si hoy, ayer o anteayer ya se evaluaron en esa base. Las filas llevan ids fijos, así que el borrado solo toca esas filas.

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
- **Modelo de datos completo** — 22 modelos en dos esquemas de PostgreSQL, con los invariantes escritos en la base: existencia nunca negativa, autorización verificada en el instante del acto y de escritura única, claves de negocio inmutables, y una bitácora alimentada por trigger para los cambios de negocio en las tablas auditadas.
- **Entradas completas en el trabajo local** — listado, captura y edición de borradores, confirmación con folio, capas de costo, existencias y Server Actions protegidas. Los importes se calculan en PostgreSQL.
- **Salidas completas en el trabajo local** — solicitud, autorización, rechazo, cancelación, retiro PEPS y recepción, con lista filtrable y paginada, bandeja de pendientes, captura y detalle. Las Server Actions, la conciliación SQL y las pruebas protegen el flujo.
- **Actor verificable en desarrollo** — cada escritura protegida de un usuario liga en PostgreSQL un JWT RS256 de Clerk a su transacción. La bitácora y las columnas de actor usan esa identidad; las escrituras ordinarias sin liga se rechazan. Producción se desplegará al cerrar los entregables.
- **Traspasos, devoluciones y conteo** — traspasos que conservan fecha original y costo, devoluciones ligadas a su salida con saldo de préstamo, hojas de conteo que se vuelven ajustes y reversas por asiento inverso sobre las capas exactas. Una conciliación diferida en PostgreSQL impide que el libro quede distinto de sus partidas.
- **Alerta diaria de stock mínimo por correo** — quien la encienda en «Preferencias» recibe a las 8:00 los artículos bajo mínimo, una vez al día y sin duplicados aunque una corrida se repita. Un webhook firmado de Resend registra entregas, rebotes y quejas, y las direcciones que rebotan dejan de recibir.
- **Tablero de inicio** con los artículos bajo mínimo, las salidas, préstamos y entradas pendientes y el gasto del mes por estación. La barra lateral muestra cuántos pendientes tiene cada módulo.
- **Interfaz para celular y escritorio** — barra superior con menú por debajo de 1024 px, confirmación en un diálogo propio para toda acción irreversible, mensajes que distinguen sesión, permiso, regla de negocio y fallo, y páginas propias de error y 404.

El [contrato de la fase 6](docs/contratos-otros/04-fase-6-salidas.md) documenta el flujo de salidas y el [de la fase 7](docs/contratos-otros/05-fase-7-traspasos-devoluciones-conteo.md), el de traspasos, devoluciones, conteo y reversas.

**Empresas, estaciones y dos personas son las reales de Gasosur**, cargadas por [`prisma/migracion-datos/`](prisma/migracion-datos/README.md). **Artículos y proveedores son fixtures de desarrollo** (`prisma/fixtures.ts`) para probar movimientos y PEPS; el kardex y los demás reportes de la fase 8 los usan para mostrar historia. Producción arranca sin esos fixtures, por el [Plan B](docs/contratos-otros/01-plan-b-produccion.md).

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
| [Plan B para producción](docs/contratos-otros/01-plan-b-produccion.md) | Producción arranca sin inventario; los dos perfiles de base |
| [Contrato de la Fase 5](docs/contratos-otros/02-fase-5-entradas.md) | Funcionamiento, decisiones, seguridad, pruebas y orden de implementación de entradas |
| [Contrato de la Fase 6](docs/contratos-otros/04-fase-6-salidas.md) | Estados, permisos, PEPS, seguridad y pruebas de salidas |
| [Contrato de la Fase 7](docs/contratos-otros/05-fase-7-traspasos-devoluciones-conteo.md) | Traspasos, devoluciones, préstamos, conteo, reversas y su frontera SQL |
| [Colaboración de desarrollo](docs/contratos-otros/03-colaboracion-desarrollo.md) | Alta de desarrolladores, Clerk y bases locales aisladas |
| [Cambios](CHANGELOG.md) | Qué trae cada versión, escrito para quien usa el sistema |
| **[Entregables por fase](docs/entregables-fases/README.md)** | **Estado y plan de las fases** |

## Stack

Next.js 16 · TypeScript · Prisma 7 · PostgreSQL 16 · Tailwind CSS 4 · Clerk
