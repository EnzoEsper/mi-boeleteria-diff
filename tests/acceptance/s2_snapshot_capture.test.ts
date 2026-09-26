import { assert, assertEquals } from "@std/assert";
import {
  blobChunkKey,
  createSource,
  getBlob,
  getLatestTimestamp,
  getSnapshot,
  getStats,
  putBlob,
} from "../../server/kv.ts";
import { readSnapshotJson, rebuildJson, type FetchLike } from "../../server/snapshot.ts";
import { createApp } from "../../server/router.ts";
import { hashJson } from "../../server/diff.ts";
import {
  fetchSnapshot,
  fixtureText,
  HEX64_RE,
  mutarHorario,
  respuesta,
  revertirOrden,
  secuencial,
  VALID_URL,
  withApp,
} from "../support.ts";

// ---------------------------------------------------------------------------
// AC-2.1
// ---------------------------------------------------------------------------

Deno.test("AC-2.1: fetch manual crea el primer snapshot con trigger manual", async () => {
  await withApp(async ({ app, kv, source }) => {
    const { status, body } = await fetchSnapshot(app, source.id);
    assertEquals(status, 200);
    assertEquals(body.sourceId, source.id);

    const snap = body.snapshot;
    assertEquals(
      Object.keys(snap).sort(),
      ["changed", "chunks", "hash", "sizeBytes", "timestamp", "trigger"].sort(),
    );
    assert(Number.isInteger(snap.timestamp) && snap.timestamp > 0);
    assert(HEX64_RE.test(snap.hash), `hash inválido: ${snap.hash}`);
    assertEquals(snap.sizeBytes, new TextEncoder().encode(fixtureText).length);
    assertEquals(snap.changed, true, "el primer snapshot debe ser changed: true");
    assertEquals(snap.trigger, "manual");

    const persistido = await getSnapshot(kv, source.id, snap.timestamp);
    assert(persistido, "snapshot no persistido en ['snapshot', id, timestamp]");
    assertEquals(persistido.changed, true);
    assert((persistido.chunks ?? 0) >= 1, "falta chunks en el registro");
    assertEquals(await readSnapshotJson(kv, source.id, persistido), JSON.parse(fixtureText));
  }, { fetchImpl: respuesta(fixtureText) });
});

// ---------------------------------------------------------------------------
// AC-2.2
// ---------------------------------------------------------------------------

Deno.test("AC-2.2: hashJson ignora orden de claves y whitespace", async () => {
  assertEquals(await hashJson({ a: 1, b: { c: 2, d: [1, 2] } }), await hashJson({ b: { d: [1, 2], c: 2 }, a: 1 }));
  assertEquals(await hashJson(JSON.parse('{ "z": 1, "a": { "y": 2, "b": 3 } }')), await hashJson({ a: { b: 3, y: 2 }, z: 1 }));
  assert((await hashJson([1, 2])) !== (await hashJson([2, 1])), "el orden de arrays debe importar");
});

Deno.test("AC-2.2: mismo contenido serializado distinto → changed:false y sin full", async () => {
  const data = JSON.parse(fixtureText);
  const reordenado = JSON.stringify(revertirOrden(data));
  assert(reordenado !== fixtureText, "las serializaciones deberían diferir");

  await withApp(async ({ app, kv, source }) => {
    const primero = (await fetchSnapshot(app, source.id)).body.snapshot;
    const segundo = (await fetchSnapshot(app, source.id)).body.snapshot;

    assertEquals(segundo.changed, false);
    assertEquals(segundo.hash, primero.hash, "el hash canónico debe coincidir");
    assert(segundo.sizeBytes !== primero.sizeBytes, "sizeBytes debía reflejar la serialización recibida");

    const persistido = await getSnapshot(kv, source.id, segundo.timestamp);
    assert(persistido);
    assertEquals(persistido.chunks, undefined, "changed:false no debe persistir chunks");
    assertEquals(await readSnapshotJson(kv, source.id, persistido), null, "no debe haber blob");
    const blobKeys: string[] = [];
    for await (const entry of kv.list({ prefix: ["blob", source.id, segundo.timestamp] })) {
      blobKeys.push(entry.key.join("/"));
    }
    assertEquals(blobKeys, [], "changed:false no debe escribir chunks de blob");
    assertEquals(await getLatestTimestamp(kv, source.id), segundo.timestamp);
  }, { fetchImpl: secuencial(fixtureText, reordenado) });
});

