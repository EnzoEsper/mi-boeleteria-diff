import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { FetchLike } from "../../server/snapshot.ts";
import type { ActualizarFuenteInput, CrearFuenteInput, Fuente } from "../../web/src/api.ts";
import { createApi } from "../../web/src/api.ts";
import { apiStub, boton, buscar, click, createElement, enviarForm, escribirEn, montar } from "../support_ui.ts";
import { withApp } from "../support.ts";

const { SourceCard } = await import("../../web/src/SourceCard.tsx");
const { FuentesPage } = await import("../../web/src/FuentesPage.tsx");
const { ApiError } = await import("../../web/src/api.ts");

const FUENTE: Fuente = {
  id: "id-url",
  name: "Horarios MB",
  type: "url",
  url: "https://miboleteria.com.ar/xml/horarios.txt",
  headers: {},
  cronExpr: "*/5 * * * *",
  cronEnabled: false,
  createdAt: "2026-09-26T12:00:00.000Z",
};

function parchear(app: { fetch(req: Request): Response | Promise<Response> }, id: string, body: string) {
  return app.fetch(
    new Request(`http://localhost/api/sources/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
}

// ---------------------------------------------------------------------------
// AC-21.1
// ---------------------------------------------------------------------------

Deno.test("AC-21.1: PATCH actualiza solo los campos provistos y conserva id/type/createdAt", async () => {
  await withApp(async ({ app, source }) => {
    const res = await parchear(app, source.id, JSON.stringify({
      name: " MB editada ",
      cronExpr: "0 9 * * *",
      cronEnabled: true,
      type: "file",
    }));
    assertEquals(res.status, 200, "el PATCH debía responder 200");
    const body = await res.json() as Fuente;
    assertEquals(body.name, "MB editada", "name debía guardarse con trim");
    assertEquals([body.cronExpr, body.cronEnabled], ["0 9 * * *", true]);
    assertEquals([body.id, body.type, body.createdAt], [source.id, source.type, source.createdAt], "id/type/createdAt cambiaron");
    assertEquals(body.url, source.url, "url no provisto debía conservarse");
    assertEquals(body.headers, source.headers, "headers no provisto debía conservarse");

    const soloName = await parchear(app, source.id, JSON.stringify({ name: "Otro nombre" }));
    assertEquals(soloName.status, 200);
    const tras = await soloName.json() as Fuente;
    assertEquals(tras.name, "Otro nombre");
    assertEquals([tras.cronExpr, tras.cronEnabled], ["0 9 * * *", true], "el patch de name no debía tocar el cron");

    const get = await app.fetch(new Request(`http://localhost/api/sources/${source.id}`));
    const guardada = await get.json() as Fuente;
    assertEquals(guardada.name, "Otro nombre", "el GET posterior no reflejaba el cambio");
  });
});

// ---------------------------------------------------------------------------
// AC-21.2
// ---------------------------------------------------------------------------

Deno.test("AC-21.2: PATCH valida el body y responde 404 para id inexistente", async () => {
  await withApp(async ({ app, source }) => {
    const vacio = await parchear(app, source.id, "{}");
    assertEquals(vacio.status, 400, "body vacío debía 400");
    const vacioBody = await vacio.json() as { error: string; issues: { path: string; message: string }[] };
    assertEquals(vacioBody.error, "validación fallida");
    assertStringIncludes(vacioBody.issues[0].message, "sin campos", "el issue del body vacío menciona sin campos");

    const noJson = await parchear(app, source.id, "no-es-json");
    assertEquals(noJson.status, 400, "body no-JSON debía 400");

    const invalidos = [
      { body: { cronEnabled: "si" }, path: "cronEnabled" },
      { body: { name: "" }, path: "name" },
      { body: { url: "ftp://x/y" }, path: "url" },
    ] as const;
    for (const caso of invalidos) {
      const res = await parchear(app, source.id, JSON.stringify(caso.body));
      assertEquals(res.status, 400, `esperaba 400 para ${JSON.stringify(caso.body)}`);
      const body = await res.json() as { issues: { path: string }[] };
      assertEquals(body.issues[0].path, caso.path, `path incorrecto para ${JSON.stringify(caso.body)}`);
    }

    const noExiste = await parchear(app, "no-existe", JSON.stringify({ name: "x" }));
    assertEquals(noExiste.status, 404, "id inexistente debía 404");
    assertEquals(await noExiste.json(), { error: "fuente no encontrada" });
  });
});

// ---------------------------------------------------------------------------
// AC-21.3
// ---------------------------------------------------------------------------

