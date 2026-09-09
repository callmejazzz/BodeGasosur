	# BodeGasosur — Fases siguientes

Orden de trabajo a partir del levantamiento cerrado con Compras y de la
[auditoría de arquitectura](docs/09-auditoria.md). Reemplaza el plan original de
[`docs/04-plan-demo.md`](docs/04-plan-demo.md), que se conserva como referencia de cómo se
llegó hasta aquí.

**Ya construido:**

- **Fases 0 y 1** (`v0.1.0`) — cimientos, modelo de datos inicial y los catálogos con datos
  sembrados. Se le presentó a Compras como demo.
- **Fase 2** (`v0.2.0`) — cimientos corregidos.

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
- Los invariantes **escritos en la base**: 38 `CHECK` y los triggers de bitácora,
  inmutabilidad de claves, verificación de la facultad de autorizar y baja de bodega
- `fecha` como día y los instantes con zona horaria explícita
- Cantidades enteras; la unidad de medida pasa a significar presentación
- Nueve catálogos funcionando contra el esquema nuevo

**Criterio de aceptación — cumplido:** el esquema refleja lo acordado, los catálogos
existentes siguen funcionando y 35 invariantes se verifican contra PostgreSQL.

## Fase 3 — Usuarios y permisos

Bloquea la fase de salidas: no se puede impedir una salida sin autorización si el sistema
no sabe quién está capturando.

**Clerk autentica; PostgreSQL autoriza** ([01 §3.6](docs/01-arquitectura.md)). Eso saca del
proyecto las contraseñas, las sesiones, el límite de intentos y la recuperación, y deja
adentro lo único que no se puede delegar: el permiso.

### Los tres roles

| Rol | Empresas y Estaciones | Resto de las tablas | Movimientos |
|---|---|---|---|
| **Superadmin** | CRUD completo | CRUD completo | Todo |
| **Compras** | Lectura | Captura y edita catálogos operativos | Registra entradas, salidas, traspasos y devoluciones |
| **Jefe** | Lectura | Lectura | Consulta |

**La columna de Movimientos es diseño, no código.** Los movimientos se construyen en las
fases 5 a 7; hoy [`permisos.ts`](src/lib/permisos.ts) solo declara permisos de catálogos y
de usuarios. Las otras dos columnas sí están implementadas y verificadas rol por rol.

Además, transversal a los roles: la bandera **puede autorizar**, editable desde la pantalla
de usuarios.

**Por qué la bandera y no una lista en el código:** autorizan el Lic. Hugo, la Lic. Andrea
y el área de Compras, y la C.P. Cosumel también está facultada aunque quedó fuera de la
lista inicial. La lista cambia; el código no debería. La facultad de autorizar es
independiente del rol — un Jefe puede tenerla y un usuario de Compras puede no tenerla.

**Por qué tres y no cinco.** `ADMIN` se diferenciaba de `SUPERADMIN` solo en dos tablas:
eso es un permiso, no un rol. `GERENTE` implicaba administrar unas cuarenta cuentas de
gerentes de estación —altas, bajas, contraseñas, capacitación, soporte— para una solicitud
que de todos modos llega por WhatsApp y que Compras captura; el modelo ya lo soporta sin
darles cuenta, porque `solicitadoPor` apunta a una `Persona`. Es la lectura literal de lo
que Compras dijo, y quita el mayor costo operativo de la `v1.0.0`.

### Lo que se construyó

| Qué | Dónde |
|---|---|
| Identidad delegada a Clerk, en español, con pantalla de acceso propia | `src/app/(acceso)/`, `src/proxy.ts` |
| Arranque del primer Superadmin, idempotente y con guardas | `scripts/arranque-superadmin.ts` |
| Negación por omisión: `sin-sesion`, `sin-acceso` y `activa` | `sesionActual()` en `src/lib/db.ts` |
| Lectura autorizada, en transacción `REPEATABLE READ READ ONLY` | `consultar()` |
| Escritura autorizada, que fija `app.usuario_id` para la bitácora | `accionProtegida()` |
| Matriz de permisos tipada, con los catálogos globales separados de los operativos | [`src/lib/permisos.ts`](src/lib/permisos.ts) |
| El cliente de Prisma fuera de la capa de aplicación, con regla de ESLint | `src/lib/db.ts`, `eslint.config.mjs` |
| Webhooks de Clerk: atómicos, idempotentes por `svix-id`, limitados por tipo a tres tablas | `src/app/api/webhooks/clerk/`, `escrituraDeSistema()` |
| Pantalla de usuarios: conceder acceso, editar rol y bandera, activar y desactivar | `src/app/(sistema)/usuarios/` |
| Navegación y catálogos según el rol, con detalle de solo lectura para quien no escribe | `navegacion.tsx`, `catalogos/[slug]/` |
| Un solo usuario **activo** por correo, sin límite en los históricos | índice parcial en `prisma/sql/despues/` |
| Registro de accesos y de entregas de webhook | `EventoAcceso`, `EventoWebhook` |

Tres cosas conviene no perder de vista al leer esa tabla:

- **La frontera son `consultar()` y `accionProtegida()`, no la pantalla.** Ocultar un botón
  o una sección del menú es presentación. Las acciones de servidor son URLs propias y no
  pasan por ningún layout.
