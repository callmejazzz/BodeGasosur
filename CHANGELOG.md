# Cambios

Todo lo que va entrando a BodeGasosur, versión por versión. Las versiones se numeran según
la política de [versionado y despliegue](docs/05-versionado-y-despliegue.md).

Se escribe para quien usa el sistema, no para quien lo programa: cada entrada dice qué se
puede hacer ahora que antes no se podía.

---

## v0.7.1 — 2026-10-09

Última migración incluida: `20261008100000_entrada_con_sus_capas`.

Correcciones de la revisión de `v0.7.0`.

**Lo que cambia para quien va a usar el sistema**

- **Ninguna lista esconde registros.** Entradas, salidas, pendientes, traspasos,
  devoluciones, ajustes, préstamos, conteo físico, catálogos y usuarios muestran hasta 100
  por página; desde el 101 se pasa a la siguiente sin perder la búsqueda ni los filtros.
  Antes, préstamos se cortaba en 500 y las demás listas pedían afinar los filtros o ir
  por tramos.
- **También dentro de cada detalle.** Las partidas de entradas, salidas, traspasos,
  devoluciones y ajustes, el saldo y las devoluciones de una salida, las otras recepciones
  de la misma factura y los artículos de la hoja de conteo van de 100 en 100. Al capturar,
  las partidas de otras páginas no se pierden: se guardan completas, y si a una le falta
  un dato, la página se abre sola para corregirlo.
- **El selector de salida de una devolución se busca tecleando.** Sigue mostrando las
  salidas de la estación que aún tienen algo por volver, la más reciente primero y de 100
  en 100; al teclear el folio (`S-000123`, `s123` o `123`), el número o el nombre se
  filtra. Si la salida buscada no aparece porque ya volvió todo, fue revertida o salió a
  otra estación, lo dice. Lo mismo al llegar desde una salida o un préstamo con
  «Registrar devolución».
- **Una hoja de conteo no se confirma con valores sin guardar.** Si el guardado falla,
  «Confirmar conteo» sigue bloqueado y la hoja sigue avisando que hay cambios sin guardar.

**Por dentro**

- La base exige que una entrada confirmada tenga exactamente una capa por partida, con su
  cantidad y su costo: ya no se puede confirmar, ni con SQL directo, sin que suba la
  existencia. La migración revisa las entradas existentes antes de terminar.
- La lista y su total salen de una sola consulta; una página que ya no existe muestra la
  última.
- El selector de salidas no se precarga: lee cada página bajo demanda, con sesión y
  permiso de captura, igual que la pantalla.
- 469 pruebas contra PostgreSQL real.

## v0.7.0 — 2026-10-02

Commit `2ac6ca3`, con su etiqueta.

Última migración incluida: `20261001150000_bitacora_en_hora_de_mexico`.

Cierra la fase 7: traspasos, devoluciones y conteo. Con esta versión el material se mueve
entre bodegas sin perder su costo, vuelve de las estaciones, los préstamos dicen cuánto
falta, el inventario físico corrige la existencia y cualquier asiento cerrado se corrige
con otro asiento, sin borrar nada.

**Lo que cambia para quien va a usar el sistema**

- **Traspasos entre bodegas.** Compras captura origen, destino y partidas, por unidad o por
  caja, y los corrige mientras son borrador. Al confirmar, el material sale de las capas más
  antiguas del origen y llega al destino con su fecha de entrada y su costo originales, con
  folio `T-000001`. La valuación total no cambia. Si no alcanza, no se mueve nada.
- **Devoluciones desde las estaciones.** Ligadas a una salida, regresan a la bodega de la
  que salió —no se puede elegir otra—, solo ofrecen sus artículos, muestran cuánto falta
  por volver y no dejan devolver de más; el material vuelve con el costo con el que salió.
  Sin salida, entran sin costo a la bodega que se elija y se marcan como procedencia no
  comprobada. Folio `D-000001`.
