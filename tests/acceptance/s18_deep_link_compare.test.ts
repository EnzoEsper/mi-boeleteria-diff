import { assert, assertEquals } from "@std/assert";
import type { EntradaSnapshot, Fuente } from "../../web/src/api.ts";
import { act, apiStub, boton, buscar, click, createElement, esperar, escribirEn, montar } from "../support_ui.ts";

const { BrowserRouter } = await import("react-router-dom");
const { Shell } = await import("../../web/src/Shell.tsx");

const T1 = 1_700_000_000_000;
const T2 = 1_700_008_600_000;
const T3 = 1_700_017_200_000;

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
  { timestamp: T3, hash: "abcdef0123456789", sizeBytes: 197942, changed: false, trigger: "cron", hasBlob: false, hasDelta: false, sinceBase: 2, deltaFrom: T2 },
  { timestamp: T2, hash: "1111222233334444", sizeBytes: 197500, changed: true, trigger: "manual", hasBlob: false, hasDelta: true, sinceBase: 1, deltaFrom: T1 },
  { timestamp: T1, hash: "9999888877776666", sizeBytes: 197942, changed: true, trigger: "import", hasBlob: true, hasDelta: false, sinceBase: 0, deltaFrom: null },
];

function enRuta(path: string): void {
  globalThis.window.history.replaceState({}, "", path);
}

async function irA(path: string): Promise<void> {
  await act(async () => {
    globalThis.window.history.replaceState({}, "", path);
    // jsdom no expone PopStateEvent; el router solo escucha el evento "popstate"
    globalThis.window.dispatchEvent(new Event("popstate"));
    await esperar();
  });
}

function montarShell(api: ReturnType<typeof apiStub>) {
  return montar(createElement(BrowserRouter, null, createElement(Shell, { api })));
}

function pedidorDeDiff(pedidos: [number, number][]) {
  return {
    getDiff: (_id: string, from: number, to: number) => {
      pedidos.push([from, to]);
      return Promise.resolve({
        sourceId: FUENTE.id,
        from,
        to,
        changed: true,
        delta: { h: ["10:00", "11:00"] },
      });
    },
    getSnapshot: (id: string, ts: number) =>
      Promise.resolve({
        sourceId: id,
        snapshot: { timestamp: ts, hash: "h", sizeBytes: 10, changed: true, trigger: "manual" as const },
        json: { h: "10:00" },
      }),
  };
}

function stubHistorial(pedidos: [number, number][] = []) {
  return apiStub({
    getSource: () => Promise.resolve(FUENTE),
    listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
    ...pedidorDeDiff(pedidos),
  });
}

// ---------------------------------------------------------------------------
// AC-18.1
// ---------------------------------------------------------------------------

