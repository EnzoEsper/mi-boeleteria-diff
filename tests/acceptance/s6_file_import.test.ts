import { assert, assertEquals } from "@std/assert";
import { createSource, getLatestTimestamp, getSnapshot } from "../../server/kv.ts";
import { cronTick } from "../../server/cron.ts";
import { applyPatch } from "../../server/diff.ts";
import { rebuildJson } from "../../server/snapshot.ts";
import { fixtureText, mutarHorario, type Fetcher, withApp } from "../support.ts";

const mutadoText = JSON.stringify(mutarHorario(JSON.parse(fixtureText)));

async function crear(app: Fetcher, payload: unknown) {
  const res = await app.fetch(
    new Request("http://localhost/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  return { status: res.status, body: await res.json() };
}

async function importar(app: Fetcher, sourceId: string, contenido: string | null) {
  const form = new FormData();
  if (contenido !== null) {
    form.append("file", new Blob([contenido], { type: "application/json" }), "horarios.json");
  }
  const res = await app.fetch(
    new Request(`http://localhost/api/sources/${sourceId}/import`, { method: "POST", body: form }),
  );
  return { status: res.status, body: await res.json() };
}

async function get(app: Fetcher, path: string) {
  const res = await app.fetch(new Request(`http://localhost${path}`));
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// AC-6.1
// ---------------------------------------------------------------------------

Deno.test("AC-6.1: POST /api/sources acepta type file sin url", async () => {
  await withApp(async ({ app, source }) => {
    const { status, body } = await crear(app, { name: "Archivo", type: "file" });
    assertEquals(status, 201);
    assertEquals(
      Object.keys(body).sort(),
      ["createdAt", "cronEnabled", "cronExpr", "headers", "id", "name", "type", "url"].sort(),
      "mismo contrato de 8 campos que las fuentes url",
    );
    assertEquals(body.type, "file");
    assertEquals(body.url, "");
    assertEquals([body.cronEnabled, body.cronExpr], [false, null]);

    const leida = await get(app, `/api/sources/${body.id}`);
    assertEquals(leida.status, 200);
    assertEquals(leida.body, body, "el GET por id devuelve la fuente file igual");

    const listada = await get(app, "/api/sources");
    assertEquals(
      listada.body.map((s: { id: string }) => s.id).sort(),
      [source.id, body.id].sort(),
      "el listado incluye la fuente url previa y la file recién creada",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-6.2
// ---------------------------------------------------------------------------

Deno.test("AC-6.2: validación del schema con type y regresión del contrato url", async () => {
  await withApp(async ({ app }) => {
    const invalidos: { body: unknown; path: string }[] = [
      { body: { name: "x", type: "zap" }, path: "type" },
      { body: { name: "x" }, path: "url" },
      { body: { name: "x", url: "ftp://host/h.txt" }, path: "url" },
      { body: { name: "   ", type: "file" }, path: "name" },
      { body: { name: "x", type: "file", cronEnabled: "si" }, path: "cronEnabled" },
    ];

    for (const { body: payload, path } of invalidos) {
      const { status, body } = await crear(app, payload);
      assertEquals(status, 400, `esperaba 400 para ${JSON.stringify(payload)}`);
      assertEquals(body.issues[0].path, path, `path incorrecto para ${JSON.stringify(payload)}`);
      assert(typeof body.issues[0].message === "string");
    }

    const valido = await crear(app, { name: "Sin url", type: "file" });
    assertEquals(valido.status, 201, "type file no requiere url");
  });
});

// ---------------------------------------------------------------------------
// AC-6.3
// ---------------------------------------------------------------------------

Deno.test("AC-6.3: import multipart crea snapshot trigger import reconstruible", async () => {
  await withApp(async ({ app, kv }) => {
    const source = (await crear(app, { name: "Para importar", type: "file" })).body;

    const { status, body } = await importar(app, source.id, fixtureText);
    assertEquals(status, 200);
    assertEquals(body.sourceId, source.id);
    assertEquals(body.snapshot.trigger, "import");
    assertEquals(body.snapshot.changed, true);

    const timestamp = body.snapshot.timestamp as number;
    const persistido = await getSnapshot(kv, source.id, timestamp);
    assert(persistido, "el snapshot importado no está persistido");
    assertEquals(persistido.trigger, "import");
    assertEquals(
      await rebuildJson(kv, source.id, timestamp),
      JSON.parse(fixtureText),
      "rebuild devuelve exactamente el contenido subido",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-6.4
// ---------------------------------------------------------------------------

Deno.test("AC-6.4: rechazos del import (sin archivo, JSON inválido, tipo url, 404)", async () => {
  await withApp(async ({ app, kv, source: sourceUrl }) => {
    const sourceFile = (await crear(app, { name: "File", type: "file" })).body;

    const sinArchivo = await importar(app, sourceFile.id, null);
    assertEquals(sinArchivo.status, 400);
    assertEquals(sinArchivo.body.issues[0].path, "file");

    const noJson = await importar(app, sourceFile.id, "<html>no soy json</html>");
    assertEquals(noJson.status, 400);
    assertEquals(noJson.body.issues[0].path, "file");
    assert(typeof noJson.body.issues[0].message === "string");

    const enUrl = await importar(app, sourceUrl.id, fixtureText);
    assertEquals(enUrl.status, 400);
    assert(typeof enUrl.body.error === "string" && enUrl.body.error.length > 0);
    assertEquals(
      await getLatestTimestamp(kv, sourceUrl.id),
      null,
      "importar en una fuente url no debe crear snapshots",
    );

    const inexistente = await importar(app, "00000000-0000-4000-8000-000000000000", fixtureText);
    assertEquals(inexistente.status, 404);
    assert(typeof inexistente.body.error === "string");

    assertEquals(await getLatestTimestamp(kv, sourceFile.id), null, "ningún rechazo debe ingestar");
  });
});

// ---------------------------------------------------------------------------
// AC-6.5
// ---------------------------------------------------------------------------

Deno.test("AC-6.5: re-import genera historial con changed y diff entre imports", async () => {
  await withApp(async ({ app }) => {
    const source = (await crear(app, { name: "Historial", type: "file" })).body;

    const r1 = await importar(app, source.id, fixtureText);
    const r2 = await importar(app, source.id, fixtureText);
    const r3 = await importar(app, source.id, mutadoText);

    assertEquals([r1.body.snapshot.changed, r2.body.snapshot.changed, r3.body.snapshot.changed], [
      true,
      false,
      true,
    ]);

    const list = await get(app, `/api/sources/${source.id}/snapshots`);
    assertEquals(list.status, 200);
    assertEquals(list.body.snapshots.length, 3);
    assertEquals(
      list.body.snapshots.map((s: { trigger: string }) => s.trigger),
      ["import", "import", "import"],
    );

    const t1 = r1.body.snapshot.timestamp as number;
    const t3 = r3.body.snapshot.timestamp as number;
    const diff = await get(app, `/api/sources/${source.id}/diff?from=${t1}&to=${t3}`);
    assertEquals(diff.status, 200);
    assertEquals(diff.body.changed, true);
    assertEquals(
      applyPatch(structuredClone(JSON.parse(fixtureText)), diff.body.delta),
      JSON.parse(mutadoText),
      "el diff entre imports reproduce el cambio",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-6.6
// ---------------------------------------------------------------------------

Deno.test("AC-6.6: cronTick saltea fuentes file aunque cronEnabled", async () => {
  const dir = await Deno.makeTempDir({ prefix: "s6-cron-" });
  const kv = await Deno.openKv(`${dir}/kv.db`);
  try {
    const fileSource = await createSource(kv, { name: "File auto", type: "file", cronEnabled: true });
    assertEquals(fileSource.type, "file");

    const llamadas: string[] = [];
    const result = await cronTick(kv, {
      fetchImpl: (input) => {
        llamadas.push(String(input));
        return Promise.resolve(new Response(fixtureText, { status: 200 }));
      },
      now: new Date(2026, 8, 26, 14, 0),
    });

    assertEquals(result.skipped, [fileSource.id]);
    assertEquals(result.ok, []);
    assertEquals(result.failures, []);
    assertEquals(llamadas, [], "una fuente file nunca debe invocar el fetch de URL");
    assertEquals(await getLatestTimestamp(kv, fileSource.id), null);
  } finally {
    kv.close();
    await Deno.remove(dir, { recursive: true });
  }
});