Deno.test("AC-21.3: updateSource emite PATCH a la ruta relativa y normaliza errores", async () => {
  const llamadas: { url: string; init?: RequestInit }[] = [];
  const respuestas: { status: number; body: unknown }[] = [
    { status: 200, body: { ...FUENTE, name: "MB editada" } },
    { status: 404, body: { error: "fuente no encontrada" } },
  ];
  const fetchImpl: FetchLike = (input, init) => {
    llamadas.push({ url: String(input), init });
    const siguiente = respuestas.shift() ?? { status: 200, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(siguiente.body), {
        status: siguiente.status,
        headers: { "content-type": "application/json" },
      }),
    );
  };

  const api = createApi(fetchImpl);
  const patch: ActualizarFuenteInput = { name: "MB editada", cronExpr: null, cronEnabled: false };
  const actualizada = await api.updateSource("abc", patch);
  assertEquals(actualizada.name, "MB editada", "no devolvió la fuente parseada");
  assertEquals(llamadas[0].url, "/api/sources/abc", "no emitió PATCH a la ruta relativa");
  assertEquals(llamadas[0].init?.method, "PATCH");
  assertEquals(llamadas[0].init?.headers, { "content-type": "application/json" });
  assertEquals(llamadas[0].init?.body, JSON.stringify(patch), "el body no serializó el patch");

  const error = await assertRejects(() => api.updateSource("nope", { name: "x" }), ApiError, "fuente no encontrada");
  assertEquals(error.status, 404, "el 4xx no se normalizó en ApiError");

  const apiRota = createApi(() => Promise.reject(new TypeError("network down")));
  await assertRejects(() => apiRota.updateSource("abc", { name: "y" }), TypeError, "network down");
});

// ---------------------------------------------------------------------------
// AC-21.4
// ---------------------------------------------------------------------------