- **Préstamos.** Una pantalla junta las salidas prestadas con lo que salió, lo que volvió y
  lo que falta. Siguen abiertas hasta que vuelve la última pieza. La salida muestra su
  saldo y sus devoluciones, y lleva a registrar la siguiente. La lista de salidas marca
  «Devuelto» cuando volvió todo y «Devuelto parcial» cuando volvió una parte.
- **Conteo físico.** Se abre una hoja por bodega con la existencia de cada artículo, se
  captura lo contado —vacío significa «no se contó»— y se puede agregar lo que apareció.
  Si alguien movió inventario mientras se contaba, confirmar lo avisa y la hoja se actualiza
  para revisar las diferencias nuevas. Al confirmar, lo que sobra entra sin costo y lo que
  falta se descuenta por PEPS, en ajustes con folio `A-000001` y el motivo de la hoja.
- **Reversas.** El Superadmin corrige cualquier entrada, salida retirada, traspaso,
  devolución o ajuste con un asiento inverso, con motivo y folio propios. El original no se
  borra ni se edita; muestra con qué se revirtió. El material vuelve a las capas exactas de
  las que salió. Si lo que entró ya se usó, o una salida tiene devoluciones vigentes, la
  pantalla dice qué revertir antes.
- **Lo que se puede seguir.** Cada detalle muestra de qué capa salió cada pieza, a cuál
  entró y a cuál volvió, con su costo y el movimiento de origen; las listas marcan lo
  revertido y lo que es reversa.
- **Quién ve qué.** Compras y Superadmin capturan y confirman traspasos, devoluciones y
  conteos; el Jefe los consulta; solo el Superadmin revierte. Quien no puede capturar no
  ve los botones ni se le cargan catálogos o existencias.
- **Un doble clic no duplica nada:** ni borradores, ni folios, ni ajustes, ni reversas.
- **Listas ordenadas por estatus.** Entradas, salidas, traspasos, devoluciones y ajustes
  muestran primero los borradores (en salidas, las solicitadas y autorizadas), luego lo
  que tiene folio, del más alto al más bajo, y al final lo descartado, rechazado o
  cancelado.
- **Buscar sin acentos.** «marquez» encuentra a «Márquez» y «pena» a «Peña», en entradas,
  salidas, traspasos, devoluciones, ajustes y catálogos.
- **Salidas: solo préstamos.** Una casilla en la lista deja ver solo las salidas prestadas.
- **Conteo físico por fecha.** Las hojas se filtran por el día en que se abrieron, con el
  mismo selector de fechas que entradas.
- **Estatus ordenados.** Las insignias de estado van hasta tres por renglón; desde la
  cuarta pasan al siguiente.
- **La reversa de un traspaso ya no aparece como otro traspaso.** Queda en el historial
  del traspaso revertido, con su folio y su motivo; buscar ese folio lleva al revertido.
- **Los avisos de error se van al dar «Volver»** al revertir o al descartar un borrador o
  una hoja de conteo, también en entradas.

**Por dentro**

- Tablas nuevas `HojaConteo`, `RenglonConteo` y `RestitucionCapa`, y `Movimiento.conteoId`.
  La migración es incremental y revisa el inventario existente antes de terminar.
- Un trigger diferido comprueba, al confirmar cada transacción, que las capas, consumos y
  restituciones de cada movimiento sean exactamente lo que dicen sus partidas, que ninguna
  devolución exceda lo retirado y que una hoja confirmada deje la existencia en lo contado.
  Otro trigger impide que una devolución ligada entre a una bodega distinta de la de su
  salida. Vale también para escrituras SQL directas.
- Las operaciones bloquean encabezados, catálogos, existencias de ambas bodegas en orden
  estable y capas en orden PEPS, sin saltar candados. Movimientos cruzados no se
  interbloquean.
- Todas las acciones pasan por la puerta con sesión, permiso y el token de Clerk que
  verifica la base; la bitácora conserva actor, instante y `jti`.
