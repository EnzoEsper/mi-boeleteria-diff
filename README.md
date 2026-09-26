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

Despliegue en Deno Deploy (paso 9 del plan). El proceso único de `server/main.ts` sirve **API + cron + estáticos** (`web/dist/` como fallback).

**Opción A — desde el dashboard (recomendada):**

1. Crear el proyecto en https://dash.deno.com y conectar el repo de GitHub.
2. **Entrypoint:** `server/main.ts`.
3. **Build command:** `deno task build` (genera `web/dist/` antes de cada deploy).
4. Habilitar **Deno KV** (gratis, 1 click) — ahí viven fuentes, snapshots y deltas.
5. Cada push a la rama principal vuelve a desplegar.

**Opción B — manual desde la terminal:**

```sh
export DENO_DEPLOY_TOKEN=<token de dash.deno.com → Settings → Tokens>
deno task deploy   # = deno task build && deployctl deploy --project=mi-boleteria-diff --entrypoint=server/main.ts
```

Ajustá `--project` en `deno.json` al nombre de tu proyecto si difiere de `mi-boleteria-diff`.

No hay variables de entorno obligatorias: `PORT` es opcional (default 8000) y la KV usa la del runtime. Los secretos nunca se committean (`.env*` está en `.gitignore`).
