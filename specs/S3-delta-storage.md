# S3 — Almacenamiento con delta (jsondiffpatch + base cada N)

**Objetivo:** dejar de guardar el JSON completo en cada snapshot: calcular el delta con `jsondiffpatch` respecto del contenido anterior y persistir solo el delta, guardando una **base** (blob chunkeado) solo cuando conviene — cubriendo la estrategia mixta del plan sin romper el límite de 64 KiB de Deno KV.

**Fuente:** plan, "Estrategia de almacenamiento mixta" + "Pasos de implementación — 3. Diff engine" y "4. Snapshot pipeline" (pasos 3–5).

## Estado: verde

## Criterios de aceptación

### AC-3.1 — Delta persistido en el registro
- Con el `fullEvery` por defecto (20), el primer snapshot `changed` de una fuente es una **base**: guarda `chunks` (blob) y `sinceBase: 0`, sin `delta`.
- El segundo snapshot `changed` guarda `delta` (serializable con `JSON.stringify`) + `deltaFrom` = timestamp del snapshot **con contenido** del cual deriva, sin `chunks`.
- `applyPatch(JSON anterior, delta)` reproduce exactamente el contenido nuevo, y `rebuildJson` sobre el timestamp del snapshot devuelve lo mismo.

### AC-3.2 — objectHash: moves en arrays
- `diffJson` configurado con `objectHash` (`id` si existe, si no JSON canónico) detecta reordenamientos de arrays: para `[1,2,3] → [3,1,2]` el delta es exactamente `{ _t: "a", _2: ["", 0, 3] }` (move, sin add/remove).
- En el payload real, invertir el orden de los `cinemas` de una ciudad produce un delta con flag `_t: "a"` y `rebuildJson` devuelve el array reordenado.

### AC-3.3 — Base cada N (`fullEvery`)
- `fullEvery` es configurable por `createApp(kv, { fullEvery })` con default 20.
- Con `fullEvery: 3` y cuatro contenidos distintos: snapshot 1 = base (`chunks`), 2 y 3 = delta (`sinceBase` 1 y 2), 4 = base de nuevo (`chunks`, `sinceBase: 0`).

### AC-3.4 — Delta que no cabe → fallback a base
- Si el registro con delta supera el límite seguro de value (60.000 bytes < 64 KiB), se guarda como base (`chunks`) sin `delta` — nunca un value que la KV rechace.

### AC-3.5 — Snapshot sin cambios en el medio
- Un snapshot `changed: false` no guarda `delta` ni `chunks`; guarda `contentAt` = timestamp del snapshot con contenido que replica.
- El siguiente `changed` pone `deltaFrom` sobre ese snapshot con contenido (salta el unchanged), y `rebuildJson` del unchanged devuelve el mismo contenido.

### AC-3.6 — Reconstrucción de la secuencia completa
- Para una secuencia `[base, delta, unchanged, delta, base]`, `rebuildJson` de **cada** timestamp devuelve exactamente el JSON que se capturó en ese momento (verificación "diff correctness" del plan).

## Datos de prueba
- `tests/fixtures/horarios-t0.json` + mutaciones generadas (`mutarTiempo`, inversión de arrays, delta gigante con 3.000 shows fake).
- `fetchImpl` inyectada; `fullEvery` inyectado cuando el test necesita forzar bases.

## Fuera de alcance
- Endpoints de lectura: listado de snapshots, snapshot reconstruido y diff HTTP (S4). Compresión del blob (optimización futura). Limpieza/retención de snapshots.
