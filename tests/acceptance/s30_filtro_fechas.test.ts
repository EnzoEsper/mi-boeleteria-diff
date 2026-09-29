import { assert, assertEquals } from "@std/assert";
import type { EntradaSnapshot, Fuente } from "../../web/src/api.ts";
import {
  apiStub,
  buscar,
  click,
  createElement,
  escribirEn,
  montar,
} from "../support_ui.ts";

const { HistorialPage } = await import("../../web/src/HistorialPage.tsx");

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

function visibles(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".timeline li")].map((li) =>
    li.getAttribute("data-timestamp") ?? ""
  );
}

function contador(container: HTMLElement): string | null {
  return buscar<HTMLElement>(container, "[data-contador]").textContent;
}

function montarCon(
  api = apiStub({
    listSnapshots: () =>
      Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
  }),
) {
  return montar(
    createElement(HistorialPage, { api, fuente: FUENTE, onVolver: () => {} }),
  );
}

// ---------------------------------------------------------------------------
// AC-30.1
// ---------------------------------------------------------------------------

Deno.test("AC-30.1: los inputs de fecha existen vacíos y no piden la lista otra vez", async () => {
  let llamadas = 0;
  const pagina = await montarCon(apiStub({
    listSnapshots: () => {
      llamadas++;
      return Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS });
    },
  }));
  try {
    const { container } = pagina;
    const desde = buscar<HTMLInputElement>(
      container,
      'input[type="date"][aria-label="Fecha desde"]',
    );
    const hasta = buscar<HTMLInputElement>(
      container,
      'input[type="date"][aria-label="Fecha hasta"]',
    );
    assertEquals(desde.value, "", "Fecha desde arranca vacío");
    assertEquals(hasta.value, "", "Fecha hasta arranca vacío");
    assert(
      desde.closest(".filtros"),
      "los date inputs deben vivir en .filtros",
    );
    assertEquals(contador(container), "4 de 4 snapshots");
    assertEquals(llamadas, 1, "el filtrado no debe pedir la lista otra vez");
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-30.2
// ---------------------------------------------------------------------------

Deno.test("AC-30.2: el rango de fechas es inclusivo por día de Buenos Aires", async () => {
  const pagina = await montarCon();
  try {
    const { container } = pagina;
    const desde = buscar<HTMLInputElement>(
      container,
      'input[aria-label="Fecha desde"]',
    );
    const hasta = buscar<HTMLInputElement>(
      container,
      'input[aria-label="Fecha hasta"]',
    );

    await escribirEn(desde, "2023-11-16");
    assertEquals(
      visibles(container),
      [String(T4), String(T3)],
      "desde incluye el día 16",
    );
    assertEquals(contador(container), "2 de 4 snapshots");

    await escribirEn(hasta, "2023-11-16");
    assertEquals(
      visibles(container),
      [String(T3)],
      "hasta es inclusivo: día 16 completo",
    );

    await escribirEn(desde, "2023-11-14");
    await escribirEn(hasta, "2023-11-14");
    assertEquals(
      visibles(container),
      [String(T1)],
      "un día único muestra solo ese día",
    );

    await escribirEn(desde, "2023-12-01");
    assertEquals(visibles(container), []);
    assertEquals(contador(container), "0 de 4 snapshots");
    buscar(container, "[data-sin-resultados]");

    await escribirEn(desde, "");
    await escribirEn(hasta, "");
    assertEquals(
      contador(container),
      "4 de 4 snapshots",
      "limpiar el rango restaura la lista",
    );
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-30.2: el rango se combina por intersección con trigger y solo-cambios", async () => {
  const pagina = await montarCon();
  try {
    const { container } = pagina;
    const desde = buscar<HTMLInputElement>(
      container,
      'input[aria-label="Fecha desde"]',
    );

    await escribirEn(desde, "2023-11-16");
    await escribirEn(
      buscar<HTMLSelectElement>(container, 'select[aria-label="Trigger"]'),
      "cron",
    );
    assertEquals(
      visibles(container),
      [String(T4)],
      "rango + trigger se cruzan",
    );

    await escribirEn(
      buscar<HTMLSelectElement>(container, 'select[aria-label="Trigger"]'),
      "todos",
    );
    await click(
      buscar<HTMLInputElement>(
        container,
        'input[aria-label="Solo con cambios"]',
      ),
    );
    assertEquals(
      visibles(container),
      [String(T3)],
      "rango + solo-cambios se cruzan",
    );

    await click(
      buscar<HTMLInputElement>(
        container,
        'input[aria-label="Solo con cambios"]',
      ),
    );
    await escribirEn(
      buscar<HTMLInputElement>(container, 'input[placeholder="Filtrar…"]'),
      "dead",
    );
    assertEquals(
      visibles(container),
      [String(T4)],
      "rango + búsqueda por hash se cruzan",
    );
    await escribirEn(
      buscar<HTMLInputElement>(container, 'input[placeholder="Filtrar…"]'),
      "",
    );
    await escribirEn(desde, "");
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-30.3
// ---------------------------------------------------------------------------

Deno.test("AC-30.3: el comparador sigue listando todos con el rango de fecha activo", async () => {
  const pagina = await montarCon();
  try {
    const { container } = pagina;
    await escribirEn(
      buscar<HTMLInputElement>(container, 'input[aria-label="Fecha desde"]'),
      "2023-11-16",
    );
    assertEquals(contador(container), "2 de 4 snapshots");

    const d = buscar<HTMLSelectElement>(
      container,
      'select[aria-label="Desde"]',
    );
    const h = buscar<HTMLSelectElement>(
      container,
      'select[aria-label="Hasta"]',
    );
    assertEquals(d.options.length, 5, "el comparador no se filtra");
    assertEquals(h.options.length, 5, "el comparador no se filtra");
  } finally {
    await pagina.desmontar();
  }
});
