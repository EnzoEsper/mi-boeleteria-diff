# S24 — Stats visibles en la fila de la fuente

**Objetivo:** con el cron autónomo (2×/día), saber de un vistazo en la UI si el **último intento de captura salió bien o falló**, y con qué error. Las stats ya se persisten en KV (`errorCount`, `lastError`, `totalSnapshots`, `lastChangedAt`) pero nunca hubo endpoint ni UI; y `lastError` nunca se limpia, así que hace falta saber si corresponde al último intento o a uno viejo.

**Fuente:** cola de QoL — "stats visibles: `lastError`/`errorCount` ya se persisten pero no se muestran".

## Estado: verde

## Criterios de aceptación

### AC-24.1 — Endpoint de stats
- `GET /api/sources/:id/stats` → `200` con el `SourceStats` completo: `totalSnapshots`, `lastChangedAt`, `errorCount`, `lastError` y `lastAttempt`; id inexistente → `404 {"error":"fuente no encontrada"}`.
- Tras una captura **exitosa** (`/fetch` con fixture OK): `totalSnapshots ≥ 1`, `lastChangedAt` numérico y `lastAttempt.ok === true`.
- Tras una captura **fallida** (fetch con HTTP 500): `errorCount ≥ 1`, `lastError.message` menciona `HTTP 500` y `lastAttempt.ok === false`.

### AC-24.2 — `lastAttempt` se escribe en los tres caminos y normaliza entradas viejas
- `recordError` (fetch fallido **y** JSON inválido en `ingestText`) escribe `lastAttempt = { at, ok: false }`.
- La captura exitosa (`ingestText` completa) escribe `lastAttempt = { at, ok: true }`.
- `SourceStats` gana `lastAttempt: { at: number; ok: boolean } | null` (default `null` en `emptyStats`); `getStats` **normaliza** entradas viejas de KV sin el campo (merge con `emptyStats()`) → `null`, no `undefined`.

### AC-24.3 — Cliente `getStats`
- `createApi().getStats(id)` emite `GET /api/sources/{id}/stats` (ruta relativa) y devuelve `StatsFuente` parseado.
- Backend 404/500 → `ApiError` (status + mensaje + issues); red caída → `TypeError`.

### AC-24.4 — Badge en `SourceCard`
- La fila carga sus stats al montar (`getStats`); fallo del request → fila intacta **sin** badge (dato auxiliar, no bloquea).
- `lastAttempt.ok === true` → badge `[data-stats="ok"]` (clase `.stats`) con `última: {fecha en Buenos Aires}` (vía `formatearMomento`).
- `lastAttempt.ok === false` → badge `[data-stats="error"]` (clase `.error`) con `falló {fecha}: {lastError.message}` y sufijo ` (×{errorCount})` cuando `errorCount > 1`.
- `lastAttempt === null` → sin badge.
- Tras **Capturar** (éxito o error) el badge se refresca con una nueva llamada a `getStats`.

## Datos de prueba
- `withApp` + `respuesta(fixtureText)` / `respuesta(fixtureText, 500)` / `respuesta("no-es-json")` como `fetchImpl`.
- `createApi(fetchSimulado)` para AC-24.3 (patrón S7/S20/S21); `apiStub` + `montar`/`click` para AC-24.4.
- Entrada vieja: `kv.saveStats` con un objeto sin `lastAttempt` (cast) → `getStats` → `null`.

## Fuera de alcance
- Cambiar la semántica de `lastError` (sigue siendo "último error conocido", no se borra con éxitos — el badge lo resuelve con `lastAttempt`).
- Endpoint de lista que empaquete stats (se pide por fila, N≈1-5 fuentes).
- Gráficas/histórico de errores.
