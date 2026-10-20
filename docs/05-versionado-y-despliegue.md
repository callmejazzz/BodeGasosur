# BodeGasosur — Versionado y despliegue

Cómo se numeran las versiones del sistema, qué significa cada número y cómo llega el
código a manos de Gasosur. Aplica desde `v0.1.0` en adelante.

## 1. Una versión es un estado del código, no un estado del servidor

El sistema se versiona desde ahora, aunque viva en `localhost` y falten fases por
construir. El despliegue *consume* una versión; no la crea.

El valor está en poder decir «las existencias dejaron de cuadrar entre la 0.4 y la 0.5» y
tener el diff exacto, en vez de recorrer el historial a ciegas. Esa capacidad se necesita
más durante el desarrollo que después.

## 2. Un solo número para todo el sistema

No hay versión de frontend y versión de backend por separado. Next.js compila las
pantallas, las acciones de servidor y las reglas de inventario en un **solo despliegue**,
que sale de un solo repositorio. El desfase entre las capas es imposible por construcción,
y un tag describe el sistema entero.

Es una consecuencia del stack elegido ([01-arquitectura.md](01-arquitectura.md) §4.2) y
conviene no perderla inventando versiones paralelas.

## 3. Qué significa cada número

Versionado semántico, definido para una aplicación interna y no para una librería:

| | Cuándo sube | Ejemplo |
|---|---|---|
| **MAYOR** | Cambia la forma de trabajar de Compras, o hay una migración de datos irreversible | Rehacer la captura de salidas como asistente de tres pasos |
| **MENOR** | Se completa una fase, o llega una capacidad nueva visible para quien captura | Fase 5, entradas con moneda y capas de costo |
| **PARCHE** | Correcciones, sin capacidad nueva | El kardex ordenaba mal los movimientos del mismo día |

La regla mira **la capacidad que gana el usuario**, no cuánto código costó. Agregar una
tabla al panel del Superadmin es una entrada en `definiciones.ts`
([01-arquitectura.md](01-arquitectura.md) §4.4) y aun así es MENOR. Mover un botón de
lugar no es MAYOR aunque toque muchas pantallas.

Los cambios que solo tocan la interfaz se numeran con la misma regla. La fase 9 —tablero,
estados vacíos, responsivo en celular, confirmaciones— no toca el modelo de datos y es una
MENOR completa, porque cambia lo que Compras puede hacer.

## 4. La línea del tiempo

```text
v0.1.0        fases 0 y 1 — cimientos, modelo de datos y catálogos
v0.2.0        fase 2 — cimientos corregidos
v0.3.0        fase 3 — usuarios y permisos
  …           una MENOR por fase
v0.8.0        fase 8 — reportes
v1.0.0-rc.1   se le presenta a Gasosur para aprobación
v1.0.0-rc.2   correcciones de esa revisión
v1.0.0        aprobado y desplegado en el destino elegido
```

El orden de las fases está en [entregables por fase](entregables-fases/README.md).

**Las `rc` no son adorno.** Entre «lo terminé» y «Gasosur lo aprobó» va a haber al menos
una ronda de observaciones, y hace falta poder decir *«eso quedó corregido en la rc.2»* con
precisión.

**`v1.0.0` no significa «sin defectos», significa «hay datos reales de Gasosur aquí
dentro».** Ese es el corte que cambia las reglas.

## 5. Las reglas

**Mientras el sistema esté en `0.x`, romper está permitido.** Es lo que declara el cero. La
fase 2 migra todas las llaves primarias a UUIDv7 y eso está bien ahora; después de
`v1.0.0` sería una MAYOR con plan de migración.

**A partir de `v1.0.0`, migraciones expansivas.** Nunca eliminar una columna en un solo
paso: agregar la nueva como opcional, rellenar, dejar de escribir en la vieja, y quitarla
una versión después. Suena excesivo hasta el primer despliegue que falla a la mitad con
Compras capturando.

**Cada versión anota su migración.** En el CHANGELOG, junto a la versión, la última
migración de Prisma que incluye. Es lo que permite responder «¿a qué estado de base
corresponde lo que está corriendo?» sin adivinar.

**Los parches posteriores a `v1.0.0` salen de la rama de producción, no de `main`.** Se
ramifica desde el tag, se corrige, se etiqueta `v1.0.1`, se despliega y se mezcla de vuelta
a `main`. Así una corrección urgente no arrastra la fase que esté a medias.

