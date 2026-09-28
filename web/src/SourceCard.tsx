import { useState, type FormEvent } from "react";
import type { ActualizarFuenteInput, FetchResponse, Fuente } from "./api.ts";
import { CronInput, esCronValida } from "./CronInput.tsx";
import { mensajeDe } from "./mensajes.ts";

export interface SourceCardApi {
  fetchNow(id: string): Promise<FetchResponse>;
  importFile(id: string, file: File): Promise<FetchResponse>;
  deleteSource(id: string): Promise<{ deleted: string }>;
  updateSource(id: string, patch: ActualizarFuenteInput): Promise<Fuente>;
}

export function SourceCard({
  api,
  fuente,
  onVerHistorial,
  onBorrada,
  onActualizada,
}: {
  api: SourceCardApi;
  fuente: Fuente;
  onVerHistorial?: (fuente: Fuente) => void;
  onBorrada?: (id: string) => void;
  onActualizada?: (fuente: Fuente) => void;
}) {
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [nombreEdit, setNombreEdit] = useState("");
  const [cronEdit, setCronEdit] = useState("");
  const [cronActivo, setCronActivo] = useState(false);

  async function capturar(): Promise<void> {
    try {
      const res = await api.fetchNow(fuente.id);
      setMensaje(`changed=${res.snapshot.changed}`);
      setError(null);
    } catch (err: unknown) {
      setError(mensajeDe(err));
    }
  }

  async function importar(archivo: File | undefined): Promise<void> {
    if (!archivo) return;
    try {
      const res = await api.importFile(fuente.id, archivo);
      setMensaje(`importado (trigger=${res.snapshot.trigger})`);
      setError(null);
    } catch (err: unknown) {
      setError(mensajeDe(err));
    }
  }

  function editar(): void {
    setNombreEdit(fuente.name);
    setCronEdit(fuente.cronExpr ?? "");
    setCronActivo(fuente.cronEnabled);
    setError(null);
    setEditando(true);
  }

  function cancelar(): void {
    setEditando(false);
    setError(null);
  }

  async function guardar(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const cron = cronEdit.trim();
    if (fuente.type === "url" && cron !== "" && !esCronValida(cron)) return;
    const patch: ActualizarFuenteInput = fuente.type === "url"
      ? { name: nombreEdit.trim(), cronExpr: cron === "" ? null : cron, cronEnabled: cronActivo }
      : { name: nombreEdit.trim() };
    try {
      const actualizada = await api.updateSource(fuente.id, patch);
      onActualizada?.(actualizada);
      setEditando(false);
      setMensaje("actualizado");
      setError(null);
    } catch (err: unknown) {
      setError(mensajeDe(err));
    }
  }

  function borrar(): void {
    const seguro = globalThis.window.confirm(
      `¿Borrar la fuente "${fuente.name}"? Se eliminan también sus snapshots.`,
    );
    if (!seguro) return;
    void (async () => {
      try {
        await api.deleteSource(fuente.id);
        onBorrada?.(fuente.id);
      } catch (err: unknown) {
        setError(mensajeDe(err));
      }
    })();
  }

  return (
    <li data-tipo={fuente.type}>
      <strong>{fuente.name}</strong> <span className="badge">{fuente.type}</span>
      {editando ? (
        <form data-form-editar onSubmit={(event) => void guardar(event)}>
          <input
            placeholder="Nombre"
            value={nombreEdit}
            onChange={(event) => setNombreEdit(event.target.value)}
          />
          {fuente.type === "url" && (
            <>
              <CronInput value={cronEdit} onChange={setCronEdit} />
              <label>
                <input
                  type="checkbox"
                  checked={cronActivo}
                  onChange={(event) => setCronActivo(event.target.checked)}
                />
                automática
              </label>
            </>
          )}
          <button type="submit">Guardar</button>
          <button type="button" onClick={cancelar}>
            Cancelar
          </button>
        </form>
      ) : (
        <>
          {onVerHistorial && (
            <button type="button" onClick={() => onVerHistorial(fuente)}>
              Historial
            </button>
          )}
          <button type="button" onClick={editar}>
            Editar
          </button>
          {fuente.type === "url" && (
            <button type="button" onClick={() => void capturar()}>
              Capturar
            </button>
          )}
          {fuente.type === "file" && (
            <input
              type="file"
              accept="application/json"
              onChange={(event) => void importar(event.target.files?.[0])}
            />
          )}
          <button type="button" onClick={borrar}>
            Borrar
          </button>
        </>
      )}
      {mensaje && <span className="resultado">{mensaje}</span>}
      {error && <span className="error">{error}</span>}
    </li>
  );
}