- La búsqueda de texto usa una función de la base, `texto_buscable()`, que quita acentos
  y mayúsculas a los dos lados de la comparación.
- La base muestra las horas en la de la Ciudad de México: bitácora, accesos y cualquier
  `…En` se leen igual que en el reloj de la oficina, también los registros anteriores. Las
  copias que guarda la bitácora de cada cambio también llevan la hora de México.
  La aplicación sigue hablando con la base en UTC, que es lo que espera Prisma.
- 448 pruebas contra PostgreSQL real.

## v0.6.0 — 2026-09-28

Cierra la fase 6: salidas. Con esta versión el inventario también baja: el material sale de
una bodega hacia una estación con autorización, se descuenta con el costo de las capas más
antiguas y queda registrado quién lo pidió, quién lo autorizó, quién lo entregó, quién se
lo llevó y cuándo llegó.

**Lo que cambia para quien va a usar el sistema**

- **Ya se solicitan salidas.** Compras captura bodega de origen, estación destino, quién lo
  pide, área, si es préstamo y una partida por artículo, por unidad o por caja. La solicitud
  no lleva folio ni toca la existencia. Mientras se captura, cada partida muestra cuánto hay
  en la bodega elegida y avisa si no alcanza.
- **Alguien facultado la autoriza o la rechaza.** Lo puede hacer cualquier rol con la
  facultad de autorizar marcada en Usuarios; rechazar pide motivo. Autorizar no aparta
  material ni asigna folio. Una solicitud ya no se edita: para corregirla se cancela, con
  motivo, y se pide otra.
- **Registrar el retiro es cuando el material sale.** Se indica quién se lo lleva; el sistema
  asigna el folio (`S-000001`, `S-000002`…), descuenta la existencia y toma el costo de las
  capas más antiguas primero (PEPS). Si no alcanza, no se retira nada ni se gasta folio.
  Antes de retirar, la pantalla muestra lo que hay en la bodega y avisa si un artículo, la
  bodega o la estación se dieron de baja, o si un artículo cambió de piezas por caja.
- **Confirmar la recepción cierra la salida**, con quién y cuándo confirmó que llegó a la
  estación. No vuelve a mover inventario.
- **Pendientes.** Una pantalla junta lo que espera a cada quien —por autorizar, por retirar
  y por confirmar recepción—, lo más antiguo primero. Cada persona ve solo lo que puede
  atender.
- **Detalle de cada salida** con su historial (quién capturó, autorizó, rechazó, retiró,
  recibió o canceló, y cuándo), de qué entrada salió cada pieza y a qué costo, y el importe
  con y sin IVA.
- **Lista de salidas** con búsqueda por folio, bodega, estación, solicitante o quién se lo
  llevó, filtro por estatus, y recorrido completo aunque haya más de 200.
- **Un doble clic no duplica nada:** ni la solicitud, ni el folio, ni el descuento. Registrar
  otra vez un retiro con otro nombre en «quién se lo lleva» avisa que ya se retiró y quién
  se lo llevó.
- **Si otra persona ya movió la salida**, la pantalla lo dice y muestra dónde quedó en vez
  de dejar botones que ya no aplican.
- **Quién ve qué.** Compras y Superadmin solicitan, cancelan, retiran y confirman
  recepción; el Jefe consulta; autoriza quien tenga la facultad. El servidor lo exige en
  cada envío, y quitar un permiso surte efecto en la siguiente acción.
- Un select obligatorio sin elegir ahora dice «No se seleccionó nada», también en Entradas.

**Por dentro**

- Estados `SOLICITADA` → `AUTORIZADA` → `RETIRADA` → `RECIBIDA`, con `RECHAZADA` y
  `CANCELADO` terminales. La base impide saltar estados, retirar sin autorización o sin
  consumos, cambiar partidas autorizadas y borrar salidas, también por SQL directo.
