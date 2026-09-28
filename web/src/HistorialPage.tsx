import { useEffect, useRef, useState } from "react";
import type { Api, EntradaSnapshot, Fuente } from "./api.ts";
import { DiffViewer } from "./DiffViewer.tsx";
import { mensajeDe } from "./mensajes.ts";
import { formatearMomento } from "./tiempo.ts";

export type HistorialApi = Pick<Api, "listSnapshots" | "getDiff" | "getSnapshot">;

export interface Comparacion {
  left: number;
  right: number;
}

interface HistorialProps {
  api: HistorialApi;
  fuente: Fuente;
  onVolver: () => void;
  /** Par de la URL (`?left=&right=`) cuando la vista cuelga de una ruta; null si no hay query. */
  comparacion?: Comparacion | null;
  /** En contexto de ruta, "Comparar" escribe la URL y el effect carga el diff. */
  onCompararEnRuta?: (left: number, right: number) => void;
}

interface Resultado {
  delta: unknown;
  left?: unknown;
}

export function HistorialPage({ api, fuente, onVolver, comparacion = null, onCompararEnRuta }: HistorialProps) {
  const [entradas, setEntradas] = useState<EntradaSnapshot[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [errorDiff, setErrorDiff] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [trigger, setTrigger] = useState("todos");
  const [soloCambios, setSoloCambios] = useState(false);
  const [json, setJson] = useState<{ timestamp: number; texto: string | null; error: string | null } | null>(null);
  const [comparando, setComparando] = useState(false);
  const diffCargado = useRef<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api.listSnapshots(fuente.id)
      .then((listado) => {
        if (!vivo) return;
        setEntradas(listado.snapshots);
        setError(null);
      })
      .catch((err: unknown) => {
        if (vivo) setError(mensajeDe(err));
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [api, fuente.id]);

  useEffect(() => {
    if (!comparacion) {
      diffCargado.current = null;
      setResultado(null);
      setErrorDiff(null);
      return;
    }
    const clave = `${comparacion.left}|${comparacion.right}`;
    if (diffCargado.current === clave) return;
    let vivo = true;
    (async () => {
      try {
        const diff = await api.getDiff(fuente.id, comparacion.left, comparacion.right);
        const izquierdo = await api.getSnapshot(fuente.id, comparacion.left);
        if (!vivo) return;
        setResultado({ delta: diff.delta, left: izquierdo.json });
        setErrorDiff(null);
        diffCargado.current = clave;
      } catch (err: unknown) {
        if (vivo) setErrorDiff(mensajeDe(err));
      }
    })();
    return () => {
      vivo = false;
    };
  }, [api, comparacion, fuente.id]);

  async function comparar(): Promise<void> {
    if (comparando) return;
    if (!desde || !hasta) {
      setErrorDiff("Elegí dos snapshots");
      return;
    }
    const izq = Number(desde);
    const der = Number(hasta);
    if (onCompararEnRuta) {
      onCompararEnRuta(izq, der);
      return;
    }
    setComparando(true);
    try {
      const diff = await api.getDiff(fuente.id, izq, der);
      const izquierdo = await api.getSnapshot(fuente.id, izq);
      setResultado({ delta: diff.delta, left: izquierdo.json });
      setErrorDiff(null);
    } catch (err: unknown) {
      setErrorDiff(mensajeDe(err));
    } finally {
      setComparando(false);
    }
  }

  async function alternarJson(timestamp: number): Promise<void> {
    if (json?.timestamp === timestamp) {
      if (json.texto !== null) {
        setJson(null);
        return;
      }
      if (json.error === null) return; // en curso: un click no debe re-pedir
    }
    setJson({ timestamp, texto: null, error: null });
    try {
      const detalle = await api.getSnapshot(fuente.id, timestamp);
      const texto = JSON.stringify(detalle.json, null, 2);
      setJson((actual) => (actual?.timestamp === timestamp ? { timestamp, texto, error: null } : actual));
    } catch (err: unknown) {
      const error = mensajeDe(err);
      setJson((actual) => (actual?.timestamp === timestamp ? { timestamp, texto: null, error } : actual));
    }
  }

  const texto = busqueda.trim().toLowerCase();
  const visibles = entradas.filter((entrada) => {
    if (trigger !== "todos" && entrada.trigger !== trigger) return false;
    if (soloCambios && !entrada.changed) return false;
    if (texto) {
      const coincideHash = entrada.hash.toLowerCase().startsWith(texto);
      const coincideFecha = formatearMomento(entrada.timestamp).toLowerCase().includes(texto);
      if (!coincideHash && !coincideFecha) return false;
    }
    return true;
  });

  return (
    <section>
      <h2>Historial — {fuente.name}</h2>
      <button type="button" onClick={onVolver}>
        Volver
      </button>

      {cargando && <p data-cargando>Cargando…</p>}
      {error && <p className="error">{error}</p>}

      {!cargando && !error && entradas.length === 0 && (
        <p className="vacio" data-vacio>
          Todavía no hay capturas en esta fuente.
        </p>
      )}

      {!cargando && !error && entradas.length > 0 && (
        <>
          <div className="filtros">
            <input
              type="search"
              placeholder="Filtrar…"
              aria-label="Filtrar historial"
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
            />
            <select aria-label="Trigger" value={trigger} onChange={(event) => setTrigger(event.target.value)}>
              <option value="todos">todos</option>
              <option value="manual">manual</option>
              <option value="cron">cron</option>
              <option value="import">import</option>
            </select>
            <label>
              <input
                type="checkbox"
                aria-label="Solo con cambios"
                checked={soloCambios}
                onChange={(event) => setSoloCambios(event.target.checked)}
              />
              Solo con cambios
            </label>
          </div>
          <p data-contador>
            {visibles.length} de {entradas.length} snapshots
          </p>
        </>
      )}

      {!cargando && !error && entradas.length > 0 && visibles.length === 0 && (
        <p className="vacio" data-sin-resultados>
          Ningún snapshot coincide con los filtros.
        </p>
      )}

      {entradas.length > 0 && (
        <ul className="timeline">
        {visibles.map((entrada) => (
          <li
            key={entrada.timestamp}
            data-timestamp={entrada.timestamp}
            data-changed={entrada.changed}
            data-trigger={entrada.trigger}
            data-since-base={entrada.sinceBase ?? ""}
            data-delta-from={entrada.deltaFrom ?? ""}
          >
            <span className="momento">{formatearMomento(entrada.timestamp)}</span>
            <code>{entrada.hash.slice(0, 8)}</code>
            <span>{entrada.sizeBytes} B</span>
            <span className="trigger">{entrada.trigger}</span>
            <span className={entrada.changed ? "badge badge-ok" : "badge badge-neutro"}>
              {entrada.changed ? "cambió" : "sin cambios"}
            </span>
            {entrada.sinceBase !== null && <span className="flag">base hace {entrada.sinceBase}</span>}
            {entrada.deltaFrom !== null && (
              <span className="flag">delta de {formatearMomento(entrada.deltaFrom)}</span>
            )}
            <button
              type="button"
              disabled={json?.timestamp === entrada.timestamp && json.texto === null && json.error === null}
              onClick={() => void alternarJson(entrada.timestamp)}
            >
              JSON
            </button>
            {json?.timestamp === entrada.timestamp && json.texto !== null && (
              <pre data-json={entrada.timestamp}>{json.texto}</pre>
            )}
            {json?.timestamp === entrada.timestamp && json.error !== null && (
              <span className="error">{json.error}</span>
            )}
          </li>
        ))}
        </ul>
      )}

      {entradas.length > 0 && (
        <div className="comparador">
          <select aria-label="Desde" value={desde} onChange={(event) => setDesde(event.target.value)}>
            <option value="">Elegir…</option>
            {entradas.map((entrada) => (
              <option key={entrada.timestamp} value={entrada.timestamp}>
                {formatearMomento(entrada.timestamp)} ({entrada.trigger})
              </option>
            ))}
          </select>
          <select aria-label="Hasta" value={hasta} onChange={(event) => setHasta(event.target.value)}>
            <option value="">Elegir…</option>
            {entradas.map((entrada) => (
              <option key={entrada.timestamp} value={entrada.timestamp}>
                {formatearMomento(entrada.timestamp)} ({entrada.trigger})
              </option>
            ))}
          </select>
          <button type="button" disabled={comparando} onClick={() => void comparar()}>
            Comparar
          </button>
        </div>
      )}

      {errorDiff && <p className="error">{errorDiff}</p>}
      {resultado && <DiffViewer delta={resultado.delta} left={resultado.left} nombre={fuente.name} />}
    </section>
  );
}
