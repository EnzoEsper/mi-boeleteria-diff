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
2. **Alta de la app** (una vez): `deno deploy create --app mi-boleteria-diff --source local --region us --no-wait` — la org sale de la clave `deploy.org` de `deno.json` (la sección `deploy` la consume el CLI: `org`/`app`; **el builder no la lee**). Los flags de build de `create` (`--build-command`, `--entrypoint`, …) no llegan al server: **la config de build efectiva se setea en el dashboard** → Settings → App configuration → Edit: install `npm --prefix web install`, build `deno task build`, runtime **Dynamic** con entrypoint `server/main.ts` y **Build memory 3072**.
3. **KV gestionada:** `deno deploy database provision mi-boleteria-kv --kind denokv` y `deno deploy database assign mi-boleteria-kv --app mi-boleteria-diff` (también desde la consola → *Databases*; verificar con `deno deploy database list` — en algunos flujos la app ya nace con una asignada). En EA la app abre `Deno.openKv()` sin path y usa esa base.
4. **Deploy:** `deno task deploy` = `deno task build` (gate local) + `deno deploy --app mi-boleteria-diff --prod`. URL: `https://mi-boleteria-diff.<org>.deno.net`.

> **Usage (free):** los límites mensuales (memory time, requests, KV…) son **por organización**; excederlos pausa las apps hasta el siguiente ciclo. El cron maestro corre 2×/día (ver abajo) para no consumir el *memory time* — cada segundo con el isolate cargado se factura aunque esté idle.

En EA la app detecta el entorno con `DENO_DEPLOY=1`: el cron maestro se registra **a nivel de módulo** en `server/main.ts` (requisito de descubrimiento de `Deno.cron()`); en local ese registro sigue dentro de `start()`. No hay variables de entorno obligatorias: `PORT` es opcional (default 8000). Los secretos nunca se committean (`.env*` está en `.gitignore`).

### Variables de entorno (cron y fetch)

- **`MASTER_CRON`** — cadencia del cron maestro. Default **`0 9,21 * * *`** (dos veces por día, 9:00 y 21:00); una env vacía o inválida cae al default. En Deploy se cambia **sin rebuild**: `deno deploy env add MASTER_CRON "0 7,19 * * *"`.
- **`FETCH_TIMEOUT_MS`** — timeout de cada fetch de fuente (default `15000`). Evita que una red colgada mantenga cargado el isolate y consuma *memory time*.

El maestro no evalúa el `cronExpr` de cada fuente en el minuto puntual sino en la **ventana desde el último tick** (`(último tick, ahora]`, guardado en KV como `["masterTick"]`; el primer tick usa las últimas 24 h). Por eso una fuente con `0 12 * * *` dispara aunque el maestro corra solo a las 9:00 y 21:00. **La frecuencia efectiva de una fuente nunca supera la del maestro**: un `*/5 * * * *` con el maestro 2×/día termina capturando 2 veces por día.
