# BodeGasosur — Colaboración de desarrollo

Esta guía incorpora a otra persona sin darle acceso a la base local de alguien más.
Cada clon trabaja contra su propio contenedor, volumen y base PostgreSQL. Por eso
`npm run db:reset` borra solo sus datos de desarrollo y sus fixtures.

## 1. Acceso al repositorio

La persona responsable del repositorio la invita a GitHub con el nivel necesario para
trabajar en una rama y abrir un pull request. No se versionan `.env`, llaves de Clerk ni
credenciales de bases de datos.

El flujo de ramas previsto está en [05-versionado-y-despliegue.md](../05-versionado-y-despliegue.md):
trabajo en una rama de fase o `fix/...`, integración en `main` y, cuando exista despliegue,
promoción deliberada a `production`.

## 2. Base local propia

La persona instala Node 20+, Docker y clona el repositorio. Luego ejecuta:

```bash
npm install
cp .env.example .env
```

Antes de levantar Docker, debe elegir valores que nadie más esté usando en esa máquina.
Por ejemplo, para Ana:

```dotenv
COMPOSE_PROJECT_NAME="bodegasosur_ana"
POSTGRES_PORT="5434"
POSTGRES_DB="bodegasosur_ana"
POSTGRES_USER="bodegasosur"
POSTGRES_PASSWORD="bodegasosur"
DATABASE_URL="postgresql://bodegasosur:bodegasosur@localhost:5434/bodegasosur_ana?schema=public"
DATABASE_URL_PRUEBAS="postgresql://bodegasosur:bodegasosur@localhost:5434/bodegasosur_ana_prueba?schema=public"
BODEGASOSUR_FIXTURES="permitidos"
```

`COMPOSE_PROJECT_NAME` separa el contenedor y el volumen de Docker; se eliminó el nombre
fijo del contenedor precisamente para que dos clones puedan convivir en un mismo equipo.
La base de pruebas debe conservar el sufijo `_prueba`: Vitest la destruye y recrea antes de
correr. Nunca se deben pegar aquí las URLs de una base compartida o de producción.

Con el archivo preparado:

```bash
npm run db:up
npm run db:reset
npm run dev
```

`db:reset` migra, carga la configuración, los catálogos y fixtures de desarrollo, y
arranca el Superadmin de **esa** base. No comparte registros con otra base ni otro volumen.

## 3. Entrar y ver todas las pantallas

Clerk responde quién inició sesión y la tabla local `Usuario` decide el rol. Para ver todas
las pantallas, la persona debe quedar como `SUPERADMIN` en su base local; el comando de
arranque lo crea con el correo configurado en `CLERK_SUPERADMIN_CORREO`.

La opción recomendada es que cada desarrollador use su propia identidad de la instancia
de desarrollo de Clerk. La persona con administración de esa instancia entrega por un
canal seguro sus llaves **de desarrollo** y el colaborador configura:

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
CLERK_SUPERADMIN_CORREO="correo-del-colaborador@ejemplo.com"
```

Primero debe existir esa identidad en Clerk (por registro de desarrollo o por invitación).
Después `npm run db:reset` la enlaza como Superadmin en la base aislada. Esto le concede
las mismas pantallas y permisos de un Superadmin sin compartir la contraseña, la sesión ni
la trazabilidad de la cuenta actual.

Si se necesita reproducir exactamente una sesión del Superadmin actual, se puede usar su
correo en `CLERK_SUPERADMIN_CORREO` y las llaves de la misma instancia **solo en la base
local aislada**. Aun así, no se deben compartir contraseña, códigos de recuperación ni
cookies de esa cuenta: la alternativa anterior da el mismo acceso funcional y conserva la
auditoría por persona.

El webhook no es indispensable para este arranque local. Si se requiere probar cambios de
correo, bajas o eventos de sesión, se configura un listener de desarrollo y su
`CLERK_WEBHOOK_SIGNING_SECRET`; nunca se apunta una instancia local al webhook de
producción.

## 4. Comprobaciones antes de entregar cambios

```bash
npm run lint
npm run test
```

Las pruebas de integración usan exclusivamente `DATABASE_URL_PRUEBAS`. La persona debe
confirmar que esa URL contiene su puerto local, su propia base y el sufijo `_prueba` antes
de ejecutarlas.
