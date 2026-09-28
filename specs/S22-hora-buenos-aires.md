# S22 — Hora de Buenos Aires en la UI

**Objetivo:** los momentos de la UI (timeline, flags y comparador) se muestran en la zona de **Buenos Aires** (`America/Argentina/Buenos_Aires`, UTC-3 sin DST) en vez de UTC — el caso de uso vive en Argentina y las capturas del maestro (9:00/21:00) deben leerse en hora local.

**Fuente:** candidato "hora local en vez de UTC" de la cola de QoL.

## Estado: verde

## Criterios de aceptación

### AC-22.1 — `formatearMomento` formatea en Buenos Aires
- Nuevo módulo `web/src/tiempo.ts` exporta `ZONA_HORARIA = "America/Argentina/Buenos_Aires"` y `formatearMomento(timestamp: number): string` con formato `YYYY-MM-DD HH:mm:ss` en esa zona (vía `Intl.DateTimeFormat` + `formatToParts`, `hourCycle: "h23"`).
- `1_700_000_000_000` (2023-11-14 22:13:20 UTC) → `2023-11-14 19:13:20`.
- Medianoche: `Date.UTC(2024, 0, 1, 3, 0, 0)` (2024-01-01 03:00 UTC = 00:00 BA) → `2024-01-01 00:00:00` — la hora es `00` (no `24`).
- Cruce de día: `Date.UTC(2024, 0, 1, 2, 0, 0)` (2024-01-01 02:00 UTC) → `2023-12-31 23:00:00` — cae al día anterior.

### AC-22.2 — HistorialPage usa la zona nueva
- `HistorialPage` importa `formatearMomento` desde `web/src/tiempo.ts` (fin de la copia local en UTC): el timeline (`span.momento`), el flag "delta de …" y los `<option>` del comparador muestran hora de BA.
- Para T1 el DOM muestra `2023-11-14 19:13:20` y **no** contiene `22:13:20`.
- Regresión: el filtro de fecha del timeline (S12) sigue funcionando sobre la hora visible — los fixtures de S12 (22:13 UTC) se ven 19:13 de la misma fecha, así que `2023-11-15` y `2023-11` siguen coincidiendo (sus tests no cambian).

### AC-22.3 — Enmiendas (S9 AC-9.1)
- `specs/S9-historial-diff.md` AC-9.1: "momento en UTC" → "momento en Buenos Aires (`America/Argentina/Buenos_Aires`)" con el mismo formato `YYYY-MM-DD HH:mm:ss`; la sección de datos de prueba deja de depender de `getUTC*`.
- Tests actualizados: `s9_historial_diff.test.ts` (T1 se ve `2023-11-14 19:13:20`) y `s18_deep_link_compare.test.ts` (mismo string en sus 2 aserciones).

## Datos de prueba
- T1 = `1_700_000_000_000` (22:13:20 UTC → 19:13:20 BA); `Date.UTC` para el caso de medianoche.
- `montar` + `apiStub({ listSnapshots })` (patrón S9) para la aserción de DOM.

## Fuera de alcance
- Cambiar el `trigger`/hora de los cron del maestro (ya configurable con `MASTER_CRON`).
- Persistir o redondear timestamps (siguen siendo epoch ms; solo cambia el render).
- Localización de textos de la UI (sigue en español neutro).
