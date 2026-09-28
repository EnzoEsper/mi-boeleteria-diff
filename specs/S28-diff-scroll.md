# S28 — Diff sin scroll horizontal (columnas fijas + wrap)

**Objetivo:** la vista split del diff se ve "cortada": el layout auto de la tabla le da más ancho al lado con líneas más largas y `.diff-viewer` recorta con `overflow: hidden`, por lo que la mitad derecha queda fuera de pantalla y hay que scrollear horizontalmente. La meta es que **ambas partes siempre quepan en el contenedor, sin scroll horizontal**.

**Fuente:** reporte de usuario con captura (S27 recién entregado); polish de la UI de comparación.

**Diseño:**
- `.dif-codigo` pasa de `white-space: pre` + `overflow-x: auto` a `white-space: pre-wrap` + `overflow-wrap: anywhere`: las líneas largas envuelven dentro de su columna (min-content ~1 carácter) → ninguna celda desborda y no hay scroll por celda.
- `.dif-tabla` usa `table-layout: fixed` con `<colgroup>`: `.dif-col-num` reserva 60 px por número (cabe un número de 5 dígitos en border-box con padding 8+8) y `.dif-col-marca` 20 px; **las columnas de código van sin clase/width y se reparten el sobrante por partes iguales** — en split eso da 50/50 exacto (`calc` innecesario) y en unified el total sobrante.
- El `<colgroup>` se emite por modo (split: num, código, num, código; unified: num, num, marca, código), lo que evita el caso borde del `table-layout: fixed` cuando la primera fila es un expander colapsado (un solo `<td colSpan>`).

## Estado: verde

## Criterios de aceptación

### AC-28.1 — Las celdas de código envuelven sin scroll ni recorte
- La regla `.dif-codigo` de `index.css` declara `white-space: pre-wrap` y `overflow-wrap: anywhere`, y ya **no** declara `overflow-x` ni `text-overflow` (sin scroll por celda ni ellipsis).
- Con un fixture de línea de ~240 caracteres, `.dif-codigo.dif-del` y `.dif-codigo.dif-add` contienen el texto completo de sus lados en el DOM (no se trunca nada).

### AC-28.2 — Tabla de columnas fijas con colgroup por modo
- `.dif-tabla` declara `table-layout: fixed`; `.dif-col-num` tiene `width: 60px` y `.dif-col-marca` `width: 20px`.
- En split la tabla renderiza `<colgroup>` `[.dif-col-num, sin clase, .dif-col-num, sin clase]` (las dos columnas de código se quedan con el sobrante → 50/50); al pasar a unified queda `[.dif-col-num, .dif-col-num, .dif-col-marca, sin clase]`.
- El contenido de ambas columnas sigue visible en los dos modos (la regresión de la captura): el texto de izquierda y derecha está íntegro en el DOM.

## Datos de prueba
- Lectura de fuente de `web/src/index.css` (regex sobre los bloques `.dif-codigo`, `.dif-tabla`, `.dif-col-num`, `.dif-col-marca`) — estilo AC-14.x / S26.
- `montar`/`click`/`buscar`/`boton` de `tests/support_ui.ts`; `DiffViewer` montado directo con `delta {u: [...]}` y `left` de una línea de 240 chars.

## Fuera de alcance
- Diff intra-linea a nivel de palabra y syntax highlighting (defer de S27).
- Forzar unified en pantallas chicas (se puede sumar después con un media query + JS).
- Virtualización de filas.
