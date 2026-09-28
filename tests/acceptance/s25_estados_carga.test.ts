import { assert, assertEquals } from "@std/assert";
import type {
  CrearFuenteInput,
  DiffResponse,
  EntradaSnapshot,
  Fuente,
  SnapshotDetalle,
  SnapshotResumen,
} from "../../web/src/api.ts";
import { apiStub, act, boton, buscar, click, createElement, enviarForm, escribirEn, esperar, montar } from "../support_ui.ts";

const { FuentesPage } = await import("../../web/src/FuentesPage.tsx");
const { SourceCard } = await import("../../web/src/SourceCard.tsx");
const { HistorialPage } = await import("../../web/src/HistorialPage.tsx");
const { ApiError } = await import("../../web/src/api.ts");

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
const T3 = 1_700_017_200_000;

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

const STATS_VACIAS = {
  totalSnapshots: 0,
  lastChangedAt: null,
  errorCount: 0,
  lastError: null,
  lastAttempt: null,
} as const;

// ---------------------------------------------------------------------------
// AC-25.1
// ---------------------------------------------------------------------------

Deno.test("AC-25.1: lista vacía muestra empty state y conserva el form de alta", async () => {
  const pagina = await montar(
    createElement(FuentesPage, { api: apiStub({ listSources: () => Promise.resolve([]) }) }),
  );
  try {
    const vacio = buscar(pagina.container, "[data-vacio]");
    assert(vacio.textContent?.includes("Todavía no hay fuentes"), `texto: ${vacio.textContent}`);
    assertEquals(pagina.container.querySelector("ul"), null, "la lista no debía renderizarse vacía");
    buscar(pagina.container, "form");
    assertEquals(pagina.container.querySelector("[data-cargando]"), null);
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-25.1: Cargando visible durante el listado y se va al resolver", async () => {
  const resolvers: ((lista: Fuente[]) => void)[] = [];
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({
        listSources: () =>
          new Promise((resolve) => {
            resolvers.push(resolve);
          }),
      }),
    }),
  );
  try {
    const cargando = buscar(pagina.container, "[data-cargando]");
    assert(cargando.textContent?.includes("Cargando"), `texto: ${cargando.textContent}`);
    assertEquals(pagina.container.querySelector("li"), null);
    assertEquals(pagina.container.querySelector("[data-vacio]"), null, "con el listado en vuelo no hay vacío");

    await act(async () => {
      resolvers[0]([FUENTE]);
      await esperar();
    });
    assertEquals(pagina.container.querySelector("[data-cargando]"), null);
    buscar(pagina.container, 'li[data-tipo="url"]');
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-25.1: un error de listado no muestra empty state", async () => {
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({ listSources: () => Promise.reject(new ApiError(500, "KV explotó")) }),
    }),
  );
  try {
    const error = buscar(pagina.container, "p.error");
    assert(error.textContent?.includes("KV explotó"));
    assertEquals(pagina.container.querySelector("[data-vacio]"), null, "con error no debe haber vacío");
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-25.2
// ---------------------------------------------------------------------------

Deno.test("AC-25.2: Crear fuente deshabilita durante el vuelo y bloquea el doble submit", async () => {
  const payloads: CrearFuenteInput[] = [];
  const creaciones: ((f: Fuente) => void)[] = [];
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({
        listSources: () => Promise.resolve([]),
        createSource: (input) => {
          payloads.push(input);
          return new Promise((resolve) => {
            creaciones.push(resolve);
          });
        },
      }),
    }),
  );
  try {
    const form = buscar<HTMLFormElement>(pagina.container, "form");
    await escribirEn(buscar<HTMLInputElement>(form, "input[placeholder='Nombre']"), "MB");
    await escribirEn(buscar<HTMLInputElement>(form, "input[placeholder='https://...']"), "https://x.test/a.json");
    const btn = boton(form, "Crear fuente");
    await enviarForm(form);
    await enviarForm(form);

    assertEquals(payloads.length, 1, "el doble submit debía bloquearse");
    assertEquals(btn.disabled, true, "Crear fuente debía quedar disabled durante el vuelo");

    await act(async () => {
      creaciones[0]({ ...FUENTE, id: "nuevo", name: "MB", url: "https://x.test/a.json" });
      await esperar();
    });
    assertEquals(btn.disabled, false, "al resolver se re-habilita");
    assert(pagina.container.textContent?.includes("MB"), "la fuente creada no apareció en la lista");
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-25.2: SourceCard deshabilita Capturar, Guardar y Borrar durante sus vuelos", async () => {
  const fetchResolvers: ((r: { sourceId: string; snapshot: SnapshotResumen }) => void)[] = [];
  const updateRejects: ((e: unknown) => void)[] = [];
  const deleteResolvers: ((r: { deleted: string }) => void)[] = [];
  let fetchCalls = 0;
  let updateCalls = 0;
  let deleteCalls = 0;

  const pagina = await montar(
    createElement(SourceCard, {
      api: apiStub({
        getStats: () => Promise.resolve(STATS_VACIAS),
        fetchNow: () => {
          fetchCalls += 1;
          return new Promise((resolve) => {
            fetchResolvers.push(resolve);
          });
        },
        updateSource: () => {
          updateCalls += 1;
          return new Promise((_resolve, reject) => {
            updateRejects.push(reject);
          });
        },
        deleteSource: () => {
          deleteCalls += 1;
          return new Promise((resolve) => {
            deleteResolvers.push(resolve);
          });
        },
      }),
      fuente: FUENTE,
    }),
  );
  try {
    const btnCapturar = boton(pagina.container, "Capturar");
    await click(btnCapturar);
    await click(btnCapturar);
    assertEquals(fetchCalls, 1, "el doble click en Capturar no debía duplicar la llamada");
    assertEquals(btnCapturar.disabled, true, "Capturar debía quedar disabled durante el vuelo");
    await act(async () => {
      fetchResolvers[0]({
        sourceId: FUENTE.id,
        snapshot: { timestamp: 1, hash: "h", sizeBytes: 10, changed: false, trigger: "manual" },
      });
      await esperar();
    });
    assertEquals(btnCapturar.disabled, false, "Capturar se re-habilitó");
    assert(pagina.container.textContent?.includes("changed=false"), "falta el resultado de la captura");

    await click(boton(pagina.container, "Editar"));
    const form = buscar<HTMLFormElement>(pagina.container, "[data-form-editar]");
    await escribirEn(buscar<HTMLInputElement>(form, "input[placeholder='Nombre']"), "MB editada");
    const btnGuardar = boton(form, "Guardar");
    await enviarForm(form);
    await enviarForm(form);
    assertEquals(updateCalls, 1, "el doble submit de Guardar no debía duplicar el PATCH");
    assertEquals(btnGuardar.disabled, true, "Guardar debía quedar disabled durante el vuelo");
    await act(async () => {
      updateRejects[0](new ApiError(500, "KV reventó"));
      await esperar();
    });
    assertEquals(btnGuardar.disabled, false, "Guardar se re-habilitó tras el error");
    assert(pagina.container.querySelector("[data-form-editar]"), "con error el form permanece abierto");
    assert(pagina.container.textContent?.includes("KV reventó"), "el error del guardar no se mostró");
    await click(boton(form, "Cancelar"));
    assertEquals(pagina.container.querySelector("[data-form-editar]"), null, "Cancelar volvió a la fila");

    const originalConfirm = globalThis.window.confirm;
    globalThis.window.confirm = () => true;
    try {
      const btnBorrar = boton(pagina.container, "Borrar");
      await click(btnBorrar);
      await click(btnBorrar);
      assertEquals(deleteCalls, 1, "el doble click en Borrar no debía duplicar el DELETE");
      assertEquals(btnBorrar.disabled, true, "Borrar debía quedar disabled durante el vuelo");
      await act(async () => {
        deleteResolvers[0]({ deleted: FUENTE.id });
        await esperar();
      });
      assertEquals(btnBorrar.disabled, false, "Borrar se re-habilitó");
    } finally {
      globalThis.window.confirm = originalConfirm;
    }
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-25.2: Comparar se deshabilita durante el vuelo y bloquea el doble click", async () => {
  const diffResolvers: ((d: DiffResponse) => void)[] = [];
  const snapResolvers: ((s: SnapshotDetalle) => void)[] = [];
  let diffCalls = 0;

  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({
        listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
        getDiff: () => {
          diffCalls += 1;
          return new Promise((resolve) => {
            diffResolvers.push(resolve);
          });
        },
        getSnapshot: () =>
          new Promise((resolve) => {
            snapResolvers.push(resolve);
          }),
      }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );
  try {
    await escribirEn(buscar<HTMLSelectElement>(pagina.container, '[aria-label="Desde"]'), String(T1));
    await escribirEn(buscar<HTMLSelectElement>(pagina.container, '[aria-label="Hasta"]'), String(T2));
    const btn = boton(pagina.container, "Comparar");
    await click(btn);
    await click(btn);

    assertEquals(diffCalls, 1, "el doble click en Comparar no debía duplicar getDiff");
    assertEquals(btn.disabled, true, "Comparar debía quedar disabled durante el vuelo");

    await act(async () => {
      diffResolvers[0]({ sourceId: FUENTE.id, from: T1, to: T2, changed: true, delta: { a: [1, 2] } });
      await esperar();
      snapResolvers[0]({
        sourceId: FUENTE.id,
        snapshot: { timestamp: T1, hash: "9999888877776666", sizeBytes: 10, changed: true, trigger: "import" },
        json: { a: 1 },
      });
      await esperar();
    });
    assertEquals(btn.disabled, false, "Comparar se re-habilitó");
    buscar(pagina.container, ".diff-viewer");
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-25.3
// ---------------------------------------------------------------------------

Deno.test("AC-25.3: historial sin snapshots muestra vacío y oculta filtros, contador, timeline y comparador", async () => {
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({ listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: [] }) }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );
  try {
    const vacio = buscar(pagina.container, "[data-vacio]");
    assert(vacio.textContent?.includes("Todavía no hay capturas"), `texto: ${vacio.textContent}`);
    assertEquals(pagina.container.querySelector(".filtros"), null, "sin snapshots no hay filtros");
    assertEquals(pagina.container.querySelector("[data-contador]"), null, "sin snapshots no hay contador");
    assertEquals(pagina.container.querySelector(".timeline"), null, "sin snapshots no hay timeline");
    assertEquals(pagina.container.querySelector(".comparador"), null, "sin snapshots no hay comparador");
    assertEquals(pagina.container.querySelector("[data-cargando]"), null);
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-25.3: filtros sin resultados muestran el mensaje y mantienen filtros y contador", async () => {
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({ listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }) }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );
  try {
    await escribirEn(buscar<HTMLInputElement>(pagina.container, 'input[type="search"]'), "zzz");
    const sinResultados = buscar(pagina.container, "[data-sin-resultados]");
    assert(sinResultados.textContent?.includes("Ningún snapshot coincide"), `texto: ${sinResultados.textContent}`);
    buscar(pagina.container, ".filtros");
    assert(buscar(pagina.container, "[data-contador]").textContent?.includes(`0 de ${ENTRADAS.length}`));
    assertEquals(pagina.container.querySelector("[data-vacio]"), null, "no es el vacío de cero snapshots");
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-25.3: Cargando visible en el historial y se va al resolver", async () => {
  const resolvers: ((listado: { sourceId: string; snapshots: EntradaSnapshot[] }) => void)[] = [];
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({
        listSnapshots: () =>
          new Promise((resolve) => {
            resolvers.push(resolve);
          }),
      }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );
  try {
    const cargando = buscar(pagina.container, "[data-cargando]");
    assert(cargando.textContent?.includes("Cargando"), `texto: ${cargando.textContent}`);
    assertEquals(pagina.container.querySelector(".filtros"), null, "con el listado en vuelo no hay filtros");

    await act(async () => {
      resolvers[0]({ sourceId: FUENTE.id, snapshots: ENTRADAS });
      await esperar();
    });
    assertEquals(pagina.container.querySelector("[data-cargando]"), null);
    buscar(pagina.container, "[data-contador]");
    assertEquals(pagina.container.querySelectorAll(".timeline li").length, ENTRADAS.length);
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-25.4
// ---------------------------------------------------------------------------

Deno.test("AC-25.4: JSON queda disabled mientras carga el detalle y se re-habilita", async () => {
  const resolvers: ((s: SnapshotDetalle) => void)[] = [];
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({
        listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
        getSnapshot: () =>
          new Promise((resolve) => {
            resolvers.push(resolve);
          }),
      }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );
  try {
    const btn = boton(pagina.container, "JSON");
    await click(btn);
    assertEquals(btn.disabled, true, "JSON debía quedar disabled mientras carga");
    assertEquals(pagina.container.querySelector("[data-json]"), null, "sin detalle aún");

    await act(async () => {
      resolvers[0]({
        sourceId: FUENTE.id,
        snapshot: { timestamp: T3, hash: "abcdef0123456789", sizeBytes: 10, changed: false, trigger: "cron" },
        json: { ok: true },
      });
      await esperar();
    });
    assertEquals(btn.disabled, false, "JSON se re-habilitó tras resolver");
    buscar(pagina.container, "[data-json]");
  } finally {
    await pagina.desmontar();
  }
});
