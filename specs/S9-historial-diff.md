# S9 — Historial + DiffViewer + navegación por estado interno

**Objetivo:** la segunda pantalla del walking skeleton: timeline de snapshots de una fuente, selector de dos snapshots arbitrarios → diff visual *(enmendado en S27: vista de líneas estilo GitHub con `diffLines` + `patch`)*, y navegación fuentes ⇄ historial por estado interno de React (sin router, decisión registrada en S8).

**Fuente:** plan, estructura de páginas (`/sources/:id` timeline, `/sources/:id/compare` selector), `<DiffViewer />` (originalmente wrapper sobre `jsondiffpatch.formatters.html.format()` + toggle "unchanged", **enmendado en S27**) y paso 7 "Frontend — historial + diff".

## Estado: verde

## Criterios de aceptación

### AC-9.1 — HistorialPage lista el timeline de la fuente
- Con `listSnapshots` stub devolviendo 3 entradas (cambiadas y sin cambiar, triggers `manual`/`cron`/`import`), el DOM muestra por snapshot: momento en **Buenos Aires** (`America/Argentina/Buenos_Aires`, `YYYY-MM-DD HH:mm:ss` — enmienda de S22/AC-22.1, antes UTC), hash corto (8 chars), tamaño en bytes, el `trigger` y el estado `changed` (badge `sin cambios` cuando `changed: false`), más los flags de almacenamiento (`sinceBase`/`deltaFrom` cuando existen).
- Si `listSnapshots` rechaza con `ApiError`, se muestra su `message` y la página no se rompe.
- Un botón **Volver** invoca `onVolver`.

### AC-9.2 — Seleccionar dos snapshots y comparar
- Dos `select` ("Desde" y "Hasta") con una opción por snapshot (vacío por defecto). Con ambos elegidos, **Comparar** llama `getDiff(id, from, to)` y `getSnapshot(id, from)` (para el JSON izquierdo del panel) y renderiza `<DiffViewer>` con la vista de diff. *(Enmendado en S27: antes era "con el HTML del formatter".)*
- El `DiffViewer` renderizado contiene `.dif-tabla` (la tabla de líneas real, no un mock) con el valor izquierdo visible. *(Enmendado en S27: antes era `jsondiffpatch-delta`.)*

### AC-9.3 — Comparar sin selección completa no llama a la API
- Con uno o ningún `select` elegido, **Comparar** muestra el mensaje `Elegí dos snapshots` y no invoca `getDiff` ni `getSnapshot`.

### AC-9.4 — Un error del diff se muestra sin romper la página
- Si `getDiff` rechaza con `ApiError(400, ...)` se muestra su mensaje; el listado del timeline sigue en pie.

### AC-9.5 — DiffViewer: render del diff y su estado visible *(enmendado en S27: reemplazo del formatter por diff de líneas)*
- Con `delta` no nulo, renderiza la tabla de líneas `.dif-tabla` del diff (contexto con numeración, cambios con `dif-del`/`dif-add`) a partir de `left` y `delta` (en S27 el HTML de `jsondiffpatch/formatters/html` fue reemplazado por `diffLines` + `patch`).
- Con `delta` nulo (snapshots sin cambios) muestra `Sin cambios entre ambos snapshots` sin renderizar tabla.
- El contenedor `.diff-viewer` expone `data-modo` (split/unified, S27) como estado visible del toggle; el viejo checkbox `Mostrar sin cambios`/`data-mostrar-sin-cambios` se eliminó con el reemplazo.

### AC-9.6 — Navegación por rutas (enmendado en S15) y CSS del formatter
- `Shell` arranca en la vista de fuentes; al hacer click en **Historial** de una fila navega a la ruta `/historial/<id>` y muestra `HistorialPage` (la fuente se resuelve con `api.getSource(id)`), y **Volver** regresa a `/`. *(Enmendado por S15: antes era navegación por estado interno de React.)*
- `web/src/App.tsx` compone `Shell` con `createApi()` dentro de `BrowserRouter`; `web/src/main.tsx` importa `./index.css` — y **solo** eso entre CSS. *(Enmendado en S27: antes importaba también `jsondiffpatch/formatters/styles/html.css`; el formatter dejó de existir con el diff de líneas.)*
- `DiffViewer.tsx`, `HistorialPage.tsx` y `Shell.tsx` no importan `.css` ni assets (mismo criterio que AC-8.6).

## Datos de prueba
- Entradas `EntradaSnapshot` con timestamps arbitrarios (p. ej. `1_700_000_000_000`, `1_700_008_600_000`, `1_700_017_200_000`) — la fecha se formatea con `formatearMomento` de `web/src/tiempo.ts` en `America/Argentina/Buenos_Aires` (S22) para ser determinista: T1 (22:13:20 UTC) se ve como `19:13:20`.
- Stub de `getDiff` devuelve `{ changed: true, delta: {h: ["10:00", "11:00"]} }` y `getSnapshot` devuelve `{ json: {h: "10:00"} }`; el diff de líneas se deriva de `JSON.stringify(..., null, 2)` + `diffLines` + `patch` (en S0 el HTML lo generaba el formatter de jsondiffpatch).
- Helpers de S8 (`montar`, `click`, `escribirEn`, `buscar`, `boton`) reutilizados; react-dom sigue cargándose tras `instalarDom()` (AC-8.1).

## Fuera de alcance
- Filtros del timeline (rango de fechas, trigger, solo-con-cambios) y virtualización con react-window — el listado es corto en el walking skeleton.
- Router/URLs reales — resuelto en S15 (enmienda de AC-9.6); side-by-side y toggle animado `showUnchanged()` de jsondiffpatch — el side-by-side hoy es la vista split por defecto del diff de líneas (S27) y el toggle alterna `data-modo`.
- `<SourceCard />` con último cambio, `<CronInput />`, `<JsonDropzone />`, TanStack Query/Zustand/Tailwind/shadcn (pulido post-skeleton).
