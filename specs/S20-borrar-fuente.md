# S20 — Borrar fuente (DELETE /api/sources/:id + UI)

**Objetivo:** completar el CRUD: una fuente se puede dar de baja desde la UI, y el server elimina todos sus datos de KV (fuente, snapshots, blobs, latest, stats) sin dejar huérfanos.

**Fuente:** opción 3 acordada el 28-sep-2026 (QoL: borrar fuente).

## Estado: verde

## Criterios de aceptación

### AC-20.1 — DELETE borra la fuente y todos sus datos de KV
- `DELETE /api/sources/:id` → **200** `{ "deleted": "<id>" }` y elimina: la entrada `["source", id]`, todos los snapshots `["snapshot", id, …]`, los blobs chunkeados `["blob", id, …]`, `["latest", id]` y `["stats", id]` — sin tocar datos de otras fuentes.
- Después del DELETE: `GET /api/sources/:id` → 404, `GET /api/sources` ya no la incluye y `GET /api/sources/:id/snapshots` → 404.

### AC-20.2 — DELETE de un id inexistente → 404
- Responde **404** `{ "error": "fuente no encontrada" }` y no modifica nada (las demás fuentes siguen listables).

### AC-20.3 — Cliente `deleteSource`
- `createApi().deleteSource(id)` emite `DELETE /api/sources/{id}` con ruta relativa (misma regla S7) y devuelve el body 2xx parseado.
- Un 4xx/5xx se normaliza en `ApiError` como el resto del cliente.

### AC-20.4 — SourceCard: Borrar con confirm
- El card muestra el botón **Borrar**; `window.confirm` aceptado → `deleteSource(id)` y luego `onBorrada(id)` (la fila desaparece de `FuentesPage`).
- Cancelado → sin llamada a `deleteSource` ni `onBorrada`.
- Un `ApiError` del DELETE queda visible en `.error` de la fila sin romperla.

## Datos de prueba
- Server: `withApp` (KV temporal) + `fetchImpl` stub con el fixture; se cuentan entradas por prefijo antes/después del DELETE.
- **Gotcha Deno 2.6.7:** `kv.list({ prefix })` **excluye la clave igual al prefijo** — las claves exactas (`source`/`latest`/`stats`) se verifican con `kv.get` y se borran con `kv.delete` directo; `list` solo se usa para prefijos con hijos (`snapshot`/`blob`, claves estrictamente mayores).
- UI: `window.confirm` sobreescrito por el test (jsdom no implementa diálogos) + `apiStub`.

## Fuera de alcance
- Borrado lógico/soft-delete o papelera de reciclaje.
- Borrar snapshots individuales (solo la fuente completa).
- Undo del borrado.
