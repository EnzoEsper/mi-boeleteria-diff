import { useEffect, useState, type FormEvent } from "react";
import type { CrearFuenteInput, FetchResponse, Fuente } from "./api.ts";
import { CronInput, esCronValida } from "./CronInput.tsx";
import { mensajeDe } from "./mensajes.ts";

export interface FuentesApi {
  listSources(): Promise<Fuente[]>;
  createSource(input: CrearFuenteInput): Promise<Fuente>;
  fetchNow(id: string): Promise<FetchResponse>;
  importFile(id: string, file: File): Promise<FetchResponse>;
}

export function FuentesPage({
  api,
  onVerHistorial,
}: {
  api: FuentesApi;
  onVerHistorial?: (fuente: Fuente) => void;
}) {
  const [fuentes, setFuentes] = useState<Fuente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<"url" | "file">("url");
  const [url, setUrl] = useState("");
  const [cronExpr, setCronExpr] = useState("");
  const [errorForm, setErrorForm] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api.listSources()
      .then((lista) => {
        if (!vivo) return;
        setFuentes(lista);
        setErrorLista(null);
      })
      .catch((error: unknown) => {
        if (vivo) setErrorLista(mensajeDe(error));
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [api]);

  async function capturar(fuente: Fuente): Promise<void> {
    try {
      const res = await api.fetchNow(fuente.id);
      setMensajes((prev) => ({ ...prev, [fuente.id]: `changed=${res.snapshot.changed}` }));
      setErrores((prev) => ({ ...prev, [fuente.id]: "" }));
    } catch (error: unknown) {
      setErrores((prev) => ({ ...prev, [fuente.id]: mensajeDe(error) }));
    }
  }

  async function importar(fuente: Fuente, archivo: File): Promise<void> {
    try {
      const res = await api.importFile(fuente.id, archivo);
      setMensajes((prev) => ({ ...prev, [fuente.id]: `importado (trigger=${res.snapshot.trigger})` }));
      setErrores((prev) => ({ ...prev, [fuente.id]: "" }));
    } catch (error: unknown) {
      setErrores((prev) => ({ ...prev, [fuente.id]: mensajeDe(error) }));
    }
  }

  function elegirArchivo(fuente: Fuente, archivo: File | undefined): void {
    if (archivo) void importar(fuente, archivo);
  }

  async function crear(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const cron = cronExpr.trim();
    if (tipo === "url" && cron !== "" && !esCronValida(cron)) {
      return;
    }
    const input: CrearFuenteInput = tipo === "url"
      ? { name: nombre, type: "url", url, ...(cron !== "" ? { cronExpr: cron } : {}) }
      : { name: nombre, type: "file" };
    try {
      const creada = await api.createSource(input);
      setFuentes((prev) => [creada, ...prev]);
      setNombre("");
      setUrl("");
      setCronExpr("");
      setErrorForm(null);
    } catch (error: unknown) {
      setErrorForm(mensajeDe(error));
    }
  }

  return (
    <section>
      <h2>Fuentes</h2>
      {cargando && <p>Cargando…</p>}
      {errorLista && <p className="error">{errorLista}</p>}
      <ul>
        {fuentes.map((fuente) => (
          <li key={fuente.id} data-tipo={fuente.type}>
            <strong>{fuente.name}</strong> <span className="badge">{fuente.type}</span>
            {onVerHistorial && (
              <button type="button" onClick={() => onVerHistorial(fuente)}>
                Historial
              </button>
            )}
            {fuente.type === "url" && (
              <button type="button" onClick={() => void capturar(fuente)}>
                Capturar
              </button>
            )}
            {fuente.type === "file" && (
              <input
                type="file"
                accept="application/json"
                onChange={(event) => elegirArchivo(fuente, event.target.files?.[0])}
              />
            )}
            {mensajes[fuente.id] && <span className="resultado">{mensajes[fuente.id]}</span>}
            {errores[fuente.id] && <span className="error">{errores[fuente.id]}</span>}
          </li>
        ))}
      </ul>

      <form onSubmit={(event) => void crear(event)}>
        <input
          placeholder="Nombre"
          value={nombre}
          onChange={(event) => setNombre(event.target.value)}
        />
        <select value={tipo} onChange={(event) => setTipo(event.target.value as "url" | "file")}>
          <option value="url">url</option>
          <option value="file">file</option>
        </select>
        {tipo === "url" && (
          <input
            placeholder="https://..."
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        )}
        {tipo === "url" && <CronInput value={cronExpr} onChange={setCronExpr} />}
        <button type="submit">Crear fuente</button>
      </form>
      {errorForm && <p className="error">{errorForm}</p>}
    </section>
  );
}
