# S31 — Diff con anterior desde el timeline

**Objetivo:** el plan pedía "Click en snapshot → panel de diff vs anterior"; hoy
la única forma de comparar es armar el par a mano en el comparador. Cada
snapshot del timeline ahora ofrece un botón **"Diff con anterior"** que muestra
al instante el diff contra el snapshot del que deriva (`deltaFrom`).

**Fuente:** plan (`/sources/:id` — "Click en snapshot → panel de diff vs
anterior"); capsula del comparador (S9) y del deep link (S18).

## Estado: verde

## Criterios de aceptación

### AC-31.1 — Botón "Diff con anterior" en cada snapshot con delta

- Cada `<li>` del timeline con `deltaFrom != null` incluye un `<button>` con
  clase `.ver-diff` y texto `Diff con anterior`.
- El snapshot **base inicial** (`deltaFrom == null`) no muestra el botón (no
  tiene anterior).
- `.ver-diff` tiene regla en `index.css` (AC-14.1 la exige para toda clase
  literal nueva).

### AC-31.2 — El click pide el diff y lo renderiza

- Click en el botón de un snapshot `T` con `deltaFrom = P` → `getDiff(P, T)` +
  `getSnapshot(P)` y el `DiffViewer` se renderiza (mismo resultado que el
  comparador, con el nombre de la fuente).
- El botón queda `disabled` mientras `comparando` es true (y el "Comparar" del
  comparador también, ya existente): un doble click rápido hace **una** sola
  llamada.
- Un error de la API queda visible en `errorDiff` sin romper la página (mismo
  manejo que el comparador).

### AC-31.3 — En contexto de ruta escribe la URL

- Con `onCompararEnRuta` (la página cuelga de `/historial/:id?left=&right=`), el
  click invoca `onCompararEnRuta(deltaFrom, timestamp)` y **no** llama a
  `getDiff` localmente — igual que el comparador (S18); el effect de ruta se
  encarga de cargar el diff.

## Datos de prueba

- Fixtures de `s12`: T1 (`deltaFrom: null`), T2→T1, T3→T2, T4→T3.
- `apiStub` con `getDiff`/`getSnapshot` contados; `getDiff` diferido (promise
  que se resuelve a mano) para el doble click, patrón s25.
- Spy de `onCompararEnRuta` para AC-31.3.

## Fuera de alcance

- Elegir un snapshot distinto al `deltaFrom` desde el timeline (para eso está el
  comparador).
- "Diff vs siguiente" (el delta se calcula siempre hacia atrás).
- Cambiar el orden del timeline.
