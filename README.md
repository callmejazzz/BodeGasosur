# BodeGasosur

Sistema de control de inventario para las bodegas del grupo gasolinero **Gasosur**.

Controla la entrada y salida de material entre bodegas y estaciones, registrando hacia
qué estación se envía, quién lo transporta, quién autoriza, cuándo, en qué cantidad, a
qué costo unitario, a qué área se destina y con qué observaciones.

**Estado:** fases 0 y 1 construidas — cimientos, modelo de datos y los ocho catálogos
con datos sembrados. El cuestionario de requerimientos ya fue contestado por Compras
y sus discrepancias quedaron resueltas: cinco de diez supuestos resultaron falsos y el
modelo está en revisión — ver [hallazgos](docs/05-hallazgos-levantamiento.md).

## Arranque

Requiere Node 20+ y Docker.

```bash
npm install
npm run db:up
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

La aplicación queda en <http://localhost:3000>.

> PostgreSQL se publica en el puerto **5433** para no chocar con la instalación local
> de PostgreSQL que ocupa el 5432.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run db:up` / `db:down` | Levanta o baja PostgreSQL |
| `npm run db:migrate` | Crea y aplica una migración tras cambiar el esquema |
| `npm run db:seed` | Vuelve a sembrar los catálogos |
| `npm run db:studio` | Explorador visual de la base de datos |
| `npm run db:reset` | Borra todo, remigra y resiembra |

## Qué hay construido

- **Tablero** con el avance de la demo y los datos base cargados.
- **Ocho catálogos** con alta, edición, búsqueda y baja lógica: bodegas, estaciones,
  áreas, unidades de medida, categorías, artículos, proveedores y personas.
- **Datos sembrados** verosímiles: 3 bodegas, 10 estaciones, 50 artículos típicos de
  estación de servicio, 7 proveedores y 12 personas.
- **Modelo de datos completo** para movimientos, partidas, existencias y folios: las
  tablas ya existen aunque las pantallas de captura sean de la siguiente fase.

## Documentación

| Documento | Contenido |
|---|---|
| [Arquitectura](docs/01-arquitectura.md) | Stack, principios, capas, estructura y entorno local |
| [Modelo de datos](docs/02-modelo-de-datos.md) | Esquema de destino: entidades, estados, costeo PEPS y permisos |
| [Levantamiento de requerimientos](docs/03-levantamiento-de-requerimientos.md) | Cuestionario aplicado a Compras y método de levantamiento |
| [Plan de la demo](docs/04-plan-demo.md) | Plan original de la demo — referencia histórica |
| [Hallazgos del levantamiento](docs/05-hallazgos-levantamiento.md) | Respuestas de Compras, veredicto de supuestos y cambios derivados |
| [Empresas y estaciones](docs/06-estaciones.md) | Catálogo global del grupo: 22 empresas, 32 estaciones |
| [Inventario actual](docs/07-datos-actuales.md) | Análisis del Excel vigente y plan de migración |
| **[Fases siguientes](fases-siguientes.md)** | **Orden de trabajo vigente** |

## Stack

Next.js 16 · TypeScript · Prisma 7 · PostgreSQL 16 · Tailwind CSS 4
