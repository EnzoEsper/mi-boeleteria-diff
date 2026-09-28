import { assert, assertEquals } from "@std/assert";
import type { EntradaSnapshot, Fuente } from "../../web/src/api.ts";
import { apiStub, createElement, montar } from "../support_ui.ts";

const { HistorialPage } = await import("../../web/src/HistorialPage.tsx");
const { formatearMomento } = await import("../../web/src/tiempo.ts");

const T1 = 1_700_000_000_000; // 2023-11-14 22:13:20 UTC → 19:13:20 Buenos Aires

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

const ENTRADAS: EntradaSnapshot[] = [
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

// ---------------------------------------------------------------------------
// AC-22.1
// ---------------------------------------------------------------------------

Deno.test("AC-22.1: formatearMomento formatea en Buenos Aires con00 en medianoche", () => {
  assertEquals(formatearMomento(T1), "2023-11-14 19:13:20", "22:13:20 UTC debía verse como 19:13:20 en BA");
  assertEquals(
    formatearMomento(Date.UTC(2024, 0, 1, 3, 0, 0)),
    "2024-01-01 00:00:00",
    "medianoche de BA debía ser 00:00:00 (h23, no h24)",
  );
  assertEquals(
    formatearMomento(Date.UTC(2024, 0, 1, 2, 0, 0)),
    "2023-12-31 23:00:00",
    "las 02:00 UTC debían caer al día anterior en BA",
  );
});

// ---------------------------------------------------------------------------
// AC-22.2
// ---------------------------------------------------------------------------

Deno.test("AC-22.2: HistorialPage muestra el momento en hora de Buenos Aires", async () => {
  const pagina = await montar(
    createElement(HistorialPage, {
      api: apiStub({
        listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }),
      }),
      fuente: FUENTE,
      onVolver: () => {},
    }),
  );
  try {
    const texto = pagina.container.textContent ?? "";
    assert(texto.includes("2023-11-14 19:13:20"), `falta el momento en hora BA en: ${texto.slice(0, 300)}`);
    assert(!texto.includes("22:13:20"), "no debe mostrarse la hora UTC");
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-22.3
// ---------------------------------------------------------------------------

Deno.test("AC-22.3: S9 quedó enmendado a Buenos Aires y s9/s18 usan la hora nueva", async () => {
  const spec9 = await Deno.readTextFile(new URL("../../specs/S9-historial-diff.md", import.meta.url));
  assert(spec9.includes("Buenos Aires"), "S9 AC-9.1 no quedó enmendado a Buenos Aires");
  assert(!spec9.includes("momento en UTC"), "quedó la redacción de UTC vieja en S9");

  const test9 = await Deno.readTextFile(new URL("./s9_historial_diff.test.ts", import.meta.url));
  assert(test9.includes("2023-11-14 19:13:20"), "s9 no usa la hora de Buenos Aires");

  const test18 = await Deno.readTextFile(new URL("./s18_deep_link_compare.test.ts", import.meta.url));
  assert(test18.includes("2023-11-14 19:13:20"), "s18 no usa la hora de Buenos Aires");
  assert(!test18.includes("2023-11-14 22:13:20"), "s18 quedó con la hora UTC");
});
