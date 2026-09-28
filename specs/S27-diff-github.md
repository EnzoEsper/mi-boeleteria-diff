# S27 — Diff estilo GitHub (vista de líneas + split/unified + colapso)

**Objetivo:** reemplazar el árbol semántico de `jsondiffpatch/formatters/html` por una vista de diff de líneas estilo GitHub sobre el JSON pretty-printado: números de línea, stats `+N -M`, toggle split/unified y colapso de regiones sin cambios (también aligera el DOM con archivos de ~200 KiB).

**Fuente:** decisión de usuario (elegir "reemplazar el árbol por GitHub-style" + "incluir colapso de regiones"); enmienda de S9 (AC-9.2/9.5/9.6) y S14 (AC-14.3).

**Diseño:**
- Lado izquierdo: `JSON.stringify(left, null, 2)`; lado derecho: `JSON.stringify(patch(clone(left), delta), null, 2)` — calculado en el cliente con `jsondiffpatch`, sin pedir un snapshot extra (mantiene AC-9.2: un solo `getSnapshot`).
- Líneas con `diffLines` de `diff@9` (dependencia nueva en `web/package.json` + specifier `npm:diff@^9` en `deno.json`); los cambios consecutivos se emparejan lado a lado en split y se apilan del-encima/add-abajo en unified.
- Colapso: toda racha de contexto de **más de 12 líneas** conserva 3+3 visibles y colapsa el medio tras un botón "Expandir N líneas".

## Estado: verde

## Criterios de aceptación

### AC-27.1 — Diff de líneas estilo GitHub (split por defecto)
- Con `delta` no nulo, `DiffViewer` renderiza `.diff-viewer` con `data-modo="split"` y una `.dif-tabla` de filas por línea (contexto con ambos números de línea; cambios con clase `dif-del`/`dif-add` y el texto viejo/nuevo respectivos).
- El encabezado `.dif-encabezado` muestra el nombre de archivo (prop `nombre`), las stats `.dif-stat-add` / `.dif-stat-del` con la cantidad de líneas agregadas y borradas, y el selector `.dif-modos`.
- El lado derecho se calcula con `patch(clone(left), delta)` (no se llama `getSnapshot` un segundo vez).
- Con `delta` nulo no hay `.dif-tabla` y se muestra `Sin cambios entre ambos snapshots`.

### AC-27.2 — Toggle split/unified
- Los botones "Split" y "Unified" (`.dif-modo`, activo por `data-activo`) alternan `data-modo` del contenedor.
- En unified cada fila lleva `.dif-marca` con `+`/`-` y los números de línea izquierdo/derecho en columnas separadas; en split cada fila tiene los cuatro cells (num/código × 2 lados) con el cambio emparejado lado a lado.

### AC-27.3 — Colapso de regiones sin cambios
- Toda racha de contexto de más de 12 líneas se renderiza con su medio colapsado tras un botón `.dif-expandir` "Expandir N líneas" (las 3 primeras y 3 últimas de la racha quedan visibles, con la numeración original intacta).
- Click en el botón agrega el bloque a los expandidos: las N líneas aparecen y el botón desaparece (el estado se reinicia al cambiar `delta`/`left`).

### AC-27.4 — Integración y fin de formatter
- `HistorialPage` le pasa `nombre={fuente.name}` al `DiffViewer` (el encabezado lo muestra).
- El CSS del formatter html y las reglas muertas quedan fuera: `main.tsx` ya no importa `jsondiffpatch/formatters/styles/html.css` (solo `index.css`), e `index.css` ya no tiene `.jsondiffpatch-*` / `.toggle-unchanged` / `.diff-html` — solo reglas `.dif-*` nuevas (enmienda de AC-9.6 y AC-14.3).
- Los componentes siguen sin importar CSS (AC-8.6) y toda clase nueva tiene regla en `index.css` (AC-14.1).

## Datos de prueba
- Fixtures pequeños con `delta` a mano (`{ h: ["10:00", "11:00"] }` sobre `{ h: "10:00" }` → 22 líneas de texto con 1 cambiada) y un objeto de 20 claves cuyo cambio cae en la última para producir una racha de contexto de 20 líneas (medio colapsado = 14, "Expandir 14 líneas").
- `montar`/`click`/`buscar`/`boton` de `tests/support_ui.ts`; `DiffViewer` se monta directo para 27.1–27.3 y vía `HistorialPage` para 27.4.

## Fuera de alcance
- Syntax highlighting y diff intra-linea a nivel de palabra (`diffWordsWithSpace`) — defer.
- Virtualización de filas para archivos gigantes — el colapso ya reduce el DOM.
- Pedir el snapshot derecho al servidor — resuelto en el cliente con `patch` (decisión de diseño arriba).