Deno.test("AC-21.4: Editar prellena el form, guardar llama updateSource y refresca la fila", async () => {
  const actualizadas: { id: string; patch: ActualizarFuenteInput }[] = [];
  const actualizada: Fuente = { ...FUENTE, name: "MB nueva", cronExpr: "0 9 * * *", cronEnabled: true };
  const pagina = await montar(
    createElement(FuentesPage, {
      api: apiStub({
        listSources: () => Promise.resolve([FUENTE]),
        updateSource: (id, patch) => {
          actualizadas.push({ id, patch });
          return Promise.resolve(actualizada);
        },
      }),
    }),
  );
  try {
    await click(boton(pagina.container, "Editar"));
    const form = buscar<HTMLFormElement>(pagina.container, "[data-form-editar]");
    const nombre = buscar<HTMLInputElement>(form, "input[placeholder='Nombre']");
    assertEquals(nombre.value, FUENTE.name, "el form no venía prellenado con el nombre actual");
    const cron = buscar<HTMLInputElement>(form, "input[placeholder='*/5 * * * *']");
    assertEquals(cron.value, FUENTE.cronExpr, "el form no venía prellenado con el cron actual");
    const check = buscar<HTMLInputElement>(form, "input[type=checkbox]");
    assertEquals(check.checked, FUENTE.cronEnabled, "el checkbox no venía con el cronEnabled actual");

    await escribirEn(nombre, " MB nueva ");
    await escribirEn(cron, "0 9 * * *");
    await click(check);
    await enviarForm(form);

    assertEquals(actualizadas, [{
      id: FUENTE.id,
      patch: { name: "MB nueva", cronExpr: "0 9 * * *", cronEnabled: true },
    }], "no se llamó a updateSource con el patch esperado");
    assertEquals(pagina.container.querySelector("[data-form-editar]"), null, "el form no se cerró tras guardar");
    assertEquals(buscar(pagina.container, "li .resultado").textContent, "actualizado");
    assert(pagina.container.textContent?.includes("MB nueva"), "la fila no reflejó el nombre actualizado");
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-21.4: cron inválido bloquea Guardar y Cancelar cierra sin llamadas", async () => {
  let llamado = false;
  const pagina = await montar(
    createElement(SourceCard, {
      api: apiStub({
        updateSource: () => {
          llamado = true;
          return Promise.resolve(FUENTE);
        },
      }),
      fuente: FUENTE,
    }),
  );
  try {
    await click(boton(pagina.container, "Editar"));
    const form = buscar<HTMLFormElement>(pagina.container, "[data-form-editar]");
    await escribirEn(buscar<HTMLInputElement>(form, "input[placeholder='*/5 * * * *']"), "no-es-cron");
    await enviarForm(form);
    assertEquals(llamado, false, "no debía llamar updateSource con cron inválido");
    buscar(form, "[data-cron-error]");

    await click(boton(form, "Cancelar"));
    assertEquals(pagina.container.querySelector("[data-form-editar]"), null, "Cancelar no cerró el form");
    assertEquals(llamado, false, "Cancelar no debía llamar updateSource");
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-21.4: un ApiError del guardar queda visible y el form permanece abierto", async () => {
  const pagina = await montar(
    createElement(SourceCard, {
      api: apiStub({ updateSource: () => Promise.reject(new ApiError(500, "KV reventó")) }),
      fuente: FUENTE,
    }),
  );
  try {
    await click(boton(pagina.container, "Editar"));
    await enviarForm(buscar<HTMLFormElement>(pagina.container, "[data-form-editar]"));
    assertEquals(buscar(pagina.container, "li .error").textContent, "KV reventó", "el error del guardar no se mostró");
    assert(pagina.container.querySelector("[data-form-editar]"), "el form debía permanecer abierto tras el error");
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-21.4: file solo edita el nombre (sin CronInput ni checkbox)", async () => {
  const fuenteFile: Fuente = { ...FUENTE, id: "id-file", type: "file", url: "", cronExpr: null, cronEnabled: false };
  const patches: ActualizarFuenteInput[] = [];
  const pagina = await montar(
    createElement(SourceCard, {
      api: apiStub({
        updateSource: (_id, patch) => {
          patches.push(patch);
          return Promise.resolve({ ...fuenteFile, name: "Backup nuevo" });
        },
      }),
      fuente: fuenteFile,
    }),
  );
  try {
    await click(boton(pagina.container, "Editar"));
    const form = buscar<HTMLFormElement>(pagina.container, "[data-form-editar]");
    assertEquals(form.querySelector("input[placeholder='*/5 * * * *']"), null, "file no debe mostrar CronInput");
    assertEquals(form.querySelector("input[type=checkbox]"), null, "file no debe mostrar checkbox");

    await escribirEn(buscar<HTMLInputElement>(form, "input[placeholder='Nombre']"), "Backup nuevo");
    await enviarForm(form);
    assertEquals(patches, [{ name: "Backup nuevo" }], "el patch de file solo debía llevar name");
    assertEquals(pagina.container.querySelector("[data-form-editar]"), null, "el form no se cerró tras guardar");
  } finally {
    await pagina.desmontar();
  }
});

// ---------------------------------------------------------------------------
// AC-21.5
// ---------------------------------------------------------------------------

Deno.test("AC-21.5: el alta URL envía cronEnabled: true y file no lo envía (enmienda AC-8.4/AC-13.2)", async () => {
  const payloads: CrearFuenteInput[] = [];
  const api = apiStub({
    listSources: () => Promise.resolve([]),
    createSource: (input) => {
      payloads.push(input);
      return Promise.resolve({
        id: `n-${payloads.length}`,
        name: input.name,
        type: input.type ?? "url",
        url: input.url ?? "",
        headers: {},
        cronExpr: input.cronExpr ?? null,
        cronEnabled: input.cronEnabled ?? false,
        createdAt: "2026-09-27T12:00:00.000Z",
      });
    },
  });
  const pagina = await montar(createElement(FuentesPage, { api }));
  try {
    const form = buscar<HTMLFormElement>(pagina.container, "form");
    const nombre = buscar<HTMLInputElement>(form, "input[placeholder='Nombre']");
    const url = buscar<HTMLInputElement>(form, "input[placeholder='https://...']");
    const cron = buscar<HTMLInputElement>(form, `input[placeholder='*/5 * * * *']`);

    await escribirEn(nombre, "MB");
    await escribirEn(url, "https://x.test/a.json");
    await escribirEn(cron, "*/5 * * * *");
    await enviarForm(form);
    assertEquals(payloads[0], {
      name: "MB",
      type: "url",
      url: "https://x.test/a.json",
      cronExpr: "*/5 * * * *",
      cronEnabled: true,
    }, "el alta con cron debía enviar cronEnabled: true");

    await escribirEn(nombre, "MB sin cron");
    await escribirEn(url, "https://x.test/b.json");
    await enviarForm(form);
    assertEquals(payloads[1], {
      name: "MB sin cron",
      type: "url",
      url: "https://x.test/b.json",
      cronEnabled: true,
    }, "el alta sin cron también debía enviar cronEnabled: true (frecuencia del maestro)");

    await escribirEn(buscar<HTMLSelectElement>(form, "select"), "file");
    await escribirEn(nombre, "Backup");
    await enviarForm(form);
    assertEquals(payloads[2], { name: "Backup", type: "file" }, "el alta file debía ir sin cronEnabled");
    assertEquals("cronEnabled" in payloads[2], false, "el alta file no debe llevar cronEnabled");
  } finally {
    await pagina.desmontar();
  }
});
