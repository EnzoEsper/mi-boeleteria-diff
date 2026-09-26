import { useState } from "react";
import type { Delta } from "jsondiffpatch";
import { format } from "jsondiffpatch/formatters/html";

export function DiffViewer({ delta, left }: { delta: unknown; left?: unknown }) {
  const [mostrarSinCambios, setMostrarSinCambios] = useState(false);
  const sinCambios = delta === null || delta === undefined;
  const html: string | null = sinCambios ? null : (format(delta as Delta, left) ?? "");

  return (
    <div className="diff-viewer" data-mostrar-sin-cambios={mostrarSinCambios ? "si" : "no"}>
      <label className="toggle-unchanged">
        <input
          type="checkbox"
          checked={mostrarSinCambios}
          onChange={(event) => setMostrarSinCambios(event.target.checked)}
        />{" "}
        Mostrar sin cambios
      </label>
      {html === null ? <p>Sin cambios entre ambos snapshots</p> : (
        <div className="diff-html" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}
