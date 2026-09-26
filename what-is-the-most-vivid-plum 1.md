# Plan: JSON Diff Tracker (Vite + React + Deno Deploy)

## Context

Necesitás una herramienta para **comparar versiones de un JSON a lo largo del tiempo** — venga de un archivo importado o de un endpoint HTTP — y conservar un **historial** de cambios. Debe permitir disparar la captura **manualmente o por cron**, y todo corriendo en stack 100% gratuito y moderno.

La solución elegida: **Vite + React + TypeScript** en el frontend, **Deno Deploy + Deno KV + `Deno.cron()`** en el backend. Un solo proyecto, un solo deploy, sin infra que mantener.

---

## Evaluación de alternativas (resumen)

| Opción | Cron | Storage | Pros | Contras |
|---|---|---|---|---|
| **Deno Deploy + Deno KV** ✅ | `Deno.cron()` nativo, free | KV 1GB free | Cero infra, cron declarativo en código, TypeScript end-to-end, 100k req/día | KV es key/value (no SQL) — queries de historial son por prefijo |
| Cloudflare Workers + D1 | Cron Triggers free | D1 5GB + KV 1GB | SQL real, ecosistema maduro | Más piezas, wrangler config, límites 1k writes/día en KV free |
| Supabase + pg_cron | pg_cron en Postgres | 500MB DB | SQL Postgres, dashboard | **Proyectos free pausan tras 7 días inactivos** → mata el cron |
| Local Node + node-cron + SQLite | node-cron | SQLite local | Cero deploy | Cron solo corre con la app abierta; no compartible |

**Decisión: Deno Deploy.** `Deno.cron()` se descubre automáticamente al deploy, KV alcanza de sobra para historial de JSONs, y todo es un único proceso TypeScript.

### Librería de diff: `jsondiffpatch`

Evaluados: `jsondiffpatch`, `deep-diff`, `microdiff`, `superdiff`.

**Elegido `jsondiffpatch`** porque:
- Genera **delta serializable** (lo guardamos en KV en vez del JSON completo cuando conviene)
- Detecta **moves en arrays** con `objectHash`
- Trae **`formatters.html`** → render visual del diff sin escribir CSS de diffs a mano
- Permite **`patch` / `unpatch`** → reconstruir cualquier versión histórica desde un snapshot + cadena de deltas

---

## Arquitectura

```
┌──────────────────────────┐         ┌────────────────────────────┐
│  Frontend (Vite + React) │  HTTP   │  Backend (Deno Deploy)     │
│                          │ ──────▶ │  - REST API                │
│  - Lista de Fuentes      │         │  - Deno.cron() schedulers  │
│  - Detalle + Timeline    │ ◀────── │  - Diff engine             │
│  - Visor de diff (HTML)  │         │                            │
│  - Importar archivo      │         │              ┌─────────────┤
│  - Trigger manual        │         │              │  Deno KV    │
└──────────────────────────┘         │              │  (historial)│
                                     └──────────────┴─────────────┘
```

Un solo deploy en Deno Deploy sirve **API + estáticos de Vite** desde el mismo proceso (Hono o Oak como router; build de Vite copiado a `./dist` y servido con `Deno.serve`).

---

## Modelo de datos (Deno KV)

KV usa claves jerárquicas (arrays). Layout:

```
["source", <sourceId>]                       → { id, name, type: "url"|"file",
                                                 url?, headers?, cronExpr?, 
                                                 cronEnabled, createdAt }

["snapshot", <sourceId>, <timestamp>]        → { hash, sizeBytes, full?: <JSON>,
                                                 deltaFrom?: <prevTimestamp>,
                                                 delta?: <jsondiffpatch delta>,
                                                 changed: boolean,
                                                 trigger: "manual"|"cron"|"import" }

["latest", <sourceId>]                       → <timestamp>  (puntero al último)

["stats", <sourceId>]                        → { totalSnapshots, lastChangedAt, ... }
```

**Estrategia de almacenamiento mixta** (para no reventar el 1GB):
- Cada N snapshots (configurable, default 20) guardamos `full` JSON completo
- En el medio, solo `delta` de jsondiffpatch desde el último snapshot
- Para reconstruir una versión: tomar el último `full` previo + aplicar `patch` con los deltas siguientes

---

## Detección de cambios

Cada snapshot se compara con el anterior canonicalizando el JSON (sort keys) y calculando su SHA-256. Si el hash coincide con el `latest`, se marca `changed: false` y no se persiste delta. Si difiere, se calcula el delta con `jsondiffpatch` y se almacena.

