# S30 — Filtro por fechas de los snapshots

**Objetivo:** acotar el timeline a un **rango de días** (hora de Buenos Aires)
con dos datepickers, sin salir de la página y sin llamadas extra a la API. Era
"fuera de alcance" en S12 (el comparador cubría elegir instantes); el usuario
pidió explícitamente el filtro por fechas.

**Fuente:** pedido de usuario (post S28/S29); enmienda de
`S12-timeline-filtros.md` (fuera de alcance y AC-12.3).

## Estado: verde

## Criterios de aceptación

### AC-30.1 — Dos inputs de fecha en los filtros

- `.filtros` incluye dos `input[type="date"]` con `aria-label="Fecha desde"` y
  `aria-label="Fecha hasta"`, **vacíos por defecto**.
- Con ambos vacíos la lista queda completa (`4 de 4` en los datos de prueba) y
  el filtrado **no** dispara llamadas extra (solo `listSnapshots` del montaje,
  como AC-12.1).

### AC-30.2 — Rango inclusivo por día de Buenos Aires, en intersección

- Cada entrada se testea contra `formatearMomento(timestamp).slice(0, 10)`
  (`YYYY-MM-DD` en Buenos Aires): `desde` y `hasta` son **inclusivos** (un
  snapshot del día límite se muestra; `desde = hasta =` un día muestra solo ese
  día).
- 0 coincidencias → contador `0 de N` y mensaje `[data-sin-resultados]` (mismo
  estado vacío que el resto de los filtros).
- El rango **combina por intersección** con trigger, "solo con cambios" y
  búsqueda (p. ej. `desde=2023-11-16` + `trigger=cron` muestra solo T4 en los
  datos de prueba).

### AC-30.3 — El comparador no se filtra

- Con `desde`/`hasta` de fecha activos, los selects **Desde/Hasta** del
  comparador siguen listando **todos** los snapshots (`N + 1` opciones:
  "Elegir…" + N), igual que AC-12.3. El filtro solo afecta la lista visible.

## Datos de prueba

- Fixtures de `s12_timeline_filtros.test.ts`: 4 snapshots con días BA
  T1=`2023-11-14`, T2=`2023-11-15`, T3=`2023-11-16`, T4=`2023-11-17` (22:13 UTC
  → 19:13 BA del mismo día); triggers manual/cron/import/cron.
- Helpers existentes: `montar`, `escribirEn` (acepta `2023-11-16` en
  `input[type=date]`), `buscar`, `contador`.

## Fuera de alcance

- Persistir el rango en la URL (los filtros viven en estado local desde S12; S15
  ya deep-link-ea el par de comparación).
- Datepicker con calendario nativo más fino (el nativo del browser ya es un
  calendario).
- Rango guardado / presets ("últimos 7 días", etc.).
