import { Fragment, useEffect, useMemo, useState } from "react";
import type { Delta } from "jsondiffpatch";
import { clone, patch } from "jsondiffpatch";
import { diffLines } from "diff";

interface Costado {
  n: number;
  texto: string;
}

interface Fila {
  izq: Costado | null;
  der: Costado | null;
  izqBorrado?: boolean;
  derAgregado?: boolean;
  bloque?: number;
  expandir?: { id: number; n: number };
}

const RACHA_SIN_COLAPSAR = 12;
const CONTEXTO_VISIBLE = 3;

function lineasDe(valor: string): string[] {
  const lineas = valor.split("\n");
  if (lineas[lineas.length - 1] === "") lineas.pop();
  return lineas;
}

function construirFilas(textoIzq: string, textoDer: string) {
  const partes = diffLines(textoIzq, textoDer);
  const filas: Fila[] = [];
  const lineas = (p: { count?: number; value: string }) => p.count ?? lineasDe(p.value).length;
  const agregadas = partes.filter((p) => p.added).reduce((n, p) => n + lineas(p), 0);
  const borradas = partes.filter((p) => p.removed).reduce((n, p) => n + lineas(p), 0);
  let nIzq = 1;
  let nDer = 1;
  let racha: Fila[] = [];
  let bloqueId = 0;

  const vaciarRacha = () => {
    if (racha.length > RACHA_SIN_COLAPSAR) {
      const id = bloqueId++;
      const inicio = racha.slice(0, CONTEXTO_VISIBLE);
      const medio = racha.slice(CONTEXTO_VISIBLE, racha.length - CONTEXTO_VISIBLE);
      const fin = racha.slice(racha.length - CONTEXTO_VISIBLE);
      for (const fila of medio) fila.bloque = id;
      filas.push(...inicio, { izq: null, der: null, expandir: { id, n: medio.length } }, ...medio, ...fin);
    } else {
      filas.push(...racha);
    }
    racha = [];
  };

  const contar = (parte: { added?: boolean; removed?: boolean; value: string }, borrados: string[], agregados: string[]) => {
    if (parte.removed) borrados.push(...lineasDe(parte.value));
    else agregados.push(...lineasDe(parte.value));
  };

  let i = 0;
  while (i < partes.length) {
    const parte = partes[i];
    i++;
    if (!parte.added && !parte.removed) {
      for (const texto of lineasDe(parte.value)) {
        racha.push({ izq: { n: nIzq++, texto }, der: { n: nDer++, texto } });
      }
      continue;
    }
    vaciarRacha();
    const borrados: string[] = [];
    const agregados: string[] = [];
    contar(parte, borrados, agregados);
    while (i < partes.length && (partes[i].added || partes[i].removed)) {
      contar(partes[i], borrados, agregados);
      i++;
    }
    const parejas = Math.max(borrados.length, agregados.length);
    for (let k = 0; k < parejas; k++) {
      const b = borrados[k];
      const a = agregados[k];
      filas.push({
        izq: b !== undefined ? { n: nIzq + k, texto: b } : null,
        der: a !== undefined ? { n: nDer + k, texto: a } : null,
        ...(b !== undefined ? { izqBorrado: true } : {}),
        ...(a !== undefined ? { derAgregado: true } : {}),
      });
    }
    nIzq += borrados.length;
    nDer += agregados.length;
  }
  vaciarRacha();
  return { filas, agregadas, borradas };
}