- **`accionProtegida` es el único camino de escritura de la capa de aplicación**, no del
  sistema entero: el webhook escribe por `escrituraDeSistema()` y el arranque por su
  script, y las dos declaran su origen para la bitácora.
- `Usuario.correo` **no es único**. La identidad canónica es `clerkUserId`; una baja
  conserva su fila con todo el histórico colgando.

### Lo que queda diferido

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

## Fase 4 — Migración de catálogos

- 22 empresas y 32 estaciones desde `Estaciones.xlsx`, con el RFC normalizado sin guiones
- **Pantalla de alta y edición de estaciones** — el catálogo llega incompleto: el grupo
  opera alrededor de **40 estaciones** y hay más empresas de las 22 capturadas
- 137 proveedores; los 33 que son empresas del grupo se enlazan a la `Empresa` existente
- 225 artículos **renumerados** por el sistema (`ART-00001`…)
- Personas, unificando las catorce grafías de nueve nombres reales
- Existencia inicial como movimiento de `AJUSTE` por bodega, **con capa de costo nulo**

**Por qué renumerar:** los 41 códigos que aparecen en las dos bodegas designan artículos
distintos en cada una. El código actual no puede migrarse como clave.

**Los códigos viejos no se guardan en la base.** Se decidió que conservarlos era trabajo
extra de poco valor: BodeGasosur asigna claves nuevas y la normalización de las
descripciones se hace a mano. Lo que sí tiene que existir es el **mapeo**
`codigo_viejo,bodega,clave_nueva` como archivo versionado en `prisma/migracion-datos/`,
producto de esa misma normalización — sin él, la tarea aparte del histórico deja de ser
posible para siempre.

**Cómo se ejecuta:** código idempotente y versionado en `prisma/migracion-datos/`,
ejecutable N veces contra una base limpia. No trabajo manual en Studio.

**El corte:** congelar el Excel un viernes, correr la migración con el archivo de ese día,
operar ambos en paralelo una semana y conciliar. Esa semana es lo que compra la confianza
de Compras, y de paso es la mejor prueba posible de los invariantes.

**Criterio de aceptación:** el sistema arranca con las existencias reales de ambas bodegas,
la conciliación de la semana en paralelo cierra sin diferencias, y el mapeo de códigos
viejos queda versionado en el repositorio.

## Fase 5 — Entradas

Nacen completas: agregar dinero después obligaría a recalcular todo lo capturado.

- Proveedor, factura o remisión, bodega destino, quién recibe
- **Moneda (MXN/USD), tipo de cambio e IVA**
- Capas de costo por entrada, consumidas por **PEPS**
- Cada costo se guarda sin IVA y con IVA, para valuar el inventario de las dos formas
- Captura en caja o pieza, convirtiendo a la unidad base
- Entregas parciales de una misma compra

**Antes de escribir el consumo PEPS** hay que resolver la concurrencia, que hoy son tres
carreras clásicas ([09 §5](docs/09-auditoria.md)):

- Toda mutación de existencia empieza bloqueando la fila de `Existencia` con
  `SELECT … FOR UPDATE`
- El folio se toma con `UPDATE folio SET siguiente = siguiente + 1 … RETURNING`, nunca
  leyendo y después escribiendo
- El consumo PEPS entero en **un solo viaje**, como función de PostgreSQL
- Idempotencia por transición condicional, para que un doble clic no duplique el movimiento

**Decisión pendiente:** ¿el folio reinicia cada año? (`E-2026-00001`). En la práctica
mexicana casi siempre sí, y es un cambio de dato, no de formato.

**Criterio de aceptación:** una entrada en dólares queda valuada en pesos al tipo de cambio
del día y no cambia después; dos capturas simultáneas del mismo artículo nunca dejan
existencia negativa.

## Fase 6 — Salidas

El flujo completo, no la captura directa.

- Estados: `SOLICITADA → AUTORIZADA → ENTREGADA → RECIBIDA`, con `RECHAZADA` y `CANCELADO`
- Solicita el gerente **por WhatsApp y Compras captura a su nombre**; autoriza quien tenga
  la facultad; Compras entrega
- Estación y área destino; `entregadoA` como texto libre
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
| `migrate deploy` **fuera del build**, como paso de release | Al desplegar |
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

| Tema | Cuándo |
|---|---|
| **Sacar los `.xlsx` y `.docx` con datos personales a un Drive**, dejando en `docs/` el análisis derivado y un reporte | Antes de que el repositorio deje de ser privado o entre alguien externo. El historial de git ya los contiene, así que ese es el disparador real |
| Autoservicio para gerentes de estación (rol `GERENTE`) | Cuando Compras lo pida |
| Requisición → orden de compra → recepción | Cuando Compras lo pida; Diana lo quiere *«poco a poco»* |
| Integración con AuditorFiscalWeb | Sin acuerdo entre Diana y Oscar; no hay prisa |
| Alertas por WhatsApp | Después de que funcionen por pantalla y correo |
| Adjuntar factura escaneada | Cuando haya dónde almacenar archivos |

## Fuera de alcance

**Historial de mantenimiento.** No se registra dónde se instaló cada pieza ni quién
diagnosticó la falla. BodeGasosur lleva control de inventario y nada más.
