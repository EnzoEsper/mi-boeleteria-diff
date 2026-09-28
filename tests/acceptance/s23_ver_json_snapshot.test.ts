import { assert, assertEquals } from "@std/assert";
import type { EntradaSnapshot, Fuente, SnapshotDetalle, SnapshotResumen } from "../../web/src/api.ts";
import { act, apiStub, boton, buscar, click, createElement, montar } from "../support_ui.ts";

const { HistorialPage } = await import("../../web/src/HistorialPage.tsx");
const { ApiError } = await import("../../web/src/api.ts");

const T1 = 1_700_000_000_000;
const T2 = 1_700_008_600_000;

const FUENTE: Fuente = {
  id: "id-url",
  name: "Horarios MB",
  type: "url",
  url: "https://miboleteria.com.ar/xml/horarios.txt",
  headers: {},
  cronExpr: null,
  cronEnabled: true,
  createdAt: "2026-09-26T12:00:00.000Z",
};

const RESUMEN: SnapshotResumen = {
  timestamp: T1,
  hash: "9999888877776666",
  sizeBytes: 197942,
  changed: true,
  trigger: "import",
};

const ENTRADAS: EntradaSnapshot[] = [
  { ...RESUMEN, hasBlob: true, hasDelta: false, sinceBase: 0, deltaFrom: null },
  { ...RESUMEN, timestamp: T2, hash: "1111222233334444", trigger: "manual", hasBlob: true, hasDelta: true, sinceBase: 1, deltaFrom: T1 },
];

// ---------------------------------------------------------------------------
// AC-23.1
// ---------------------------------------------------------------------------

Deno.test("AC-23.1: el botón JSON muestra el JSON pretty-printado y alterna cerrar", async () => {
  const pedidos: number[] = [];
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({
        listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
        getSnapshot: (id, timestamp) => {
          pedidos.push(timestamp);
          return Promise.resolve({
            sourceId: id,
            snapshot: { ...RESUMEN, timestamp },
            json: { hora: "10:00" },
          });
        },
      }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );
  try {
    const li1 = buscar<HTMLLIElement>(pagina.container, 'li[data-timestamp="1700000000000"]');
    await click(boton(li1, "JSON"));
    assertEquals(pedidos, [T1], "no se pidió getSnapshot de la fila");
    const pre = buscar<HTMLElement>(li1, "pre[data-json]");
    assertEquals(pre.textContent, JSON.stringify({ hora: "10:00" }, null, 2), "el JSON no está pretty-printado");

    await click(boton(li1, "JSON"));
    assertEquals(li1.querySelector("pre[data-json]"), null, "el segundo click no cerró el JSON");
    assertEquals(pedidos, [T1], "cerrar no debe re-pedir el snapshot");

    const li2 = buscar<HTMLLIElement>(pagina.container, 'li[data-timestamp="1700008600000"]');
    await click(boton(li2, "JSON"));
    assertEquals(pedidos, [T1, T2], "abrir la fila B pidió su snapshot");
    assertEquals(li1.querySelector("pre[data-json]"), null, "abrir B debe cerrar el JSON de A");
    buscar(li2, "pre[data-json]");
    assert(!li1.querySelector("[data-json]"), "quedó un JSON huérfano");
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-23.1: un click durante la carga no dispara un segundo pedido", async () => {
  let pedidos = 0;
  let resolver!: (valor: SnapshotDetalle) => void;
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({
        listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
        getSnapshot: (_id, _timestamp) => {
          pedidos++;
          return new Promise<SnapshotDetalle>((resolve) => {
            resolver = resolve;
          });
        },
      }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );
  try {
    const li1 = buscar<HTMLLIElement>(pagina.container, 'li[data-timestamp="1700000000000"]');
    await click(boton(li1, "JSON"));
    await click(boton(li1, "JSON"));
    assertEquals(pedidos, 1, "el click durante la carga re-pidió el snapshot");
    await act(async () => {
      resolver({ sourceId: FUENTE.id, snapshot: { ...RESUMEN }, json: { ok: true } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    buscar(li1, "pre[data-json]");
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-23.2
// ---------------------------------------------------------------------------

Deno.test("AC-23.2: un ApiError queda visible en la fila y el siguiente click reintenta", async () => {
  let intentos = 0;
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({
        listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
        getSnapshot: (id, timestamp) => {
          intentos++;
          if (intentos === 1) return Promise.reject(new ApiError(404, "snapshot no encontrado"));
          return Promise.resolve({ sourceId: id, snapshot: { ...RESUMEN, timestamp }, json: { ok: true } });
        },
      }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );
  try {
    const li1 = buscar<HTMLLIElement>(pagina.container, 'li[data-timestamp="1700000000000"]');
    await click(boton(li1, "JSON"));
    assertEquals(intentos, 1);
    assertEquals(buscar(li1, ".error").textContent, "snapshot no encontrado", "el error no quedó visible en la fila");
    assertEquals(li1.querySelector("pre[data-json]"), null, "no debe haber JSON con error");
    assertEquals(pagina.container.querySelectorAll("li").length, 2, "la lista se rompió");

    await click(boton(li1, "JSON"));
    assertEquals(intentos, 2, "el siguiente click no reintentó");
    assert(li1.querySelector(".error") === null, "el error debía desaparecer tras el reintento exitoso");
    buscar(li1, "pre[data-json]");
  } finally {
    await pagina.desmontar();
  }
});
