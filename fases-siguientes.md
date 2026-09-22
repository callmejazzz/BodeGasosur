	# BodeGasosur — Fases siguientes

Orden de trabajo a partir del levantamiento cerrado con Compras y de la
[auditoría de arquitectura](docs/09-auditoria.md). Reemplaza el plan original de
[`docs/04-plan-demo.md`](docs/04-plan-demo.md), que se conserva como referencia de cómo se
llegó hasta aquí.

Los entregables, archivos, commits y versiones de referencia de cada fase están separados
en [`docs/entregables-fases/`](docs/entregables-fases/README.md).

**Ya construido:**

- **Fases 0 y 1** (`v0.1.0`) - cimientos, modelo de datos inicial y los catálogos con datos
  sembrados. Se le presentó a Compras como demo.
- **Fase 2** (`v0.2.0`) - cimientos corregidos.
- **Fase 3** (`v0.3.0`) - usuarios y permisos.
- **Fase 4**, parcial - empresas, estaciones y dos personas migradas; dos perfiles de base
  (desarrollo y producción) y el [Plan B](docs/10-plan-b-produccion.md) para arrancar
  producción sin inventario.

---

## Fase 2 — Cimientos corregidos ✅

Todo lo que el levantamiento y la auditoría invalidaron del esquema de la demo. Fue primero
porque cada fase posterior escribe sobre estas tablas.

Se resolvió **regenerando la migración inicial**: la de la demo se borró y en su lugar hay
una sola migración limpia con el modelo corregido. En `0.x` romper está permitido, y no
había datos reales de Gasosur que migrar.

- Llaves primarias a **UUIDv7** nativo, y rutas por clave de negocio
- Esquema `catalogo_gasosur` con `Empresa` y `Estacion`, expuesto por **vistas versionadas**
- Las tablas de fases posteriores, creadas desde ahora para no volver a migrar: `Usuario`,
  `CapaCosto`, `ConsumoCapa`, `Bitacora`, `EventoAcceso` y `EventoWebhook`
- Los invariantes **escritos en la base**: 45 `CHECK` y 20 triggers —bitácora,
  inmutabilidad de claves, verificación de la facultad de autorizar y baja de bodega—
- `fecha` como día y los instantes con zona horaria explícita
- Cantidades enteras; la unidad de medida pasa a significar presentación
- Nueve catálogos funcionando contra el esquema nuevo

