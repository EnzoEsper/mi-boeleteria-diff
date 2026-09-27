# S17 — Cron maestro de baja frecuencia (control de consumo)

**Objetivo:** el cron maestro pasa de correr **cada minuto (1.440/día)** a **un par de veces por día** (default `0 9,21 * * *`, configurable por env `MASTER_CRON`), porque en Deno Deploy el *memory time* se cobra por cada segundo con el isolate cargado (768 MB × s) y la cadencia por minuto quemó la cuota mensual del plan free en un día. Para que ninguna fuente pierda su schedule, `cronTick` evalúa el `cronExpr` de cada fuente contra la **ventana desde el último tick** (no contra el minuto puntual), y el fetch lleva **timeout** para que una red colgada no mantenga cargado el isolate.

**Fuente:** incidente de producción del 27-sep-2026 — app suspendida con `USAGE_EXCEEDED` en memory time (3.5/3.5 GiB·h del tier restringido); requerimiento del usuario: "un par de veces al día ya bastaría" y "configurable de alguna manera".

**Enmiendas a S5:** AC-5.4, AC-5.5 y AC-5.6 (ventana del minuto → ventana desde el último tick; cadencia fija → configurable).

## Estado: verde

## Criterios de aceptación

### AC-17.1 — Cadencia configurable por MASTER_CRON
- `server/cron.ts` expone `MASTER_CRON_DEFAULT = "0 9,21 * * *"` y `masterCronExpr()`: lee `Deno.env.get("MASTER_CRON")`; si está vacía o no parsea como cron → devuelve el default.
- `registerMasterCron` (local) y el registro a nivel de módulo de `server/main.ts` (`scheduler-deploy`, bajo `DENO_DEPLOY=1`) usan `masterCronExpr()` como expresión.
- La env se setea en Deploy con `deno deploy env add MASTER_CRON "..."` y no requiere rebuild.

### AC-17.2 — El cronExpr se evalúa por ventana desde el último tick
- `matchesCron(expr, desde, hasta)` es true si el `expr` tiene **al menos una ocurrencia estrictamente posterior a `desde` y ≤ `hasta`** (ventana semiabierta `(desde, hasta]`).
- `cronTick` usa `desde = ["masterTick"]` en KV (timestamp del último tick, alineado a minuto) y, si no existe (primer tick), `hasta − 24h`. `hasta` = `now` alineado a minuto.
- Tras procesar todas las fuentes, `cronTick` persiste `["masterTick"] = hasta` — los ticks consecutivos no disparan dos veces la misma ocurrencia.
- `cronExpr: null` sigue procesándose en cada tick (regresión AC-5.5).
- Una fuente cuya ventana contenga su ocurrencia dispara aunque el tick no coincida con esa hora (catch-up del primer tick: ventana de 24h).
- **Enmienda AC-5.4/5.5** en `specs/S5-cron-master.md` y sus tests.

### AC-17.3 — Fetch con timeout configurable
- `fetchAndStore` envía `signal: AbortSignal.timeout(fetchTimeoutMs())` en el init del fetch.
- `fetchTimeoutMs()` lee `FETCH_TIMEOUT_MS` (default `15000`); valor no numérico o ≤ 0 → default.
- Un fetch que nunca responde aborta → `FetchSourceError` con `fetch falló`, `stats.errorCount` incrementa y no se crea snapshot (mismo camino de error que AC-2.4).
- El timeout aplica también a los disparos manuales e import (mismo `fetchAndStore`).

### AC-17.4 — README documenta la cadencia y los límites
- README (sección Deploy) documenta: default `0 9,21 * * *`, cómo cambiarlo (`deno deploy env add MASTER_CRON "0 7,19 * * *"`), `FETCH_TIMEOUT_MS` (default 15000), la semántica de ventana y que la frecuencia efectiva de una fuente no puede superar la del maestro.

## Datos de prueba
- `now` y la env se inyectan/alteran con `try/finally` (restaurar `MASTER_CRON`/`FETCH_TIMEOUT_MS`).
- `["masterTick"]` se setea explícitamente en los tests de ventana para simular ticks anteriores.
- El timeout se prueba con un `fetchImpl` que cuelga hasta recibir el evento `abort`.

## Fuera de alcance
- Cambiar la cadencia desde la UI (queda en env; el backend ni siquiera tiene PATCH de fuentes).
- Reintentos/backoff de fetch fallido (sigue sin existir, igual que en S2).
- Verificar la organización de Deno Deploy (link de tarjeta) — decisión del usuario, independiente de este slice.
