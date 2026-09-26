# S0 — Bootstrap del proyecto

**Objetivo:** dejar montado el esqueleto (estructura, tasks, fixture del endpoint, trazabilidad spec↔test y spike de la dependencia crítica) para que el micro-loop pueda correr con `deno task verify` desde el primer momento.

**Fuente:** `what-is-the-most-vivid-plum 1.md` (plan original), sección "Pasos de implementación — 1. Bootstrap".

## Estado: verde

## Criterios de aceptación

### AC-0.1 — Estructura de carpetas
- Dado el repositorio, existen los directorios `specs/`, `scripts/`, `tests/acceptance/`, `tests/fixtures/`, `server/` y `web/`.
- El scaffold de `web/` expone `web/package.json` con script `build` y `web/vite.config.ts`.

### AC-0.2 — Tasks del loop
- `deno.json` define las tasks `test`, `spec:check`, `check`, `verify` y `build`.
- La task `verify` encadena: `spec:check` → `lint` → `check` → `test` → `build`.

### AC-0.3 — Trazabilidad spec ↔ test
- `deno task spec:check` falla si un `AC-x.y` definido en `specs/S*.md` no es referenciado por ningún archivo de `tests/`.
- Falla si un test referencia un `AC-x.y` que no está definido en ninguna spec (huérfano).
- Falla si una spec no declara `## Estado:` con valor `pendiente` o `verde`.
- Falla si un `AC-x.y` no aparece en `specs/TRACEABILITY.md`, o si la matriz contiene ids inexistentes.
- Falla si dos specs definen el mismo `AC-x.y`.
- Pasa (cero errores) sobre el repositorio completo.

### AC-0.4 — Fixture del endpoint
- Existe `tests/fixtures/horarios-t0.json` con la respuesta real de `https://miboleteria.com.ar/xml/horarios.txt`.
- Es JSON válido: array no vacío de objetos con `title`, `id` y `cinemas[]`.
- Cada cinema tiene `shows[]`; cada show tiene `dates[]`; cada date tiene `times[]` con al menos `time` y `id`.

### AC-0.5 — Spike: jsondiffpatch en Deno
- `jsondiffpatch` se importa vía specifier `npm:` y `diff()` produce un delta serializable con `JSON.stringify`.
- `patch(delta)` reconstruye exactamente el original (roundtrip) y `unpatch(delta)` recupera el original desde la versión nueva.
- Soporta `objectHash` configurado (`o => o.id ?? JSON.stringify(o)`) detectando moves en arrays.

### AC-0.6 — README del loop
- `README.md` documenta los pasos ①–⑦ del micro-loop, los comandos del loop (`spec:check`, `test`, `verify`, `dev`, `dev:web`, `build`) y la estructura de `specs/`.

## Datos de prueba
- `tests/fixtures/horarios-t0.json` — payload real capturado el 2026-09-26 (~198 KB, `Content-Type: text/plain`, `Last-Modified` se actualiza a lo largo del día).

## Fuera de alcance
- Cualquier funcionalidad de negocio: fetch de fuentes, snapshots, API de diff, cron, UI.
- Contenido de frontend (solo scaffold Vite react-ts).
