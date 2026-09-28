import { useEffect, useState, type FormEvent } from "react";
import type { ActualizarFuenteInput, CrearFuenteInput, FetchResponse, Fuente, StatsFuente } from "./api.ts";
import { CronInput, esCronValida } from "./CronInput.tsx";
import { mensajeDe } from "./mensajes.ts";
import { SourceCard } from "./SourceCard.tsx";

export interface FuentesApi {
  listSources(): Promise<Fuente[]>;
  createSource(input: CrearFuenteInput): Promise<Fuente>;
  updateSource(id: string, patch: ActualizarFuenteInput): Promise<Fuente>;
  fetchNow(id: string): Promise<FetchResponse>;
  importFile(id: string, file: File): Promise<FetchResponse>;
  deleteSource(id: string): Promise<{ deleted: string }>;
  getStats(id: string): Promise<StatsFuente>;
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
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<"url" | "file">("url");
  const [url, setUrl] = useState("");
  const [cronExpr, setCronExpr] = useState("");
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

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

  async function crear(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (creando) return;
    const cron = cronExpr.trim();
    if (tipo === "url" && cron !== "" && !esCronValida(cron)) {
      return;
    }
    const input: CrearFuenteInput = tipo === "url"
      ? { name: nombre, type: "url", url, cronEnabled: true, ...(cron !== "" ? { cronExpr: cron } : {}) }
      : { name: nombre, type: "file" };
    setCreando(true);
    try {
      const creada = await api.createSource(input);
      setFuentes((prev) => [creada, ...prev]);
      setNombre("");
      setUrl("");
      setCronExpr("");
      setErrorForm(null);
    } catch (error: unknown) {
      setErrorForm(mensajeDe(error));
    } finally {
      setCreando(false);
    }
  }

  return (
    <section>
      <h2>Fuentes</h2>
      {cargando && <p data-cargando>Cargando…</p>}
      {errorLista && <p className="error">{errorLista}</p>}
      {!cargando && !errorLista && fuentes.length === 0 && (
        <p className="vacio" data-vacio>
          Todavía no hay fuentes — creá la primera con el formulario de abajo.
        </p>
      )}
      {fuentes.length > 0 && (
        <ul>
          {fuentes.map((fuente) => (
            <SourceCard
              key={fuente.id}
              api={api}
              fuente={fuente}
              onVerHistorial={onVerHistorial}
              onBorrada={(id) => setFuentes((prev) => prev.filter((f) => f.id !== id))}
              onActualizada={(actualizada) =>
                setFuentes((prev) => prev.map((f) => (f.id === actualizada.id ? actualizada : f)))}
            />
          ))}
        </ul>
      )}

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
        <button type="submit" disabled={creando}>
          Crear fuente
        </button>
      </form>
      {errorForm && <p className="error">{errorForm}</p>}
    </section>
  );
}
