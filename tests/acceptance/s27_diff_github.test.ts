import { assert, assertEquals } from "@std/assert";
import type { EntradaSnapshot, Fuente } from "../../web/src/api.ts";
import { apiStub, boton, buscar, click, createElement, escribirEn, montar } from "../support_ui.ts";

const { DiffViewer } = await import("../../web/src/DiffViewer.tsx");
const { HistorialPage } = await import("../../web/src/HistorialPage.tsx");

const T1 = 1_700_000_000_000;
const T2 = 1_700_008_600_000;

const DELTA = { h: ["10:00", "11:00"] };
const LEFT = { h: "10:00" };

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

// ---------------------------------------------------------------------------
// AC-27.1
// ---------------------------------------------------------------------------

Deno.test("AC-27.1: diff de líneas en split por defecto con stats y cambio emparejado", async () => {
  const pagina = await montar(
    createElement(DiffViewer, { delta: DELTA, left: LEFT, nombre: "Horarios MB" }),
  );

  const cont = buscar(pagina.container, ".diff-viewer");
  assertEquals(cont.getAttribute("data-modo"), "split", "arranca en split");
  assertEquals(buscar(pagina.container, ".dif-nombre").textContent, "Horarios MB", "falta el nombre de archivo");
  assertEquals(buscar(pagina.container, ".dif-stat-add").textContent, "+1", "stat de líneas agregadas");
  assertEquals(buscar(pagina.container, ".dif-stat-del").textContent, "-1", "stat de líneas borradas");
  buscar(pagina.container, ".dif-tabla");

  const filas = [...pagina.container.querySelectorAll(".dif-tabla tr")];
  assertEquals(filas.length, 3, "contexto + cambio + contexto");
  const primera = filas[0].querySelectorAll("td");
  assertEquals(primera.length, 4, "split tiene cuatro cells por fila");
  assertEquals(primera[0].textContent, "1", "número de línea izquierdo");
  assertEquals(primera[2].textContent, "1", "número de línea derecho");

  const viejo = buscar(pagina.container, ".dif-codigo.dif-del");
  assert(viejo.textContent?.includes('"h": "10:00"'), "falta el valor viejo en dif-del");
  const nuevo = buscar(pagina.container, ".dif-codigo.dif-add");
  assert(nuevo.textContent?.includes('"h": "11:00"'), "falta el valor nuevo en dif-add");

  await pagina.desmontar();
});

Deno.test("AC-27.1: delta nulo muestra sin cambios y no renderiza tabla", async () => {
  const pagina = await montar(createElement(DiffViewer, { delta: null }));
  const texto = pagina.container.textContent ?? "";
  assert(texto.includes("Sin cambios entre ambos snapshots"), "falta el mensaje de sin cambios");
  assertEquals(pagina.container.querySelector(".dif-tabla"), null, "no debe haber tabla con delta nulo");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-27.2
// ---------------------------------------------------------------------------

Deno.test("AC-27.2: el toggle alterna split y unified con marcas +/-", async () => {
  const pagina = await montar(createElement(DiffViewer, { delta: DELTA, left: LEFT }));
  const cont = buscar(pagina.container, ".diff-viewer");
  assertEquals(cont.getAttribute("data-modo"), "split");

  await click(boton(pagina.container, "Unified"));
  assertEquals(cont.getAttribute("data-modo"), "unified", "Unified no cambió el modo");
  assertEquals(
    buscar(pagina.container, '.dif-modo[data-activo="si"]').textContent,
    "Unified",
    "el botón activo no se marcó",
  );
  const marcas = [...pagina.container.querySelectorAll(".dif-marca")].map((td) => td.textContent);
  assert(marcas.includes("-"), "falta la marca - del unified");
  assert(marcas.includes("+"), "falta la marca + del unified");

  await click(boton(pagina.container, "Split"));
  assertEquals(cont.getAttribute("data-modo"), "split", "Split no volvió al modo inicial");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-27.3
// ---------------------------------------------------------------------------

Deno.test("AC-27.3: colapsa el medio de rachas largas y lo expande con click", async () => {
  const izq: Record<string, string> = {};
  for (let i = 1; i <= 20; i++) izq[`k${i}`] = `v${i}`;
  const pagina = await montar(
    createElement(DiffViewer, { delta: { k20: ["v20", "nuevo"] }, left: izq, nombre: "grande" }),
  );

  const texto = () => pagina.container.textContent ?? "";
  assert(texto().includes("Expandir 14 líneas"), "falta el expander con el conteo de líneas");
  assert(!texto().includes('"k10"'), "el medio de la racha debe estar colapsado");
  assert(texto().includes('"k1"'), "las 3 primeras líneas de la racha deben quedar visibles");
  assert(texto().includes('"k17"'), "las 3 últimas líneas de la racha deben quedar visibles");

  await click(boton(pagina.container, "Expandir 14 líneas"));
  assert(texto().includes('"k10"'), "expandir debió mostrar el medio colapsado");
  assertEquals(pagina.container.querySelector(".dif-expandir"), null, "el expander debe desaparecer");

  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-27.4
// ---------------------------------------------------------------------------

Deno.test("AC-27.4: HistorialPage le pasa el nombre de la fuente al DiffViewer", async () => {
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({
        listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
        getDiff: (_id, from, to) =>
          Promise.resolve({ sourceId: FUENTE.id, from, to, changed: true, delta: DELTA }),
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
            json: LEFT,
          }),
      }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );

  const desde = buscar<HTMLSelectElement>(pagina.container, 'select[aria-label="Desde"]');
  const hasta = buscar<HTMLSelectElement>(pagina.container, 'select[aria-label="Hasta"]');
  await escribirEn(desde, String(T1));
  await escribirEn(hasta, String(T2));
  await click(boton(pagina.container, "Comparar"));

  assertEquals(
    buscar(pagina.container, ".dif-nombre").textContent,
    "Horarios MB",
    "el encabezado del diff no muestra el nombre de la fuente",
  );
  buscar(pagina.container, ".dif-tabla");
  await pagina.desmontar();
});

Deno.test("AC-27.4: el formatter y el toggle viejo quedaron fuera del código y del CSS", async () => {
  const main = await Deno.readTextFile(new URL("../../web/src/main.tsx", import.meta.url));
  assert(main.includes("index.css"), "index.css sigue en main.tsx");
  assert(
    !main.includes("jsondiffpatch/formatters/styles/html.css"),
    "main.tsx ya no debe importar el CSS del formatter (enmienda AC-9.6/AC-14.3)",
  );

  const css = await Deno.readTextFile(new URL("../../web/src/index.css", import.meta.url));
  assert(!css.includes(".jsondiffpatch-"), "index.css no debe conservar reglas del formatter");
  assert(!css.includes(".toggle-unchanged"), "la regla del toggle viejo debe irse");
  assert(!css.includes(".diff-html"), "la regla del contenedor html viejo debe irse");
  for (
    const regla of [
      ".dif-encabezado",
      ".dif-tabla",
      ".dif-num",
      ".dif-codigo",
      ".dif-add",
      ".dif-del",
      ".dif-marca",
      ".dif-expandir",
    ]
  ) {
    assert(css.includes(regla), `falta la regla ${regla} en index.css`);
  }
});