- El retiro bloquea encabezado, catálogos, existencias y capas en orden fijo y consume PEPS
  en una sola sentencia. Un trigger diferido concilia consumos, capas y existencia antes de
  confirmar cada transacción.
- **Actor verificable.** Cada escritura protegida lleva un token RS256 de Clerk (plantilla
  `bodegasosur-db`, 30 segundos) que PostgreSQL verifica con la llave pública cargada por
  el dueño. La bitácora toma de ahí al actor: el usuario de ejecución ya no puede atribuir
  cambios a otra persona ni escribir en la bitácora, y nadie puede escalar su rol ni cambiar
  el `clerkUserId` de una cuenta.
- Rol, actividad y facultad de autorizar se releen bajo candado antes de confirmar: una
  revocación concurrente revierte la acción o la espera.
- Usuarios y Catálogos comprueban sesión y permiso antes de leer el formulario, y las
  pantallas de Salidas no consultan lo que el usuario no puede ver.
- Los scripts de datos y de arranque escriben con la conexión del dueño. Scripts nuevos:
  `db:llaves-clerk`, `db:probar-token` y `clerk:medir-token`.
- 344 pruebas contra PostgreSQL real, con los vectores Wycheproof para la firma y pruebas
  de concurrencia para retiro, autorización y revocación.

**Por saber**

- **Cada base necesita la llave pública de Clerk.** La plantilla JWT `bodegasosur-db` tiene
  que existir en Clerk y su llave cargarse con `npm run db:llaves-clerk`; sin ella no pasa
  ninguna escritura. `db:reset` ya la carga. Las migraciones son incrementales: una base de
  la `v0.5.0` se actualiza sin recrearse.
- En producción el actor verificable se despliega en dos etapas, y la rotación de llaves de
  Clerk es manual: el servidor avisa si aparece una llave sin cargar.
- No hay vale imprimible de salida, por decisión del 2026-09-23.
- Devolver un préstamo, revertir una salida ya retirada y los traspasos son de la fase 7.
  El histórico de salidas no se importa.

*Migración: `20260927130000_facultad_bajo_candado`*

---

## v0.5.0 — 2026-09-21

Cierra la fase 5: entradas. Es la primera versión en la que el inventario se mueve: lo
que llega de un proveedor entra a una bodega, con su costo, y a partir de aquí las
existencias dejan de ser cero.

**Lo que cambia para quien va a usar el sistema**

- **Ya se capturan entradas.** Compras registra lo que llega de un proveedor —factura o
  remisión, bodega destino, fecha de recepción— con una partida por artículo, por unidad
  o por caja. Se guarda como **borrador**: se puede editar, descartar o dejar para después
  sin tocar la existencia.
- **Confirmar la recepción es un paso aparte.** Al confirmar, el sistema asigna el folio
  (`E-000001`, `E-000002`…), sube la existencia de la bodega y deja el costo congelado. Una
  entrada confirmada ya no se edita ni se borra.
- **Cajas y piezas.** Una caja de 12 se captura como una caja; el sistema la convierte a
  12 piezas con el costo por pieza. Si el artículo cambia de piezas por caja después,
  el borrador pide volver a guardarse antes de confirmar; lo confirmado no se reinterpreta.
- **Facturas en dólares.** Se captura en USD con el tipo de cambio del día; los importes
  de la factura se conservan en dólares y el costo de inventario queda en pesos.
- **La fecha de recepción es hoy o anterior**, según el día en México, y no antes del
  año 2000.
- **Un doble clic no crea dos entradas ni consume dos folios.** Repetir el alta o la
  confirmación devuelve lo mismo.
- **Lista de entradas** con búsqueda en vivo por folio, referencia, proveedor o bodega
  —`e1` encuentra `E-000001`, `bdg2` encuentra `BDG-00002`—, filtros por estatus, con o
  sin referencia y rango de fechas en un calendario. Los borradores van siempre arriba.