// ---------------------------------------------------------------------------
// AC-2.3
// ---------------------------------------------------------------------------

Deno.test("AC-2.3: contenido mutado → changed:true con contenido nuevo recuperable", async () => {
  const mutado = JSON.stringify(mutarHorario(JSON.parse(fixtureText)));

  await withApp(async ({ app, kv, source }) => {
    const primero = (await fetchSnapshot(app, source.id)).body.snapshot;
    const segundo = (await fetchSnapshot(app, source.id)).body.snapshot;

    assertEquals(segundo.changed, true);
    assert(segundo.hash !== primero.hash, "hash debía cambiar");

    const persistido = await getSnapshot(kv, source.id, segundo.timestamp);
    assert(persistido, "el snapshot mutado no está persistido");
    assertEquals(await rebuildJson(kv, source.id, persistido.timestamp), JSON.parse(mutado));
    assertEquals(await getLatestTimestamp(kv, source.id), segundo.timestamp);

    const anterior = await getSnapshot(kv, source.id, primero.timestamp);
    assert(anterior, "el snapshot anterior desapareció");
    assertEquals(
      await rebuildJson(kv, source.id, anterior.timestamp),
      JSON.parse(fixtureText),
      "el contenido anterior quedó intacto",
    );
  }, { fetchImpl: secuencial(fixtureText, mutado) });
});

// ---------------------------------------------------------------------------
// AC-2.4
// ---------------------------------------------------------------------------