---

## Endpoints del backend

```
GET    /api/sources                     → lista de fuentes
POST   /api/sources                     → crea fuente (url o file)
PATCH  /api/sources/:id                 → edita (incluye cronExpr, cronEnabled)
DELETE /api/sources/:id                 → borra fuente + historial

POST   /api/sources/:id/fetch           → dispara fetch manual ahora
POST   /api/sources/:id/import          → multipart upload de un .json (snapshot manual)

GET    /api/sources/:id/snapshots       → lista paginada (sin payload)
GET    /api/sources/:id/snapshots/:ts   → snapshot reconstruido (full JSON)
GET    /api/sources/:id/diff/:ts        → diff vs anterior (delta + html)
GET    /api/sources/:id/diff/:a/:b      → diff arbitrario entre dos snapshots
```

### Cron

`Deno.cron()` se llama una vez por fuente activa **al arrancar el isolate**. Como el set de fuentes es dinámico, usamos un **único cron maestro** que corre cada minuto:

```ts
Deno.cron("scheduler", "* * * * *", async () => {
  for await (const src of listSourcesWithCronEnabled()) {
    if (matchesCron(src.cronExpr, new Date())) {
      await fetchAndStore(src, "cron");
    }
  }
});
```

Esto evita el límite de cron jobs estáticos y permite que el usuario configure expresiones cron arbitrarias desde la UI.

---

## Frontend

### Estructura de páginas

```
/                       Lista de fuentes (card por fuente: nombre, último cambio detectado)
/sources/new            Form: nombre, tipo (URL/archivo), URL, headers, cron expr
/sources/:id            Timeline vertical de snapshots
                          - Filtros: rango de fechas, trigger, solo con cambios
                          - Click en snapshot → panel de diff vs anterior
/sources/:id/compare    Selector de dos snapshots arbitrarios → diff side-by-side
```

### Componentes clave

- `<SourceCard />` — resumen con timestamp del último cambio detectado
- `<SnapshotTimeline />` — lista virtualizada (react-window si pasa de 200 items)
- `<DiffViewer />` — wrapper sobre `jsondiffpatch.formatters.html.format()` + toggle "unchanged" 
- `<CronInput />` — input + preview "próxima ejecución: ..." usando `cronstrue` para human-readable
- `<JsonDropzone />` — drag & drop de `.json` para snapshot manual

### State / data fetching

- **TanStack Query** (`@tanstack/react-query`) para cache + invalidación tras mutations
- **Zustand** o solo Context para UI state (filtros, panel abierto)
- **React Router** v6 para navegación

### Estilo

- **Tailwind CSS v4** (modo CSS-first, sin config compleja) + shadcn/ui para primitives
- Paleta sobria, monoespaciado para JSON viewer
- Dark mode por default

---

## Layout del proyecto

```
json-diff-tracker/
├── deno.json                 # tasks: dev, build, deploy
├── deno.lock
├── server/
│   ├── main.ts               # Deno.serve + Deno.cron
│   ├── router.ts             # Hono routes
│   ├── kv.ts                 # acceso a Deno KV
│   ├── diff.ts               # wrappers de jsondiffpatch
│   ├── snapshot.ts           # fetchAndStore, rebuildAt, hashing
│   └── cron.ts               # scheduler maestro
├── web/                      # Vite app
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/client.ts
│       ├── pages/
│       │   ├── SourcesList.tsx
│       │   ├── SourceNew.tsx
│       │   ├── SourceDetail.tsx
│       │   └── SourceCompare.tsx
│       └── components/
│           ├── SourceCard.tsx
│           ├── SnapshotTimeline.tsx
│           ├── DiffViewer.tsx
│           ├── CronInput.tsx
│           └── JsonDropzone.tsx
└── README.md
```

---

## Pasos de implementación

1. **Bootstrap del proyecto**
   - `deno init` + crear `web/` con `npm create vite@latest web -- --template react-ts`
   - `deno.json` con tasks: `dev:server`, `dev:web`, `build`, `deploy`

2. **Backend mínimo**
   - `server/main.ts` con `Deno.serve` + Hono
   - `server/kv.ts` con helpers `getSource`, `listSources`, `putSnapshot`, etc.
   - Endpoint `POST /api/sources` y `GET /api/sources` funcionando contra KV local (`deno run --unstable-kv`)

