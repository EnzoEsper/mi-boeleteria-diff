# S15 — Router con URLs (deep links)

**Objetivo:** pasar la navegación de estado interno (S9) a rutas reales con `react-router-dom`, para que el historial de cada fuente sea un URL compartible y recargable (`/historial/:id`), aprovechando el SPA fallback de S10.

**Fuente:** plan (dependencia `react-router-dom`, estructura `/sources/:id`); enmienda de AC-9.6.

## Estado: verde

## Criterios de aceptación

### AC-15.1 — Rutas y resolución de fuente por URL
- `Shell`, envuelto en `BrowserRouter` por `App.tsx`, resuelve: `/` → `FuentesPage`, `/historial/:id` → `HistorialPage`, cualquier otra ruta → redirige a `/`.
- `/historial/:id` resuelve la fuente con `api.getSource(id)`; mientras carga muestra `Cargando…`, y si la promesa falla el mensaje queda visible en un `.error` sin romper la página.

### AC-15.2 — Navegación y deep link
- Click en **Historial** cambia `window.location.pathname` a `/historial/<id>` y renderiza el historial de esa fuente; **Volver** regresa a `/`.
- Deep link: con `window.location.pathname = /historial/<id>` fijado antes de montar, `Shell` muestra directo el historial (`getSource` + `listSnapshots`).

### AC-15.3 — Dependencia y enmienda de AC-9.6
- `react-router-dom` declarado en `deno.json` (imports) y en `web/package.json`.
- `specs/S9-historial-diff.md` enmienda AC-9.6 hacia "navegación por rutas (S15)" y su test pasa con `Shell` navegando por URL (regresión Historial ⇄ Volver).

## Datos de prueba
- `apiStub` con `listSources`, `getSource` y `listSnapshots`; la ruta inicial se fija con `window.history.replaceState` antes de `montar`.
- El estado de carga se prueba con un `getSource` que nunca resuelve.

## Fuera de alcance
- Ruta de comparación (`/historial/:id/compare`): el par Desde/Hasta sigue siendo estado interno de `HistorialPage`.
- `createBrowserRouter`/loaders/data APIs: se usa `<Routes>` declarativo, suficiente y testeable con el helper actual.
- Suspense: el estado de carga se maneja con `useState`.
