# S10 — Servir el frontend desde el backend

**Objetivo:** un solo proceso Deno sirve la API **y** el build estático de Vite (`web/dist/`): las rutas no-API caen en un fallback estático con `index.html` para deep links, sin tocar los contratos de `/api/*` ni permitir salir del directorio de build.

**Fuente:** plan, paso 8 "Servir frontend desde el backend" — `npm run build` genera `web/dist/`, `server/main.ts` hace fallback a los estáticos para rutas no-API, `deno task build` deja todo listo.

## Estado: verde

## Criterios de aceptación

### AC-10.1 — Fallback a index.html para rutas no-API
- `createApp` sirve el `index.html` del dist (`200` + `text/html`) ante `GET /`.
- Cualquier ruta no-API **sin extensión** (`GET /cualquiera`, `GET /fuentes/abc`) responde ese mismo `index.html` (SPA fallback), de modo que un deep link no rompa.
- Si el `index.html` no existe (build no corrido), la ruta responde `404` con un `error` que menciona `deno task build`.

### AC-10.2 — Assets con su content-type y cache
- `GET /assets/<archivo>` sirve el archivo con su MIME (`text/javascript`, `text/css`, `image/svg+xml`) y `cache-control: public, max-age=31536000, immutable` (los assets de Vite van hasheados).
- `GET /index.html` (y el fallback del AC-10.1) responden con `cache-control: no-cache`.
- Un asset **inexistente con extensión** (`GET /assets/falta.js`) → `404`: no se cae al `index.html`.

### AC-10.3 — El API no se ve afectado
- `GET /api/sources` sigue respondiendo JSON (regresión de los contratos de S1–S6).
- Una ruta `/api/*` desconocida (`GET /api/desconocida`) responde `404` con body JSON `{ error }` — nunca el `index.html`.

### AC-10.4 — Path traversal bloqueado
- Un pedido con `..` percent-encoded que escape del dist (`GET /..%2Fdeno.json`) responde `404` y no entrega archivos del repositorio.

### AC-10.5 — Build y wiring
- `deno task build` ejecuta el build de Vite (`npm --prefix web run build`) y deja `web/dist/` listo para servir.
- `server/main.ts` sirve API + estáticos desde el **mismo** `app.fetch` de `Deno.serve` (un solo proceso), verificado por inspección de fuente (estilo AC-7.4).

## Datos de prueba
- Dist temporal con `index.html`, `assets/app.js`, `assets/app.css`, `assets/logo.svg` (inyectado vía `deps.distDir`), más un directorio sin build para el caso del 404.
- KV temporal por test (helper `withApp` de `tests/support.ts`).

## Fuera de alcance
- Compresión (`gzip`/`brotli`) y `ETag`/`If-None-Match` — Deno Deploy agrega capa de CDN delante.
- Deduplicación del hash del dist en `Cache-Control` para archivos fuera de `assets/`.
- Deploy en deno.com (paso 9 del plan) y configuración de GitHub Actions.
