# Cambios

Todo lo que va entrando a BodeGasosur, versión por versión. Las versiones se numeran según
la política de [versionado y despliegue](docs/08-versionado-y-despliegue.md).

Se escribe para quien usa el sistema, no para quien lo programa: cada entrada dice qué se
puede hacer ahora que antes no se podía.

---

## v0.4.0 — 2026-09-12

Cierra la fase 4: migración de catálogos, bajo el **Plan B** de
[`docs/10-plan-b-produccion.md`](docs/10-plan-b-produccion.md). Es la primera versión con
datos reales de Gasosur adentro, y la que decide cómo va a arrancar producción: **limpia de
inventario**. Compras captura proveedores y artículos desde la aplicación; el Excel no se
migra.

**Lo que cambia para quien va a usar el sistema**

- **Las empresas y estaciones ya son las reales**: 21 empresas y 32 estaciones del grupo,
  tomadas de `Estaciones.xlsx`, y dos personas de Compras. Lo que falte —el grupo opera
  unas 40 estaciones— se captura desde la pantalla de estaciones.
- **Empresas es solo el grupo Gasosur.** El proveedor lleva ahora su propia razón social
  y su RFC en su pantalla; ya no se elige una empresa del catálogo global para darlo de
  alta.
- **La clave de bodega la asigna el sistema** (`BDG-00001`, `BDG-00002`…), igual que la
  de artículo. Ya no se captura.
- **No puede haber dos bodegas, dos personas ni dos proveedores con el mismo nombre**,
  aunque cambien las mayúsculas o los espacios. El sistema lo avisa al guardar.
- **Nada de lo que se edite en pantalla se pierde por volver a cargar el catálogo.** Si
  el archivo de Compras y la base difieren, la carga se detiene y dice qué campo, qué valor
  hay en cada lado y quién hizo el último cambio; sobrescribir es una decisión explícita.

**Por dentro**

- Dos perfiles de base que no comparten comando: `db:reset` para desarrollo, con
  fixtures que **fallan por omisión** (exigen `BODEGASOSUR_FIXTURES=permitidos` y una base
  sin operación), y `prod:bootstrap` para producción — manual, valida el entorno antes de
  `migrate deploy`, rechaza una base que ya opere y exige teclear el nombre de la base.
- `prisma/migracion-datos/`: importador en dos pasadas —planea, luego escribe— dentro de
  una transacción firmada `migracion-datos` en la bitácora; `--simular` y `--sincronizar`.
- **Vitest** contra el PostgreSQL real, en una base `*_prueba` que se recrea en cada
  corrida, con las cuatro pruebas del importador. Primer paso hacia las pruebas de
  invariantes de la auditoría (E1).
- `Proveedor` deja de apuntar a `Empresa`; `Bodega.clave` por secuencia; índices únicos
  normalizados por nombre. `src/lib/rfc.ts` es la única regla del RFC, compartida por la
  pantalla y la migración.
- `prisma/seed.ts` se reparte en `prisma/configuracion.ts` (lo mínimo real) y
  `prisma/fixtures.ts` (lo demostrativo).

**Por saber**

- **La migración inicial se volvió a regenerar.** Toda base de desarrollo creada con la
  `v0.3.0` se recrea con `npm run db:reset`, después de descomentar
  `BODEGASOSUR_FIXTURES` en `.env`. Sigue sin haber producción; después de la `v1.0.0`
  esto ya no será posible.
- **Los 225 artículos, los 137 proveedores y la existencia inicial no están pendientes.**
  Si Compras entrega una normalización confiable, entran como carga operativa adicional,
  auditada y sin reiniciar producción.
- Un hallazgo para cuando Compras capture proveedores: en su hoja, `ALCARAZ SOBERANIS
  (CHILPO 4)` trae el RFC de Muller y Asociados ([07 §6](docs/07-datos-actuales.md)).

## v0.3.0 — 2026-09-09

