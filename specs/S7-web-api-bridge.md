# S7 — Puente web↔API: cliente HTTP tipado + proxy de Vite

**Objetivo:** el frontend habla con el backend a través de un cliente único, tipado y testeable (inyección de `fetch`), y en dev Vite proxea `/api` al server Deno — sin CORS y con los mismos contratos que ya validaron S1–S6.

**Fuente:** plan, estructura `web/src/api.ts` + "en dev usa proxy de Vite" (fuera de alcance de S1) + paso de UI del plan.

## Estado: verde

## Criterios de aceptación

### AC-7.1 — createApi ejecuta los requests del contrato
- `createApi(fetchImpl?)` expone `listSources`, `getSource`, `createSource`, `fetchNow`, `listSnapshots`, `getSnapshot` y `getDiff`.
- Con un `fetchImpl` stub que captura `(url, init)`: `listSources()` → `GET /api/sources`; `createSource(payload)` → `POST /api/sources` con `content-type: application/json` y `body: JSON.stringify(payload)`; `fetchNow(id)` → `POST /api/sources/{id}/fetch`; `getSnapshot(id, ts)` → `GET /api/sources/{id}/snapshots/{ts}`; `getDiff(id, from, to)` → `GET /api/sources/{id}/diff?from=<from>&to=<to>`.
- Las respuestas 2xx se devuelven ya parseadas (`await res.json()`), sin envoltorios extra.
- **Las URLs son relativas al origen** (sin host fijo): en dev las resuelve el proxy de Vite (AC-7.4) y en Deploy el mismo origen. *(bugfix 28-sep-2026: la implementación hardcodeaba `http://localhost` — el puerto 80/443 del **cliente** — y en prod la UI fallaba con `Failed to fetch`; detectado en E2E. El texto del AC siempre fue relativo; los tests asertaban el host y se corrigieron.)*

### AC-7.2 — importFile sube multipart con el campo `file`
- `importFile(id, file)` → `POST /api/sources/{id}/import` con `FormData` cuya parte `file` es el Blob enviado (el backend de S6 lee exactamente ese nombre de campo).
- No se setea `content-type` a mano (lo arma `fetch` con el boundary); devuelve `{ sourceId, snapshot }`.

### AC-7.3 — Errores normalizados en `ApiError`
- Cualquier 4xx/5xx con body `{ error, issues? }` lanza `ApiError` con `status`, `message` (= `error`) e `issues` (`[]` si el body no los trae).
- Si `fetch` rechaza (red caída), la excepción original se propaga sin convertirse en `ApiError`.

### AC-7.4 — Proxy de Vite en dev
- `web/vite.config.ts` proxea `/api` (y prefijos derivados) a `http://localhost:8000` con `changeOrigin`, de modo que `deno task dev` + `deno task dev:web` funciona cross-origin-free. Verificado por inspección de fuente (estilo AC-0.6).

## Datos de prueba
- `fetchImpl` stub capturadora de llamadas + `Response` sintéticas (`new Response(JSON.stringify(...), { status })`).
- Sin DOM: el cliente es TS puro (prerrequisito para testearlo en Deno antes de introducir jsdom en S8).

## Fuera de alcance
- Componentes React y render (S8: fuentes; S9: historial/diff).
- Manejo de estados de carga en la UI (llega con los componentes).
- Retry/backoff del cliente; el contrato de errores alcanza para mostrar mensajes.
