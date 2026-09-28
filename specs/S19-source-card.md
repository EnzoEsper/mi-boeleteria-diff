# S19 — Componente `<SourceCard />` (extracción de la fila de fuentes)

**Objetivo:** la fila de cada fuente vive en su propio componente testeable, con su estado de mensaje/error acoplado; `FuentesPage` queda como orquestadora (lista + formulario). Salud de código sin cambio de comportamiento visible.

**Fuente:** opción 3 acordada el 28-sep-2026 (componente `<SourceCard />`).

## Estado: verde

## Criterios de aceptación

### AC-19.1 — SourceCard renderiza la fila de una fuente
- `SourceCard({ api, fuente, onVerHistorial? })` devuelve el `<li data-tipo="url|file">` con: nombre, badge del tipo, botón **Historial** (solo si se pasa `onVerHistorial`), **Capturar** para `type: url` o input `file` (accept `application/json`) para `type: file`.
- Sin `onVerHistorial` no se renderiza el botón Historial (misma regla que la lista actual).

### AC-19.2 — SourceCard maneja sus mensajes y errores
- **Capturar** OK → muestra `changed=<bool>` en `.resultado` y limpia el error.
- **Capturar** con `ApiError` → muestra el mensaje en `.error` sin romper la fila.
- **Importar** OK → muestra `importado (trigger=<trigger>)`.
- El estado es interno del card (ya no vive en mapas de `FuentesPage`).

### AC-19.3 — FuentesPage queda orquestadora y la regresión de S8 sigue verde
- `FuentesPage.tsx` mapea `<SourceCard>` por fuente y **ya no contiene** el `<li>` ni la lógica de `capturar`/`importar` (inspección de fuente, estilo AC-0.6).
- `SourceCard.tsx` es el único archivo con `<li data-tipo` y no importa CSS ni assets (regla AC-8.6).
- Los tests de S8 (`s8_fuentes_ui.test.ts`) siguen pasando sin cambios: son la regresión de esta extracción.

## Datos de prueba
- Render standalone de `SourceCard` con `apiStub` que registra `fetchNow`/`importFile`.
- Inspección de fuente de `FuentesPage.tsx` y `SourceCard.tsx`.

## Fuera de alcance
- Cambiar el markup visible, las clases CSS o los textos de la fila (la extracción es 1:1).
- Borrar/editar fuentes (S20).
- Virtualización de listas largas.
