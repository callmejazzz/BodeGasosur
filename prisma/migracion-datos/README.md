# Migración de datos

Los catálogos reales de Gasosur entran a la base desde aquí, como código idempotente y versionado —lo que pide el hallazgo **F5** de la [auditoría](../../docs/cimientos-word/04-auditoria-arquitectura.docx)— y no como trabajo manual en Studio. Lo usan tanto `db:reset` (desarrollo) como `prod:bootstrap` (producción).

```bash
npm run datos:migrar                    # crea lo que falta; se detiene ante divergencias
npm run datos:migrar -- --simular       # muestra el plan sin escribir
npm run datos:migrar -- --sincronizar   # sobrescribe las divergencias desde el CSV
```

## Qué migra y desde dónde

| Archivo | Fuente | Corte | Resultado |
|---|---|---|---|
| `datos/estaciones.csv` | `docs/Estaciones.xlsx`, hoja única | 2026-09-10 | **21 empresas** y 32 estaciones |
| `datos/personas.csv` | Escrito a mano | — | 2 personas |

`estaciones.csv` es la hoja tal cual, exportada como CSV: mismos encabezados, mismas
columnas, mismo orden. Lo único que se le hizo fue recortar espacios y tabuladores
sobrantes (la razón social de Polotitlán traía tabuladores al final).

`personas.csv` no viene de ningún archivo. El histórico del Excel trae nueve nombres
reales escritos de catorce formas —`OSCAR`, `OSCAR B.`, `LIC HUGO`, `LIC. HUGO`…— y solo
Compras puede decir cómo se llama cada quien. Entran las dos personas confirmadas por
nombre completo; las demás se agregan como renglón cuando se confirmen.

**Los proveedores no se migran.** Por el [Plan B](../../docs/decisiones-otros/01-plan-b-produccion.md),
Compras los captura desde la aplicación. Lo que se aprendió de la hoja `CATALOGO
PROVEDORES` quedó en [04 §6](../../docs/04-datos-actuales.md).

## El CSV es carga inicial, no fuente permanente

Lo que Compras cambie después desde la pantalla manda. El importador lo respeta trabajando en dos pasadas dentro de una sola transacción: primero **planea** —compara cada renglón con la base y lo clasifica en *crear*, *igual* o *divergente*— y solo después **escribe**.

| Situación | `datos:migrar` | `-- --sincronizar` | `-- --simular` |
|---|---|---|---|
| Todo coincide | No escribe nada: ni un `UPDATE`, `updatedAt` intacto | igual | Imprime el plan |
| Hay filas nuevas en el CSV | Las crea | igual | Imprime el plan |
| Hay divergencias | **Sale con error y el reporte; no escribe nada, ni lo nuevo** | Sobrescribe desde el CSV y lista cada cambio | Imprime el plan |

El reporte dice, por cada divergencia, el campo, el valor en la base, el valor en el CSV y **quién hizo el último cambio según la bitácora** —«editado por diana@… el …» u «origen migracion-datos el …»—, que es lo que distingue una edición manual de un corte nuevo.

Lo que el importador **no** hace:

- No compara `activa`: el CSV no la trae. Dar de baja una estación desde la pantalla no
  es una divergencia, y ni `--sincronizar` la reactiva.
- No borra ni desactiva lo que está en la base y no en el CSV. Una estación creada desde la
  pantalla se queda.

## Las reglas

- **Idempotencia por clave de negocio.** La empresa por RFC, la estación por número y la persona por nombre —único en la base sin distinguir mayúsculas ni espacios, con el mismo `nombre_normalizado()` que usa el índice—.
- **El RFC se normaliza con la misma función que usa la pantalla**, `normalizarRfc` de
  [`src/lib/rfc.ts`](../../src/lib/rfc.ts): mayúsculas, sin guiones ni espacios ([03 §4](../../docs/03-estaciones.md)).
- **Validación antes de la transacción.** RFC sin forma de RFC, estación repetida, persona repetida o un mismo RFC con dos razones sociales detienen el archivo entero, con el renglón en el mensaje.
- **Todo o nada.** Una sola transacción, firmada `migracion-datos` en la bitácora.

## Pruebas

`migrar.test.ts` corre contra el PostgreSQL real de docker, en la base de
`DATABASE_URL_PRUEBAS` —que se destruye y recrea en cada corrida, por eso tiene que
llamarse `*_prueba`—:

```bash
npm run test
```

1. Base limpia → carga → segunda corrida sin escrituras (`updatedAt` y bitácora intactos).
2. Cambio manual → error con el reporte y rollback completo, incluida la fila nueva.
3. `--sincronizar` → sobrescribe, crea lo nuevo, y la bitácora lo firma con el antes y el después.
4. RFC inválido, estación o persona repetidas, RFC con dos razones sociales → rollback.

## Cómo hacer un corte nuevo

1. Abrir la hoja en Excel y **Guardar como → CSV UTF-8**, encima de `datos/estaciones.csv`.
   El lector busca las columnas por encabezado, sin importar mayúsculas ni acentos, e
   ignora las que no conoce.
2. Revisar el `git diff` del CSV: es la lista exacta de lo que cambió.
3. `npm run datos:migrar -- --simular`, leer el plan; después sin `--simular`. Si reporta
   divergencias, decidir con quien editó la base antes de usar `--sincronizar`.
4. Actualizar la fecha de corte de la tabla de arriba.
