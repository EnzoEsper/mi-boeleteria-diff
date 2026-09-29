import { assert, assertEquals } from "@std/assert";
import type { Api, EntradaSnapshot, Fuente } from "../../web/src/api.ts";
import {
  act,
  apiStub,
  buscar,
  click,
  createElement,
  esperar,
  montar,
} from "../support_ui.ts";

const { HistorialPage } = await import("../../web/src/HistorialPage.tsx");

type DiffRespuesta = Awaited<ReturnType<Api["getDiff"]>>;
type Detalle = Awaited<ReturnType<Api["getSnapshot"]>>;

const T1 = 1_700_000_000_000; // 2023-11-14 19:13:20 BA
const T2 = 1_700_086_400_000; // 2023-11-15 19:13:20 BA
const T3 = 1_700_172_800_000; // 2023-11-16 19:13:20 BA
const T4 = 1_700_259_200_000; // 2023-11-17 19:13:20 BA

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
    timestamp: T4,
    hash: "dead44441111aaaa",
    sizeBytes: 197942,
    changed: false,
    trigger: "cron",
    hasBlob: false,
    hasDelta: false,
    sinceBase: 3,
    deltaFrom: T3,
  },
  {
    timestamp: T3,
    hash: "cafe2222dead3333",
    sizeBytes: 197900,
    changed: true,
    trigger: "import",
    hasBlob: false,
    hasDelta: true,
    sinceBase: 2,
    deltaFrom: T2,
  },
  {
    timestamp: T2,
    hash: "beef0000cafe1111",
    sizeBytes: 197500,
    changed: true,
    trigger: "cron",
    hasBlob: false,
    hasDelta: true,
    sinceBase: 1,
    deltaFrom: T1,
  },
  {
    timestamp: T1,
    hash: "aaaa1111bbbb2222",
    sizeBytes: 197942,
    changed: false,
    trigger: "manual",
    hasBlob: true,
    hasDelta: false,
    sinceBase: 0,
    deltaFrom: null,
  },
];

function montarCon(api: Api) {
  return montar(
    createElement(HistorialPage, { api, fuente: FUENTE, onVolver: () => {} }),
  );
}

function stubListado(): Api {
  return apiStub({
    listSnapshots: () =>
      Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
  });
}

function botondiff(
  container: HTMLElement,
  timestamp: number,
): HTMLButtonElement {
  const li = buscar<HTMLElement>(
    container,
    `li[data-timestamp="${timestamp}"]`,
  );
  return li.querySelector<HTMLButtonElement>("button.ver-diff") ??
    (() => {
      throw new Error(`no hay botón ver-diff en ${timestamp}`);
    })();
}

// ---------------------------------------------------------------------------
// AC-31.1
// ---------------------------------------------------------------------------

Deno.test("AC-31.1: el botón Diff con anterior aparece donde hay deltaFrom", async () => {
  const pagina = await montarCon(stubListado());
  try {
    const { container } = pagina;
    const btn = botondiff(container, T2);
    assertEquals(btn.textContent, "Diff con anterior");
    assert(
      buscar<HTMLElement>(container, `li[data-timestamp="${T1}"]`)
        .querySelector("button.ver-diff") === null,
      "la base inicial (deltaFrom null) no debe mostrar el botón",
    );

    const css = await Deno.readTextFile(
      new URL("../../web/src/index.css", import.meta.url),
    );
    assert(
      /\.ver-diff\s*\{/.test(css),
      ".ver-diff necesita regla en index.css",
    );
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-31.2
// ---------------------------------------------------------------------------

Deno.test("AC-31.2: el click pide el diff vs deltaFrom y bloquea dobles clicks", async () => {
  let resolverDiff!: (valor: DiffRespuesta) => void;
  const pedidos: Array<[number, number]> = [];
  let pedidosDetalle = 0;
  const api = apiStub({
    listSnapshots: () =>
      Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
    getDiff: (_id, from, to) => {
      pedidos.push([from, to]);
      return new Promise<DiffRespuesta>((resolve) => {
        resolverDiff = resolve;
      });
    },
    getSnapshot: (id, ts) => {
      pedidosDetalle++;
      const resumen = ENTRADAS.find((entrada) => entrada.timestamp === ts);
      return Promise.resolve(
        {
          sourceId: id,
          snapshot: resumen ?? ENTRADAS[0],
          json: { h: "antes" },
        } satisfies Detalle,
      );
    },
  });

  const pagina = await montarCon(api);
  try {
    const { container } = pagina;
    const btn = botondiff(container, T2);
    await click(btn);

    assertEquals(pedidos, [[T1, T2]], "el diff se pide contra deltaFrom");
    assertEquals(
      btn.disabled,
      true,
      "durante el vuelo el botón queda disabled",
    );

    await click(btn);
    assertEquals(
      pedidos.length,
      1,
      "el segundo click durante el vuelo se ignora",
    );

    await act(async () => {
      resolverDiff({
        sourceId: FUENTE.id,
        from: T1,
        to: T2,
        changed: true,
        delta: { h: ["antes", "ahora"] },
      });
      await esperar();
    });

    assert(
      container.querySelector(".diff-viewer"),
      "el DiffViewer debe renderizarse",
    );
    assertEquals(
      pedidosDetalle,
      1,
      "se pide el snapshot izquierdo una sola vez",
    );
    assertEquals(btn.disabled, false, "al resolver se re-habilita");
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-31.3
// ---------------------------------------------------------------------------

Deno.test("AC-31.3: en contexto de ruta el click escribe la URL y no pide el diff", async () => {
  let llamado: [number, number] | null = null;
  let diffs = 0;
  const api = apiStub({
    listSnapshots: () =>
      Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
    getDiff: () => {
      diffs++;
      return Promise.reject(new Error("no debe pedirse el diff"));
    },
  });
  const pagina = await montar(
    createElement(HistorialPage, {
      api,
      fuente: FUENTE,
      onVolver: () => {},
      comparacion: null,
      onCompararEnRuta: (left: number, right: number) => {
        llamado = [left, right];
      },
    }),
  );
  try {
    await click(botondiff(pagina.container, T4));
    assertEquals(llamado, [T3, T4], "el click escribe el par en la URL");
    assertEquals(diffs, 0, "en contexto de ruta no se pide el diff localmente");
  } finally {
    await pagina.desmontar();
  }
});