export function DiffViewer(
  { delta, left, nombre }: { delta: unknown; left?: unknown; nombre?: string },
) {
  const [modo, setModo] = useState<"split" | "unified">("split");
  const [expandidos, setExpandidos] = useState<number[]>([]);
  const sinCambios = delta === null || delta === undefined;

  const vista = useMemo(() => {
    if (sinCambios || left === undefined) return { filas: [], agregadas: 0, borradas: 0, error: false };
    try {
      const textoIzq = JSON.stringify(left, null, 2);
      const textoDer = JSON.stringify(patch(clone(left), delta as Delta), null, 2);
      return { ...construirFilas(textoIzq, textoDer), error: false };
    } catch {
      return { filas: [], agregadas: 0, borradas: 0, error: true };
    }
  }, [delta, left, sinCambios]);

  useEffect(() => {
    setExpandidos([]);
  }, [delta, left]);

  const expandido = (id: number) => expandidos.includes(id);
  const alternar = (id: number) =>
    setExpandidos((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const expander = (f: Fila, idx: number) => {
    const exp = f.expandir;
    if (!exp) return null;
    if (expandido(exp.id)) return null;
    return (
      <tr key={`exp-${idx}`}>
        <td colSpan={4}>
          <button type="button" className="dif-expandir" onClick={() => alternar(exp.id)}>
            Expandir {exp.n} líneas
          </button>
        </td>
      </tr>
    );
  };

  const oculta = (f: Fila) => f.bloque !== undefined && !expandido(f.bloque);

  const filaSplit = (f: Fila, idx: number) => {
    if (f.expandir) return expander(f, idx);
    if (oculta(f)) return null;
    if (f.izqBorrado || f.derAgregado) {
      return (
        <tr key={idx}>
          {f.izq ? <td className="dif-num dif-del">{f.izq.n}</td> : <td className="dif-num" />}
          {f.izq ? <td className="dif-codigo dif-del">{f.izq.texto}</td> : <td className="dif-codigo" />}
          {f.der ? <td className="dif-num dif-add">{f.der.n}</td> : <td className="dif-num" />}
          {f.der ? <td className="dif-codigo dif-add">{f.der.texto}</td> : <td className="dif-codigo" />}
        </tr>
      );
    }
    if (!f.izq || !f.der) return null;
    return (
      <tr key={idx}>
        <td className="dif-num">{f.izq.n}</td>
        <td className="dif-codigo">{f.izq.texto}</td>
        <td className="dif-num">{f.der.n}</td>
        <td className="dif-codigo">{f.der.texto}</td>
      </tr>
    );
  };

  const filaUnified = (f: Fila, idx: number) => {
    if (f.expandir) return expander(f, idx);
    if (oculta(f)) return null;
    if (f.izqBorrado || f.derAgregado) {
      return (
        <Fragment key={idx}>
          {f.izq !== null && (
            <tr>
              <td className="dif-num dif-del">{f.izq.n}</td>
              <td className="dif-num" />
              <td className="dif-marca dif-del">-</td>
              <td className="dif-codigo dif-del">{f.izq.texto}</td>
            </tr>
          )}
          {f.der !== null && (
            <tr>
              <td className="dif-num" />
              <td className="dif-num dif-add">{f.der.n}</td>
              <td className="dif-marca dif-add">+</td>
              <td className="dif-codigo dif-add">{f.der.texto}</td>
            </tr>
          )}
        </Fragment>
      );
    }
    if (!f.izq || !f.der) return null;
    return (
      <tr key={idx}>
        <td className="dif-num">{f.izq.n}</td>
        <td className="dif-num">{f.der.n}</td>
        <td className="dif-marca" />
        <td className="dif-codigo">{f.izq.texto}</td>
      </tr>
    );
  };

  return (
    <div className="diff-viewer" data-modo={modo}>
      <div className="dif-encabezado">
        <span className="dif-nombre">{nombre ?? "snapshot"}</span>
        <span className="dif-stat">
          <b className="dif-stat-add">+{vista.agregadas}</b>
          <b className="dif-stat-del">-{vista.borradas}</b>
        </span>
        {!sinCambios && !vista.error && (
          <div className="dif-modos">
            <button
              type="button"
              className="dif-modo"
              data-activo={modo === "split" ? "si" : "no"}
              onClick={() => setModo("split")}
            >
              Split
            </button>
            <button
              type="button"
              className="dif-modo"
              data-activo={modo === "unified" ? "si" : "no"}
              onClick={() => setModo("unified")}
            >
              Unified
            </button>
          </div>
        )}
      </div>
      {sinCambios
        ? <p className="vacio">Sin cambios entre ambos snapshots</p>
        : vista.error
        ? <p className="error">No se pudo armar el diff</p>
        : (
          <table className="dif-tabla">
            {modo === "split"
              ? (
                <colgroup>
                  <col className="dif-col-num" />
                  <col />
                  <col className="dif-col-num" />
                  <col />
                </colgroup>
              )
              : (
                <colgroup>
                  <col className="dif-col-num" />
                  <col className="dif-col-num" />
                  <col className="dif-col-marca" />
                  <col />
                </colgroup>
              )}
            <tbody>
              {vista.filas.map(modo === "split" ? filaSplit : filaUnified)}
            </tbody>
          </table>
        )}
    </div>
  );
}
