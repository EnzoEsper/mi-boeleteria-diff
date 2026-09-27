# S5 — Cron maestro (Deno.cron + matchesCron por fuente)

**Objetivo:** captura automática: un único cron maestro que procesa las fuentes con `cronEnabled`, evaluando por fuente su `cronExpr` con `cron-parser` — el diseño de "un cron estático + scheduler dinámico" del plan (Deno.cron no permite registrar crons por fuente en runtime). La cadencia del maestro era cada minuto y pasa a configurable/baja frecuencia en S17 (enmiendas AC-5.4/5.5/5.6).

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

### AC-5.4 — matchesCron evalúa la ventana entre ticks *(enmendado en S17)*
- `matchesCron(expr, desde, hasta)` es true si `expr` tiene al menos una ocurrencia en la ventana semiabierta `(desde, hasta]`.
- `matchesCron("*/15 * * * *", 14:00, 14:16)` → true (la ocurrencia 14:15 cae en la ventana); `matchesCron("*/15 * * * *", 14:00, 14:14)` → false (la próxima es 14:15 > hasta).
- Ventana cuya inicio y fin son la misma ocurrencia: `matchesCron("*/15 * * * *", 14:00, 14:00)` → false (inicio estricto); `matchesCron("*/15 * * * *", 13:59, 14:00)` → true.
- `matchesCron("0 3 * * *", 2026-09-26 02:00, 2026-09-26 03:00)` → true; con `desde` a las 03:00 → false (la próxima es el día siguiente).
- `matchesCron("* * * * *", desde, hasta)` es true siempre que la ventana no esté vacía (`hasta > desde`).

### AC-5.5 — El cronExpr decide por ventana desde el último tick *(enmendado en S17)*
- Con `["masterTick"]` en KV a las 14:01 y `now` a las 14:07, una fuente `cronEnabled: true, cronExpr: "*/15 * * * *"` se saltea (sin snapshot): su ocurrencia 14:00 no es estrictamente posterior a 14:01.
- Con el mismo `masterTick` y `now` a las 14:15 dispara (snapshot con `trigger: "cron"`) y deja `["masterTick"] = 14:15`.
- Un tick posterior (`now` a las 14:16) no vuelve a disparar (la ventana `(14:15, 14:16]` no contiene ocurrencias) — sin dobles captures por tick.
- Sin `["masterTick"]` en KV (primer tick), la ventana default es `hasta − 24h`: una fuente con `cronExpr: "0 12 * * *"` evaluada a las 14:00 dispara (catch-up).
- Fuente habilitada con `cronExpr: null` se procesa en cada tick.

### AC-5.6 — Registro del cron maestro con guard *(enmendado en S17)*
- `server/cron.ts` expone `registerMasterCron` que llama `Deno.cron("scheduler", masterCronExpr(), handler)` delegando en `cronTick` con el fetch real, **solo si** el runtime expone `Deno.cron` (guard defensivo: ausente en CLI local, presente en Deno Deploy).
- La expresión viene de `masterCronExpr()` (AC-17.1); la cadencia ya no está hardcodeada (enmendado desde `* * * * *`).
- `server/main.ts` invoca `registerMasterCron` dentro de `start()`. Verificado por inspección de fuente (estilo AC-0.6).

## Datos de prueba
- Fetch inyectado por URL (contador de invocaciones) para saber a quién se llamó.
- Fechas construidas con componente local (`new Date(y, m, d, h, min)`) para no depender del timezone de la máquina.
- `now` inyectado en `cronTick` para simular ticks arbitrarios.

## Fuera de alcance
- Validación de `cronExpr` en `POST /api/sources` y preview en la UI (llega con el form de fuentes).
- PATCH/DELETE de fuentes (habilitar/deshabilitar desde la API ya es posible vía creación; el toggle llega con el CRUD).
- ~~Cambiar la cadencia del cron maestro (fija en `* * * * *`)~~ → habilitado en S17 (default `0 9,21 * * *` vía env `MASTER_CRON`).
