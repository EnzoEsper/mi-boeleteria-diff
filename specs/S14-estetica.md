# S14 — Estética de la UI

**Objetivo:** la app pasa de "CSS de scaffold de Vite" a un diseño propio, consistente y responsive: un sistema de tokens en `index.css` que cubre **todas** las clases que usan los componentes, y cero CSS muerto.

**Fuente:** pulido de UI (elección de usuario). El `index.css`/`App.css` actuales son el template de Vite (`.hero`, `#center`, `.counter`…) y ninguna clase de nuestros componentes tiene reglas.

## Estado: verde

## Criterios de aceptación

### AC-14.1 — Cobertura componente ↔ CSS
- Cada clase usada en `className="…"` de los `web/src/*.tsx` tiene al menos una regla (`.clase`) en `web/src/index.css`.
- El test extrae las clases de los componentes con regex y las contrasta contra el CSS (estilo AC-8.6); falla si aparece una clase sin estilizar.

### AC-14.2 — Sistema de estilos base
- `index.css` define tokens en `:root` (colores con acento, tipografía, sombra) con variante `@media (prefers-color-scheme: dark)`, estilos de `body`, y un `@media (max-width: …)` responsive.
- Reglas presentes y con contenido de diseño para: `.error`, `.badge`, `.resultado`, `.filtros`, `.comparador`, `.timeline` (tarjetas) y `.diff-viewer`.

### AC-14.3 — Sin scaffold muerto y formatter integrado
- `web/src/App.css` ya no existe y **ningún** `.tsx` importa `.css` salvo `main.tsx` (el único entrypoint, regla AC-8.6 generalizada).
- `main.tsx` sigue importando `jsondiffpatch/formatters/styles/html.css` y `index.css` contiene reglas `.jsondiffpatch-…` que integran el diff con la paleta.

## Datos de prueba
- Inspección de fuente (`*.tsx`, `index.css`, `main.tsx`, `App.css`) — el estilo de los AC-0.6 / AC-8.6 / AC-10.5: el gate `deno task build` verifica además que el CSS compile en Vite.

## Fuera de alcance
- Frameworks de CSS (Tailwind/shadcn) — el plan los lista como dependencias, pero un `index.css` con tokens resuelve el pulido sin ampliar la superficie del gate.
- Tests visuales con browser real (Playwright/etc.) — fuera del stack Deno puro del gate.
- Iconografía y assets externos (el sweep de clases/assets lo cubre AC-8.6).
