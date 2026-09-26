# S1 — Fuentes URL: API de alta y lectura

**Objetivo:** exponer el CRUD mínimo de fuentes (alta por URL y lectura) persistido en Deno KV con validación de entrada — la base sobre la que el slice 2 cuelga el pipeline de snapshots.

**Fuente:** plan, "Endpoints del backend" + "Pasos de implementación — 2. Backend mínimo".

## Estado: verde

## Criterios de aceptación

### AC-1.1 — Alta de fuente URL
- `POST /api/sources` con `{ name, url }` válidos → `201` con el objeto fuente completo: `id` (uuid v4), `name`, `type: "url"`, `url`, `headers: {}`, `cronExpr: null`, `cronEnabled: false`, `createdAt` (fecha ISO 8601 parseable).

### AC-1.2 — Validación de entrada
- `POST /api/sources` devuelve `400` con `{ error, issues: [{ path, message }] }` cuando: falta `name` o está vacío tras trim; `url` no es parseable o no es `http(s)`; `headers` no es un mapa string→string; `cronExpr` no es string|null; `cronEnabled` no es boolean; o el body no es JSON válido.
- Campos desconocidos se descartan (no rompen la validación).

### AC-1.3 — Listado
- `GET /api/sources` → `200` con array ordenado por `createdAt` descendente (más reciente primero).
- Con el KV vacío → `200 []`.

### AC-1.4 — Recuperación y persistencia
- `GET /api/sources/:id` → `200` con el mismo objeto que se creó.
- El objeto se lee directamente del KV en la clave `["source", <id>]` (persistencia real, no memoria del proceso).
- Id inexistente → `404` con `{ error }`.

### AC-1.5 — Identidad única
- Dos altas consecutivas producen `id` distintos; ambas fuentes son recuperables por su id y aparecen en el listado.

### AC-1.6 — Campos opcionales persistidos
- `headers`, `cronExpr` y `cronEnabled` provistos en el alta se guardan y devuelven tal cual.

### AC-1.7 — Bootstrap del server
- `deno task dev` ejecuta `server/main.ts` (Deno.serve sobre el router) y `deno task check` incluye `server/main.ts`.
- `deno.json` habilita KV con `"unstable": ["kv"]` (sin flags por task).

## Datos de prueba
- Requests HTTP en proceso contra `createApp(kv)` con una KV temporal por test (sin puertos, sin red).

## Fuera de alcance
- `PATCH` / `DELETE` de fuentes; validación semántica de `cronExpr` en el alta (el parser `cron-parser` llegó en S5, la validación del form llega con la UI); CORS (producción sirve frontend y API del mismo origen; en dev usa proxy de Vite). ~~Tipo `file` e import de archivos~~ → implementados en S6; fetch/snapshots/diff → S2–S4; cron → S5.
