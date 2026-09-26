# S2 — Captura de snapshots (fetch → hash → changed)

**Objetivo:** implementar el pipeline de captura: fetch del JSON de la fuente, canonicalización + SHA-256, detección de cambios contra el último snapshot y persistencia en KV, expuesto vía `POST /api/sources/:id/fetch`.

**Fuente:** plan, "Detección de cambios" + "Pasos de implementación — 4. Snapshot pipeline" (paso 1: fetch, paso 2: canonicalize+hash).

## Estado: verde

## Criterios de aceptación

### AC-2.1 — Fetch manual y primer snapshot
- `POST /api/sources/:id/fetch` descarga la URL de la fuente (ignorando el `Content-Type`, el endpoint real sirve JSON como `text/plain`), lo parsea y persiste un snapshot.
- Respuesta `200` con `{ sourceId, snapshot }` donde `snapshot` es un resumen **sin** el payload: `timestamp` (epoch ms), `hash` (SHA-256 hex de 64 chars), `sizeBytes`, `changed`, `trigger: "manual"` y `chunks` (solo si `changed`).
- El contenido se guarda como **blob chunkeado** en `["blob", <sourceId>, <timestamp>, <i>]` (JSON crudo partido en chunks < 64 KiB) y el registro en `["snapshot", <sourceId>, <timestamp>]` guarda `chunks: N` — ver "Descubrimiento de plataforma".
- El primer snapshot de una fuente siempre tiene `changed: true`.

### AC-2.2 — Hash canónico e idempotencia
- `hashJson` ignora el orden de claves y el whitespace: objetos con las mismas claves en distinto orden producen el mismo hash; el hash de un array depende del orden de sus elementos.
- Un segundo fetch con el **mismo contenido pero serializado distinto** (claves anidadas en otro orden) → `changed: false`, mismo `hash`, y el snapshot se guarda **sin** `chunks` ni blob (no se duplica el payload).
- `sizeBytes` refleja los bytes recibidos (puede diferir entre serializaciones).

### AC-2.3 — Contenido distinto → changed
- Un tercer fetch con contenido mutado (una función con horario alterado) → `changed: true`, `hash` distinto, y `["latest", <sourceId>]` apunta al timestamp nuevo; los snapshots anteriores quedan intactos.
- El contenido nuevo y el anterior son recuperables con `rebuildJson` (desde S3 el registro puede guardar un `delta` en lugar del blob; la base conserva el blob).

### AC-2.4 — Fallos no persisten snapshots
- HTTP ≠ 200, error de red o body que no es JSON válido → el endpoint responde `502` con `{ error }`.
- En todos los casos **no** se escribe ningún snapshot ni se actualiza `latest`; `stats.errorCount` incrementa y `stats.lastError` queda `{ message, at }`.

### AC-2.5 — Fuente inexistente
- `POST /api/sources/:id/fetch` con id inexistente → `404` y **no** se intenta el fetch (la función de fetch no es invocada).

### AC-2.6 — Puntero `latest` y `stats`
- `["latest", <sourceId>]` = timestamp del último snapshot persistido.
- `["stats", <sourceId>]` = `{ totalSnapshots, lastChangedAt, errorCount, lastError }`: `totalSnapshots` cuenta snapshots persistidos (changed o no), `lastChangedAt` solo se actualiza cuando `changed: true`.

### AC-2.7 — Humo contra el endpoint real (opcional)
- Con `SMOKE=1 deno task test`, un fetch real a `https://miboleteria.com.ar/xml/horarios.txt` produce un snapshot válido (`hash` de 64 hex, `sizeBytes` > 100.000, `changed` boolean). Ignorado por defecto para mantener el gate sin red.

### AC-2.8 — Blob chunkeado bajo el límite de 64 KiB
- `putBlob` serializa el JSON crudo a bytes y lo parte en chunks de ≤ 60.000 bytes; `getBlob` los reensambla.
- Roundtrip con el payload real (~198 KB): ≥ 4 chunks y texto idéntico byte a byte.
- Ningún value escrito en la KV supera 65.536 bytes.
- Nota (S3): la base solo se escribe para el primer `changed` o cada `fullEvery` changed; el resto guarda `delta` — ver S3.

## Descubrimiento de plataforma (S2)
Deno KV rechaza cualquier value mayor a 64 KiB (`TypeError: Value too large (max 65536 bytes)`). El plan original asumía persistir el JSON completo (`full`) en una sola clave, lo que es imposible para el payload real (~198 KB). **Decisión:** blob chunkeado en `["blob", sourceId, ts, i]`; el registro de snapshot solo guarda `chunks`. La compresión queda como optimización posible para S3 (estrategia de almacenamiento).

## Datos de prueba
- `tests/fixtures/horarios-t0.json` (payload real) leído por los tests.
- Mutaciones **generadas en el test**: reordenamiento recursivo de claves (serialización distinta, mismo contenido) y alteración de un horario (contenido distinto).
- `fetchFn` inyectada en `createApp(kv, { fetchImpl })` → tests deterministas y sin red.

## Fuera de alcance
- Cálculo de delta con `jsondiffpatch` y estrategia `full` cada N snapshots (S3); reconstrucción de versiones (S4); API de listado/diff de snapshots (S5); triggers `cron`/`import`; validación del shape del JSON (schema-specific).
