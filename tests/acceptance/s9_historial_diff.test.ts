import { assert, assertEquals } from "@std/assert";
import type { EntradaSnapshot, Fuente } from "../../web/src/api.ts";
import { apiStub, boton, buscar, click, createElement, escribirEn, montar } from "../support_ui.ts";

const { HistorialPage } = await import("../../web/src/HistorialPage.tsx");
const { DiffViewer } = await import("../../web/src/DiffViewer.tsx");
const { Shell } = await import("../../web/src/Shell.tsx");
const { ApiError } = await import("../../web/src/api.ts");

const T1 = 1_700_000_000_000; // 2023-11-14 22:13:20 UTC
const T2 = 1_700_008_600_000; // 2023-11-15 00:36:40 UTC
const T3 = 1_700_017_200_000; // 2023-11-15 03:00:00 UTC

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

const FUENTE_FILE: Fuente = { ...FUENTE, id: "id-file", name: "Backup local", type: "file", url: "" };

const ENTRADAS: EntradaSnapshot[] = [
  {
    timestamp: T3,
    hash: "abcdef0123456789",
    sizeBytes: 197942,
    changed: false,
    trigger: "cron",
    hasBlob: false,
    hasDelta: false,
    sinceBase: 2,
    deltaFrom: T2,
  },
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
    trigger: "import",
    hasBlob: true,
    hasDelta: false,
    sinceBase: 0,
    deltaFrom: null,
  },
];

function listar() {
  return Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS });
}

// ---------------------------------------------------------------------------
// AC-9.1
// ---------------------------------------------------------------------------

Deno.test("AC-9.1: HistorialPage lista el timeline de la fuente", async () => {
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({ listSnapshots: listar }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );
  const texto = pagina.container.textContent ?? "";
  assert(texto.includes("Horarios MB"), "falta el nombre de la fuente");
  assert(texto.includes("2023-11-14 22:13:20"), "falta el momento UTC del primer snapshot");
  assert(texto.includes("abcdef01"), "falta el hash corto (8 chars)");
  assert(texto.includes("197942"), "falta el tamaño en bytes");
  for (const trigger of ["cron", "manual", "import"]) {
    assert(texto.includes(trigger), `falta el trigger ${trigger}`);
  }
  assert(texto.includes("sin cambios"), "falta el badge sin cambios para changed:false");
  const fila = buscar(pagina.container, 'li[data-timestamp="1700008600000"]');
  assertEquals(fila.getAttribute("data-delta-from"), "1700000000000", "falta el flag deltaFrom");
  assertEquals(fila.getAttribute("data-since-base"), "1", "falta el flag sinceBase");
  await pagina.desmontar();
});

Deno.test("AC-9.1: el error del listado es visible y Volver invoca onVolver", async () => {
  let volvio = false;
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({ listSnapshots: () => Promise.reject(new ApiError(500, "KV reventó")) }),
      fuente: FUENTE,
      onVolver: () => {
        volvio = true;
      },
    }),
  );
  assert(pagina.container.textContent?.includes("KV reventó"), "no se mostró el error del listado");
  await click(boton(pagina.container, "Volver"));
  assertEquals(volvio, true, "onVolver no se invocó");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-9.2
// ---------------------------------------------------------------------------