- **Quién ve qué.** Compras y Superadmin capturan y confirman; el Jefe consulta. Ninguna
  pantalla ni acción se salta esa regla, y el servidor la vuelve a exigir en cada envío.

**Por dentro**

- `MovimientoPartida` guarda la captura tal cual (presentación, cantidad, factor y costo
  capturado) además de la cantidad y el costo canónicos en MXN por unidad base; el orden
  de captura se conserva. Llave de idempotencia por borrador.
- El dinero se calcula y redondea en PostgreSQL (`costo_base_mxn`, `importe_renglon`),
  nunca en JavaScript; los rangos se comprueban en la base antes de escribir.
- Invariantes nuevos en la base: un confirmado es inmutable, incluso hacia cancelado; un
  movimiento nace en borrador y su tipo no cambia; una entrada no lleva actores de
  autorización ni entrega; partidas y confirmación toman el mismo bloqueo.
- Orden fijo de bloqueos —encabezado, proveedor, bodega, artículos, existencias, folio— y
  errores de la base traducidos «fallando cerrado»: solo los `RAISE` propios (`BG501`–
  `BG506`) conservan su texto.
- Las Server Actions solo llegan a la base por `consultar()` y `accionProtegida()`; una
  prueba lee el código fuente y lo vigila.
- Prisma con `relationJoins`: las relaciones se cargan en una sola sentencia en vez de en
  paralelo sobre la conexión de la transacción (pg 9 lo rechazaría).
- 142 pruebas contra PostgreSQL real: los 14 criterios de aceptación del contrato
  ([contrato de Entradas](docs/contratos-otros/02-fase-5-entradas.md) §12), el criterio 13 sobre
  las Server Actions reales.

**Por saber**

- **La migración inicial se volvió a regenerar.** Toda base de desarrollo se recrea con
  `npm run db:reset`. Sigue sin haber producción.
- Las salidas, traspasos y reportes siguen pendientes: la existencia sube, todavía no
  baja.
- En celular, la barra lateral sigue ocupando media pantalla; es de la fase 9.

---

## v0.4.0 — 2026-09-12

Cierra la fase 4: migración de catálogos, bajo el **Plan B** de
[Plan B para producción](docs/contratos-otros/01-plan-b-produccion.md). Es la primera versión con
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
  (CHILPO 4)` trae el RFC de Muller y Asociados ([04 §6](docs/04-datos-actuales.md)).

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
([04-auditoria-arquitectura.docx](docs/cimientos-word/04-auditoria-arquitectura.docx)) y de las decisiones que se tomaron sobre ella.

**Lo que cambia para quien va a usar el sistema**

- **El inventario ya nunca podrá quedar en negativo, ni salir sin autorización.** Hasta
  ahora esas dos reglas estaban escritas en los documentos; ahora la base de datos las
  rechaza, aunque el error venga de un programa mal hecho o de una corrección a mano.
- **Queda registro de quién hace cada cosa.** Cada movimiento guarda quién lo creó, quién
  lo autorizó, quién lo entregó y a qué hora, y una bitácora aparte guarda los cambios de
  negocio en las tablas auditadas — incluido quitarle a alguien la facultad de
  autorizar, que hasta ahora era el único permiso sin historia.
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
  [hallazgos](docs/cimientos-word/03-hallazgos-levantamiento.docx).
- Catálogo del grupo levantado del Excel vigente: 22 empresas y 32 estaciones
  ([03-estaciones.md](docs/03-estaciones.md)), y el análisis del inventario actual con su
  plan de migración ([04-datos-actuales.md](docs/04-datos-actuales.md)).
- Estado y plan de las fases en [entregables por fase](docs/entregables-fases/README.md).

**Por saber**

- El esquema de esta versión será corregido por la fase 2: llaves primarias a UUIDv7, rutas
  por clave de negocio y el esquema `catalogo_gasosur`. Los datos sembrados son de ejemplo,
  no los reales de Gasosur — esos llegan en la fase 4.

*Migración: `20260818075624_inicial`*