3. **Diff engine**
   - `server/diff.ts`: wrapper de `jsondiffpatch` (configurado con `objectHash: o => o.id ?? JSON.stringify(o)`)
   - Función `canonicalize(obj)` (sort keys) + `hash(obj)` → SHA-256

4. **Snapshot pipeline**
   - `fetchAndStore(source, trigger)`:
     1. fetch JSON (con headers)
     2. canonicalize + hash → si igual al `latest`, marcar `changed: false` y salir
     3. obtener snapshot anterior reconstruido
     4. calcular delta
     5. decidir guardar `full` (cada N) o solo `delta`
     6. escribir `snapshot` + actualizar `latest` + `stats`

5. **Cron maestro**
   - `server/cron.ts` con `Deno.cron("scheduler", "* * * * *", ...)`
   - Parser de cron expression (`cron-parser` desde `npm:` specifier)

6. **Frontend — fuentes**
   - Lista + form de alta con validación de cron expression (preview con `cronstrue`)
   - Importar archivo: snapshot manual con `POST /api/sources/:id/import`

7. **Frontend — historial + diff**
   - Timeline mostrando timestamp, trigger y si hubo cambios
   - `DiffViewer` integrando `jsondiffpatch/formatters/html` (importar CSS oficial)
   - Vista comparar dos snapshots arbitrarios

8. **Servir frontend desde el backend**
   - `npm run build` en `web/` → genera `web/dist/`
   - En `server/main.ts`: fallback a archivos estáticos de `web/dist/` para rutas no-API
   - `deno task build` corre el build de Vite y deja todo listo

9. **Deploy**
   - Crear proyecto en https://dash.deno.com → conectar repo de GitHub
   - Entrypoint: `server/main.ts`
   - Variables si fueran necesarias (ninguna obligatoria al inicio)
   - Habilitar Deno KV (gratis, 1 click)

---

## Archivos críticos a crear

| Path | Responsabilidad |
|---|---|
| `server/main.ts` | Bootstrap: Deno.serve + Deno.cron + router |
| `server/diff.ts` | jsondiffpatch + canonicalización + hashing |
| `server/snapshot.ts` | fetch / reconstrucción / hashing |
| `server/kv.ts` | Capa de acceso a Deno KV (todas las claves en un solo lugar) |
| `web/src/components/DiffViewer.tsx` | Render HTML del delta |
| `web/src/pages/SourceDetail.tsx` | Timeline + integración con DiffViewer |
| `deno.json` | tasks de dev/build/deploy + imports |

---

## Dependencias (todas free / open source)

**Server (Deno):**
- `hono` — router liviano
- `jsondiffpatch` — diff engine
- `cron-parser` — match de cron expressions

**Web (npm):**
- `react`, `react-dom`, `react-router-dom`
- `@tanstack/react-query`
- `jsondiffpatch` (mismo módulo, otra build)
- `cronstrue` — cron → texto humano
- `tailwindcss` v4 + `@radix-ui/react-*` (vía shadcn/ui)
- `zod` — validación de forms

---

## Verificación end-to-end

1. **Local dev**
   - `deno task dev` levanta server en `:8000` con KV local
   - `cd web && npm run dev` levanta Vite en `:5173` con proxy a `:8000`
   - Crear fuente apuntando a un endpoint JSON conocido (ej. `https://api.github.com/repos/denoland/deno`)
   - Trigger manual → verificar snapshot guardado en KV (`deno task kv:dump`)
   - Modificar el archivo de origen (si es URL controlada) o usar import → verificar que aparece nuevo snapshot con `changed: true` y delta no vacío

2. **Diff correctness**
   - Test unitario: dos JSONs conocidos → assert sobre estructura del delta
   - Test de reconstrucción: snapshot N reconstruido = JSON original capturado en ese momento

3. **Cron**
   - Crear fuente con `cronExpr: "* * * * *"` (cada minuto)
   - Esperar 3 minutos → verificar 3 snapshots con `trigger: "cron"`
   - Deshabilitar cron → verificar que no se generan más

4. **Deploy**
   - Push a GitHub → Deno Deploy redeploy automático
   - Verificar `Deno.cron()` activo en el dashboard de Deno Deploy
   - Crear fuente desde la UI deployada y validar persistencia entre isolates

5. **Límites**
   - Confirmar uso de KV en dashboard < 1GB
   - Confirmar requests/día < 100k (cron maestro cada minuto = 1.440/día — sobra)
