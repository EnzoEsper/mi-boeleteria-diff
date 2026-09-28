import { assert, assertEquals } from "@std/assert";
import type { Fuente } from "../../web/src/api.ts";
import { apiStub, boton, buscar, click, createElement, elegirArchivo, montar } from "../support_ui.ts";

const { SourceCard } = await import("../../web/src/SourceCard.tsx");
const { ApiError } = await import("../../web/src/api.ts");

const FUENTE_URL: Fuente = {
  id: "id-url",
  name: "Horarios MB",
  type: "url",
  url: "https://miboleteria.com.ar/xml/horarios.txt",
  headers: {},
  cronExpr: null,
  cronEnabled: true,
  createdAt: "2026-09-26T12:00:00.000Z",
};

const FUENTE_FILE: Fuente = { ...FUENTE_URL, id: "id-file", name: "Backup local", type: "file", url: "" };

// ---------------------------------------------------------------------------
// AC-19.1
// ---------------------------------------------------------------------------

Deno.test("AC-19.1: SourceCard url renderiza nombre, badge, Historial y Capturar", async () => {
  let historial: string | null = null;
  const pagina = await montar(
    createElement(SourceCard, {
      api: apiStub({ fetchNow: () => Promise.reject(new Error("no usado")) }),
      fuente: FUENTE_URL,
      onVerHistorial: (fuente: Fuente) => {
        historial = fuente.id;
      },
    }),
  );

  const fila = buscar(pagina.container, 'li[data-tipo="url"]');
  assert(fila.textContent?.includes("Horarios MB"), "falta el nombre de la fuente");
  assert(fila.textContent?.includes("url"), "falta el badge del tipo");
  await click(boton(pagina.container, "Historial"));
  assertEquals(historial, "id-url", "Historial no invocó onVerHistorial con la fuente");
  buscar(pagina.container, 'button[type="button"]');
  assertEquals(
    pagina.container.querySelectorAll("input[type=file]").length,
    0,
    "una fuente url no debe mostrar input file",
  );
  await pagina.desmontar();
});

Deno.test("AC-19.1: SourceCard file renderiza input file y sin Capturar/Historial", async () => {
  const pagina = await montar(
    createElement(SourceCard, {
      api: apiStub({ importFile: () => Promise.reject(new Error("no usado")) }),
      fuente: FUENTE_FILE,
    }),
  );

  const fila = buscar(pagina.container, 'li[data-tipo="file"]');
  assert(fila.textContent?.includes("Backup local"), "falta el nombre de la fuente file");
  const input = buscar<HTMLInputElement>(pagina.container, 'input[type="file"]');
  assertEquals(input.getAttribute("accept"), "application/json", "falta accept application/json");
  const botones = [...pagina.container.querySelectorAll("button")].map((b) => b.textContent);
  assert(!botones.includes("Capturar"), "una fuente file no debe tener Capturar");
  assert(!botones.includes("Historial"), "sin onVerHistorial no debe haber Historial");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-19.2
// ---------------------------------------------------------------------------

Deno.test("AC-19.2: capturar OK muestra changed y limpia errores previos", async () => {
  let pedidos = 0;
  const pagina = await montar(
    createElement(SourceCard, {
      api: apiStub({
        fetchNow: (id: string) => {
          pedidos++;
          assertEquals(id, FUENTE_URL.id, "fetchNow no recibió el id");
          return Promise.resolve({
            sourceId: id,
            snapshot: { timestamp: 1, hash: "h", sizeBytes: 10, changed: true, trigger: "manual" as const },
          });
        },
      }),
      fuente: FUENTE_URL,
    }),
  );

  await click(boton(pagina.container, "Capturar"));
  assertEquals(pedidos, 1, "Capturar no llamó a fetchNow");
  assert(
    pagina.container.querySelector(".resultado")?.textContent === "changed=true",
    "falta el resultado changed=true",
  );
  await pagina.desmontar();
});

Deno.test("AC-19.2: un ApiError en capturar queda visible en la fila", async () => {
  const pagina = await montar(
    createElement(SourceCard, {
      api: apiStub({ fetchNow: () => Promise.reject(new ApiError(502, "HTTP 500 al fetchear")) }),
      fuente: FUENTE_URL,
    }),
  );

  await click(boton(pagina.container, "Capturar"));
  const error = buscar(pagina.container, "li .error");
  assertEquals(error.textContent, "HTTP 500 al fetchear", "el mensaje del ApiError no se muestra");
  assert(pagina.container.textContent?.includes("Horarios MB"), "la fila se rompió tras el error");
  await pagina.desmontar();
});

Deno.test("AC-19.2: importar OK muestra importado (trigger=...)", async () => {
  const recibidos: File[] = [];
  const pagina = await montar(
    createElement(SourceCard, {
      api: apiStub({
        importFile: (_id: string, file: File) => {
          recibidos.push(file);
          return Promise.resolve({
            sourceId: FUENTE_FILE.id,
            snapshot: { timestamp: 2, hash: "h2", sizeBytes: 5, changed: true, trigger: "import" as const },
          });
        },
      }),
      fuente: FUENTE_FILE,
    }),
  );

  await elegirArchivo(buscar<HTMLInputElement>(pagina.container, 'input[type="file"]'), new File(["{}"], "a.json", { type: "application/json" }));
  assert(recibidos.length === 1, "importFile no recibió el archivo");
  assertEquals(recibidos[0].name, "a.json", "importFile no recibió el archivo subido");
  assert(
    pagina.container.querySelector(".resultado")?.textContent === "importado (trigger=import)",
    "falta el mensaje de importación",
  );
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-19.3
// ---------------------------------------------------------------------------

Deno.test("AC-19.3: FuentesPage orquesta SourceCard y ya no tiene la fila ni la lógica", async () => {
  const paginaFuente = await Deno.readTextFile(new URL("../../web/src/FuentesPage.tsx", import.meta.url));
  assert(paginaFuente.includes("<SourceCard"), "FuentesPage no mapea SourceCard");
  assert(!paginaFuente.includes("<li"), "FuentesPage todavía renderiza el <li> de la fila");
  assert(!paginaFuente.includes("api.fetchNow("), "FuentesPage todavía dispara capturas directamente");
  assert(!paginaFuente.includes("api.importFile("), "FuentesPage todavía dispara imports directamente");

  const cardFuente = await Deno.readTextFile(new URL("../../web/src/SourceCard.tsx", import.meta.url));
  assert(cardFuente.includes("<li data-tipo"), "SourceCard no renderiza el <li data-tipo>");
  assert(!cardFuente.includes(".css"), "SourceCard no debe importar CSS");
  assert(!cardFuente.includes(".png") && !cardFuente.includes(".svg"), "SourceCard no debe importar assets");
});
