# S29 — Diff a todo el ancho de la pantalla

**Objetivo:** con `#root` acotado a `max-width: 960px`, el diff (tabla split de
dos columnas) solo puede ocupar ~930 px y las líneas envuelven mucho. El usuario
quiere **aprovechar todo el ancho de la pantalla** para ver mejor las dos partes
del diff.

**Fuente:** pedido de usuario (post S28); polish de la UI de comparación.

**Diseño:**

- `#root` deja de acotar el ancho (pasa a `width: 100%` sin `max-width`); el
  ancho de 960 px se recupera **por hijo**: `.cabecera` y
  `main > section, main > p` (páginas y estados de ruta) siguen centrados con
  `max-width: 960px` — la app se ve igual que antes.
- `HistorialPage` devuelve un fragmento: su `<section>` (timeline, filtros,
  comparador, errores) y el `<DiffViewer>` quedan **hermanos**; el diff es hijo
  directo de `main` → ocupa todo el ancho disponible (menos el padding de
  `#root`).

## Estado: verde

## Criterios de aceptación

### AC-29.1 — `#root` ya no acota; el resto conserva los 960

- La regla base `#root` de `index.css` **no** declara `max-width: 960px`.
- `.cabecera` y el bloque `main > section, main > p` declaran `width: 100%` +
  `max-width: 960px` centrados (`margin-inline: auto`) → páginas, header y
  estados de ruta siguen con el ancho de siempre.
- El `.diff-viewer`, al no caer bajo esos selectores, mide el 100 % de `main`
  (ancho completo de pantalla).

### AC-29.2 — HistorialPage monta el diff fuera de su sección

- Tras comparar, `.diff-viewer` existe y su `closest("section")` es `null` (es
  hermano de la `<section>` de la página, no su hijo).
- La `<section>` conserva timeline, filtros, contador, comparador y el mensaje
  de error del diff; el flujo `getDiff` + `getSnapshot` no cambia (regresiones
  cubiertas por s9/s18/s25).

## Datos de prueba

- Lectura de fuente de `web/src/index.css` (bloques `#root` base, `.cabecera`,
  `main > section…`) — estilo AC-14.x/S26.
- `HistorialPage` montado con `apiStub` de comparación (patrón s9/s27): selects
  "Desde"/"Hasta" → Comparar → assert estructural con `closest("section")`.

## Fuera de alcance

- Cambiar el ancho de la cabecera, el timeline o la lista de fuentes (siguen a
  960 px a propósito).
- Un toggle "ancho completo" configurable — si se pide, se agrega después.
