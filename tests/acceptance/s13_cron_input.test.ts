import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { CrearFuenteInput } from "../../web/src/api.ts";
import { apiStub, buscar, createElement, enviarForm, escribirEn, montar } from "../support_ui.ts";

const { FuentesPage } = await import("../../web/src/FuentesPage.tsx");
const { CronInput } = await import("../../web/src/CronInput.tsx");
const { useState } = await import("react");

const CRON_PLACEHOLDER = "*/5 * * * *";

function EnvoltorioCron() {
  const [valor, setValor] = useState("");
  return createElement(CronInput, { value: valor, onChange: setValor });
}

// ---------------------------------------------------------------------------
// AC-13.1
// ---------------------------------------------------------------------------

Deno.test("AC-13.1: CronInput muestra preview si es válida e error si no lo es", async () => {
  const pagina = await montar(createElement(EnvoltorioCron));
  try {
    const { container } = pagina;
    const input = buscar<HTMLInputElement>(container, `input[placeholder='${CRON_PLACEHOLDER}']`);
    assertEquals(container.querySelector("[data-preview-cron]"), null, "vacío: sin preview");
    assertEquals(container.querySelector("[data-cron-error]"), null, "vacío: sin error");

    await escribirEn(input, "*/5 * * * *");
    const preview = buscar<HTMLElement>(container, "[data-preview-cron]");
    assertStringIncludes(preview.textContent ?? "", "5");
    assertEquals(container.querySelector("[data-cron-error]"), null);

    await escribirEn(input, "no-es-cron");
    const error = buscar<HTMLElement>(container, "[data-cron-error]");
    assertStringIncludes(error.textContent ?? "", "cron inválido");
    assertEquals(container.querySelector("[data-preview-cron]"), null, "inválida: sin preview");

    await escribirEn(input, "");
    assertEquals(container.querySelector("[data-preview-cron]"), null);
    assertEquals(container.querySelector("[data-cron-error]"), null);

    const fuente = await Deno.readTextFile(new URL("../../web/src/CronInput.tsx", import.meta.url));
    assertEquals(fuente.includes(".css"), false, "CronInput no debe importar CSS");
    assertEquals(fuente.includes(".png") || fuente.includes(".svg"), false, "CronInput no debe importar assets");
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-13.2
// ---------------------------------------------------------------------------

interface ContextoForm {
  creado: CrearFuenteInput | null;
  pagina: Awaited<ReturnType<typeof montar>>;
  formulario: HTMLFormElement;
}

async function montarForm(): Promise<ContextoForm> {
  let creado: CrearFuenteInput | null = null;
  const api = apiStub({
    listSources: () => Promise.resolve([]),
    createSource: (input) => {
      creado = input;
      return Promise.resolve({
        id: "nueva",
        name: input.name,
        type: input.type ?? "url",
        url: input.url ?? "",
        headers: {},
        cronExpr: input.cronExpr ?? null,
        cronEnabled: input.cronExpr != null,
        createdAt: "2026-09-26T12:00:00.000Z",
      });
    },
  });
  const pagina = await montar(createElement(FuentesPage, { api }));
  const formulario = buscar<HTMLFormElement>(pagina.container, "form");
  await escribirEn(buscar<HTMLInputElement>(formulario, "input[placeholder='Nombre']"), "MB");
  await escribirEn(buscar<HTMLInputElement>(formulario, "input[placeholder='https://...']"), "https://x.test/a.json");
  return { get creado() { return creado; }, pagina, formulario };
}

Deno.test("AC-13.2: el alta con cron válido envía cronExpr y con vacío va sin cronExpr", async () => {
  const ctx = await montarForm();
  try {
    await escribirEn(buscar<HTMLInputElement>(ctx.formulario, `input[placeholder='${CRON_PLACEHOLDER}']`), "*/5 * * * *");
    await enviarForm(ctx.formulario);
    assertEquals(ctx.creado, {
      name: "MB",
      type: "url",
      url: "https://x.test/a.json",
      cronExpr: "*/5 * * * *",
    });
  } finally {
    await ctx.pagina.desmontar();
  }
});

Deno.test("AC-13.2: un cron inválido bloquea el submit y deja el error visible", async () => {
  const ctx = await montarForm();
  try {
    await escribirEn(buscar<HTMLInputElement>(ctx.formulario, `input[placeholder='${CRON_PLACEHOLDER}']`), "no-es-cron");
    await enviarForm(ctx.formulario);
    assertEquals(ctx.creado, null, "no debe llamar createSource con cron inválido");
    const error = buscar<HTMLElement>(ctx.formulario, "[data-cron-error]");
    assertStringIncludes(error.textContent ?? "", "cron inválido");
  } finally {
    await ctx.pagina.desmontar();
  }
});

Deno.test("AC-13.2: sin cron va sin cronExpr y con tipo file no aparece el campo", async () => {
  const sinCron = await montarForm();
  try {
    await enviarForm(sinCron.formulario);
    assertEquals(sinCron.creado, {
      name: "MB",
      type: "url",
      url: "https://x.test/a.json",
    });
  } finally {
    await sinCron.pagina.desmontar();
  }

  const conFile = await montarForm();
  try {
    assert(
      conFile.formulario.querySelector(`input[placeholder='${CRON_PLACEHOLDER}']`) !== null,
      "con tipo url por defecto el campo cron debe existir",
    );
    await escribirEn(buscar<HTMLSelectElement>(conFile.formulario, "select"), "file");
    assert(
      conFile.formulario.querySelector(`input[placeholder='${CRON_PLACEHOLDER}']`) === null,
      "con tipo file el campo cron no debe existir",
    );
    await enviarForm(conFile.formulario);
    assertEquals(conFile.creado, { name: "MB", type: "file" });
  } finally {
    await conFile.pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-13.3
// ---------------------------------------------------------------------------

Deno.test("AC-13.3: cronstrue y cron-parser están en deno.json y en web/package.json", async () => {
  const denoJson = JSON.parse(await Deno.readTextFile(new URL("../../deno.json", import.meta.url)));
  assertEquals(typeof denoJson.imports["cronstrue"], "string");
  assertEquals(typeof denoJson.imports["cron-parser"], "string");

  const packageJson = JSON.parse(await Deno.readTextFile(new URL("../../web/package.json", import.meta.url)));
  assertEquals(typeof packageJson.dependencies["cronstrue"], "string");
  assertEquals(typeof packageJson.dependencies["cron-parser"], "string");
});
