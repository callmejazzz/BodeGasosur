# Cambios

Todo lo que va entrando a BodeGasosur, versión por versión. Las versiones se numeran según
la política de [versionado y despliegue](docs/08-versionado-y-despliegue.md).

Se escribe para quien usa el sistema, no para quien lo programa: cada entrada dice qué se
puede hacer ahora que antes no se podía.

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
