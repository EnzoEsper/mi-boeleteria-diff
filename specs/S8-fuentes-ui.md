# S8 — UI de fuentes: listado, alta, captura e import (render bajo jsdom)

**Objetivo:** la primera pantalla real del walking skeleton: listar fuentes, crear una fuente (url o file), disparar la captura manual y subir un archivo — todo renderizado en el gate de Deno con jsdom + `act` (spike validado: jsdom@24, render y click OK; happy-dom descartado por chocar con los eventos del runtime de Deno 2).

**Fuente:** plan, `/sources` (lista de fuentes), `/sources/new` (form: nombre, tipo URL/archivo) y "Importar archivo: snapshot manual con POST /api/sources/:id/import".

## Estado: verde

## Criterios de aceptación

### AC-8.1 — Infra de render en el gate de Deno
- `deno.json` declara `compilerOptions` con `lib: ["deno.ns", "dom", "esnext"]`, `jsx: "react-jsx"`, `types` con `@types/react`/`@types/react-dom` (React 19 no trae tipos propios) e imports para `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client` y `jsdom` (npm:jsdom@24, la versión que pasa en Deno 2). Subpaths explícitos porque Deno no soporta prefijos de import map apuntando a npm (`"react/": "npm:react@^19/"` no resuelve: no puede URL-parsear el sufijo).
- `tests/dom.ts` exporta `instalarDom()` que registra globals jsdom (`window`, `document`, `Event`, `MouseEvent`, `IS_REACT_ACT_ENVIRONMENT`) de forma idempotente.
- Los módulos de React (`react`, `react-dom/client`, `web/src/*.tsx`) se importan **después** de `instalarDom()` (dynamic import): `react-dom` evalúa `canUseDOM`/`isInputEventSupported` al cargarse y, sin `window.document` en ese instante, queda en el polyfill de eventos `input` y los `change` de inputs controlados nunca se disparan. `import type` estático sí está permitido (se elimina en runtime).

### AC-8.2 — FuentesPage lista las fuentes con sus acciones
- Con `listSources` stub devolviendo una fuente `url` y otra `file`, el DOM muestra los nombres, los badges de tipo y: botón **Capturar** en la url; **input de archivo** en la file, cuyo `change` dispara la importación (AC-8.5).
- Si `listSources` rechaza con `ApiError`, se muestra el `message` del error en la página.

### AC-8.3 — Capturar dispara fetchNow y muestra el resultado
- Click en **Capturar** → se llama `fetchNow(id)` de esa fuente y el resultado (`changed: true/false`) aparece en la fila.
- Si `fetchNow` lanza `ApiError(502)`, se muestra su mensaje y la página no se rompe.

### AC-8.4 — Alta de fuente con validación del backend
- Submit del form con nombre y url → `createSource({ name, type: "url", url })`; la fuente nueva aparece en el listado sin recargar la página y el form se limpia.
- Si el backend responde `ApiError(400)` con `issues`, se muestra el mensaje del primer issue.
- Con `type: "file"` no se envía `url` (coincide con el contrato de AC-6.1).

### AC-8.5 — Importar archivo desde la fila file
- Elegir un archivo en el input de la fila file y disparar `change` → se llama `importFile(id, file)` con ese `File`.
- Éxito → mensaje `importado` con el `trigger: "import"` del snapshot; `ApiError` → su mensaje.

### AC-8.6 — Sin imports de CSS/assets en los componentes testeables
- `FuentesPage.tsx` (y cualquier componente de `web/src/` testeado desde Deno) no importa `.css` ni binarios de assets (Deno no los resuelve); los estilos globales quedan en `main.tsx` (`index.css`), fuera del grafo de tests. `App.tsx` compone la navegación (`Shell` desde S9, que a su vez compone `FuentesPage`).

## Datos de prueba
- Stub de `createApi` con `vi`-less handlers por método (`{ listSources: async () => [...], ... }`) castuado al tipo de retorno de `createApi` (o `Partial<...>` + cast).
- Helpers de interacción: `escribirEn(input, texto)` con el setter nativo de `HTMLInputElement.prototype` (React trackea el value; RTL-style) y `enviarForm(form)` con `submit` cancelable.
- Sin red ni puertos: todo en memoria con jsdom.

## Fuera de alcance
- Campos avanzados del form (headers, cronExpr, cronEnabled) — el contrato ya existe (S1/S5), la UI de cron viene después.
- Router/URLs (`/sources`, `/sources/:id`): la navegación es estado interno de la app por ahora.
- Estética/paleta (CSS global mínimo alcanza para el walking skeleton); lint de estilo de componentes con oxlint queda para pulido.
