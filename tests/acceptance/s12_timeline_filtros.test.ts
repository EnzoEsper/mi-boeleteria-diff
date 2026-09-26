import { assertEquals } from "@std/assert";
import type { EntradaSnapshot, Fuente } from "../../web/src/api.ts";
import { apiStub, boton, buscar, click, createElement, escribirEn, montar } from "../support_ui.ts";

const { HistorialPage } = await import("../../web/src/HistorialPage.tsx");

const T1 = 1_700_000_000_000; // 2023-11-14 22:13:20 UTC
const T2 = 1_700_086_400_000; // 2023-11-15 22:13:20 UTC
const T3 = 1_700_172_800_000; // 2023-11-16 22:13:20 UTC
const T4 = 1_700_259_200_000; // 2023-11-17 22:13:20 UTC

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
  { timestamp: T4, hash: "dead44441111aaaa", sizeBytes: 197942, changed: false, trigger: "cron", hasBlob: false, hasDelta: false, sinceBase: 3, deltaFrom: T3 },
  { timestamp: T3, hash: "cafe2222dead3333", sizeBytes: 197900, changed: true, trigger: "import", hasBlob: false, hasDelta: true, sinceBase: 2, deltaFrom: T2 },
  { timestamp: T2, hash: "beef0000cafe1111", sizeBytes: 197500, changed: true, trigger: "cron", hasBlob: false, hasDelta: true, sinceBase: 1, deltaFrom: T1 },
  { timestamp: T1, hash: "aaaa1111bbbb2222", sizeBytes: 197942, changed: false, trigger: "manual", hasBlob: true, hasDelta: false, sinceBase: 0, deltaFrom: null },
];

function visibles(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".timeline li")].map((li) => li.getAttribute("data-timestamp") ?? "");
}

function contador(container: HTMLElement): string | null {
  return buscar<HTMLElement>(container, "[data-contador]").textContent;
}

// ---------------------------------------------------------------------------
// AC-12.1
// ---------------------------------------------------------------------------

Deno.test("AC-12.1: el buscador filtra por fecha y hash sin llamadas extra, con contador", async () => {
  let llamadas = 0;
  const api = apiStub({
    listSnapshots: () => {
      llamadas++;
      return Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS });
    },
  });
  const pagina = await montar(createElement(HistorialPage, { api, fuente: FUENTE, onVolver: () => {} }));
  try {
    const { container } = pagina;
    assertEquals(contador(container), "4 de 4 snapshots");

    const buscador = buscar<HTMLInputElement>(container, "input[placeholder='Filtrar…']");
    await escribirEn(buscador, "2023-11-15");
    assertEquals(contador(container), "1 de 4 snapshots");
    assertEquals(visibles(container), [String(T2)]);

    await escribirEn(buscador, "BEEF");
    assertEquals(visibles(container), [String(T2)], "el hash filtra sin distinguir mayúsculas");

    await escribirEn(buscador, "2023-11");
    assertEquals(visibles(container), [String(T4), String(T3), String(T2), String(T1)]);

    await escribirEn(buscador, "");
    assertEquals(contador(container), "4 de 4 snapshots");
    assertEquals(llamadas, 1, "el filtrado no debe pedir la lista otra vez");
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-12.2
// ---------------------------------------------------------------------------

Deno.test("AC-12.2: el select Trigger acota la lista por origen", async () => {
  const api = apiStub({ listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }) });
  const pagina = await montar(createElement(HistorialPage, { api, fuente: FUENTE, onVolver: () => {} }));
  try {
    const { container } = pagina;
    const trigger = buscar<HTMLSelectElement>(container, "select[aria-label='Trigger']");
    assertEquals(Array.from(trigger.options).map((opcion) => opcion.value), ["todos", "manual", "cron", "import"]);

    await escribirEn(trigger, "cron");
    assertEquals(visibles(container), [String(T4), String(T2)]);
    assertEquals(contador(container), "2 de 4 snapshots");

    await escribirEn(trigger, "manual");
    assertEquals(visibles(container), [String(T1)]);

    await escribirEn(trigger, "import");
    assertEquals(visibles(container), [String(T3)]);

    await escribirEn(trigger, "todos");
    assertEquals(contador(container), "4 de 4 snapshots");
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-12.3
// ---------------------------------------------------------------------------

Deno.test("AC-12.3: solo-cambios + combinación de filtros; comparador y Volver intactos", async () => {
  let vueltas = 0;
  const api = apiStub({ listSnapshots: () => Promise.resolve({ sourceId: FUENTE.id, snapshots: ENTRADAS }) });
  const pagina = await montar(
    createElement(HistorialPage, { api, fuente: FUENTE, onVolver: () => vueltas++ }),
  );
  try {
    const { container } = pagina;
    const soloCambios = buscar<HTMLInputElement>(container, "input[aria-label='Solo con cambios']");
    await click(soloCambios);
    assertEquals(visibles(container), [String(T3), String(T2)]);
    assertEquals(contador(container), "2 de 4 snapshots");

    await escribirEn(buscar<HTMLSelectElement>(container, "select[aria-label='Trigger']"), "cron");
    assertEquals(visibles(container), [String(T2)], "cron + solo-cambios se combinan por intersección");

    await escribirEn(buscar<HTMLInputElement>(container, "input[placeholder='Filtrar…']"), "2023-11-16");
    assertEquals(visibles(container), []);
    assertEquals(contador(container), "0 de 4 snapshots");

    const desde = buscar<HTMLSelectElement>(container, "select[aria-label='Desde']");
    const hasta = buscar<HTMLSelectElement>(container, "select[aria-label='Hasta']");
    assertEquals(desde.options.length, 5, "los selects siguen listando todos los snapshots");
    assertEquals(hasta.options.length, 5, "los selects siguen listando todos los snapshots");

    await click(boton(container, "Volver"));
    assertEquals(vueltas, 1, "Volver debe seguir funcionando tras filtrar");
  } finally {
    await pagina.desmontar();
  }
});
