# S21 — Editar fuente (PATCH) y alta URL con cron habilitado

**Objetivo:** modificar una fuente existente —en especial la frecuencia de captura (`cronExpr` + `cronEnabled`)— desde la UI, y cerrar el hueco por el que las fuentes creadas desde la UI nunca corrían el cron (`cronEnabled` default `false` en AC-1.1 y la form de alta no lo enviaba).

**Fuente:** plan, paso 7 — "`PATCH /api/sources/:id` → edita (incluye cronExpr, cronEnabled)".

## Estado: verde

## Criterios de aceptación

### AC-21.1 — PATCH actualiza solo los campos provistos
- `PATCH /api/sources/:id` con body JSON acepta campos opcionales: `name` (string, min 1 tras trim), `url` (http(s)), `headers` (mapa string→string), `cronExpr` (string|null) y `cronEnabled` (boolean).
- Solo se actualizan los campos provistos: los ausentes conservan su valor (p. ej. patch de `name` no toca `cronExpr`).
- `id`, `type` y `createdAt` no cambian; un `type` mandado en el body se ignora (no está en el schema).
- Responde `200` con la fuente completa actualizada, y el `GET /api/sources/:id` posterior refleja los cambios.

### AC-21.2 — Validaciones y 404 del PATCH
- Body vacío (`{}`) o no-JSON → `400` con `{ error: "validación fallida", issues }` (el issue del body vacío menciona "sin campos").
- Campos con tipos inválidos (`cronEnabled: "si"`, `name: ""`, `url: "ftp://…"`) → `400` con `issues[0].path` correspondiente (mismo estilo S1).
- Id inexistente → `404` con `{ error: "fuente no encontrada" }`.

### AC-21.3 — Cliente `updateSource`
- `createApi().updateSource(id, patch)` emite `PATCH /api/sources/{id}` (ruta **relativa**, regla AC-7.1) con `content-type: application/json` y el body serializado; devuelve la `Fuente` parseada.
- Backend con `400`/`404` → rechaza con `ApiError` (status + mensaje + issues); red caída → rechaza con `TypeError`.

### AC-21.4 — UI: editar desde la fila
- `SourceCard` expone el botón **Editar**; al activarlo la fila muestra un form (`[data-form-editar]`) prellenado con el nombre actual, `CronInput` con el `cronExpr` actual y el checkbox "automática" (`cronEnabled`) — ambos solo para `type: "url"`; para `file` el form solo tiene nombre.
- **Guardar** (submit) → `updateSource(id, patch)` con `{ name, cronExpr: string|null, cronEnabled }` en url (cron vacío → `null`) o `{ name }` en file; éxito → la fila queda con la fuente actualizada vía `onActualizada`, el form se cierra y aparece mensaje `actualizado`.
- Cron inválido → no se llama `updateSource` y el error de `CronInput` queda visible.
- `ApiError` de la respuesta → su mensaje queda visible en la fila y el form permanece abierto.
- **Cancelar** cierra el form sin ninguna llamada.

### AC-21.5 — Alta URL habilita el cron por defecto (enmiendas AC-8.4 / AC-13.2)
- El form de alta con tipo `url` envía `cronEnabled: true` siempre (con o sin `cronExpr`): la fuente creada corre cron con la cadencia del maestro desde el alta; después puede pausarse/editarse con AC-21.4.
- El alta con tipo `file` no envía `cronEnabled` (queda el default `false` de AC-6.1; no hay cron que correr).
- Enmiendas aplicadas: `specs/S8-fuentes-ui.md` AC-8.4 y `specs/S13-cron-input.md` AC-13.2 (payloads URL ahora incluyen `cronEnabled: true`); sus tests actualizados.

## Datos de prueba
- `withApp` (tests/support.ts) para PATCH de servidor sobre la fuente fixture; `createApi(fetchSimulado)` para AC-21.3 (mismo patrón S7/S20).
- `apiStub` + `montar`/`click`/`escribirEn`/`boton` para AC-21.4/21.5; el form de edición se scopea por `[data-form-editar]` (la form de alta también tiene `CronInput` en la página).

## Fuera de alcance
- Editar `type` de la fuente (cambiaría el significado de snapshots/blobs existentes).
- Preview de "próxima ejecución" del cron (sigue pendiente desde S13).
- Edición de `headers` desde la UI (el endpoint la admite; la form no la expone).
