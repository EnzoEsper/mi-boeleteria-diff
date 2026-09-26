# S11 — Deploy listo para Deno Deploy

**Objetivo:** dejar el proyecto desplegable en Deno Deploy (paso 9 del plan) con una task reproducible, un repositorio limpio de artefactos, documentación de los pasos del dashboard y la garantía de que el entrypoint arranca de punta a punta (API + estáticos + cron) en un solo proceso.

**Fuente:** plan, paso 9 "Deploy" — proyecto en https://dash.deno.com, repo de GitHub, entrypoint `server/main.ts`, build `deno task build`, habilitar Deno KV (gratis); task `deploy` pedida desde el paso 1 del plan.

## Estado: verde

## Criterios de aceptación

### AC-11.1 — Task de deploy reproducible
- `deno.json` expone `tasks.deploy` que corre `deno task build` antes de desplegar y luego invoca `deployctl` con `--entrypoint=server/main.ts`.
- El despliegue manual usa el token `DENO_DEPLOY_TOKEN` (documentado en el README, AC-11.3); no se committea ningún token (`.env*` fuera de git, AC-11.2).

### AC-11.2 — Artefactos y secretos fuera de git
- `.gitignore` excluye: `node_modules/`, `web/node_modules/`, `web/dist/`, la KV local (`kv.sqlite*`), salidas de smoke (`smoke.*`) y entornos (`.env`).

### AC-11.3 — README documenta el deploy
- Sección **Deploy** con: crear proyecto en `dash.deno.com` conectando el repo de GitHub, entrypoint `server/main.ts`, build command `deno task build`, habilitar Deno KV, y la alternativa manual `DENO_DEPLOY_TOKEN` + `deno task deploy`. Verificado por inspección de fuente (estilo AC-0.6).

### AC-11.4 — Boot end-to-end de un solo proceso
- `start()` acepta opciones (`port`, `kvPath`, `distDir`, `cron`) con defaults compatibles con lo de hoy (`PORT` env → 8000, KV del runtime, `web/dist`, cron maestro activo) y sigue invocando `registerMasterCron(kv)` (regresión AC-5.6).
- Con `port: 0` + KV y dist temporales, el proceso sirve en **un mismo puerto** el `index.html` (`GET /`) y la API (`GET /api/sources` → JSON `[]`), y `shutdown()` + `finished` lo cierran limpio (el KV se cierra al terminar).

## Datos de prueba
- Dist temporal (`index.html` + un asset) y directorio temporal de KV inyectados vía las opciones de `start()`.
- Puerto efímero (`port: 0`): el test descubre el puerto real desde `server.addr.port`.

## Fuera de alcance
- Ejecutar el deploy real y el setup del dashboard — requiere la cuenta/credenciales del usuario (quedan documentados en el README).
- GitHub Actions / deploy automático en push (se agrega después, si se quiere).
- Dominio propio, previews por PR y variables de entorno adicionales.
