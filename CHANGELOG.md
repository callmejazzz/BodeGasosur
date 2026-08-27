# Cambios

Todo lo que va entrando a BodeGasosur, versión por versión. Las versiones se numeran según
la política de [versionado y despliegue](docs/08-versionado-y-despliegue.md).

Se escribe para quien usa el sistema, no para quien lo programa: cada entrada dice qué se
puede hacer ahora que antes no se podía.

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
- 35 invariantes verificados contra PostgreSQL antes de publicar esta versión.

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
