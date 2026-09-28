# S26 — Pulido visual: estructura, timeline/diff y responsive

**Objetivo:** las áreas "estética general", "timeline y diff" y "responsive/móvil" del pulido de UI: dar estructura de tarjetas a la lista de fuentes (hoy sin estilo), layout a los formularios, tono a los botones/badges, estilo al bloque JSON y apilado en móvil; más el loader que faltó en la ruta del historial.

**Fuente:** cola de pulido de UI — continúa S25 (comportamiento) con la capa visual.

## Estado: verde

## Criterios de aceptación

### AC-26.1 — Clases de estructura (wiring)
- FuentesPage: `<ul class="fuentes">`; SourceCard: `<li class="fuente" data-tipo="…">`; form de alta `class="alta"`; form de edición `class="editar"`; botón Borrar `class="peligro"` (los `data-*` existentes no cambian).
- HistorialPage: el badge del timeline es `class="badge badge-ok"` cuando `changed` y `class="badge badge-neutro"` cuando no.
- Shell: el "Cargando…" de `/historial/:id` lleva `data-cargando` (igual que las páginas desde S25).

### AC-26.2 — Reglas de estilo nuevas en index.css
- Todas las clases nuevas (`.fuentes`, `.fuente`, `.alta`, `.editar`, `.peligro`, `.badge-ok`, `.badge-neutro`) tienen regla propia en `index.css` (AC-14.1 también lo exige).
- Tono: `.peligro` usa `var(--err*)`, `.badge-ok` usa `var(--ok*)`, `.badge-neutro` es neutro (`--bg-soft`/`--border`).
- `[data-json]` tiene regla: mono, `overflow` con `max-height` (bloque de código scrolleable), fondo `--code-bg` y borde.

### AC-26.3 — Responsive
- El bloque `@media (max-width: 720px)` incluye `#root`, `.alta` y `.editar` además de las reglas existentes (`.timeline li`, `.comparador`).
- En móvil `.alta` y `.editar` se apilan (`flex-direction: column`) y los inputs/.botones van a ancho completo.

## Datos de prueba
- Lectura de `web/src/index.css` con `Deno.readTextFile` (patrón S14) para AC-26.2/26.3.
- Renders DOM con `apiStub`/`montar` para AC-26.1; Shell con `BrowserRouter` + `window.history.replaceState` (patrón S15) y `getSource` pendiente nunca resuelto.

## Fuera de alcance
- Skeletons animados/spinners, toggle manual de tema, iconografía, fuentes tipográficas externas, cambios de copy.
- Reordenar el contenido de las filas/timeline (solo clases y estilo).
- Estilos del diff de jsondiffpatch (los aporta su CSS importado en main; solo se toca la carcasa `.diff-viewer` si hace falta).

## Enmiendas
- Ninguna.
