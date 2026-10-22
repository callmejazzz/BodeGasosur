# Convenciones de código

- Nunca utilices el carácter `ñ` ni acentos para la lógica del código (variables, parámetros, propiedades), solo puede quedarse en textos, documentación y comentarios
- Textos visibles en la UI siempre en español
- Puedes agregar dependencias nuevas, quitar o actualizar, pero siempre explícame cuáles, por qué y para qué

# Base de datos

- Todo cambio de esquema va en una migración nueva; nunca edites migraciones ya aplicadas
- NUNCA ejecutes SQL destructivo (DROP, TRUNCATE, DELETE sin WHERE) sin mi confirmación explícita

# Repositorio GitHub

## Git branches

- NUNCA hagas commit ni push directo a `main`
- Única excepción: un hotfix para producción, y puedes proponerlo en caso de ser estrictamente necesario, o que yo te lo indique
- Una rama por tarea con formato `<tipo>/<descripcion-corta>`:
  - Tipos: `feat`, `fix`, `hotfix`, `docs`, `refactor`, `chore`, `release`
  - Descripción en minúsculas, palabras separadas con guiones, sin acentos ni `ñ`, de 2 a 4 palabras
  - Ejemplos: `feat/reportes`, `fix/boton-descarga-invisible`, `chore/despliegue-sevalla`, `release/v0.8.0`

## Git commits

- Título en español y en lenguaje natural (no uses Conventional Commits)
- Empieza con un verbo en infinitivo y con mayúscula: Agregar, Corregir, Actualizar, Eliminar, Mover, Optimizar, Publicar
- Usa un prefijo de área opcional en minúsculas, solo cuando aporte contexto: `db:...`, `docs:...`
- Sin punto final y con máximo 72 caracteres
  - Bien: `Corregir botón de descarga invisible en móvil`, `db: Enviar verificador SCRAM para usuario-app`
  - Mal: `cambios`, `fix`, `Actualizado.`

El cuerpo del commit debe respetar el siguiente formato:
```
Qué cambió
- <cambio(s) concreto(s)>

Por qué
- <motivo(s) o problema(s) que resuelve>
```
- En el cuerpo, NO hagas saltos de línea manuales a 72 caracteres: cada viñeta va completamente en una sola línea, aunque sea larga:
  - Bien: `- Botón de proveedores (proveedores.tsx) cambió de color`
  - Mal: `- Botón de proveedores (proveedores.tsx)` y en la siguiente línea `cambió de color`
- Un commit equivale a un cambio lógico. No mezcles refactor con funcionalidad nueva
- Antes de hacer commit, ejecuta el lint y la verificación de tipos del proyecto (si existen); si falla, corrige primero

### Flujo obligatorio antes de cada commit

1. Al terminar los cambios, notifícame con un resumen: archivos modificados y qué cambió en cada uno
2. Espera a que te confirme que terminé de revisar
3. Solo entonces haz el commit, sin pedir más permiso
4. Nunca hagas push sin preguntarme

## Pull Requests

Título con el mismo formato y en español, igual que los commits. Cuerpo del PR en español:
  ```
  ## Qué cambia
  <resumen breve>

  ## Por qué
  <motivo o problema que resuelve>

  ## Cómo probarlo
  1. <pasos>

  ## Notas
  <migraciones, variables de entorno nuevas, riesgos, pendientes>
  ```
- Si el PR incluye migración o variables de entorno nuevas, menciónalo en **Notas**.

## Seguridad

- NUNCA leas, muestres ni hagas commit de `.env*` ni de llaves o secretos
- Si necesitas una variable de entorno nueva, agrégala a `.env.example` con valor ficticio y avísame
- Nunca uses llaves privilegiadas (ej. `service_role` de Supabase) en código del cliente

## Forma de trabajar

- Si algo es ambiguo, pregunta antes de asumir
- Explícame qué hace cada comando antes de ejecutar algo que modifique archivos, la BD o git
- Al terminar una tarea: resume qué cambiaste y qué falta probar
- No borres archivos ni código que no entiendas; pregunta primero