**El CHANGELOG se escribe para Compras, no para el desarrollador.** Diana y Oscar son
quienes lo van a leer: «ahora puedes capturar en cajas o en piezas», no «refactorizado el
servicio de movimientos».

## 6. El ritual, que son cuatro pasos

Al cerrar una fase, cuando su criterio de aceptación se cumple:

1. Subir `version` en `package.json`
2. Agregar la entrada en [`CHANGELOG.md`](../CHANGELOG.md)
3. `git tag -a v0.2.0 -m "Fase 2 — cimientos corregidos"`
4. `git push --follow-tags`

**Fase 6:** por decisión del proyecto, el cierre funcional de Salidas se registró sin
cambiar `package.json` ni el CHANGELOG. La `v0.6.0` se publicó después en un commit de
versión aparte, que agrupa los cuatro commits de la fase, y la etiqueta apunta a él.

**Fase 7:** se construyó completa antes del registro en Git. Su cierre funcional,
versión `v0.7.0` y documentación se reúnen en un único commit, `2ac6ca3`, etiquetado y
publicado. Las correcciones de la revisión se publicaron como `v0.7.1` en `22c1146`.
El ajuste posterior del teclado del selector está en `afcea45`, sin nueva etiqueta por
decisión del proyecto: `main` va por delante de la última versión etiquetada.

