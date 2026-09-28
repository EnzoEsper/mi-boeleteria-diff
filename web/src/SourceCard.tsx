import { useState } from "react";
import type { FetchResponse, Fuente } from "./api.ts";
import { mensajeDe } from "./mensajes.ts";

export interface SourceCardApi {
  fetchNow(id: string): Promise<FetchResponse>;
  importFile(id: string, file: File): Promise<FetchResponse>;
  deleteSource(id: string): Promise<{ deleted: string }>;
}

export function SourceCard({
  api,
  fuente,
  onVerHistorial,
  onBorrada,
}: {
  api: SourceCardApi;
  fuente: Fuente;
  onVerHistorial?: (fuente: Fuente) => void;
  onBorrada?: (id: string) => void;
}) {
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      {onVerHistorial && (
        <button type="button" onClick={() => onVerHistorial(fuente)}>
          Historial
        </button>
      )}
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
      {mensaje && <span className="resultado">{mensaje}</span>}
      {error && <span className="error">{error}</span>}
    </li>
  );
}
