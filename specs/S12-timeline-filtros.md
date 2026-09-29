# S12 — Filtros del timeline

**Objetivo:** el historial de una fuente se puede acotar sin salir de la página:
búsqueda por texto, filtro por trigger y "solo con cambios", todo cliente-side
sobre el listado ya pedido (sin llamadas extra a la API).

**Fuente:** pulido de UI (elección de usuario), plan (timeline con timestamp,
trigger y si hubo cambios).

## Estado: verde

## Criterios de aceptación

### AC-12.1 — Buscador y contador

- `HistorialPage` expone un campo de búsqueda (placeholder `Filtrar…`) que
  filtra **cliente-side** la lista visible por hash (prefijo, sin distinguir
  mayúsculas) y por fecha/hora visibles (`YYYY-MM-DD HH:mm:ss`, p. ej. `2023-11`
  coincide).
- La búsqueda vacía muestra la lista completa; el filtrado no dispara nuevas
  llamadas a la API (solo `listSnapshots` del montaje).
- Un contador visible (`data-contador`) refleja `X de Y snapshots` con el filtro
  aplicado.

### AC-12.2 — Filtro por trigger

- Select con `aria-label="Trigger"` y opciones `todos | manual | cron | import`
  que muestra solo los snapshots del trigger elegido (default `todos`).

### AC-12.3 — Solo con cambios y combinación

- Checkbox con `aria-label="Solo con cambios"` que muestra solo `changed: true`
  (default desmarcado).
- Los filtros combinan por **intersección** (p. ej. trigger=cron +
  solo-cambios + búsqueda). _(Enmendado en S30: se sumó el rango de fechas.)_
- Los selects **Desde/Hasta** del comparador siguen listando **todos** los
  snapshots (los filtros solo afectan la lista visible), y el botón **Volver**
  sigue funcionando.

## Datos de prueba

- `apiStub` con `listSnapshots` de 4 snapshots: manual sin cambios, cron con
  cambios, import con cambios, cron sin cambios (mismo `2023-11` en las fechas
  para el filtro de texto).
- Helpers de `tests/support_ui.ts` (`montar`, `escribirEn`, `click`, `buscar`).

## Fuera de alcance

- Filtro por rango de fechas (datepicker) — **llegó en S30** (acá solo cubría
  elegir instantes el comparador).
- Paginación del listado (el endpoint devuelve todo por página de KV).
- Persistir los filtros en la URL (llega con el router en S15).
