# JSON Diff Tracker (mi-boleteria-diff)

Herramienta para **comparar versiones de un JSON a lo largo del tiempo** — al principio desde `https://miboleteria.com.ar/xml/horarios.txt` — con historial de snapshots y diff visual.

Stack: **Deno (server + API + cron) + Vite/React (UI)**, persistencia en Deno KV. Plan de referencia: `what-is-the-most-vivid-plum 1.md`.

## Metodología: Spec-Driven Development + micro-loop

`specs/` es la fuente de verdad. **Ningún código sin spec; ninguna spec sin test.**

### El micro-loop (1 loop = 1 slice vertical)

| # | Paso | Qué pasa |
|---|---|---|
| ① | **spec** | escribir/editar `specs/S<n>-*.md` con los criterios numerados `AC-x.y` |
| ② | **red** | crear los tests en `tests/acceptance/` que referencian esos `AC-x.y` → fallan |
| ③ | **green** | implementar el mínimo en `server/` o `web/` para pasarlos |
| ④ | **refactor** | verde → limpiar sin romper |
| ⑤ | **verify** | `deno task verify` → gate completo del loop |
| ⑥ | **registro** | spec a `## Estado: verde` + fila en `specs/TRACEABILITY.md` |
| ⑦ | **siguiente slice** | WIP = 1: solo una spec abierta a la vez |

### Comandos del loop

| Comando | Qué hace |
|---|---|
| `deno task spec:check` | valida la trazabilidad `AC ↔ test ↔ TRACEABILITY` |
| `deno task test` | tests de aceptación (type-check incluido) |
| `deno task check` | type-check de los entrypoints |
| `deno lint` | lint del repo |
| `deno task verify` | **gate**: `spec:check → lint → check → test → build` |
| `deno task dev` | server Deno con KV local (disponible desde el slice 1) |
| `deno task dev:web` | Vite dev server (proxy a `:8000`) |
| `deno task build` | build de producción de `web/` |

### Estructura de specs

```
specs/S<n>-<slug>.md   # plantilla: Objetivo | ## Estado | ## Criterios de aceptación (### AC-n.k)
                       #            | ## Datos de prueba | ## Fuera de alcance
specs/TRACEABILITY.md  # matriz AC ↔ test ↔ slice ↔ estado
```

Cada `AC-x.y` tiene exactamente un test que lo referencia por id:

```ts
Deno.test("AC-0.3: detecta AC definido sin test que lo referencie", () => { ... });
```

Si agregás un AC sin test, o un test sin AC, o borrás una fila de la matriz: `deno task spec:check` falla.

## Setup

```sh
deno task verify        # gate completo del loop
npm --prefix web install  # solo necesario para build/dev de la UI
```

## Layout

```
specs/     specs ejecutables (fuente de verdad) + TRACEABILITY.md
scripts/   spec_check.ts (trazabilidad)
tests/     acceptance/*.test.ts + fixtures/ (payload real del endpoint)
server/    Deno: main, router, kv, diff, snapshot, cron
web/       Vite + React + TypeScript
```

## Deploy

Despliegue en **Deno Deploy EA** — la plataforma activa (la versión clásica se apagó el 20-jul-2026). El proceso único de `server/main.ts` sirve **API + cron + estáticos** (`web/dist/` como fallback).

1. **Login** (una vez): `deno deploy whoami` — abre el browser y guarda el token en el keyring del sistema.
2. **Alta de la app** (una vez): `deno deploy create --app mi-boleteria-diff --source local --entrypoint server/main.ts --build-command "deno task build"` (o `deno deploy create` sin flags para el flujo interactivo).
3. **KV gestionada:** `deno deploy database provision mi-boleteria-kv --kind denokv` y `deno deploy database assign mi-boleteria-kv --app mi-boleteria-diff` (también desde la consola → *Databases*). En EA la app abre `Deno.openKv()` sin path y usa esa base.
4. **Deploy:** `deno task deploy` = `deno task build` (gate local) + `deno deploy --app mi-boleteria-diff --prod`.

En EA la app detecta el entorno con `DENO_DEPLOY=1`: el cron maestro se registra **a nivel de módulo** en `server/main.ts` (requisito de descubrimiento de `Deno.cron()`); en local ese registro sigue dentro de `start()`. No hay variables de entorno obligatorias: `PORT` es opcional (default 8000). Los secretos nunca se committean (`.env*` está en `.gitignore`).
