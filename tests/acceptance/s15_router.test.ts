import { assert, assertEquals } from "@std/assert";
import type { Fuente } from "../../web/src/api.ts";
import { apiStub, boton, click, createElement, montar } from "../support_ui.ts";

const { BrowserRouter } = await import("react-router-dom");
const { Shell } = await import("../../web/src/Shell.tsx");
const { ApiError } = await import("../../web/src/api.ts");

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

function enRuta(path: string): void {
  globalThis.window.history.replaceState({}, "", path);
}

function montarShell(api: ReturnType<typeof apiStub>) {
  return montar(createElement(BrowserRouter, null, createElement(Shell, { api })));
}

// ---------------------------------------------------------------------------
// AC-15.1
// ---------------------------------------------------------------------------

Deno.test("AC-15.1: rutas de Shell: / → fuentes, desconocida → redirige a /", async () => {
  enRuta("/cualquiera");
  const pagina = await montarShell(apiStub({ listSources: () => Promise.resolve([FUENTE]) }));

  assertEquals(globalThis.window.location.pathname, "/", "la ruta desconocida no redirigió a /");
  assert(pagina.container.textContent?.includes("Crear fuente"), "no se mostró FuentesPage");
  await pagina.desmontar();
});

Deno.test("AC-15.1: /historial/:id resuelve la fuente y muestra Cargando mientras carga", async () => {
  enRuta("/historial/id-url");
  const pagina = await montarShell(apiStub({ getSource: () => new Promise<Fuente>(() => {}) }));

  assert(pagina.container.textContent?.includes("Cargando"), "no se vio el estado de carga");
  assert(pagina.container.querySelector(".error") === null, "no debe haber error durante la carga");
  await pagina.desmontar();
});

Deno.test("AC-15.1: si getSource falla, el error queda visible sin romper la página", async () => {
  enRuta("/historial/id-url");
  const pagina = await montarShell(
    apiStub({ getSource: () => Promise.reject(new ApiError(404, "no existe")) }),
  );

  const error = pagina.container.querySelector(".error");
  assert(error, "el fallo de getSource no quedó visible en .error");
  assert(error.textContent?.includes("no existe"), "el mensaje del error no se muestra");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-15.2
// ---------------------------------------------------------------------------

Deno.test("AC-15.2: click Historial navega a /historial/<id> y Volver regresa a /", async () => {
  enRuta("/");
  let pedidosFuente = 0;
  let listados = 0;
  const pagina = await montarShell(apiStub({
    listSources: () => Promise.resolve([FUENTE]),
    getSource: (id: string) => {
      pedidosFuente++;
      assertEquals(id, FUENTE.id, "getSource no recibió el id de la ruta");
      return Promise.resolve(FUENTE);
    },
    listSnapshots: (id: string) => {
      listados++;
      assertEquals(id, FUENTE.id, "listSnapshots no recibió el id de la fuente");
      return Promise.resolve({ sourceId: id, snapshots: [] });
    },
  }));

  await click(boton(pagina.container, "Historial"));
  assertEquals(globalThis.window.location.pathname, `/historial/${FUENTE.id}`, "la URL no cambió");
  assert(
    pagina.container.textContent?.includes("Horarios MB"),
    "no se abrió el historial de la fuente elegida",
  );
  assertEquals(pedidosFuente, 1, "getSource no se llamó al navegar");
  assertEquals(listados, 1, "no se listó el historial al navegar");

  await click(boton(pagina.container, "Volver"));
  assertEquals(globalThis.window.location.pathname, "/", "Volver no regresó a /");
  assert(
    pagina.container.textContent?.includes("Crear fuente"),
    "Volver no regresó a la vista de fuentes",
  );
  await pagina.desmontar();
});

Deno.test("AC-15.2: deep link a /historial/<id> muestra el historial directo", async () => {
  enRuta(`/historial/${FUENTE.id}`);
  const pagina = await montarShell(apiStub({
    getSource: () => Promise.resolve(FUENTE),
    listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: [] }),
  }));

  assert(
    pagina.container.textContent?.includes("Horarios MB"),
    "el deep link no abrió el historial",
  );
  assertEquals(globalThis.window.location.pathname, `/historial/${FUENTE.id}`, "la URL del deep link cambió");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-15.3
// ---------------------------------------------------------------------------

Deno.test("AC-15.3: react-router-dom está en deno.json y en web/package.json", async () => {
  const denoJson = await Deno.readTextFile(new URL("../../deno.json", import.meta.url));
  assert(denoJson.includes("react-router-dom"), "falta react-router-dom en deno.json");

  const pkg = await Deno.readTextFile(new URL("../../web/package.json", import.meta.url));
  assert(pkg.includes("react-router-dom"), "falta react-router-dom en web/package.json");
});

Deno.test("AC-15.3: la spec S9 enmienda AC-9.6 hacia la navegación por rutas de S15", async () => {
  const spec = await Deno.readTextFile(new URL("../../specs/S9-historial-diff.md", import.meta.url));
  assert(spec.includes("S15"), "AC-9.6 no está enmendado hacia S15");
  assert(
    spec.includes("Navegación por rutas"),
    "AC-9.6 sigue hablando de estado interno sin enmendar",
  );
});
