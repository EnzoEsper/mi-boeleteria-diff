# S4 — API de lectura: listado, snapshot reconstruido y diff

**Objetivo:** exponer por HTTP lo que se capturó: listar los snapshots de una fuente, obtener el JSON reconstruido de un timestamp (vía `rebuildJson`, que resuelve base/delta/unchanged) y pedir el diff entre dos snapshots.

**Fuente:** plan, "Endpoints" del backend (list snapshots, snapshot by timestamp, diff) — walking skeleton de lectura.

## Estado: verde

## Criterios de aceptación

### AC-4.1 — Listado de snapshots
- `GET /api/sources/:id/snapshots` devuelve 200 con `{ sourceId, snapshots: [...] }`.
- Cada entrada incluye `timestamp`, `hash`, `sizeBytes`, `changed`, `trigger`, `hasBlob` (booleano: tiene `chunks`), `hasDelta` (booleano: tiene `delta`), `sinceBase` (`number` presente en `changed`, `null` en unchanged) y `deltaFrom` (`number` presente si deriva de otro snapshot, `null` si no).
- Orden descendente por timestamp (el más nuevo primero).
- Fuente inexistente → 404 con `error`.

### AC-4.2 — Snapshot reconstruido
- `GET /api/sources/:id/snapshots/:ts` devuelve 200 con `{ sourceId, snapshot, json }`, donde `snapshot` es el resumen (6 campos) y `json` el resultado de `rebuildJson` de ese timestamp.
- Probado sobre una base (chunks) y sobre un delta: `json` reprodujo exactamente el contenido capturado en ese momento.
- Timestamp sin snapshot o fuente inexistente → 404 con `error`; nunca dispara fetch.

### AC-4.3 — Diff entre dos snapshots
- `GET /api/sources/:id/diff?from=<ts>&to=<ts>` devuelve 200 con `{ sourceId, from, to, changed, delta }`.
- `delta = diffJson(jsonFrom, jsonTo)`; si `changed` es `true`, `applyPatch(structuredClone(jsonFrom), delta)` reproduce `jsonTo`; si el contenido es idéntico (incluido `from == to`) → `changed: false, delta: null`.
- `from` o `to` sin snapshot correspondiente → 404 con `error`.

### AC-4.4 — Validación de query params del diff
- `from`/`to` ausentes o no numéricos → 400 con `{ error, issues }` (mismo contrato de zod que los writes).
- Sin invocación de fetch en ninguna rama de lectura.

### AC-4.5 — Trazabilidad de lectura en el índice de snapshots
- El listado refleja la secuencia real de almacenamiento: en `[base, delta, unchanged]` se ve `hasBlob: true` solo en la base, `hasDelta: true` solo en el delta y `sinceBase/deltaFrom: null` en el unchanged.
- `deno task spec:check` acepta los ids AC-4.x en tests y TRACEABILITY.

## Datos de prueba
- Secuencia generada con `fetchImpl` inyectada (fixture + `mutarTiempo` + reordenamiento), timestamps capturados de las respuestas de `POST /fetch`.

## Fuera de alcance
- Paginación/corte del listado (los snapshots son pocos y livianos). Diff en vivo contra el contenido actual de la URL (requiere fetch, es de escritura). UI de comparación (slice de frontend).
