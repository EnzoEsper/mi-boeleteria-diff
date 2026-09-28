import { assert, assertEquals } from "@std/assert";
import type { EntradaSnapshot, Fuente } from "../../web/src/api.ts";
import { apiStub, buscar, click, createElement, montar } from "../support_ui.ts";

const { BrowserRouter } = await import("react-router-dom");
const { FuentesPage } = await import("../../web/src/FuentesPage.tsx");
const { HistorialPage } = await import("../../web/src/HistorialPage.tsx");
const { Shell } = await import("../../web/src/Shell.tsx");

const FUENTE: Fuente = {
  id: "id-url",
  name: "Horarios MB",
  type: "url",
  url: "https://miboleteria.com.ar/xml/horarios.txt",
  headers: {},
  cronExpr: "*/5 * * * *",
  cronEnabled: true,
  createdAt: "2026-09-26T12:00:00.000Z",
};

const T1 = 1_700_000_000_000;
const T2 = 1_700_008_600_000;

const ENTRADAS: EntradaSnapshot[] = [
  {
    timestamp: T2,
    hash: "1111222233334444",
    sizeBytes: 197500,
    changed: false,
    trigger: "cron",
    hasBlob: false,
    hasDelta: false,
    sinceBase: 1,
    deltaFrom: T1,
  },
  {
    timestamp: T1,
    hash: "9999888877776666",
    sizeBytes: 197942,
    changed: true,
    trigger: "manual",
    hasBlob: true,
    hasDelta: false,
    sinceBase: 0,
    deltaFrom: null,
  },
];

// ---------------------------------------------------------------------------
// AC-26.1
// ---------------------------------------------------------------------------

Deno.test("AC-26.1: FuentesPage y SourceCard usan las clases de estructura", async () => {
  const pagina = await montar(
    createElement(FuentesPage, { api: apiStub({ listSources: () => Promise.resolve([FUENTE]) }) }),
  );
  try {
    buscar(pagina.container, "ul.fuentes");
    const fila = buscar(pagina.container, "li.fuente");
    assertEquals(fila.getAttribute("data-tipo"), "url", "el data-tipo existente cambió");
    buscar(pagina.container, "form.alta");
    assert(buscar(pagina.container, "button.peligro").textContent === "Borrar", "Borrar sin clase peligro");
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-26.1: form de edición con clase editar y sin romper el resto", async () => {
  const pagina = await montar(
    createElement(FuentesPage, { api: apiStub({ listSources: () => Promise.resolve([FUENTE]) }) }),
  );
  try {
    const editar = [...pagina.container.querySelectorAll("button")].find((b) => b.textContent === "Editar");
    assert(editar, "falta el botón Editar");
    await click(editar);
    buscar(pagina.container, "form.editar");
    assert(pagina.container.querySelector("form.alta"), "el form de alta debía seguir visible al editar");
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-26.1: badges del timeline con tono según changed y loader de la ruta", async () => {
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({ listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }) }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );
  try {
    assertEquals(pagina.container.querySelectorAll(".badge-ok").length, 1, "el snapshot changed debía usar badge-ok");
    assertEquals(pagina.container.querySelectorAll(".badge-neutro").length, 1, "el sin cambios debía usar badge-neutro");
  } finally {
    await pagina.desmontar();
  }

  globalThis.window.history.replaceState({}, "", "/historial/id-url");
  const shell = await montar(
    createElement(BrowserRouter, null, createElement(Shell, { api: apiStub({ getSource: () => new Promise<Fuente>(() => {}) }) })),
  );
  try {
    buscar(shell.container, "[data-cargando]");
  } finally {
    await shell.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-26.2
// ---------------------------------------------------------------------------

Deno.test("AC-26.2: index.css tiene reglas para las clases nuevas, sus tonos y [data-json]", async () => {
  const css = await Deno.readTextFile(new URL("../../web/src/index.css", import.meta.url));
  for (const selector of [".fuentes", ".fuente", ".alta", ".editar", ".peligro", ".badge-ok", ".badge-neutro"]) {
    assert(css.includes(selector), `falta la regla ${selector} en index.css`);
  }
  assert(/\.peligro\s*\{[^}]*--err/.test(css), ".peligro debe usar el tono de error");
  assert(/\.badge-ok\s*\{[^}]*--ok/.test(css), ".badge-ok debe usar el tono ok");
  assert(/\.badge-neutro\s*\{[^}]*--border/.test(css), ".badge-neutro debe ser neutro (--border)");
  assert(/\[data-json\]\s*\{[^}]*overflow/.test(css), "[data-json] debe tener overflow scrolleable");
  assert(/\[data-json\]\s*\{[^}]*max-height/.test(css), "[data-json] debe limitar max-height");
  assert(/\[data-json\]\s*\{[^}]*--mono/.test(css), "[data-json] debe ser monoespaciado");
  assert(/\[data-json\]\s*\{[^}]*--code-bg/.test(css), "[data-json] debe usar el fondo de código");
});

// ---------------------------------------------------------------------------
// AC-26.3
// ---------------------------------------------------------------------------

Deno.test("AC-26.3: el media 720px apila los forms y ajusta #root", async () => {
  const css = await Deno.readTextFile(new URL("../../web/src/index.css", import.meta.url));
  const desde = css.indexOf("@media (max-width: 720px)");
  assert(desde >= 0, "falta el bloque media 720px");
  const media = css.slice(desde);
  assert(media.includes("#root"), "el media no ajusta #root");
  assert(media.includes(".alta"), "el media no apila el form de alta");
  assert(media.includes(".editar"), "el media no apila el form de edición");
  assert(media.includes("flex-direction: column"), "el media no apila con flex-direction: column");
  assert(media.includes(".timeline li"), "el media perdió la regla existente de .timeline li");
  assert(media.includes(".comparador"), "el media perdió la regla existente de .comparador");
});