Deno.test("AC-2.4: fallos de fetch responden 502, no persisten y registran en stats", async () => {
  const dir = await Deno.makeTempDir({ prefix: "s2-err-" });
  const kv = await Deno.openKv(`${dir}/kv.db`);
  try {
    const source = await createSource(kv, { name: "Rota", url: "https://ejemplo.invalid/horarios.json" });

    const escenarios: { fetchImpl: FetchLike; esperado: RegExp }[] = [
      { fetchImpl: respuesta("<html>500 Internal Server Error</html>"), esperado: /JSON/i },
      { fetchImpl: respuesta("ok", 500), esperado: /HTTP 500/ },
      {
        fetchImpl: () => Promise.reject(new TypeError("connection refused")),
        esperado: /connection refused/,
      },
    ];

    for (const escenario of escenarios) {
      const app = createApp(kv, { fetchImpl: escenario.fetchImpl });
      const { status, body } = await fetchSnapshot(app, source.id);
      assertEquals(status, 502);
      assert(typeof body.error === "string" && body.error.length > 0, "falta error");
      assert(escenario.esperado.test(body.error), `error "${body.error}" no matchea ${escenario.esperado}`);
    }

    assertEquals(await getLatestTimestamp(kv, source.id), null, "latest no debe actualizarse en errores");
    const keys: string[] = [];
    for await (const entry of kv.list({ prefix: ["snapshot", source.id] })) keys.push(entry.key.join("/"));
    assertEquals(keys, [], "no debe haber snapshots persistidos tras errores");

    const stats = await getStats(kv, source.id);
    assertEquals(stats.errorCount, 3);
    assertEquals(stats.totalSnapshots, 0);
    assert(stats.lastError && stats.lastError.message.length > 0);
    assert(Number.isInteger(stats.lastError.at));
  } finally {
    kv.close();
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// AC-2.5
// ---------------------------------------------------------------------------

Deno.test("AC-2.5: fuente inexistente → 404 sin invocar el fetch", async () => {
  let invocaciones = 0;
  const fetchImpl: FetchLike = () => {
    invocaciones++;
    return Promise.resolve(new Response(fixtureText, { status: 200 }));
  };
  const dir = await Deno.makeTempDir({ prefix: "s2-404-" });
  const kv = await Deno.openKv(`${dir}/kv.db`);
  try {
    const app = createApp(kv, { fetchImpl });
    const { status, body } = await fetchSnapshot(app, "00000000-0000-4000-8000-000000000000");
    assertEquals(status, 404);
    assert(typeof body.error === "string");
    assertEquals(invocaciones, 0, "no debe hacer fetch de una fuente inexistente");
  } finally {
    kv.close();
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// AC-2.6
// ---------------------------------------------------------------------------

Deno.test("AC-2.6: latest y stats reflejan la secuencia de fetches", async () => {
  const data = JSON.parse(fixtureText);
  const reordenado = JSON.stringify(revertirOrden(data));
  const mutado = JSON.stringify(mutarHorario(data));

  await withApp(async ({ app, kv, source }) => {
    const s1 = (await fetchSnapshot(app, source.id)).body.snapshot;
    const s2 = (await fetchSnapshot(app, source.id)).body.snapshot;
    const s3 = (await fetchSnapshot(app, source.id)).body.snapshot;

    assertEquals([s1.changed, s2.changed, s3.changed], [true, false, true]);
    assertEquals(await getLatestTimestamp(kv, source.id), s3.timestamp);

    const stats = await getStats(kv, source.id);
    assertEquals(stats.totalSnapshots, 3);
    assertEquals(stats.lastChangedAt, s3.timestamp, "lastChangedAt debe ser el último changed");
    assertEquals(stats.errorCount, 0);
    assertEquals(stats.lastError, null);
  }, { fetchImpl: secuencial(fixtureText, reordenado, mutado) });
});

// ---------------------------------------------------------------------------
// AC-2.8
// ---------------------------------------------------------------------------

Deno.test("AC-2.8: blob chunkeado respeta el límite de 64 KiB de Deno KV", async () => {
  const dir = await Deno.makeTempDir({ prefix: "s2-blob-" });
  const kv = await Deno.openKv(`${dir}/kv.db`);
  try {
    const chunks = await putBlob(kv, "fuente", 123, fixtureText);
    assert(chunks >= 4, `198 KB debía partirse en ≥ 4 chunks, dio ${chunks}`);

    for (let index = 0; index < chunks; index++) {
      const entry = await kv.get<Uint8Array>(blobChunkKey("fuente", 123, index));
      assert(entry.value, `falta el chunk ${index}`);
      assert(entry.value.length <= 65_536, `chunk ${index} excede 64 KiB: ${entry.value.length}`);
    }

    assertEquals(await getBlob(kv, "fuente", 123, chunks), fixtureText, "roundtrip byte a byte");
    assertEquals(await getBlob(kv, "fuente", 123, chunks + 1), null, "chunk faltante debe devolver null");
  } finally {
    kv.close();
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// AC-2.7
// ---------------------------------------------------------------------------

Deno.test({
  name: "AC-2.7: humo contra el endpoint real (SMOKE=1)",
  ignore: !Deno.env.get("SMOKE"),
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "s2-smoke-" });
    const kv = await Deno.openKv(`${dir}/kv.db`);
    try {
      const source = await createSource(kv, { name: "Humo", url: VALID_URL });
      const app = createApp(kv);
      const { status, body } = await fetchSnapshot(app, source.id);
      assertEquals(status, 200);
      assert(HEX64_RE.test(body.snapshot.hash));
      assert(body.snapshot.sizeBytes > 100_000, `sizeBytes sospechoso: ${body.snapshot.sizeBytes}`);
      assertEquals(typeof body.snapshot.changed, "boolean");
    } finally {
      kv.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
