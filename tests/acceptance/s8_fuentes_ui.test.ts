import { assert, assertEquals } from "@std/assert";
import type { CrearFuenteInput, Fuente } from "../../web/src/api.ts";
import { instalarDom } from "../dom.ts";
import {
  apiStub,
  boton,
  buscar,
  click,
  createElement,
  elegirArchivo,
  enviarForm,
  escribirEn,
  montar,
} from "../support_ui.ts";

const { FuentesPage } = await import("../../web/src/FuentesPage.tsx");
const { ApiError } = await import("../../web/src/api.ts");

const FUENTE_URL: Fuente = {
  id: "id-url",
  name: "Horarios MB",
  type: "url",
  url: "https://miboleteria.com.ar/xml/horarios.txt",
  headers: {},
  cronExpr: null,
  cronEnabled: false,
  createdAt: "2026-09-26T12:00:00.000Z",
};

const FUENTE_FILE: Fuente = {
  id: "id-file",
  name: "Backup local",
  type: "file",
  url: "",
  headers: {},
  cronExpr: null,
  cronEnabled: false,
  createdAt: "2026-09-26T12:00:01.000Z",
};

// ---------------------------------------------------------------------------
// AC-8.1
// ---------------------------------------------------------------------------

Deno.test("AC-8.1: infra de render: deno.json + instalarDom + render de web/src", async () => {
  const denoJson = JSON.parse(await Deno.readTextFile(new URL("../../deno.json", import.meta.url)));
  assertEquals(denoJson.compilerOptions.jsx, "react-jsx");
  assert(
    Array.isArray(denoJson.compilerOptions.lib) && denoJson.compilerOptions.lib.includes("dom"),
    "falta lib dom en compilerOptions",
  );
  for (const dependencia of ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "jsdom"]) {
    assert(dependencia in denoJson.imports, `falta el import "${dependencia}" en deno.json`);
  }

  instalarDom();
  assert(typeof document !== "undefined" && document.body !== null, "document jsdom no instalado");
  assert(typeof MouseEvent === "function", "window.MouseEvent no disponible");

  const pagina = await montar(
    createElement(FuentesPage, { api: apiStub({ listSources: () => Promise.resolve([]) }) }),
  );
  assert(
    pagina.container.textContent?.includes("Crear fuente"),
    "el componente de web/src renderizó dentro de deno test",
  );
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-8.2
// ---------------------------------------------------------------------------

Deno.test("AC-8.2: lista fuentes con acciones por tipo", async () => {
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({ listSources: () => Promise.resolve([FUENTE_URL, FUENTE_FILE]) }),
    }),
  );
  const texto = pagina.container.textContent ?? "";
  assert(texto.includes("Horarios MB"), "falta la fuente url");
  assert(texto.includes("Backup local"), "falta la fuente file");
  assert(pagina.container.querySelector('li[data-tipo="url"]'), "falta la fila data-tipo=url");
  assert(pagina.container.querySelector('li[data-tipo="file"]'), "falta la fila data-tipo=file");

  boton(pagina.container, "Capturar");
  const inputArchivo = buscar<HTMLInputElement>(pagina.container, 'input[type="file"]');
  assert(inputArchivo, "falta el input de archivo en la fila file");
  await pagina.desmontar();
});

Deno.test("AC-8.2: si listSources falla con ApiError se muestra el mensaje", async () => {
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({ listSources: () => Promise.reject(new ApiError(500, "KV explotó")) }),
    }),
  );
  assert(pagina.container.textContent?.includes("KV explotó"), "no se mostró el error del listado");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-8.3
// ---------------------------------------------------------------------------

Deno.test("AC-8.3: capturar dispara fetchNow y muestra changed", async () => {
  const llamadas: string[] = [];
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({
        listSources: () => Promise.resolve([FUENTE_URL]),
        fetchNow: (id) => {
          llamadas.push(id);
          return Promise.resolve({
            sourceId: id,
            snapshot: {
              timestamp: 1,
              hash: "abc",
              sizeBytes: 10,
              changed: true,
              trigger: "manual",
            },
          });
        },
      }),
    }),
  );

  await click(boton(pagina.container, "Capturar"));
  assertEquals(llamadas, ["id-url"]);
  assert(
    pagina.container.textContent?.includes("changed=true"),
    `falta el resultado changed en: ${pagina.container.textContent}`,
  );
  await pagina.desmontar();
});

Deno.test("AC-8.3: un ApiError en fetchNow se muestra sin romper la página", async () => {
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({
        listSources: () => Promise.resolve([FUENTE_URL]),
        fetchNow: () => Promise.reject(new ApiError(502, "HTTP 500 al fetchear")),
      }),
    }),
  );

  await click(boton(pagina.container, "Capturar"));
  const texto = pagina.container.textContent ?? "";
  assert(texto.includes("HTTP 500 al fetchear"), "no se mostró el error de captura");
  assert(texto.includes("Horarios MB"), "la página se rompió tras el error");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-8.4
// ---------------------------------------------------------------------------

