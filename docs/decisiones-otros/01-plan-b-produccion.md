# BodeGasosur — Plan B para producción

**Decisión** (2026-09-11): el desarrollo continúa con datos demostrativos, y **si al llegar a producción Compras no ha entregado una normalización confiable de su inventario, producción arranca limpia de datos operativos e históricos**.

## Qué entra a producción y qué no

| Entra                                                                                         | No entra                                               |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Las **empresas y estaciones** del catálogo global, desde `Estaciones.xlsx`                    | Los 137 proveedores del Excel                          |
| Las **dos personas** confirmadas: Diana Damián Hernández y Oscar Bailón Delgado               | Los 225 artículos, sus precios y la existencia inicial |
| La configuración mínima: las dos bodegas reales, las tres áreas, la unidad `PZA` y los folios | El histórico de movimientos y cualquier capa PEPS      |
| El primer **Superadmin** y los permisos                                                       | Fixtures o inventario demostrativo de cualquier tipo   |

Proveedores y categorías quedan como catálogos **habilitados y vacíos**. Compras crea los
proveedores y artículos reales desde la aplicación conforme los necesite.

Si después Compras entrega una normalización válida, se implementa una **carga operativa
adicional** —auditada, por el mismo mecanismo de `prisma/migracion-datos/`, con el mapeo
`codigo_viejo,bodega,clave_nueva`— **sin reiniciar producción**.

## Dos perfiles, dos cadenas

No existe un solo `db:reset` que sirva a los dos. Cada perfil tiene su comando, y lo que
los separa es un mecanismo, no un nombre:

| | Desarrollo — `npm run db:reset` | Producción — `npm run prod:bootstrap` |
|---|---|---|
| Esquema | `migrate reset` (destruye y recrea) | `migrate deploy` (solo aplica lo pendiente) |
| Configuración mínima | `prisma/configuracion.ts` | `prisma/configuracion.ts` |
| Catálogos reales | `prisma/migracion-datos/` | `prisma/migracion-datos/` |
| Fixtures | `prisma/fixtures.ts` | **Nunca** |
| Superadmin | `scripts/arranque-superadmin.ts` | `scripts/arranque-superadmin.ts` |

**Los fixtures fallan por omisión.** `prisma/fixtures.ts` exige tres cosas a la vez:
`BODEGASOSUR_FIXTURES=permitidos` en el entorno —una variable que solo existe en el `.env`
de una máquina de desarrollo—, `NODE_ENV` distinto de `production`, y una base sin
movimientos ni existencias.

**El bootstrap de producción es manual** y no forma parte de `next build` ni de `next
start`. Valida el entorno **antes** de `migrate deploy` y sin conectarse —`DATABASE_URL`
válida y no `*_prueba`, Clerk con llave de producción, terminal interactiva, y
`BODEGASOSUR_FIXTURES` sin definir, porque si está es una máquina de desarrollo—. Después
de migrar rechaza una base que ya tenga datos operativos, rechaza divergencias entre los
CSV y la base —nunca sobrescribe ni reactiva nada—, muestra qué va a escribir y a dónde, y
exige teclear el nombre de la base para confirmar.

## Lo que esta decisión cambió en el modelo

- **`Empresa` en `catalogo_gasosur` es exclusivamente de las empresas de Gasosur**: nunca
  una empresa proveedora externa ni un dato de prueba. `Proveedor` dejó de apuntar a ella
  y lleva su propia razón social y RFC (normalizado con la misma regla). No hay vínculo
  opcional entre las dos: si una empresa del grupo debe ser proveedora, se decide como
  caso de negocio específico.

- **`Bodega.clave` la asigna el sistema** (`BDG-00001`…), igual que la de artículo. Si la
  capturara una persona, las claves de producción serían las que inventó quien sembró la
  demo, y son inmutables.
- **`Bodega.nombre`, `Persona.nombre` y `Proveedor.nombreComercial` son únicos** sin
  distinguir mayúsculas ni espacios sobrantes (`nombre_normalizado()` en
  `prisma/sql/despues/10-invariantes.sql`). Son la forma en que una persona identifica el
  registro y la clave con la que los scripts deciden si ya existe; sin unicidad, un script
  actualizaría una fila cualquiera.