Deno.test("AC-9.2: comparar dos snapshots llama getDiff/getSnapshot y renderiza el diff", async () => {
  const diffs: [number, number][] = [];
  const snapshotsPedidos: number[] = [];
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({
        listSnapshots: listar,
        getDiff: (_id, from, to) => {
          diffs.push([from, to]);
          return Promise.resolve({
            sourceId: FUENTE.id,
            from,
            to,
            changed: true,
            delta: { h: ["10:00", "11:00"] },
          });
        },
        getSnapshot: (id, ts) => {
          snapshotsPedidos.push(ts);
          return Promise.resolve({
            sourceId: id,
            snapshot: {
              timestamp: ts,
              hash: "h",
              sizeBytes: 10,
              changed: true,
              trigger: "manual",
            },
            json: { h: "10:00" },
          });
        },
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

  assertEquals(diffs, [[T1, T2]], "getDiff no se llamó con los timestamps elegidos");
  assertEquals(snapshotsPedidos, [T1], "getSnapshot (JSON izquierdo) no se pidió desde T1");
  buscar(pagina.container, ".jsondiffpatch-delta");
  const texto = pagina.container.textContent ?? "";
  assert(texto.includes("10:00"), "el valor izquierdo del diff no se mostró");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-9.3
// ---------------------------------------------------------------------------

Deno.test("AC-9.3: comparar sin selección completa no llama a la API", async () => {
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({ listSnapshots: listar }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );

  await click(boton(pagina.container, "Comparar"));
  assert(
    pagina.container.textContent?.includes("Elegí dos snapshots"),
    "falta el mensaje de selección incompleta",
  );
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-9.4
// ---------------------------------------------------------------------------

Deno.test("AC-9.4: un error del diff se muestra sin romper la página", async () => {
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({
        listSnapshots: listar,
        getDiff: () => Promise.reject(new ApiError(400, "desde mayor a hasta")),
      }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );

  const desde = buscar<HTMLSelectElement>(pagina.container, 'select[aria-label="Desde"]');
  const hasta = buscar<HTMLSelectElement>(pagina.container, 'select[aria-label="Hasta"]');
  await escribirEn(desde, String(T2));
  await escribirEn(hasta, String(T1));
  await click(boton(pagina.container, "Comparar"));

  const texto = pagina.container.textContent ?? "";
  assert(texto.includes("desde mayor a hasta"), "no se mostró el error del diff");
  assert(texto.includes("cron"), "el timeline se rompió tras el error");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-9.5
// ---------------------------------------------------------------------------

Deno.test("AC-9.5: DiffViewer renderiza format(delta, left) y alterna el toggle", async () => {
  const pagina = await montar(
    createElement(DiffViewer, { delta: { h: ["10:00", "11:00"] }, left: { h: "10:00" } }),
  );
  buscar(pagina.container, ".jsondiffpatch-delta");
  const contenedor = buscar(pagina.container, ".diff-viewer");
  assertEquals(contenedor.getAttribute("data-mostrar-sin-cambios"), "no", "el toggle inicia apagado");
  const check = buscar<HTMLInputElement>(pagina.container, 'input[type="checkbox"]');
  await click(check);
  assertEquals(
    contenedor.getAttribute("data-mostrar-sin-cambios"),
    "si",
    "el checkbox no alternó el atributo del contenedor",
  );
  await pagina.desmontar();
});

Deno.test("AC-9.5: DiffViewer con delta nulo muestra sin cambios sin formatear", async () => {
  const pagina = await montar(createElement(DiffViewer, { delta: null }));
  const texto = pagina.container.textContent ?? "";
  assert(texto.includes("Sin cambios entre ambos snapshots"), "falta el mensaje de sin cambios");
  assertEquals(pagina.container.querySelector(".jsondiffpatch-delta"), null, "no debe haber diff formateado");
  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-9.6
// ---------------------------------------------------------------------------

Deno.test("AC-9.6: Shell navega fuentes ⇄ historial por rutas (enmendado en S15)", async () => {
  const { BrowserRouter } = await import("react-router-dom");
  globalThis.window.history.replaceState({}, "", "/");
  let listados = 0;
  const pagina = await montar(
    createElement(
      BrowserRouter,
      null,
      createElement(Shell, {
        api: apiStub({
          listSources: () => Promise.resolve([FUENTE, FUENTE_FILE]),
          getSource: (id: string) => Promise.resolve(id === FUENTE_FILE.id ? FUENTE_FILE : FUENTE),
          listSnapshots: () => {
            listados++;
            return listar();
          },
        }),
      }),
    ),
  );

  assert(pagina.container.textContent?.includes("Fuentes"), "no arranca en la vista de fuentes");
  await click(boton(pagina.container, "Historial"));
  assertEquals(globalThis.window.location.pathname, `/historial/${FUENTE.id}`, "la URL no cambió a la ruta del historial");
  const texto = pagina.container.textContent ?? "";
  assert(texto.includes("Horarios MB"), "no se abrió el historial de la fuente elegida");
  assertEquals(listados, 1, "no se listó el historial al navegar");

  await click(boton(pagina.container, "Volver"));
  assertEquals(globalThis.window.location.pathname, "/", "Volver no regresó a la ruta /");
  assert(
    pagina.container.textContent?.includes("Crear fuente"),
    "Volver no regresó a la vista de fuentes",
  );
  await pagina.desmontar();
});

Deno.test("AC-9.6: App compone Shell, main importa el CSS del formatter y los componentes no traen CSS", async () => {
  const main = await Deno.readTextFile(new URL("../../web/src/main.tsx", import.meta.url));
  assert(main.includes("index.css"), "los estilos globales siguen en main.tsx");
  assert(
    main.includes("jsondiffpatch/formatters/styles/html.css"),
    "falta el CSS oficial del formatter en main.tsx",
  );

  const app = await Deno.readTextFile(new URL("../../web/src/App.tsx", import.meta.url));
  assert(app.includes("Shell"), "App.tsx debe componer Shell");

  for (const archivo of ["DiffViewer", "HistorialPage", "Shell"]) {
    const fuente = await Deno.readTextFile(new URL(`../../web/src/${archivo}.tsx`, import.meta.url));
    assert(!fuente.includes(".css"), `${archivo} no debe importar CSS`);
    assert(!fuente.includes(".png") && !fuente.includes(".svg"), `${archivo} no debe importar assets`);
  }
});
