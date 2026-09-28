# S18 — Deep-link de comparación (`/historial/:id/compare?left=&right=`)

**Objetivo:** un diff concreto es compartible y navegable: la comparación vive en la URL, así un link (o el botón Atrás) restaura o repite el estado sin re-seleccionar los snapshots.

**Fuente:** opción 3 acordada el 28-sep-2026 (deep-link de comparación).

## Estado: verde

## Criterios de aceptación

### AC-18.1 — Deep link carga el diff directo
- Abrir `/historial/<id>/compare?left=<L>&right=<R>` (L y R numéricos distintos) renderiza el historial **y** dispara `getDiff(id, L, R)` + `getSnapshot(id, L)` sin interacción, mostrando el `DiffViewer`.
- La ruta `/historial/:id/compare` comparte el mismo contenedor que `/historial/:id` (misma fuente, mismos filtros y timeline, mismo comparador).

### AC-18.2 — Query malformada → redirect al timeline
- Si `left`/`right` están incompletos (falta uno o está vacío), no son numéricos o son iguales, la ruta redirige (replace) a `/historial/<id>` sin query y **sin** llamar a `getDiff`/`getSnapshot`.
- Sin ningún parámetro, `/historial/<id>` muestra solo el timeline — el comportamiento pre-existente, sin diff.

### AC-18.3 — Comparar sincroniza la URL y Atrás vuelve al timeline
- Con la ruta del historial abierta, elegir dos snapshots y apretar **Comparar** navega a `/historial/<id>/compare?left=<L>&right=<R>` (push) y muestra el diff.
- Volver atrás en el navegador (la URL pierde la query) limpia el diff de la pantalla y deja el timeline visible.

### AC-18.4 — Cambiar la query recarga el diff, sin doble fetch
- Un cambio de `left`/`right` en la URL (Atrás/Adelante del navegador) re-pide el diff con los nuevos valores y lo reemplaza.
- Revisitar la misma URL (mismo par) no vuelve a pedir el diff: un solo fetch por par.

### AC-18.5 — README documenta la ruta compartible
- README lista las rutas de la UI, incluida `/historial/:id/compare?left=…&right=…` como URL compartible.

## Datos de prueba
- Stubs de `getDiff`/`getSnapshot` que registran los pedidos; timestamps `T1 < T2 < T3`.
- `enRuta()` (replaceState) para abrir una ruta y `irA()` (replaceState + `PopStateEvent`) para simular Atrás/Adelante en jsdom: `BrowserRouter` relee `location` al recibir `popstate`.

## Fuera de alcance
- Botón "Copiar link"/Web Share para compartir la URL desde la UI.
- Validar que L/R existan en el timeline antes de pedir el diff: si el server responde 4xx se muestra el error (mismo camino que AC-9.4).
- Comparaciones múltiples o historial de pares seleccionados.