Deno.test("AC-8.4: alta url: payload correcto, alta en lista y form limpio", async () => {
  const payloads: CrearFuenteInput[] = [];
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({
        listSources: () => Promise.resolve([]),
        createSource: (input) => {
          payloads.push(input);
          return Promise.resolve({ ...FUENTE_URL, id: "id-nuevo", name: input.name });
        },
      }),
    }),
  );

  const nombre = buscar<HTMLInputElement>(pagina.container, 'input[placeholder="Nombre"]');
  const url = buscar<HTMLInputElement>(pagina.container, 'input[placeholder="https://..."]');
  await escribirEn(nombre, "Nueva MB");
  await escribirEn(url, "https://ejemplo.com/horarios.json");
  await enviarForm(buscar(pagina.container, "form"));

  assertEquals(payloads, [{ name: "Nueva MB", type: "url", url: "https://ejemplo.com/horarios.json" }]);
  assert(pagina.container.textContent?.includes("Nueva MB"), "la fuente creada no aparece en la lista");
  assertEquals((nombre as HTMLInputElement).value, "", "el form no se limpió");
  await pagina.desmontar();
});

Deno.test("AC-8.4: un 400 del backend muestra el issue y no agrega la fuente", async () => {
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({
        listSources: () => Promise.resolve([]),
        createSource: () =>
          Promise.reject(new ApiError(400, "validación fallida", [{ path: "name", message: "nombre requerido" }])),
      }),
    }),
  );

  const nombre = buscar<HTMLInputElement>(pagina.container, 'input[placeholder="Nombre"]');
  await escribirEn(nombre, "Sin url");
  await enviarForm(buscar(pagina.container, "form"));

  const texto = pagina.container.textContent ?? "";
  assert(texto.includes("nombre requerido"), "no se mostró el issue del backend");
  assertEquals(pagina.container.querySelectorAll("li").length, 0, "la fuente inválida no debe listarse");
  await pagina.desmontar();
});

Deno.test("AC-8.4: con tipo file no se envía url", async () => {
  const payloads: CrearFuenteInput[] = [];
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({
        listSources: () => Promise.resolve([]),
        createSource: (input) => {
          payloads.push(input);
          return Promise.resolve({ ...FUENTE_FILE, id: "id-file-nuevo", name: input.name });
        },
      }),
    }),
  );

  const select = buscar<HTMLSelectElement>(pagina.container, "select");
  await escribirEn(select, "file");
  assert(pagina.container.querySelector('input[placeholder="https://..."]') === null, "no debe haber input de url");

  const nombre = buscar<HTMLInputElement>(pagina.container, 'input[placeholder="Nombre"]');
  await escribirEn(nombre, "Backup 2");
  await enviarForm(buscar(pagina.container, "form"));

  assertEquals(payloads, [{ name: "Backup 2", type: "file" }]);
  assertEquals("url" in payloads[0], false, "el payload no debe llevar url");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-8.5
// ---------------------------------------------------------------------------

Deno.test("AC-8.5: elegir archivo dispara importFile y muestra el resultado", async () => {
  const llamadas: { id: string; file: File }[] = [];
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({
        listSources: () => Promise.resolve([FUENTE_FILE]),
        importFile: (id, file) => {
          llamadas.push({ id, file });
          return Promise.resolve({
            sourceId: id,
            snapshot: { timestamp: 2, hash: "h", sizeBytes: 5, changed: true, trigger: "import" },
          });
        },
      }),
    }),
  );

  const input = buscar<HTMLInputElement>(pagina.container, 'input[type="file"]');
  const archivo = new File(['{"a":1}'], "t1.json", { type: "application/json" });
  await elegirArchivo(input, archivo);

  assertEquals(llamadas.length, 1, "importFile no se llamó");
  assertEquals(llamadas[0].id, "id-file");
  assertEquals(llamadas[0].file.name, "t1.json");
  const texto = pagina.container.textContent ?? "";
  assert(texto.includes("importado") && texto.includes("import"), `falta el resultado en: ${texto}`);
  await pagina.desmontar();
});

Deno.test("AC-8.5: un ApiError al importar se muestra en la fila", async () => {
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({
        listSources: () => Promise.resolve([FUENTE_FILE]),
        importFile: () => Promise.reject(new ApiError(400, "el archivo debe contener JSON válido")),
      }),
    }),
  );

  const input = buscar<HTMLInputElement>(pagina.container, 'input[type="file"]');
  await elegirArchivo(input, new File(["<html>"], "malo.html", { type: "text/html" }));

  assert(
    pagina.container.textContent?.includes("el archivo debe contener JSON válido"),
    "no se mostró el error de import",
  );
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-8.6
// ---------------------------------------------------------------------------

Deno.test("AC-8.6: los componentes testeables no importan CSS ni assets", async () => {
  const paginaFuente = await Deno.readTextFile(new URL("../../web/src/FuentesPage.tsx", import.meta.url));
  assert(!paginaFuente.includes(".css"), "FuentesPage no debe importar CSS (Deno no lo resuelve)");
  assert(!paginaFuente.includes(".png") && !paginaFuente.includes(".svg"), "FuentesPage no debe importar assets");

  const main = await Deno.readTextFile(new URL("../../web/src/main.tsx", import.meta.url));
  assert(main.includes("index.css"), "los estilos globales se quedan en main.tsx");

  const app = await Deno.readTextFile(new URL("../../web/src/App.tsx", import.meta.url));
  assert(app.includes("Shell"), "App.tsx debe componer la navegación (Shell, desde S9)");
});