**Criterio de aceptación — cumplido:** el esquema refleja lo acordado, los catálogos
existentes siguen funcionando y **11 de los 14 invariantes** de
[02 §4](docs/02-modelo-de-datos.md#4-invariantes) los hace cumplir PostgreSQL, escritos como
45 `CHECK` y 20 triggers. Los otros tres —el 1, el 2 y el 10— dependen de la capa de
servicios, que se construye junto con los movimientos.

## Fase 3 — Usuarios y permisos ✅

Bloquea la fase de salidas: no se puede impedir una salida sin autorización si el sistema
no sabe quién está capturando.

**Clerk autentica; PostgreSQL autoriza** ([01 §3.6](docs/01-arquitectura.md)). Eso saca del
proyecto las contraseñas, las sesiones, el límite de intentos y la recuperación, y deja
adentro lo único que no se puede delegar: el permiso.

### Roles de usuario

| Rol | Empresas y Estaciones | Resto de las tablas | Movimientos |
|---|---|---|---|
| **Superadmin** | CRUD completo | CRUD completo | Todo |
| **Compras** | Lectura | Captura y edita catálogos operativos | Registra entradas, salidas, traspasos y devoluciones |
| **Jefe** | Lectura | Lectura | Consulta |

**La columna de Movimientos se implementa por fase.** [`permisos.ts`](src/lib/permisos.ts)
ya declara y prueba `entradas:leer`, `entradas:capturar` y `entradas:confirmar`; los permisos
de salidas, traspasos y devoluciones se agregarán cuando se construyan esas fases. Las otras
dos columnas también están implementadas y verificadas rol por rol.

Además, transversal a los roles: la bandera **puede autorizar**, editable desde la pantalla
de usuarios.

### Lo que se construyó

| Qué                                                                                       | Dónde                                                 |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Identidad delegada a Clerk, en español, con pantalla de acceso propia                     | `src/app/(acceso)/`, `src/proxy.ts`                   |
| Arranque del primer Superadmin, idempotente y con guardas                                 | `scripts/arranque-superadmin.ts`                      |
| Negación por omisión: `sin-sesion`, `sin-acceso` y `activa`                               | `sesionActual()` en `src/lib/db.ts`                   |
| Lectura autorizada, en transacción `REPEATABLE READ READ ONLY`                            | `consultar()`                                         |
| Escritura autorizada, que fija `app.usuario_id` para la bitácora                          | `accionProtegida()`                                   |
| Matriz de permisos tipada, con los catálogos globales separados de los operativos         | [`src/lib/permisos.ts`](src/lib/permisos.ts)          |
| El cliente de Prisma fuera de la capa de aplicación, con regla de ESLint                  | `src/lib/db.ts`, `eslint.config.mjs`                  |
| Webhooks de Clerk: atómicos, idempotentes por `svix-id`, limitados por tipo a tres tablas | `src/app/api/webhooks/clerk/`, `escrituraDeSistema()` |
| Pantalla de usuarios: conceder acceso, editar rol y bandera, activar y desactivar         | `src/app/(sistema)/usuarios/`                         |
| Navegación y catálogos según el rol, con detalle de solo lectura para quien no escribe    | `navegacion.tsx`, `catalogos/[slug]/`                 |
| Un solo usuario **activo** por correo, sin límite en los históricos                       | índice parcial en `prisma/sql/despues/`               |
| Registro de accesos y de entregas de webhook                                              | `EventoAcceso`, `EventoWebhook`                       |

No pierdas de vista estas tres cosas al leer la tabla:

- **La frontera son `consultar()` y `accionProtegida()`, no la pantalla.** Ocultar un botón
  o una sección del menú es presentación. Las acciones de servidor son URLs propias y no
  pasan por ningún layout.
- **`accionProtegida` es el único camino de escritura de la capa de aplicación**, no del
  sistema entero: el webhook escribe por `escrituraDeSistema()` y el arranque por su
  script, y las dos declaran su origen para la bitácora.
- `Usuario.correo` **no es único**. La identidad canónica es `clerkUserId`; una baja
  conserva su fila con todo el histórico colgando.

### Pendiente de realizar de la Fase 3

Ninguna de las dos bloquea la fase ni las siguientes:

- **Cerrar el registro a invitación** en el panel de Clerk y retirar `(acceso)/sign-up`.
  Está abierto a propósito para poder crear los primeros usuarios; se cierra antes de la
  `v1.0.0`.
- **`InvitacionAcceso`** —correo normalizado, rol previsto, vigencia y estado— que el
  Superadmin llenaría antes de invitar. Clerk **no emite ningún evento al aceptarse una
  invitación de instancia** (solo existen los de organización), así que su disparador
  tendrá que ser `user.created`, emparejando por correo.

### Pantalla por tabla para el Superadmin

**Esto ya está resuelto:** los catálogos se declaran en
[`src/lib/catalogos/definiciones.ts`](src/lib/catalogos/definiciones.ts) y de esa
descripción salen las columnas, el formulario y la validación. Agregar una tabla al panel
del Superadmin es una entrada de configuración, no una pantalla nueva.

**Criterio de aceptación — cumplido y verificado:** dar y quitar la facultad de autorizar
sin tocar el código ni la base de datos, que surta efecto en la siguiente petición, y que
quede en la bitácora quién lo hizo. Se hace desde la pantalla de usuarios, `sesionActual()`
lee la bandera de PostgreSQL en cada petición —nunca del token— y el trigger anota el
cambio con el `usuarioId` de quien lo hizo.

## Fase 4 — Migración de catálogos (Plan B) ✅

La decisión canónica está en [`docs/10-plan-b-produccion.md`](docs/10-plan-b-produccion.md): el desarrollo sigue con datos demostrativos y **producción arranca limpia de datos operativos**. La fase se da por cerrada con eso; aquí solo el resumen operativo.

**Lo que se construyó:**

| Entrega                              | Resultado y comportamiento                                                                                                                                                                                                   | Evidencia / punto de entrada                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Datos reales del catálogo global** | 21 Empresas, 32 Estaciones y 2 Personas: Diana Damián Hernández y Oscar Bailón Delgado.                                                                                                                                      | [`estaciones.csv`](prisma/migracion-datos/datos/estaciones.csv) y [`personas.csv`](prisma/migracion-datos/datos/personas.csv) |
| **Importador seguro e idempotente**  | Crea faltantes; una segunda corrida no escribe. Si hay una edición manual, se detiene y reporta la divergencia. `--simular` no escribe; `--sincronizar` sobrescribe solo de forma explícita. No reactiva ni borra registros. | [`prisma/migracion-datos/`](prisma/migracion-datos/README.md)                                                                 |
| **Dos perfiles de base**             | Desarrollo carga configuración, catálogo real, fixtures y Superadmin. Producción carga únicamente configuración, catálogo real y Superadmin.                                                                                 | - `npm run db:reset`<br>- `npm run prod:bootstrap`                                                                            |
| **Modelo y reglas de catálogo**      | `Empresa` contiene exclusivamente entidades de Gasosur. `Proveedor` conserva sus propios datos fiscales. La clave de Bodega es automática; Bodega, Persona y Proveedor tienen unicidad normalizada por nombre.               | [`schema.prisma`](prisma/schema.prisma) e invariantes SQL                                                                     |
| **Verificación automatizada**        | 8 pruebas de integración en 4 grupos: carga inicial, segunda corrida sin escrituras, divergencias/rollback y sincronización explícita.                                                                                       | `npm run test` sobre base `*_prueba`                                                                                          |

**No se migra, y no está pendiente:** los 137 proveedores, los 225 artículos, los precios y
la existencia inicial. Compras los captura desde la aplicación. Si algún día entrega la
normalización, será una **carga operativa adicional** —tarea aparte, fuera de las fases—
por este mismo mecanismo, con el mapeo `codigo_viejo,bodega,clave_nueva`, sin reiniciar
producción; los artículos se renumerarían (`ART-00001`…) porque los 41 códigos que
aparecen en las dos bodegas designan artículos distintos en cada una. Mientras tanto los
artículos y proveedores demostrativos de `prisma/fixtures.ts` bastan para construir y
probar las fases 5 a 9.

**Sigue vigente:** el grupo opera alrededor de **40 estaciones** y hay más empresas de las
21 capturadas; el catálogo se completa desde la pantalla de estaciones, que ya existe.

**Criterio de aceptación — cumplido:** producción arranca con el catálogo global real, las
dos personas, la configuración mínima y el Superadmin; sin inventario. Verificado con
`prod:bootstrap` contra una base limpia: 21 empresas, 32 estaciones, 2 personas, 0
proveedores, 0 artículos.

## Fase 5 — Entradas

El contrato completo está en [`docs/11-fase-5-entradas.md`](docs/11-fase-5-entradas.md). Las entradas nacen completas: agregar dinero o capas después obligaría a reinterpretar todo lo ya capturado.

**Estado actual:** terminada en la `v0.5.0`. Los once pasos del contrato (§13) están
construidos y los catorce criterios de aceptación (§12) se prueban contra PostgreSQL real,
el 13 sobre las Server Actions reales.

### Alcance funcional

- Borrador editable con proveedor, factura o remisión, bodega destino y fecha del hecho
- **Moneda (MXN/USD), tipo de cambio e IVA** desde la primera versión
- Partidas capturadas como `UNIDAD` o `CAJA` y normalizadas en el servidor: `UNIDAD` usa
  factor 1, `CAJA` usa una fotografía de `Articulo.piezasPorCaja`; se conservan la cantidad,
  presentación, factor y costo originales de la captura
- Confirmación de recepción por un usuario: en una `ENTRADA`, **quien recibe es
  `confirmadoPor`**; `creadoPor` sigue diciendo quién capturó el borrador
- Una capa de costo por partida confirmada; esta fase **crea** las capas que las salidas
  consumirán después por PEPS
- Costos sin IVA y con IVA en `MovimientoPartida` y `CapaCosto`, siempre por **unidad base
  y en MXN**; el costo capturado puede ser por caja o unidad y el encabezado `Movimiento`
  conserva moneda, tipo de cambio y totales de la factura en su moneda original
- Recepciones parciales como varias `ENTRADA` del mismo proveedor y referencia, sin calcular
  cuánto falta por recibir mientras no exista una orden de compra

### Decisiones de integridad y concurrencia

- El borrador no tiene folio ni afecta existencias. Al confirmar, el encabezado se reclama
  con `FOR UPDATE`; la transición `BORRADOR → CONFIRMADO`, el folio, las capas y la
  existencia se escriben en una sola transacción
- El orden global de bloqueos es encabezado → proveedor → bodega → artículos por id →
  existencias por `articuloId` → folio. Proveedor, bodega y artículos se bloquean con
  `FOR SHARE` antes de releer y validar los catálogos
- Si aún no existe `Existencia` para un artículo/bodega, se crea en cero con
  `INSERT … ON CONFLICT DO NOTHING`; después se bloquea con `SELECT … FOR UPDATE`. En un
  movimiento con varias partidas, las filas se bloquean ordenadas por `articuloId`
- El folio se toma con `UPDATE … RETURNING`, nunca leyendo y después escribiendo, y **no se
  reinicia cada año**
- El alta busca primero una llave de idempotencia única y compara una firma canónica de
  toda la captura; la restricción única y el `SAVEPOINT` cubren solicitudes concurrentes.
  La confirmación usa además una transición condicional para que un doble clic devuelva el
  mismo movimiento y nunca duplique existencia ni folio
- Los errores de base fallan cerrados: solo los SQLSTATE propios `BG501`–`BG506` conservan
  el texto controlado; cualquier otro detalle de Prisma o PostgreSQL queda en el servidor
- `src/lib/fechas.ts` es la única frontera para fechas calendario:
  «hoy» se calcula en `America/Mexico_City`, un `@db.Date` se formatea en UTC y los instantes
  `…En` / `…At` se muestran en la zona de México
- El consumo PEPS completo será una función de PostgreSQL de un solo viaje cuando las
  salidas lo necesiten; no forma parte de confirmar una entrada

**Criterio de aceptación:** una entrada en dólares conserva los totales originales de la
factura y crea costos en pesos al tipo de cambio confirmado; dos primeras entradas
simultáneas del mismo artículo/bodega suman ambas cantidades sin perder actualizaciones;
repetir el alta o la confirmación devuelve el mismo movimiento; y después de cada
confirmación la existencia es exactamente igual a la suma de sus capas restantes. Una caja
de doce se guarda como 12 unidades y una futura salida de cinco piezas consumirá 5 y dejará
7; un cambio posterior en `piezasPorCaja` no reinterpreta el movimiento confirmado.

## Fase 6 — Salidas

El flujo completo, no la captura directa.

- Estados: `SOLICITADA → AUTORIZADA → ENTREGADA → RECIBIDA`, con `RECHAZADA` y `CANCELADO`
- Solicita el gerente **por WhatsApp y Compras captura a su nombre**; autoriza quien tenga
  la facultad; Compras entrega
- Estación y área destino; `entregadoA` como texto libre
- Captura como `UNIDAD` o `CAJA` reutilizando la misma normalización de la fase 5; una salida
  parcial consume unidades base, no cajas completas
- **Bloquear la salida sin existencia** y sin autorización
- Bandeja de entregas pendientes de confirmar recepción

**Hay que cerrar la pregunta 22 con Compras antes de construir esto:** *«¿se firma un vale
de salida? ¿necesitan imprimirlo desde el sistema?»* está marcada como bloqueante y sin
resolver. Si el vale existe, cambia el flujo —folio impreso, reimpresión, quién firma— y
toca esta fase, no una de acabado. Junto con la exportación a Excel, decide el stack de
impresión: hoja de estilo contra PDF generado en servidor.

**Criterio de aceptación:** el sistema impide una salida no autorizada aunque la pida un
gerente. Es el requisito #1 de Compras.

## Fase 7 — Traspasos, devoluciones y conteo

- Traspaso entre Magallanes y Servi Fer en una sola operación, **partiendo la capa** y
  conservando la fecha de la entrada original
- Devolución de estación a bodega, al costo de las capas que consumió la salida
- Préstamo con retorno, que queda abierto hasta que el material vuelve
- Inventario físico: hoja de conteo imprimible y captura de diferencias
- Cancelación con asiento inverso, devolviendo a las capas exactas vía `ConsumoCapa`

## Fase 8 — Reportes

- **Reporte de los viernes** para el Lic. Hugo: entradas, salidas y stock final
- Existencias por bodega con alerta de mínimos, **y el conteo de piezas sin valuar**
- Kardex por artículo
- **Gasto acumulado por estación**
- **Frecuencia de consumo por pieza** — es lo que usan para fijar el stock mínimo
- Exportación a Excel en todos los listados

## Fase 9 — Acabado

- Tablero de inicio
- Alertas de stock mínimo: primero por pantalla y correo; WhatsApp después
- Diseño responsivo verificado en celular (**H2**)
- Estados vacíos y confirmaciones antes de acciones irreversibles

---

## Transversal — Lo que la auditoría dejó fuera de las fases

| | Cuándo |
|---|---|
| **CI**: `tsc`, `eslint`, las cuatro pruebas de invariantes contra PostgreSQL real, y `prisma migrate diff` para detectar deriva | Cuanto antes: es lo que vuelve segura la política de *«en `0.x` romper está permitido»* |
| **Decidir dónde se despliega** (contenedor único frente a Vercel + Supabase) | Antes de la `v1.0.0` |
| **Política de respaldos** con RPO/RTO y un simulacro de restauración documentado | Antes de la `v1.0.0` |
| `migrate deploy` **fuera del build**, como paso de release; la primera vez, dentro de `prod:bootstrap` | Al desplegar |
| **Observabilidad**, con el release atado a la versión del pie de página | Antes de la `v1.0.0` |
| Quitar las dependencias instaladas sin usar | Cuanto antes |

---

## Tarea aparte — Histórico de movimientos

**240 entradas y 137 salidas** del Excel. No afecta las existencias, que ya entran por la
fase 4, así que puede hacerse en cualquier momento o no hacerse.

Bloqueada por dos cosas: en el histórico, `PORBA` y `SERVI FER` nombran a la empresa, no a
la estación, y solo Compras puede decir a cuál de sus dos o tres estaciones fue cada
salida; y necesita el mapeo de códigos viejos de la fase 4.

Migra sin costo, sin proveedor, sin área y sin moneda: el Excel no los tiene.

---

## Diferido

| Tema                                                                                                                  | Cuándo                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sacar los `.xlsx` y `.docx` con datos personales a un Drive**, dejando en `docs/` el análisis derivado y un reporte | Antes de que el repositorio deje de ser privado o entre alguien externo. El historial de git ya los contiene, así que ese es el disparador real |
| Autoservicio para gerentes de estación (rol `GERENTE`)                                                                | Cuando Compras lo pida                                                                                                                          |
| Requisición → orden de compra → recepción                                                                             | Cuando Compras lo pida; Diana lo quiere *«poco a poco»*                                                                                         |
| Integración con AuditorFiscalWeb                                                                                      | Sin acuerdo entre Diana y Oscar; no hay prisa                                                                                                   |
| Alertas por WhatsApp                                                                                                  | Después de que funcionen por pantalla y correo                                                                                                  |
| Adjuntar factura escaneada                                                                                            | Cuando haya dónde almacenar archivos                                                                                                            |

## Fuera de alcance

**Historial de mantenimiento.** No se registra dónde se instaló cada pieza ni quién
diagnosticó la falla. BodeGasosur lleva control de inventario y nada más.
