# S23 — Ver el JSON de cada snapshot

**Objetivo:** desde el timeline del historial, poder ver el JSON completo que se capturó en un snapshot. El endpoint ya existe (`GET /api/sources/:id/snapshots/:ts` devuelve `json` reconstruido vía `rebuildJson`, S4) y el cliente ya lo tiene (`getSnapshot`); falta la UI.

**Fuente:** pedido del usuario — "saber si hay posibilidad de ver el json asociado a cada snapshot".

## Estado: verde

## Criterios de aceptación

### AC-23.1 — Botón JSON en cada fila del timeline
- Cada `<li>` del timeline tiene un botón **JSON**.
- Click → `getSnapshot(fuente.id, entrada.timestamp)` una vez; éxito → `<pre data-json>` dentro de la misma fila con `JSON.stringify(json, null, 2)`.
- Click de nuevo con el JSON abierto → cierra el `<pre>` sin una nueva llamada.
- Abrir la fila B cierra la de la A (un solo `<pre>` visible a la vez); un click durante la carga no dispara un segundo pedido.

### AC-23.2 — Error visible y reintento
- `ApiError` de `getSnapshot` → el mensaje queda visible en la fila (`.error` dentro del `<li>`), sin `<pre>` y sin romper la lista.
- Click siguiente sobre la misma fila reintenta (segunda llamada); si ahora resuelve, muestra el `<pre>` y el error desaparece.

## Datos de prueba
- `apiStub` con `listSnapshots` de 2 entradas (T1/T2) y `getSnapshot` capturador (patrón S9).
- Filas scopeadas por `li[data-timestamp=…]` y `boton(li, "JSON")` (la página tiene varios botones).

## Fuera de alcance
- Ruta/deep-link para el JSON (la URL de la API ya es compartible tal cual).
- Descarga del archivo o resaltado de sintaxis (queda texto plano en `<pre>`).
- Cambios de server (el endpoint y `rebuildJson` ya cubren el 100% del caso, S4/S3).
