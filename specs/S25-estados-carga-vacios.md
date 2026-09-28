# S25 — Estados de carga y empty states

**Objetivo:** cerrar las dos áreas "de comportamiento" del pulido de UI: (1) ninguna acción puede duplicarse mientras está en vuelo (doble click/submit → doble request), (2) las pantallas sin datos muestran mensajes útiles en vez de espacios en blanco.

**Fuente:** cola de pulido de UI — áreas "estados de carga" y "empty states".

## Estado: verde

## Criterios de aceptación

### AC-25.1 — Fuentes: vacío y carga
- `listSources` resuelve `[]` sin error → `<p class="vacio" data-vacio>` con "Todavía no hay fuentes"; la `<ul>` no se renderiza; el form de alta sigue visible.
- Mientras el listado está en vuelo → `<p data-cargando>` con "Cargando…"; al resolver desaparece y aparece la lista (o el vacío).
- Si el listado falla → solo se muestra `.error` (sin `[data-vacio]`).

### AC-25.2 — Acciones deshabilitadas durante el vuelo (sin doble request)
- Fuentes: mientras `createSource` está en vuelo, "Crear fuente" queda `disabled` y un segundo submit no invoca otra llamada → exactamente 1 `createSource`; al resolver se re-habilita.
- SourceCard: "Capturar" `disabled` durante `fetchNow` (doble click → 1 llamada); "Guardar" `disabled` durante `updateSource` (→ 1 PATCH); "Borrar" `disabled` durante `deleteSource` (→ 1 DELETE); el input file queda `disabled` durante `importFile`.
- Historial: "Comparar" `disabled` durante `getDiff` + `getSnapshot` (doble click → 1 `getDiff`); al resolver se re-habilita.
- Los handlers también se guardan con un flag (el doble dispatch programático no debe pasar aunque el click nativo no dispararía sobre un botón deshabilitado).

### AC-25.3 — Historial: vacío y sin resultados
- 0 snapshots → `<p class="vacio" data-vacio>` con "Todavía no hay capturas" y NO se muestran filtros, contador, timeline ni comparador.
- ≥1 snapshots pero los filtros dejan 0 visibles → `[data-sin-resultados]` con "Ningún snapshot coincide"; filtros y contador siguen visibles.
- Carga inicial → `<p data-cargando>` con "Cargando…"; al resolver desaparece.

### AC-25.4 — JSON deshabilitado mientras carga
- Click en JSON → el botón queda `disabled` hasta que el detalle resuelva (éxito o error) y se re-habilita; el guard de S23 (un solo pedido) sigue vigente.

## Datos de prueba
- Promesas pendientes resueltas dentro de `await act(...)` (patrón S24/S21) con arrays de resolvers.
- `window.confirm` stubbeado con save/restore (patrón S20) para Borrar.
- `escribirEn` acepta `<select>` (trigger/desde/hasta).
- Fixtures `EntradaSnapshot` con hash corto (patrón s18/s12).

## Fuera de alcance
- Skeletons/spinners y pulido estético de `.vacio`/`.cargando` (S26).
- El "Cargando…" de la ruta del historial en `Shell` (S26, requiere montar Router).
- Deshabilitar "Volver"/navegación, reintentos automáticos, auto-refresh.
- Doble click en pestañas paralelas (el estado es por instancia de la página).

## Enmiendas
- Ninguna: no contradice specs previos (S8/S9/S12/S19/S20/S23 cubren otros aspectos de los mismos componentes).
