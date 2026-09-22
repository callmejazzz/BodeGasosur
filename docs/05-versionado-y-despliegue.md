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
v1.0.0        aprobado y desplegado en Vercel + Supabase
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

Los mensajes de commit siguen siendo prosa en español que describe decisiones. **No se
adopta Conventional Commits:** con ocho fases y un desarrollador, el changelog a mano sale
mejor escrito que uno generado, y los mensajes actuales documentan mejor el porqué.

## 7. Ramas: mezclar y desplegar son dos actos distintos

El comportamiento por omisión de Vercel es desplegar a producción en cada push a `main`.
Trabajar con ramas de trabajo no lo evita: cambia *cuándo* llega el código a `main`, pero
el merge sigue siendo el despliegue.

La separación se consigue **cambiando la rama de producción de Vercel a `production`**:

| Rama | Qué pasa al empujar |
|---|---|
| `fase-2-uuidv7`, `fix/...` | Despliegue de vista previa, con URL propia |
| `main` | Vista previa. Es la rama estable de desarrollo, no producción |
| `production` | **Producción.** Solo recibe merges de `main` en una versión etiquetada |

Producción ocurre entonces por un acto deliberado —mezclar `main` en `production`— que
además queda registrado en el historial. Los despliegues de vista previa por rama sirven
para enseñarle avances a Compras antes de que nada sea definitivo.

Aquí sí aparece una rama larga, y la justifica **desacoplar «ya lo mezclé» de «Gasosur ya
lo está usando»**, no mantener versiones viejas en paralelo, que no es un caso de este
proyecto.

## 8. Despliegue: Vercel Pro + Supabase Pro *(reabierto)*

**Por el momento el sistema es local** —`localhost` y PostgreSQL en Docker, ver
[01-arquitectura.md](01-arquitectura.md) §5— y así se queda mientras dure el desarrollo. La
migración ocurre cuando Gasosur apruebe el sistema, en `v1.0.0`.

> **La auditoría reabrió esta decisión (`D1`) y sigue abierta.** El argumento es que para
> diez usuarios en una oficina de Acapulco, el serverless cobra complejidad —el pooler, dos
> URLs de conexión, la advertencia de IPv6, Skew Protection, arranques en frío sobre
> transacciones con locks y `migrate deploy` metido en el build— a cambio de un escalado
> elástico y una presencia global que nadie necesita. Media sección de las que siguen existe
> para administrar complejidad que el propio despliegue introduce.
>
> La alternativa es un contenedor único —Railway, Fly o un VPS con Docker Compose— con
> `next start`, conservando Supabase por sus respaldos administrados si conviene. La
> arquitectura ya presume portabilidad; ejercerla ahora es gratis y después no.
>
> Y una pregunta que conviene hacerle a Gasosur antes de la `v1.0.0`, no después: si un
> libro contable con costos y proveedores puede vivir con un proveedor en Estados Unidos, o
> lo quieren en un servidor del grupo.
>
> Lo que sigue describe la opción original, que continúa siendo válida si se confirma.

| Pieza | Elección |
|---|---|
| Aplicación | Vercel Pro — el plan gratuito es solo para uso no comercial |
| Base de datos | Supabase Pro — el gratuito pausa el proyecto por inactividad y no incluye respaldos |
| Conexión | Connection pooler de Supabase, obligatorio con funciones serverless |

Supabase es PostgreSQL de verdad, lo cual importa porque el esquema `catalogo_gasosur` está pensado para que **otros proyectos del grupo lo lean** ([03-estaciones.md](03-estaciones.md) §3). Eso exige una base a la que se pueda conectar cualquier cliente Postgres.

### Lo que hay que dejar bien configurado el día del despliegue

**Dos URLs de conexión.** `DATABASE_URL` apunta al pooler en modo transacción para la
aplicación; `DIRECT_URL` va en modo sesión para `prisma migrate`, porque las migraciones
usan locks y sentencias preparadas que el modo transacción no soporta. En proyectos nuevos
de Supabase la conexión directa es solo IPv6, así que las migraciones también salen por el
pooler.

**Las variables de entorno tienen ámbito.** La `DATABASE_URL` de producción va marcada
**solo como Production**. Si queda en «All Environments», cualquier vista previa de
cualquier rama escribe en la base real — y siendo el movimiento un libro contable
([01-arquitectura.md](01-arquitectura.md) §3.1), eso no se limpia después.

**Las migraciones son parte del despliegue.** El build de producción corre
`prisma migrate deploy`. Nunca `migrate dev`, que es interactivo y puede resetear.

**La primera vez, la base se levanta a mano con `npm run prod:bootstrap`** —desde una
terminal, nunca desde el build ni el arranque de Next.js—. Antes de `migrate deploy` valida
el entorno sin conectarse: `DATABASE_URL` válida y que no sea una base `*_prueba`, Clerk
configurado con una llave que no sea `sk_test_`, terminal interactiva, y que
`BODEGASOSUR_FIXTURES` no esté definida. Después aplica la migración, rechaza una base que
ya opere, muestra el resumen y exige teclear el nombre de la base para confirmar. Ver
[10-plan-b-produccion.md](decisiones-otros/10-plan-b-produccion.md).

**Skew Protection encendido.** Cuando se promueve una versión, alguien puede llevar horas
con la pantalla de captura abierta: su navegador tiene el JavaScript anterior, que invoca
acciones de servidor cuyos identificadores acaban de cambiar. El síntoma es un error opaco
justo al guardar, con el formulario lleno. Vercel Pro fija las peticiones de un cliente
viejo al despliegue del que salió; según la versión de Next.js puede requerir habilitar
además el `deploymentId` en `next.config.ts`.

**Regiones cercanas.** Base y aplicación en la misma costa. Cada pantalla de catálogo hace
varias idas y vueltas a la base de datos.

### La seguridad no se delega

La autenticación se delega a **Clerk**, pero **la autorización vive en BodeGasosur**: los
tres roles y la bandera *puede autorizar*, leídos de PostgreSQL en cada petición
([01 §3.6](01-arquitectura.md)). Ningún proveedor externo decide quién puede autorizar una
salida, y por eso quitarle el permiso a alguien surte efecto de inmediato.

Si se conserva Supabase, su autenticación y su RLS no entran en esa decisión: Prisma se
conecta con un rol privilegiado, así que RLS no protegería nada por sí solo. De Supabase se
usaría el PostgreSQL administrado con respaldos.

Lo que sí se delega a la base son los **invariantes** —`CHECK` y triggers—, y esa es la
diferencia con la versión anterior de esta sección: la autorización se verifica en
`accionProtegida`, pero no *depende* de que alguien se acuerde de llamarla, porque la base
rechaza por su cuenta una existencia negativa o una autorización de quien no está
facultado.

## 9. La versión tiene que verse en la aplicación

En el pie de página, la versión y el hash corto del commit
(`v1.1.0 · a3f9c21`, desde `VERCEL_GIT_COMMIT_SHA`).

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
