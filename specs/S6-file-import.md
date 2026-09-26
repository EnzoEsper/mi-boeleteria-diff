# S6 — Fuente tipo file e import de JSON

**Objetivo:** la segunda vía de captura del plan: crear fuentes de tipo `file` y cargar el JSON con `POST /api/sources/:id/import` (multipart), generando snapshots con `trigger: "import"` que participan del mismo pipeline (delta, listado, diff, reconstrucción).

**Fuente:** plan, "POST /api/sources → crea fuente (url o file)", "POST /api/sources/:id/import → multipart upload de un .json (snapshot manual)" y "Importar archivo: snapshot manual con POST /api/sources/:id/import".

## Estado: verde

## Criterios de aceptación

### AC-6.1 — Alta de fuente file
- `POST /api/sources` con `{ name, type: "file" }` → 201 con los mismos 8 campos de siempre: `type: "file"`, `url: ""` (sin pedir url), `cronEnabled: false`.
- El listado y el GET por id devuelven la fuente file sin cambios de contrato.

### AC-6.2 — Validación del schema con type
- `{ name, type: "file" }` sin `url` → 201.
- `{ name, type: "zap" }` → 400 con `issues[0].path === "type"`.
- `{ name }` sin `url` y sin `type` (default `"url"`) → sigue 400 con `issues[0].path === "url"` (regresión del contrato AC-1.2).
- Los casos inválidos de AC-1.2 (name vacío, url no-http, headers/cronExpr/cronEnabled mal tipeados) siguen respondiendo 400 con sus paths originales.

### AC-6.3 — Import multipart crea snapshot "import"
- `POST /api/sources/:id/import` con `multipart/form-data` y parte `file` conteniendo JSON válido → 200 con `{ sourceId, snapshot }` donde `snapshot.trigger === "import"`.
- El snapshot queda persistido y `rebuildJson` devuelve exactamente el contenido subido.

### AC-6.4 — Rechazos del import
- Sin parte `file` → 400 `{ error, issues: [{ path: "file", ... }] }`.
- Parte `file` con contenido que no es JSON → 400 con `issues[0].path === "file"`.
- Fuente de tipo `url` → 400 `{ error }` (solo las file admiten import), sin snapshots nuevos.
- Fuente inexistente → 404, sin invocar ingest.

### AC-6.5 — Re-import: historial igual que el resto del pipeline
- Tres imports `[fixture, fixture, mutado]` → snapshots con trigger `"import"` en los tres, `changed` en `[true, false, true]`.
- `GET /snapshots` los lista con sus `hasBlob`/`hasDelta` y `GET /diff?from&to` entre imports devuelve el delta que reproduzca el cambio.

### AC-6.6 — Los file nunca se fetchéan por cron
- `cronTick` marca como `skipped` a las fuentes `type: "file"` aunque tengan `cronEnabled: true` (el fetch de URL no aplica); el contador de invocaciones del fetch queda vacío.

## Datos de prueba
- `FormData` con `Blob` (`application/json`) para simular el upload del navegador.
- `ingestText` (refactor de `fetchAndStore`) permite ingestir texto sin fetch; se verifica por el resultado, no por introspección.

## Fuera de alcance
- Upload de archivos grandes / límite de tamaño del multipart (Deno Deploy tiene límite de request; acá se prueba con el fixture de 198 KB).
- Editar/renombrar/borrar fuentes y su contenido (CRUD completo).
- Frontend: el form de alta con selector de tipo y el input de archivo llegan con la UI.
