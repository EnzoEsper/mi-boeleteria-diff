import { assert, assertEquals, assertRejects } from "@std/assert";
import type { FetchLike } from "../../server/snapshot.ts";
import type { Fuente } from "../../web/src/api.ts";
import { createApi } from "../../web/src/api.ts";
import { apiStub, boton, buscar, click, createElement, montar } from "../support_ui.ts";
import { fixtureText, respuesta, withApp } from "../support.ts";

const { SourceCard } = await import("../../web/src/SourceCard.tsx");
const { FuentesPage } = await import("../../web/src/FuentesPage.tsx");
const { ApiError } = await import("../../web/src/api.ts");

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

async function contar(kv: Deno.Kv, prefix: Deno.KvKey): Promise<number> {
  let n = 0;
  for await (const _ of kv.list({ prefix })) n++;
  return n;
}

// Deno 2.6.7: kv.list({prefix}) excluye la clave igual al prefijo → las claves
// exactas (source/latest/stats) se verifican con kv.get, no con list.
async function existe(kv: Deno.Kv, key: Deno.KvKey): Promise<boolean> {
  return (await kv.get(key)).value !== null;
}

// ---------------------------------------------------------------------------
// AC-20.1
// ---------------------------------------------------------------------------

Deno.test("AC-20.1: DELETE borra la fuente y todos sus datos de KV", async () => {
  await withApp(
    async ({ app, kv, source }) => {
      const creando = await app.fetch(
        new Request("http://localhost/api/sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Otra", url: "https://example.com/x.json" }),
        }),
      );
      const otra = await creando.json() as { id: string };

      const captura = await app.fetch(
        new Request(`http://localhost/api/sources/${source.id}/fetch`, { method: "POST" }),
      );
      assertEquals(captura.status, 200, "el fetch con fixture stub debía crear el primer snapshot");

      const exactas: Deno.KvKey[] = [
        ["source", source.id],
        ["latest", source.id],
        ["stats", source.id],
      ];
      const conHijos: Deno.KvKey[] = [["snapshot", source.id], ["blob", source.id]];
      for (const key of exactas) {
        assert(await existe(kv, key), `faltaba ${JSON.stringify(key)} antes del DELETE`);
      }
      for (const prefijo of conHijos) {
        assert((await contar(kv, prefijo)) > 0, `faltaban datos bajo ${JSON.stringify(prefijo)} antes del DELETE`);
      }

      const borrado = await app.fetch(new Request(`http://localhost/api/sources/${source.id}`, { method: "DELETE" }));
      assertEquals(borrado.status, 200, "DELETE debía responder 200");
      assertEquals(await borrado.json(), { deleted: source.id }, "falta el body { deleted }");

      for (const key of exactas) {
        assertEquals(await existe(kv, key), false, `quedó huérfana ${JSON.stringify(key)}`);
      }
      for (const prefijo of conHijos) {
        assertEquals(
          await contar(kv, prefijo),
          0,
          `quedaron datos huérfanos bajo ${JSON.stringify(prefijo)}`,
        );
      }
      assertEquals((await app.fetch(new Request(`http://localhost/api/sources/${source.id}`))).status, 404, "GET tras DELETE debía 404");
      assertEquals((await app.fetch(new Request(`http://localhost/api/sources/${source.id}/snapshots`))).status, 404, "snapshots tras DELETE debía 404");
      const lista = await (await app.fetch(new Request("http://localhost/api/sources"))).json() as { id: string }[];
      assertEquals(lista.map((f) => f.id), [otra.id], "solo debía quedar la otra fuente");
    },
    { fetchImpl: respuesta(fixtureText) },
  );
});

// ---------------------------------------------------------------------------
// AC-20.2
// ---------------------------------------------------------------------------

Deno.test("AC-20.2: DELETE de un id inexistente responde 404 sin tocar nada", async () => {
  await withApp(async ({ app, kv, source }) => {
    const res = await app.fetch(new Request("http://localhost/api/sources/no-existe", { method: "DELETE" }));
    assertEquals(res.status, 404, "debía responder 404");
    assertEquals(await res.json(), { error: "fuente no encontrada" }, "falta el mensaje 404");
    assert(await existe(kv, ["source", source.id]), "el DELETE no debía tocar la fuente existente");
    const lista = await (await app.fetch(new Request("http://localhost/api/sources"))).json() as { id: string }[];
    assertEquals(lista.map((f) => f.id), [source.id], "el listado cambió");
  });
});

// ---------------------------------------------------------------------------
// AC-20.3
// ---------------------------------------------------------------------------

