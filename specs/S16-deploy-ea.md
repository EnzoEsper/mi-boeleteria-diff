# S16 — Deploy a Deno Deploy EA (plataforma activa)

**Contexto:** Deploy Classic (`deployctl` + dash.deno.com) fue **apagado el 20-jul-2026**; la vía oficial actual es el comando `deno deploy` integrado en el runtime (Deno Deploy EA). La task `deploy` de S11 apuntaba a `npm:deployctl@1`, un paquete squateado que no existe (falla real al ejecutarla).

**Cambios de plataforma que exige EA:**
- **KV gestionada:** se provisiona con `deno deploy database provision <n> --kind denokv` y se asigna al app; el código abre `Deno.openKv()` **sin path** (ya es el default de `start()`).
- **Cron:** la plataforma descubre `Deno.cron()` **solo a nivel de módulo** (sin condicionales ni awaits previos dentro del registro); el registro en `start()` no se descubre.
- **Detección de entorno:** `DENO_DEPLOY=1` (built-in en EA).

## Estado: verde

## Criterios de aceptación

### AC-16.1 — Task deploy usa `deno deploy` (EA), sin npm:deployctl
- `deno.json` `tasks.deploy` corre `deno task build` previo y luego `deno deploy` con `--app mi-boleteria-diff`; ya **no** referencia `npm:deployctl` ni `--project`.
- `deno task verify` permanece en verde.

### AC-16.2 — Cron maestro descubrible en EA y KV gestionada
- `server/main.ts` registra el cron maestro **a nivel de módulo** (antes de `export async function start`) solo cuando `DENO_DEPLOY=1`, con nombre distinto al de `start()` para no duplicar.
- En EA, `start()` **no** registra el cron por segunda vez (el descubrimiento es del registro top-level).
- `start()` sigue abriendo `Deno.openKv()` sin path cuando no se pasa `kvPath` (KV gestionada de EA / default del runtime).

### AC-16.3 — README documenta el flujo EA
- Sección `## Deploy`: login con `deno deploy whoami`, alta con `deno deploy create` (`--entrypoint server/main.ts`, `--build-command "deno task build"`), KV con `database provision/assign --kind denokv`, detecta el entorno con `DENO_DEPLOY=1`.
- Sin referencias a `deployctl`, `dash.deno.com` ni `DENO_DEPLOY_TOKEN` (Classic).

### AC-16.4 — Config canónica de Deploy en deno.json *(enmendado: org `espern4`)*
- `deno.json` incluye la clave `deploy` con: `org` (`espern4` — org nueva creada el 27-sep-2026 tras agotar la cuota de `enzoespergo`; la cláusula es **obligatoria para el parser del CLI**, sin ella `deno deploy` falla con `Failed to parse "deploy" configuration: missing field org`) y `app` (`mi-boleteria-diff`) — más `install` (`npm --prefix web install`), `build` (`deno task build`) y `runtime: { type: "dynamic", entrypoint: "server/main.ts" }`.
- **Aclaración (cierre A):** `install`/`build`/`runtime` del archivo **no los lee el builder** — la config de build efectiva vive en el **dashboard** (Settings → App configuration: install, build, dynamic/entrypoint, build memory 3072). El CLI solo consume `org`/`app` del archivo; los flags de build de `deno deploy create` tampoco aplican.
- Motivo: los flags de build pasados a `deno deploy create` no llegaron al server (el resumen mostraba `(n/a)` y la revision falló con "No build command configured / No runtime entrypoint provided").

### Enmiendas a S11 (realizadas por este slice)
- `AC-11.1`: de `deployctl --entrypoint` a `deno deploy --app mi-boleteria-diff`.
- `AC-11.3`: el README ya no exige `dash.deno.com` ni `DENO_DEPLOY_TOKEN`.

## Datos de prueba
- Tests de strings sobre `deno.json`, `server/main.ts` y `README.md` (mismo estilo que S11): posición del registro de cron antes de `start`, presencia de `DENO_DEPLOY`, ausencia de `npm:deployctl`.

## Fuera de alcance
- Ejecutar el deploy real contra la cuenta del usuario (requiere login interactivo suyo; acción manual posterior al slice, no verificable por el gate).
- Deploy desde GitHub Actions; multi-entorno/timelines; rollback.
