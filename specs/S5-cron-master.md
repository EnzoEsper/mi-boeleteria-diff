# S5 — Cron maestro (Deno.cron + matchesCron por fuente)

**Objetivo:** captura automática: un único cron maestro (cada minuto) que procesa las fuentes con `cronEnabled`, evaluando por fuente su `cronExpr` con `cron-parser` — el diseño de "un cron estático + scheduler dinámico" del plan (Deno.cron no permite registrar crons por fuente en runtime).

**Fuente:** plan, "`Deno.cron()` se llama una vez por fuente activa al arrancar el isolate → usamos un único cron maestro" + pasos "Cron maestro + parser de cron expression" y prueba manual "Deshabilitar cron → verificar que no se generan más".

## Estado: verde

## Criterios de aceptación

### AC-5.1 — El pase solo procesa fuentes habilitadas
- `cronTick(kv, { fetchImpl, now })` recorre todas las fuentes y solo fetchéa las que tienen `cronEnabled: true` (default de creación es `false`, ya cubierto en AC-1.1).
- Las deshabilitadas quedan en `result.skipped` y no invocan el fetch.
- Resultado: `{ ok: string[], skipped: string[], failures: { sourceId, error }[] }` con los ids correspondientes.

### AC-5.2 — Snapshots con trigger "cron"
- Cada captura exitosa del pase persiste snapshots con `trigger: "cron"`.
- Contenido idéntico al anterior → `changed: false`; contenido mutado → `changed: true`; y `latest`/`stats` se actualizan igual que en el disparo manual.

### AC-5.3 — Un fallo no aborta el pase
- Con una fuente que responde HTTP 500 y otra sana en el mismo tick: la sana queda en `ok`, la rota en `failures` con `error` conteniendo `HTTP 500`, y `stats.errorCount` de la rota incrementa.
- Un `cronExpr` inválido también cae en `failures` (mensaje con `cron inválido`) sin romper el resto del pase.

### AC-5.4 — matchesCron evalúa la ventana del minuto
- `matchesCron("*/15 * * * *", fecha)` es true en minutos 00/15/30/45 y false en un minuto intermedio (ej. 14:07).
- `matchesCron("0 3 * * *", fecha)` true a las 03:00 (hora local del sistema) y false a las 03:01; `matchesCron("* * * * *", ...)` siempre true.
- La evaluación alinea la fecha al minuto (segundos = 0).

### AC-5.5 — El cronExpr decide por tick
- Con una fuente `cronEnabled: true, cronExpr: "*/15 * * * *"`: un tick con `now` a las 14:07 la saltea (sin snapshot), y un tick con `now` a las 14:15 la procesa (snapshot con `trigger: "cron"`).
- Fuente habilitada con `cronExpr: null` se procesa en cada tick.

### AC-5.6 — Registro del cron maestro con guard
- `server/cron.ts` expone `registerMasterCron` que llama `Deno.cron("scheduler", "* * * * *", handler)` delegando en `cronTick` con el fetch real, **solo si** el runtime expone `Deno.cron` (guard defensivo: ausente en CLI local, presente en Deno Deploy).
- `server/main.ts` invoca `registerMasterCron` dentro de `start()`. Verificado por inspección de fuente (estilo AC-0.6).

## Datos de prueba
- Fetch inyectado por URL (contador de invocaciones) para saber a quién se llamó.
- Fechas construidas con componente local (`new Date(y, m, d, h, min)`) para no depender del timezone de la máquina.
- `now` inyectado en `cronTick` para simular ticks arbitrarios.

## Fuera de alcance
- Validación de `cronExpr` en `POST /api/sources` y preview en la UI (llega con el form de fuentes).
- PATCH/DELETE de fuentes (habilitar/deshabilitar desde la API ya es posible vía creación; el toggle llega con el CRUD).
- Cambiar la cadencia del cron maestro (fija en `* * * * *`; 1.440 ejecuciones/día dentro del free tier del plan).