**Fase 8:** se construyó en la rama `feat-reportes`, con un PR por entrega (#7 a #13) que
ya traía `package.json` en `0.8.0` y su entrada del CHANGELOG. Se publicó como `v0.8.0` al
mezclar `feat-reportes` a `main` en un solo commit, `938aea3`, que lleva la etiqueta.

Los mensajes de commit siguen siendo prosa en español que describe decisiones. **No se
adopta Conventional Commits:** con este desarrollo por fases y un desarrollador, el
changelog a mano sale mejor escrito que uno generado, y los mensajes actuales documentan
mejor el porqué.

## 7. Ramas: mezclar y desplegar son dos actos distintos

Si producción se despliega con cada push a `main`, trabajar con ramas no lo evita: cambia
*cuándo* llega el código a `main`, pero el merge sigue siendo el despliegue.

La separación se consigue con **una rama `production`**, que es de donde Sevalla despliega
la aplicación de producción:

| Rama | Qué pasa al empujar |
|---|---|
| `fase-2-uuidv7`, `fix/...` | Nada en Sevalla mientras las preview apps sigan apagadas (§8) |
| `main` | La rama estable de desarrollo. Si existe una app de staging, despliega ahí |
| `production` | **Producción.** Solo recibe merges de `main` en una versión etiquetada |

Producción ocurre entonces por un acto deliberado —mezclar `main` en `production`— que
además queda registrado en el historial.

Aquí sí aparece una rama larga, y la justifica **desacoplar «ya lo mezclé» de «Gasosur ya
lo está usando»**, no mantener versiones viejas en paralelo, que no es un caso de este
proyecto.

## 8. Despliegue: Sevalla + Supabase *(en prueba)*

**Decisión (2026-10-10):** la aplicación en **Sevalla** y la base en **Supabase**, en proveedores separados. Cierra el hallazgo **D1** de la [auditoría](cimientos-word/04-auditoria-arquitectura.docx): un contenedor con `node server.js` en lugar de funciones serverless. Sevalla queda **a prueba una semana**; si no pasa la lista del final, el plan B es Render en Virginia con la misma base.

Mientras dure el desarrollo el sistema sigue siendo local ([01-arquitectura.md](01-arquitectura.md) §5). Producción con datos reales llega en `v1.0.0`.

| Pieza | Elección |
|---|---|
| Aplicación | Sevalla Application Hosting, **Ashburn** (`us-east4`, después `us-ashburn-1` en OCI), con el [`Dockerfile`](../Dockerfile), un pod S1 y una instancia |
| Base | Supabase Pro, **`us-east-1`** (Virginia del Norte) |
| Conexión de la aplicación | **Directa** (`db.<proyecto>.supabase.co`), con el complemento IPv4. Supavisor en modo sesión (5432) solo como alternativa; nunca el modo transacción (6543) |
| Conexión del dueño | **Directa**, desde una terminal |

**La base va donde está la aplicación.** El tablero hace once consultas seguidas y confirmar un movimiento encadena varias con candados puestos: dentro de Ashburn cada ida y vuelta cuesta 1–2 ms; contra Ohio, 10–15 ms, y los candados duran lo mismo de más.

**Separadas, porque el libro contable no debe depender del hosting de la aplicación.** La
aplicación se puede cambiar de proveedor sin tocar la base; los proyectos que lean `catalogo_gasosur` se conectan a la base y no a Sevalla; y la credencial del dueño nunca
está en el contenedor.

### La zona horaria con un pooler

Supavisor **solo reenvía `search_path`** a PostgreSQL y descarta el resto de las `options` de arranque, incluido el `-c TimeZone=UTC` del que dependen `src/lib/db.ts` y `prisma/comun.ts` (§4.5 de [01](01-arquitectura.md)). A través del pooler, cada instante quedaría corrido seis horas sin un solo error.

Por eso el usuario de ejecución lleva **`timezone = 'UTC'` en su rol**, junto con
`idle_in_transaction_session_timeout = '30s'` para que una conexión cortada a media
transacción no deje candados puestos. Los fija `npm run db:usuario-app`, y
`prisma/sql/privilegios.test.ts` lo vigila conectándose sin `options`. El dueño no lleva UTC
en su rol —la base enseña la hora de México—, así que los scripts que escriben como él
**se niegan a pasar por Supavisor** y exigen la conexión directa.

### Supabase, el día que se crea el proyecto

- **Complemento IPv4** (*Add-ons → Dedicated IPv4 address*). Sin él, la conexión directa
  solo existe por IPv6, y ni Sevalla ni muchas redes domésticas lo tienen.
- **Sin permisos por omisión para los roles de Supabase.** En `public`, todo lo que crea
  `postgres` nace con todos los permisos para `anon`, `authenticated` y `service_role`. Se
  quitan **antes** de la primera migración, como `postgres`:

  ```sql
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
  ```

- **Data API apagada antes de la primera migración** (*Integrations → Data API*). El esquema
  no define políticas RLS; con la API encendida, la llave pública podría leer costos y
  proveedores sin pasar por la aplicación.
- **Sin la integración con GitHub.** Aplica migraciones desde `supabase/migrations` en cada
  push: sería un segundo camino para cambiar el esquema de producción.
- **Plan Pro antes de producción.** El gratuito pausa el proyecto por inactividad y no
  respalda.
- **TLS verificado.** El CA de Supabase va en [`certificates/`](../certificates/README.md)
  y las dos URL terminan en `?sslmode=verify-full&sslrootcert=<ruta al CA>`. El motor de
  migraciones de Prisma ignora `verify-full` sin avisar y llama `sslcert` al CA;
  `prisma.config.ts` traduce la URL para él, así que se escribe una sola vez.
- **Network Restrictions**: la IP de salida de Sevalla y, mientras dure la operación, la de
  quien migra. Las IPs de salida de Sevalla son compartidas por centro de datos: la lista
  reduce quién puede intentar conectarse, pero la defensa es la credencial.
- **Una contraseña distinta para cada usuario**, larga, aleatoria y ASCII imprimible. La del
  dueño se cambia en *Project Settings → Database*. La de la aplicación se cambia en
  `DATABASE_URL` y se aplica con `DOTENV_CONFIG_PATH=.env.supabase npm run db:usuario-app`,
  desde una terminal sin las variables del `.env` local; después va la misma URL en
  Sevalla. Supabase escribe cada DDL en su bitácora (`log_statement = ddl`), así que el
  script manda el verificador SCRAM, nunca la contraseña.
- **La versión de PostgreSQL.** Supabase está en 17 y `docker-compose.yml` en 16. La suite
  pasa en 17, también con un dueño sin superusuario como el de Supabase, salvo las doce
  pruebas que fabrican inventario dañado con `session_replication_role`, que exige
  superusuario (verificado el 2026-10-12). Alinear el `docker-compose.yml` obliga a recrear
  el volumen local de cada desarrollador; queda pendiente.
- **Después del bootstrap**, `anon` y `authenticated` no deben tener privilegios en
  `public` ni en `catalogo_gasosur`:

  ```sql
  SELECT grantee, table_schema, count(*) FROM information_schema.role_table_grants
   WHERE grantee IN ('anon', 'authenticated') AND table_schema IN ('public', 'catalogo_gasosur')
   GROUP BY 1, 2;   -- vacío
  ```

### Sevalla

- **Build con el `Dockerfile`, no con Nixpacks**, que toma Node 18 por omisión. La imagen
  es `output: "standalone"`, corre con Node 24 como usuario sin privilegios y no lleva
  migraciones ni la credencial del dueño.
- **Variables.** Al construir: las `NEXT_PUBLIC_*`, que quedan incrustadas en el navegador.
  En ejecución: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` y
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. **Nunca `DATABASE_URL_MIGRACIONES`:** en Sevalla
  las variables son de la aplicación, no del proceso, y cualquier proceso la vería.
- **Readiness y liveness en `/api/salud`**, que no consulta la base: si Supabase cae,
  reiniciar la aplicación en bucle no arregla nada. La readiness es lo que hace que un
  despliegue no corte el servicio.
- **Caché de borde apagada.** Todas las páginas se renderizan con sesión; cachearlas
  enseñaría la pantalla de una persona a otra. El CDN sirve solo los estáticos.
- **Preview apps apagadas** hasta confirmar que no heredan la `DATABASE_URL` de
  producción. Si la heredan, cualquier rama escribiría en el libro real, y eso no se
  limpia después ([01](01-arquitectura.md) §3.1).
- **Una instancia.** Si se escala, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` tiene que ser la
  misma en todas, como variable de build, y los límites de descargas en Excel —que viven
  en memoria— se contarían por instancia.
- **El webhook de Clerk** apunta a `https://<dominio>/api/webhooks/clerk`, con la instancia
  de producción de Clerk.

### Versiones sin errores al guardar

Cuando se promueve una versión, alguien puede llevar horas con la pantalla de captura
abierta: su navegador tiene el JavaScript anterior, que invoca acciones de servidor cuyos
identificadores acaban de cambiar. El síntoma sería un error opaco justo al guardar.

El `Dockerfile` construye con un `NEXT_DEPLOYMENT_ID` propio de cada build —Sevalla no
expone el commit al construir—, y Next.js compara el de cada petición con el suyo: si no
coinciden, recarga la página completa en lugar de fallar. Va solo en el build; definirlo
distinto al arrancar lo pisaría.

### Migraciones y primer arranque

**Las migraciones son parte del despliegue, no del build.** Durante la prueba se corren a
mano desde una terminal, con `DATABASE_URL_MIGRACIONES` por la conexión directa:
`npm run db:migrar-remota -- .env.supabase`, nunca `migrate dev`, que es interactivo y puede
resetear. Corre `prisma migrate deploy` dentro de un contenedor Linux: en macOS, el motor de
migraciones de Prisma valida TLS con el sistema, que rechaza el certificado de Supabase
(cinco años de vigencia, sin EKU `serverAuth`); OpenSSL lo verifica con el mismo CA. Los
demás scripts usan `pg`, que ya va por OpenSSL. Por la misma razón, `prod:bootstrap` no puede
aplicar las migraciones desde macOS: hay que prepararlo para el contenedor antes de `v1.0.0`.

**La terminal no debe traer las variables del `.env` local.** `dotenv` nunca sobrescribe una
variable que ya existe, y una terminal de VS Code puede traer `DATABASE_URL` del `.env`: los
scripts correrían contra `localhost` sin avisar. Antes de usar `.env.supabase`, `unset` de
`DATABASE_URL`, `DATABASE_URL_MIGRACIONES` y las variables de Clerk. Van
**antes** de promover la aplicación, y las migraciones expansivas de §5 garantizan que la
versión anterior siga funcionando con el esquema nuevo. La credencial del dueño vive en el
gestor de contraseñas, no en Sevalla.

**La primera vez, la base se levanta a mano con `npm run prod:bootstrap`** —desde una
terminal, nunca desde el build ni el arranque—. Antes de `migrate deploy` valida el entorno
sin conectarse: `DATABASE_URL` válida y que no sea una base `*_prueba`, Clerk configurado
con una llave que no sea `sk_test_`, terminal interactiva, y que `BODEGASOSUR_FIXTURES` no
esté definida. Después aplica las migraciones como dueño, crea el usuario de ejecución y
carga las llaves públicas de Clerk, rechaza una base que ya opere, muestra el resumen y
exige teclear el nombre de la base para confirmar. La plantilla `bodegasosur-db` usa RS256
y dura 30 segundos; la base acepta hasta 60. Ver
[Plan B](contratos-otros/01-plan-b-produccion.md).

**El despliegue del actor verificable** se hará al cerrar los entregables. Si ya hay una
versión en servicio, va en dos etapas: primero funciones, llaves y aplicación que liga
actores; después la migración que exige la liga y las correcciones posteriores.

**Rotación manual de llaves.** Al aparecer un `kid` nuevo en el JWKS o en una alerta
`BG702`, quien tenga `DATABASE_URL_MIGRACIONES` ejecuta `npm run db:llaves-clerk`.
Después verifica un token real de la plantilla con `npm run db:probar-token`, sin
ponerlo en argumentos ni registros. Una vez que Clerk deje de firmar con la llave
anterior y hayan transcurrido al menos 60 segundos desde su último uso posible,
puede desactivarla con `npm run db:llaves-clerk -- --desactivar <kid>`. El monitor no
carga ni desactiva llaves por su cuenta.

### La prueba de una semana

Sevalla se queda si pasa todo esto:

1. La aplicación está en Ashburn, y se sabe si la cuenta ya está en OCI o cuándo le toca
   (la ola 1, apps sin disco, empezó el 2026-10-07). **Producción no va sobre GCP:** ahí la
   IP de salida son todos los rangos regionales de Google, y la lista de Supabase no
   filtraría nada.
2. Cien `SELECT 1` seguidos de la aplicación a Supabase promedian menos de 3 ms.
3. `SHOW TimeZone` como usuario de ejecución, por la URL real, responde `UTC`.
4. `sslmode=verify-full` conecta contra el host real con el CA de `certificates/`.
5. Desplegar con un formulario abierto recarga la página en vez de fallar al guardar.
6. Las preview apps no heredan las variables de producción (o se quedan apagadas).
7. Soporte confirma el SLA y la fecha de migración de la cuenta.

**Al cerrar la prueba, si Sevalla se queda:** una segunda aplicación, `bodegasosur-ops`,
con la credencial del dueño y nada más, que corra `migrate deploy` antes de cada despliegue
y un `pg_dump` cifrado cada hora hacia un tercer proveedor, con un ensayo de restauración
al mes. Sin PITR, el respaldo diario de Supabase puede perder un día de capturas.

### La seguridad no se delega

La autenticación se delega a **Clerk**, pero **la autorización vive en BodeGasosur**: los
tres roles y la bandera *puede autorizar*, leídos de PostgreSQL en cada petición
([01 §3.6](01-arquitectura.md)). Ningún proveedor externo decide quién puede autorizar una
salida, y por eso quitarle el permiso a alguien surte efecto de inmediato.

De Supabase se usa PostgreSQL administrado con respaldos, y nada más: ni su autenticación
ni su Data API. La aplicación usa un usuario de PostgreSQL sin propiedad y con permisos de
fila; el esquema actual no define políticas RLS y no debe atribuirles una protección que no
está implementada.

Lo que sí se delega a la base son los **invariantes** —`CHECK` y triggers—, y esa es la
diferencia con la versión anterior de esta sección: la autorización se verifica en
`accionProtegida`, pero no *depende* de que alguien se acuerde de llamarla, porque la base
rechaza por su cuenta una existencia negativa o una autorización de quien no está
facultado.

## 9. La versión tiene que verse en la aplicación

En el pie de página, la versión y el hash corto del commit (`v1.1.0 · a3f9c21`). Sevalla no
expone el commit al construir, así que llegará como variable de build del `Dockerfile`; se
implementa con el acabado de la fase 9.

Sin eso, un reporte de Compras es inaccionable: no hay forma de saber si quien reporta está
viendo lo último o una pestaña abierta desde hace tres días. Es la única pieza de esta
política que el usuario final ve, y es la que la hace útil en soporte.

## 10. El contrato compartido, resuelto

El día que otro proyecto de Gasosur lea el esquema `catalogo_gasosur`, lo que necesita
versión propia no es la interfaz sino **el contrato**: qué columnas tienen `Empresa` y
`Estacion` y qué garantías se dan sobre ellas. Renombrar una columna ahí rompe software
ajeno y sería MAYOR aunque en BodeGasosur no se note nada.

**Quedó resuelto en la fase 2, y sin trabajo extra.** Los otros proyectos no leen las
tablas: leen **vistas versionadas** —`v_empresa_v1`, `v_estacion_v1`— con un rol dedicado
de solo lectura ([02 §7](02-modelo-de-datos.md)). Con eso, renombrar una columna física no
rompe a nadie; cuando un consumidor necesite un campo que la `v1` no expone, nace una `v2`
y la `v1` sigue viva.

El contrato pasa a versionarse por su cuenta, así que un cambio en `catalogo_gasosur` ya no
arrastra por fuerza una MAYOR de BodeGasosur: solo la arrastraría retirar una vista que
alguien todavía use. Y la escritura desde fuera es imposible por construcción, no por
acuerdo.