Cierra la fase 3: usuarios y permisos. Es la primera versión en la que el sistema sabe
quién está usándolo, y la que desbloquea las salidas — no se puede impedir una salida sin
autorización si el sistema no sabe quién captura.

**Lo que cambia para quien va a usar el sistema**

- **Ahora se entra con una cuenta.** Tener cuenta no es tener acceso: hasta que el
  Superadmin da de alta a la persona, el sistema no la deja pasar y deja constancia del
  intento.
- **Tres roles.** El **Superadmin** hace todo; **Compras** captura y edita los catálogos
  operativos; el **Jefe** solo consulta. Empresas y Estaciones únicamente las edita el
  Superadmin, porque otros sistemas del grupo las leen.
- **La facultad de autorizar es una casilla del usuario**, no una lista dentro del
  programa. Se da y se quita desde la pantalla de usuarios, **surte efecto en la siguiente
  pantalla que se abra** —no hay que esperar a que nadie vuelva a entrar— y queda en la
  bitácora con quién la cambió.
- **Quien no puede editar ya no ve botones de editar.** Antes el sistema dejaba abrir el
  formulario y solo avisaba al guardar; ahora muestra el detalle en modo consulta, con
  todos los datos, incluidos el móvil y el correo de las estaciones que la tabla no enseña.
- **Se corrigieron tres fallas de captura que venían de antes.** Un artículo sin «piezas
  por caja» era imposible de guardar —eran 43 de los 52—; al fallar un guardado la clave
  del artículo desaparecía de la pantalla; y editar un registro cuya categoría, unidad o
  empresa se había dado de baja borraba ese vínculo, a veces sin avisar.

**Por dentro**

- **Clerk** para la identidad; PostgreSQL para el permiso. El rol y la facultad se leen de
  la base en cada petición y nunca viajan dentro del token de sesión: por eso revocar
  surte efecto de inmediato.
- Toda lectura pasa por `consultar()`, en una transacción de solo lectura que PostgreSQL
  hace cumplir, y toda escritura de la aplicación por `accionProtegida()`. El cliente de
  Prisma salió de la capa de aplicación y una regla de ESLint lo sostiene: no hay a qué
  llamarle sin pasar por el permiso.
- Los webhooks de Clerk sincronizan el correo y desactivan a quien se dio de baja allá,
  **sin borrar nunca su fila** — el libro tiene que seguir diciendo quién autorizó cada
  salida años después. Cada entrega se aplica entera o no se aplica.
- `Usuario.correo` deja de ser único: la identidad es el identificador de Clerk. Un índice
  parcial impide lo único que no puede pasar, dos cuentas **activas** con el mismo correo.

**Por saber**

- **El registro sigue abierto** para poder crear los primeros usuarios. Se cierra a
  invitación antes de la `v1.0.0`.
- **La migración inicial se volvió a regenerar**, así que cualquier base creada con la
  `v0.2.0` tiene que recrearse desde cero con `npm run db:reset`. Sigue sin haber datos
  reales de Gasosur; después de la `v1.0.0` esto ya no será posible.
- Hace falta configurar Clerk en `.env` — ver [`.env.example`](.env.example)—. Sin eso, el
  sistema no arranca.
- Todavía no hay pruebas automatizadas. Se construyen en la fase 4.

*Migración: `20260901130247_inicial` — regenerada, reemplaza a `20260825172744_inicial`*

---

## v0.2.0 — 2026-08-25

Cierra la fase 2: los cimientos corregidos. Es una versión de estructura — casi nada de lo
que trae se ve en pantalla todavía, y ese es el punto: son las decisiones que después no se
pueden cambiar barato. Sale de la auditoría de arquitectura
([09-auditoria.md](docs/09-auditoria.md)) y de las decisiones que se tomaron sobre ella.

**Lo que cambia para quien va a usar el sistema**

- **El inventario ya nunca podrá quedar en negativo, ni salir sin autorización.** Hasta
  ahora esas dos reglas estaban escritas en los documentos; ahora la base de datos las
  rechaza, aunque el error venga de un programa mal hecho o de una corrección a mano.