Deno.test("AC-20.3: deleteSource emite DELETE y normaliza errores", async () => {
  const llamadas: { url: string; method?: string }[] = [];
  const respuestas: { status: number; body: unknown }[] = [{ status: 200, body: { deleted: "abc" } }];
  const fetchImpl: FetchLike = (input, init) => {
    llamadas.push({ url: String(input), method: init?.method });
    const siguiente = respuestas.shift() ?? { status: 200, body: {} };
    return Promise.resolve(
      new Response(JSON.stringify(siguiente.body), {
        status: siguiente.status,
        headers: { "content-type": "application/json" },
      }),
    );
  };

  const api = createApi(fetchImpl);
  assertEquals(await api.deleteSource("abc"), { deleted: "abc" }, "no devolvió el body parseado");
  assertEquals(llamadas[0], { url: "/api/sources/abc", method: "DELETE" }, "no emitió DELETE a la ruta relativa");

  respuestas.push({ status: 404, body: { error: "fuente no encontrada" } });
  const error = await assertRejects(() => api.deleteSource("nope"), ApiError, "fuente no encontrada");
  assertEquals(error.status, 404, "el 4xx no se normalizó en ApiError");
});

// ---------------------------------------------------------------------------
// AC-20.4
// ---------------------------------------------------------------------------

Deno.test("AC-20.4: Borrar confirma, llama deleteSource y notifica onBorrada", async () => {
  const originalConfirm = globalThis.window.confirm;
  globalThis.window.confirm = () => true;
  try {
    const borradas: string[] = [];
    const notificadas: string[] = [];
    const pagina = await montar(
      createElement(SourceCard, {
        api: apiStub({
          deleteSource: (id: string) => {
            borradas.push(id);
            return Promise.resolve({ deleted: id });
          },
        }),
        fuente: FUENTE,
        onBorrada: (id: string) => notificadas.push(id),
      }),
    );

    await click(boton(pagina.container, "Borrar"));
    assertEquals(borradas, [FUENTE.id], "no se llamó a deleteSource");
    assertEquals(notificadas, [FUENTE.id], "no se notificó onBorrada");
    await pagina.desmontar();
  } finally {
    globalThis.window.confirm = originalConfirm;
  }
});

Deno.test("AC-20.4: cancelar el confirm no borra nada", async () => {
  const originalConfirm = globalThis.window.confirm;
  globalThis.window.confirm = () => false;
  try {
    let llamado = false;
    const pagina = await montar(
      createElement(SourceCard, {
        api: apiStub({ deleteSource: () => { llamado = true; return Promise.resolve({ deleted: "x" }); } }),
        fuente: FUENTE,
        onBorrada: () => {
          llamado = true;
        },
      }),
    );

    await click(boton(pagina.container, "Borrar"));
    assertEquals(llamado, false, "cancelar no debía ni borrar ni notificar");
    await pagina.desmontar();
  } finally {
    globalThis.window.confirm = originalConfirm;
  }
});

Deno.test("AC-20.4: un ApiError del DELETE queda visible y la fila sigue entera", async () => {
  const originalConfirm = globalThis.window.confirm;
  globalThis.window.confirm = () => true;
  try {
    const pagina = await montar(
      createElement(SourceCard, {
        api: apiStub({ deleteSource: () => Promise.reject(new ApiError(500, "KV reventó")) }),
        fuente: FUENTE,
      }),
    );

    await click(boton(pagina.container, "Borrar"));
    const error = buscar(pagina.container, "li .error");
    assertEquals(error.textContent, "KV reventó", "el error del DELETE no se mostró");
    assert(pagina.container.textContent?.includes("Horarios MB"), "la fila se rompió tras el error");
    await pagina.desmontar();
  } finally {
    globalThis.window.confirm = originalConfirm;
  }
});

Deno.test("AC-20.4: FuentesPage quita la fila tras onBorrada", async () => {
  const originalConfirm = globalThis.window.confirm;
  globalThis.window.confirm = () => true;
  try {
    const borradasPagina: string[] = [];
    const pagina = await montar(
      createElement(FuentesPage, {
        api: apiStub({
          listSources: () => Promise.resolve([FUENTE]),
          deleteSource: (id: string) => {
            borradasPagina.push(id);
            return Promise.resolve({ deleted: id });
          },
        }),
      }),
    );

    assert(pagina.container.querySelector('li[data-tipo="url"]'), "la fila no estaba en la lista");
    await click(boton(pagina.container, "Borrar"));
    assertEquals(borradasPagina, [FUENTE.id], "no se llamó a deleteSource desde la página");
    assertEquals(pagina.container.querySelector("li"), null, "la fila no desapareció de la lista");
    await pagina.desmontar();
  } finally {
    globalThis.window.confirm = originalConfirm;
  }
});
