# S9 — Historial + DiffViewer + navegación por estado interno

**Objetivo:** la segunda pantalla del walking skeleton: timeline de snapshots de una fuente, selector de dos snapshots arbitrarios → diff visual con `jsondiffpatch/formatters/html`, y navegación fuentes ⇄ historial por estado interno de React (sin router, decisión registrada en S8).

**Fuente:** plan, estructura de páginas (`/sources/:id` timeline, `/sources/:id/compare` selector), `<DiffViewer />` (wrapper sobre `jsondiffpatch.formatters.html.format()` + toggle "unchanged") y paso 7 "Frontend — historial + diff".

## Estado: verde

## Criterios de aceptación

### AC-9.1 — HistorialPage lista el timeline de la fuente
- Con `listSnapshots` stub devolviendo 3 entradas (cambiadas y sin cambiar, triggers `manual`/`cron`/`import`), el DOM muestra por snapshot: momento en UTC (`YYYY-MM-DD HH:mm:ss`), hash corto (8 chars), tamaño en bytes, el `trigger` y el estado `changed` (badge `sin cambios` cuando `changed: false`), más los flags de almacenamiento (`sinceBase`/`deltaFrom` cuando existen).
- Si `listSnapshots` rechaza con `ApiError`, se muestra su `message` y la página no se rompe.
- Un botón **Volver** invoca `onVolver`.

### AC-9.2 — Seleccionar dos snapshots y comparar
- Dos `select` ("Desde" y "Hasta") con una opción por snapshot (vacío por defecto). Con ambos elegidos, **Comparar** llama `getDiff(id, from, to)` y `getSnapshot(id, from)` (para el JSON izquierdo del panel) y renderiza `<DiffViewer>` con el HTML del formatter.
- El `DiffViewer` renderizado contiene `jsondiffpatch-delta` (HTML real de `jsondiffpatch/formatters/html`, no un mock).

### AC-9.3 — Comparar sin selección completa no llama a la API
- Con uno o ningún `select` elegido, **Comparar** muestra el mensaje `Elegí dos snapshots` y no invoca `getDiff` ni `getSnapshot`.

### AC-9.4 — Un error del diff se muestra sin romper la página
- Si `getDiff` rechaza con `ApiError(400, ...)` se muestra su mensaje; el listado del timeline sigue en pie.

### AC-9.5 — DiffViewer: format(delta, left) + toggle de unchanged
- Con `delta` no nulo, renderiza `format(delta, left)` de `jsondiffpatch/formatters/html` vía `dangerouslySetInnerHTML` (clase `jsondiffpatch-delta` presente, valor izquierdo del modified visible cuando se pasa `left`).
- Con `delta` nulo (snapshots sin cambios) muestra `Sin cambios entre ambos snapshots` sin invocar al formatter.
- Un checkbox `Mostrar sin cambios` alterna el atributo `data-mostrar-sin-cambios` del contenedor (el CSS oficial/ocultamiento se resuelve por fuera del grafo de tests).

### AC-9.6 — Navegación por rutas (enmendado en S15) y CSS del formatter
- `Shell` arranca en la vista de fuentes; al hacer click en **Historial** de una fila navega a la ruta `/historial/<id>` y muestra `HistorialPage` (la fuente se resuelve con `api.getSource(id)`), y **Volver** regresa a `/`. *(Enmendado por S15: antes era navegación por estado interno de React.)*
- `web/src/App.tsx` compone `Shell` con `createApi()` dentro de `BrowserRouter`; `web/src/main.tsx` importa `jsondiffpatch/formatters/styles/html.css` junto al `index.css` (el CSS del formatter queda fuera del grafo de tests, regla AC-8.6).
- `DiffViewer.tsx`, `HistorialPage.tsx` y `Shell.tsx` no importan `.css` ni assets (mismo criterio que AC-8.6).

## Datos de prueba
- Entradas `EntradaSnapshot` con timestamps arbitrarios (p. ej. `1_700_000_000_000`, `1_700_008_600_000`, `1_700_017_200_000`) — la fecha UTC se calcula con `getUTC*` para ser determinista.
- Stub de `getDiff` devuelve `{ changed: true, delta: {h: ["10:00", "11:00"]} }` y `getSnapshot` devuelve `{ json: {h: "10:00"} }`; el formatter real de jsondiffpatch genera el HTML (sin DOM, verificado en spike S0).
- Helpers de S8 (`montar`, `click`, `escribirEn`, `buscar`, `boton`) reutilizados; react-dom sigue cargándose tras `instalarDom()` (AC-8.1).

## Fuera de alcance
- Filtros del timeline (rango de fechas, trigger, solo-con-cambios) y virtualización con react-window — el listado es corto en el walking skeleton.
- Router/URLs reales — resuelto en S15 (enmienda de AC-9.6); side-by-side y toggle animado `showUnchanged()` de jsondiffpatch (requiere el DOM formateado completo) — el toggle acá solo alterna el atributo del contenedor.
- `<SourceCard />` con último cambio, `<CronInput />`, `<JsonDropzone />`, TanStack Query/Zustand/Tailwind/shadcn (pulido post-skeleton).