Deno.test("AC-18.1: el deep link compare carga getDiff/getSnapshot y muestra el diff", async () => {
  enRuta(`/historial/${FUENTE.id}/compare?left=${T1}&right=${T2}`);
  const pedidos: [number, number][] = [];
  const pagina = await montarShell(stubHistorial(pedidos));

  assertEquals(pedidos, [[T1, T2]], "el deep link no pidió el diff con L/R de la URL");
  buscar(pagina.container, ".jsondiffpatch-delta");
  assert(
    pagina.container.textContent?.includes("Horarios MB"),
    "la ruta compare no compartió el contenedor del historial",
  );
  buscar(pagina.container, 'select[aria-label="Desde"]');
  assertEquals(
    globalThis.window.location.pathname,
    `/historial/${FUENTE.id}/compare`,
    "el deep link fue redirigido",
  );
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-18.2
// ---------------------------------------------------------------------------

Deno.test("AC-18.2: query malformada redirige al timeline sin pedir el diff", async () => {
  const queries = [
    `?left=abc&right=${T2}`,
    `?left=${T1}`,
    `?left=${T1}&right=`,
    `?left=${T1}&right=${T1}`,
  ];
  for (const query of queries) {
    enRuta(`/historial/${FUENTE.id}/compare${query}`);
    const pedidos: [number, number][] = [];
    const pagina = await montarShell(stubHistorial(pedidos));

    assertEquals(
      globalThis.window.location.pathname,
      `/historial/${FUENTE.id}`,
      `la query malformada "${query}" no redirigió al timeline`,
    );
    assertEquals(globalThis.window.location.search, "", `la query malformada "${query}" quedó en la URL`);
    assertEquals(pedidos.length, 0, `la query "${query}" disparó un diff`);
    assert(
      pagina.container.textContent?.includes("Horarios MB"),
      `la query "${query}" no dejó el historial visible`,
    );
    assert(pagina.container.querySelector(".jsondiffpatch-delta") === null, "se mostró un diff");
    await pagina.desmontar();
  }
});

Deno.test("AC-18.2: /historial/:id sin query muestra solo el timeline (regresión)", async () => {
  enRuta(`/historial/${FUENTE.id}`);
  const pedidos: [number, number][] = [];
  const pagina = await montarShell(stubHistorial(pedidos));

  assertEquals(globalThis.window.location.pathname, `/historial/${FUENTE.id}`, "no debe redirigir sin query");
  assertEquals(pedidos.length, 0, "sin query no debe pedir diff");
  assert(
    pagina.container.textContent?.includes("2023-11-14 22:13:20"),
    "el timeline pre-existente dejó de renderizar",
  );
  assert(pagina.container.querySelector(".jsondiffpatch-delta") === null, "no debe haber diff");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-18.3
// ---------------------------------------------------------------------------

Deno.test("AC-18.3: Comparar sincroniza la URL y Atrás limpia el diff", async () => {
  enRuta(`/historial/${FUENTE.id}`);
  const pedidos: [number, number][] = [];
  const pagina = await montarShell(stubHistorial(pedidos));

  await escribirEn(buscar<HTMLSelectElement>(pagina.container, 'select[aria-label="Desde"]'), String(T1));
  await escribirEn(buscar<HTMLSelectElement>(pagina.container, 'select[aria-label="Hasta"]'), String(T2));
  await click(boton(pagina.container, "Comparar"));

  assertEquals(
    globalThis.window.location.pathname,
    `/historial/${FUENTE.id}/compare`,
    "Comparar no navegó a la ruta compare",
  );
  assertEquals(
    globalThis.window.location.search,
    `?left=${T1}&right=${T2}`,
    "Comparar no escribió left/right en la URL",
  );
  assertEquals(pedidos, [[T1, T2]], "el diff no se pidió con los valores elegidos");
  buscar(pagina.container, ".jsondiffpatch-delta");

  await irA(`/historial/${FUENTE.id}`);
  assertEquals(
    globalThis.window.location.pathname,
    `/historial/${FUENTE.id}`,
    "Atrás no volvió a la ruta del timeline",
  );
  assert(
    pagina.container.querySelector(".jsondiffpatch-delta") === null,
    "Atrás dejó el diff en pantalla",
  );
  assert(
    pagina.container.textContent?.includes("2023-11-14 22:13:20"),
    "Atrás dejó el timeline visible",
  );
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-18.4
// ---------------------------------------------------------------------------

Deno.test("AC-18.4: cambiar la query re-pide el diff y el mismo par no se repite", async () => {
  enRuta(`/historial/${FUENTE.id}/compare?left=${T1}&right=${T2}`);
  const pedidos: [number, number][] = [];
  const pagina = await montarShell(stubHistorial(pedidos));
  assertEquals(pedidos, [[T1, T2]], "falta el primer pedido del deep link");

  await irA(`/historial/${FUENTE.id}/compare?left=${T1}&right=${T2}`);
  assertEquals(pedidos, [[T1, T2]], "revisitar el mismo par volvió a pedir el diff");

  await irA(`/historial/${FUENTE.id}/compare?left=${T2}&right=${T3}`);
  assertEquals(pedidos, [[T1, T2], [T2, T3]], "cambiar la query no re-pidió el diff nuevo");
  buscar(pagina.container, ".jsondiffpatch-delta");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-18.5
// ---------------------------------------------------------------------------

Deno.test("AC-18.5: README documenta la ruta compartible compare", async () => {
  const readme = await Deno.readTextFile(new URL("../../README.md", import.meta.url));
  assert(readme.includes("/historial/:id/compare?left="), "falta la ruta compare en el README");
  assert(readme.includes("compartible"), "el README no explica que la URL es compartible");
});