- **Queda registro de quién hace cada cosa.** Cada movimiento guarda quién lo creó, quién
  lo autorizó, quién lo entregó y a qué hora, y una bitácora aparte guarda todo cambio a
  cualquier dato — incluido quitarle a alguien la facultad de autorizar, que hasta ahora
  era el único permiso sin historia.
- **Las fechas dejan de correrse un día.** Un movimiento capturado a las seis de la tarde
  en Acapulco se guardaba con la fecha del día siguiente. Ya no.
- **Las cantidades son piezas enteras** y la unidad de medida describe la presentación —una
  cubeta, un rollo, un par—, no una magnitud.
- **La clave del artículo la pone el sistema** (ART-00001, ART-00002…) y ya no se puede
  cambiar después. Las claves viejas del Excel no se conservan en el sistema.
- Los inicios de sesión quedan registrados aparte, y quien tenga cuenta pero no permiso no
  entra.

**Por dentro**

- Llaves primarias a UUIDv7, esquema `catalogo_gasosur` para Empresas y Estaciones, y
  vistas versionadas para que otros sistemas del grupo lo lean sin poder escribirlo.
- Tablas nuevas de fases posteriores, creadas desde ahora para no volver a migrar:
  usuarios, capas de costo PEPS, consumos, bitácora, eventos de acceso y de webhook.
- La autenticación será **Clerk**; los permisos y la auditoría se quedan en PostgreSQL,
  que es lo que permite revocar un permiso al instante.
- Los invariantes dejan de estar solo escritos en español: 45 `CHECK` y 20 triggers los
  hacen cumplir en la base, así que también valen para `prisma studio` y para una
  consulta directa.

**Por saber**

- **La migración inicial se regeneró.** `20260818075624_inicial` se borró y en su lugar hay
  una sola migración limpia con el modelo corregido. Cualquier base creada con la versión
  anterior tiene que volver a crearse desde cero: no hay ruta de actualización, y no hace
  falta porque todavía no hay datos reales de Gasosur. Después de la `v1.0.0` esto ya no
  será posible.
- Los datos sembrados siguen siendo de ejemplo. Los reales llegan en la fase 4.

*Migración: `20260825172744_inicial` — regenerada desde cero, reemplaza a `20260818075624_inicial`*

---

## v0.1.0 — 2026-08-21

Primera versión etiquetada. Cierra las fases 0 y 1: los cimientos, el modelo de datos y los
ocho catálogos. Todavía no hay captura de movimientos.

**Nuevo**

- **Ocho catálogos** con alta, edición, búsqueda y baja lógica: bodegas, estaciones, áreas,
  unidades de medida, categorías, artículos, proveedores y personas.
- **Tablero** con el avance de la demo y los datos base cargados.
- **Datos sembrados** para poder enseñar el sistema: 3 bodegas, 10 estaciones, 50 artículos
  típicos de estación de servicio, 7 proveedores y 12 personas.
- Las tablas de movimientos, partidas, existencias y folios ya existen en la base de datos,
  aunque las pantallas de captura son de fases posteriores.

**Documentación**

- Levantamiento de requerimientos cerrado con Compras: cinco de diez supuestos resultaron
  falsos y quedaron registrados en
  [hallazgos](docs/05-hallazgos-levantamiento.md).
- Catálogo del grupo levantado del Excel vigente: 22 empresas y 32 estaciones
  ([06-estaciones.md](docs/06-estaciones.md)), y el análisis del inventario actual con su
  plan de migración ([07-datos-actuales.md](docs/07-datos-actuales.md)).
- Orden de trabajo vigente en [`fases-siguientes.md`](fases-siguientes.md).

**Por saber**

- El esquema de esta versión será corregido por la fase 2: llaves primarias a UUIDv7, rutas
  por clave de negocio y el esquema `catalogo_gasosur`. Los datos sembrados son de ejemplo,
  no los reales de Gasosur — esos llegan en la fase 4.

*Migración: `20260818075624_inicial`*
