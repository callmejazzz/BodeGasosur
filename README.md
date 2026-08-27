# BodeGasosur

Sistema de control de inventario para las bodegas del grupo gasolinero **Gasosur**.

Controla la entrada y salida de material entre bodegas y estaciones, registrando hacia qué
estación se envía, quién lo autoriza, quién lo entrega, cuándo, en qué cantidad, a qué
costo unitario, a qué área se destina y con qué observaciones.

**Versión actual: `v0.2.0`** — ver [CHANGELOG.md](CHANGELOG.md).

**Estado:** fases 0 a 2 construidas. El levantamiento con Compras está cerrado y la
arquitectura fue auditada; sus correcciones de esquema ya están aplicadas. Lo siguiente es
la fase 3, usuarios y permisos — ver [`fases-siguientes.md`](fases-siguientes.md).

**Entorno:** local mientras dure el desarrollo. Dónde se despliega se decide antes de la
`v1.0.0` — ver [versionado y despliegue](docs/08-versionado-y-despliegue.md) y el hallazgo
**D1** de la [auditoría](docs/09-auditoria.md).

## Arranque

Requiere Node 20+ y Docker.

```bash
npm install
npm run db:up
cp .env.example .env
npm run db:reset
npm run dev
```

La aplicación queda en <http://localhost:3000>.

> PostgreSQL se publica en el puerto **5433** para no chocar con la instalación local
> que ocupa el 5432.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run db:up` / `db:down` | Levanta o baja PostgreSQL |
| `npm run db:seed` | Vuelve a sembrar los catálogos |
| `npm run db:studio` | Explorador visual de la base de datos |
| `npm run db:reset` | Borra todo, remigra y resiembra |

### Migraciones

Los invariantes del sistema viven en la base como `CHECK` y triggers, y Prisma no sabe
expresarlos. Ese SQL se escribe a mano en `prisma/sql/` y se arma dentro de la migración:

```bash
./scripts/armar-migracion.sh nombre-de-la-migracion
```

El script junta `prisma/sql/antes/`, el DDL que genera Prisma desde `schema.prisma`, y
`prisma/sql/despues/`. Ver [arquitectura](docs/01-arquitectura.md) §5.

## Qué hay construido

- **Nueve catálogos** con alta, edición, búsqueda y baja lógica: empresas, bodegas,
  estaciones, áreas, unidades de medida, categorías, artículos, proveedores y personas.
- **Modelo de datos completo** — 19 modelos en dos esquemas de PostgreSQL, con los
  invariantes escritos en la base: existencia nunca negativa, autorización verificada en el
  instante del acto y de escritura única, claves de negocio inmutables, y una bitácora
  alimentada por trigger que registra todo cambio a cualquier dato.
- **Tablero** con el avance por fases y los datos base cargados.

Las pantallas de captura de movimientos —entradas, salidas, traspasos— son de fases
posteriores; sus tablas ya existen.

Los datos sembrados son de ejemplo, para poder enseñar el sistema. Los reales de Gasosur
llegan en la fase 4.

## Documentación

| Documento | Contenido |
|---|---|
| [Arquitectura](docs/01-arquitectura.md) | Stack, principios rectores, capas y entorno local |
| [Modelo de datos](docs/02-modelo-de-datos.md) | Entidades, estados, invariantes, costeo PEPS y permisos |
| [Levantamiento de requerimientos](docs/03-levantamiento-de-requerimientos.md) | Cuestionario aplicado a Compras y método de levantamiento |
| [Plan de la demo](docs/04-plan-demo.md) | Plan original — referencia histórica, superado por `fases-siguientes.md` |
| [Hallazgos del levantamiento](docs/05-hallazgos-levantamiento.md) | Respuestas de Compras, veredicto de supuestos y cambios derivados |
| [Empresas y estaciones](docs/06-estaciones.md) | Catálogo global del grupo: 22 empresas, 32 estaciones |
| [Inventario actual](docs/07-datos-actuales.md) | Análisis del Excel vigente y plan de migración |
| [Versionado y despliegue](docs/08-versionado-y-despliegue.md) | Política de versiones y ramas |
| [Auditoría de arquitectura](docs/09-auditoria.md) | Revisión de las bases, con lo que se resolvió y lo que sigue abierto |
| [Cambios](CHANGELOG.md) | Qué trae cada versión, escrito para quien usa el sistema |
| **[Fases siguientes](fases-siguientes.md)** | **Orden de trabajo vigente** |

## Stack

Next.js 16 · TypeScript · Prisma 7 · PostgreSQL 16 · Tailwind CSS 4 · Clerk
