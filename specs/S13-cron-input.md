# S13 — CronInput con validación y preview

**Objetivo:** al crear una fuente URL el usuario escribe una expresión cron con **feedback inmediato**: preview en texto humano si es válida, error visible si no lo es, y el alta nunca envía un cron inválido al backend (el cron sigue siendo opcional).

**Fuente:** plan, paso 6 — "validación de cron expression (preview con `cronstrue`)".

## Estado: verde

## Criterios de aceptación

### AC-13.1 — CronInput valida y previsualiza
- `CronInput` es un componente **controlado** (`value` + `onChange`) con input de placeholder `*/5 * * * *`.
- Expresión válida (`*/5 * * * *`): se muestra un preview en `[data-preview-cron]` con el texto humano de `cronstrue` que menciona el intervalo (p. ej. `5` en "Every 5 minutes").
- Expresión inválida (`no-es-cron`): se muestra `[data-cron-error]` con `cron inválido` y **no** hay preview.
- Cadena vacía: ni error ni preview (el cron es opcional).
- `CronInput.tsx` no importa `.css` ni assets (regla AC-8.6).

### AC-13.2 — Alta de fuente con cron
- Con tipo `url`, el form incluye el campo cron; con cron válido y submit, `createSource` recibe `cronExpr` junto al resto del payload (contrato S1).
- Con cron **inválido**: el submit queda bloqueado — no se llama `createSource` y el error del cron permanece visible.
- Con cron vacío: se envía **sin** `cronExpr` (regresión del contrato S1).
- Con tipo `file` el campo cron no aparece y no se envía `cronExpr`.

### AC-13.3 — Dependencias consistentes en Deno y Vite
- `cronstrue` y `cron-parser` figuran tanto en `deno.json` (`imports`, para los tests en Deno) como en `web/package.json` (para `tsc`/Vite). Verificado por inspección de fuente.

## Datos de prueba
- `apiStub` de `tests/support_ui.ts` con `listSources: []` y `createSource` capturadora.
- Helpers `montar`, `escribirEn`, `enviarForm`, `buscar` (el input se llena con el setter nativo + evento `input`).

## Fuera de alcance
- Preview de "próxima ejecución" (fecha/hora del siguiente tick) — sería `cron-parser` además del texto.
- Editar `cronExpr`/`cronEnabled` de una fuente existente (el backend ni siquiera tiene `PATCH`).
- Localización del preview (cronstrue v2 no trae `es`; queda en inglés).
