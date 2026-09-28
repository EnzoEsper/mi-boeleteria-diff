import { useState } from "react";
import type { FetchResponse, Fuente } from "./api.ts";
import { mensajeDe } from "./mensajes.ts";

export interface SourceCardApi {
  fetchNow(id: string): Promise<FetchResponse>;
  importFile(id: string, file: File): Promise<FetchResponse>;
}

export function SourceCard({
  api,
  fuente,
  onVerHistorial,
}: {
  api: SourceCardApi;
  fuente: Fuente;
  onVerHistorial?: (fuente: Fuente) => void;
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
      {mensaje && <span className="resultado">{mensaje}</span>}
      {error && <span className="error">{error}</span>}
    </li>
  );
}
