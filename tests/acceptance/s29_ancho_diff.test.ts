import { assert } from "@std/assert";
import type { EntradaSnapshot, Fuente } from "../../web/src/api.ts";
import {
  apiStub,
  boton,
  buscar,
  click,
  createElement,
  escribirEn,
  montar,
} from "../support_ui.ts";

const { HistorialPage } = await import("../../web/src/HistorialPage.tsx");

const T1 = 1_700_000_000_000;
const T2 = 1_700_008_600_000;

const FUENTE: Fuente = {
  id: "id-url",
  name: "Horarios MB",
  type: "url",
  url: "https://miboleteria.com.ar/xml/horarios.txt",
  headers: {},
  cronExpr: null,
  cronEnabled: false,
  createdAt: "2026-09-26T12:00:00.000Z",
};

const ENTRADAS: EntradaSnapshot[] = [
  {
    timestamp: T2,
    hash: "1111222233334444",
    sizeBytes: 197500,
    changed: true,
    trigger: "manual",
    hasBlob: false,
    hasDelta: true,
    sinceBase: 1,
    deltaFrom: T1,
  },
  {
    timestamp: T1,
    hash: "9999888877776666",
    sizeBytes: 197942,
    changed: true,
    trigger: "cron",
    hasBlob: true,
    hasDelta: false,
    sinceBase: 0,
    deltaFrom: null,
  },
];

function bloque(css: string, selector: string): string {
  return css.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`))?.[0] ?? "";
}

// ---------------------------------------------------------------------------
// AC-29.1
// ---------------------------------------------------------------------------

Deno.test("AC-29.1: #root ya no acota el ancho y el resto conserva los 960", async () => {
  const css = await Deno.readTextFile(
    new URL("../../web/src/index.css", import.meta.url),
  );

  const raiz = bloque(css, "#root");
  assert(raiz, "falta la regla #root");
  assert(!raiz.includes("960px"), "#root ya no debe acotar a 960px");

  const cabecera = bloque(css, ".cabecera");
  assert(
    cabecera.includes("max-width: 960px"),
    "la cabecera sigue centrada a 960px",
  );
  assert(
    cabecera.includes("margin-inline: auto"),
    "la cabecera debe centrarse",
  );

  const paginas = css.match(/main\s*>\s*section[^{]*\{[^}]*\}/)?.[0] ?? "";
  assert(paginas, "falta la regla main > section");
  assert(
    paginas.includes("max-width: 960px"),
    "las páginas siguen acotadas a 960px",
  );
  assert(
    paginas.includes("margin-inline: auto"),
    "las páginas deben centrarse",
  );
  assert(
    /main\s*>\s*p/.test(css),
    "los estados de ruta (main > p) también se acotan",
  );
});

// ---------------------------------------------------------------------------
// AC-29.2
// ---------------------------------------------------------------------------

Deno.test("AC-29.2: el diff queda fuera de la sección de página (ancho completo)", async () => {
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({
        listSnapshots: () =>
          Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
        getDiff: (_id, from, to) =>
          Promise.resolve({
            sourceId: FUENTE.id,
            from,
            to,
            changed: true,
            delta: { h: ["10:00", "11:00"] },
          }),
        getSnapshot: (id, ts) =>
          Promise.resolve({
            sourceId: id,
            snapshot: {
              timestamp: ts,
              hash: "h",
              sizeBytes: 10,
              changed: true,
              trigger: "manual",
            },
            json: { h: "10:00" },
          }),
      }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );

  const desde = buscar<HTMLSelectElement>(
    pagina.container,
    'select[aria-label="Desde"]',
  );
  const hasta = buscar<HTMLSelectElement>(
    pagina.container,
    'select[aria-label="Hasta"]',
  );
  await escribirEn(desde, String(T1));
  await escribirEn(hasta, String(T2));
  await click(boton(pagina.container, "Comparar"));

  const diff = buscar(pagina.container, ".diff-viewer");
  assert(
    diff.closest("section") === null,
    "el diff debe ser hermano de la sección, no su hijo",
  );

  const seccion = buscar<HTMLElement>(pagina.container, "section");
  assert(
    !seccion.contains(diff),
    "la sección de la página no debe contener el diff",
  );
  buscar(seccion, ".timeline");
  buscar(seccion, ".comparador");

  await pagina.desmontar();
});
