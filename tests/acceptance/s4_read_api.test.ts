import { assert, assertEquals } from "@std/assert";
import { applyPatch } from "../../server/diff.ts";
import {
  fetchSnapshot,
  fixtureText,
  mutarHorario,
  revertirOrden,
  secuencial,
  type Fetcher,
  withApp,
} from "../support.ts";

const base = JSON.parse(fixtureText);
const mutadoText = JSON.stringify(mutarHorario(base));
const mutado = JSON.parse(mutadoText);
const unchangedText = JSON.stringify(revertirOrden(mutado));

async function get(app: Fetcher, path: string) {
  const res = await app.fetch(new Request(`http://localhost${path}`));
  return { status: res.status, body: await res.json() };
}

async function secuencia(app: Fetcher, sourceId: string, ...textos: string[]): Promise<number[]> {
  const timestamps: number[] = [];
  for (const _texto of textos) {
    const { status, body } = await fetchSnapshot(app, sourceId);
    assertEquals(status, 200);
    assert(body.snapshot.hash.length === 64);
    assertEquals(typeof body.snapshot.timestamp, "number");
    timestamps.push(body.snapshot.timestamp);
  }
  return timestamps;
}

// ---------------------------------------------------------------------------
// AC-4.1
// ---------------------------------------------------------------------------

Deno.test("AC-4.1: listado de snapshots ordenado con flags de almacenamiento", async () => {
  await withApp(async ({ app, source }) => {
    const [t1, t2, t3] = await secuencia(app, source.id, fixtureText, mutadoText, unchangedText);

    const { status, body } = await get(app, `/api/sources/${source.id}/snapshots`);
    assertEquals(status, 200);
    assertEquals(body.sourceId, source.id);
    assertEquals(body.snapshots.length, 3);
    assertEquals(
      body.snapshots.map((s: { timestamp: number }) => s.timestamp),
      [t3, t2, t1],
      "orden descendente por timestamp",
    );
    for (const entry of body.snapshots) {
      assert(typeof entry.hash === "string");
      assert(typeof entry.sizeBytes === "number");
      assert(typeof entry.changed === "boolean");
      assert(typeof entry.trigger === "string");
      assert(typeof entry.hasBlob === "boolean");
      assert(typeof entry.hasDelta === "boolean");
      assert(entry.sinceBase === null || typeof entry.sinceBase === "number");
      assert(entry.deltaFrom === null || typeof entry.deltaFrom === "number");
    }

    const { status: st404, body: b404 } = await get(
      app,
      "/api/sources/00000000-0000-4000-8000-000000000000/snapshots",
    );
    assertEquals(st404, 404);
    assert(typeof b404.error === "string");
  }, { fetchImpl: secuencial(fixtureText, mutadoText, unchangedText) });
});

// ---------------------------------------------------------------------------
// AC-4.2
// ---------------------------------------------------------------------------

Deno.test("AC-4.2: snapshot reconstruido devuelve el JSON exacto (base y delta)", async () => {
  await withApp(async ({ app, source }) => {
    const [t1, t2] = await secuencia(app, source.id, fixtureText, mutadoText);

    const primero = await get(app, `/api/sources/${source.id}/snapshots/${t1}`);
    assertEquals(primero.status, 200);
    assertEquals(primero.body.sourceId, source.id);
    assertEquals(primero.body.snapshot.timestamp, t1);
    assertEquals(primero.body.json, base, "rebuild de la base");

    const segundo = await get(app, `/api/sources/${source.id}/snapshots/${t2}`);
    assertEquals(segundo.status, 200);
    assertEquals(segundo.body.json, mutado, "rebuild del delta");

    const sinSnapshot = await get(app, `/api/sources/${source.id}/snapshots/1`);
    assertEquals(sinSnapshot.status, 404);
    assert(typeof sinSnapshot.body.error === "string");

    const sinFuente = await get(app, "/api/sources/00000000-0000-4000-8000-000000000000/snapshots/1");
    assertEquals(sinFuente.status, 404);
    assert(typeof sinFuente.body.error === "string");
  }, { fetchImpl: secuencial(fixtureText, mutadoText) });
});

// ---------------------------------------------------------------------------
// AC-4.3
// ---------------------------------------------------------------------------

Deno.test("AC-4.3: diff entre snapshots reproduzca el cambio de contenido", async () => {
  await withApp(async ({ app, source }) => {
    const [t1, t2, t3] = await secuencia(app, source.id, fixtureText, mutadoText, unchangedText);

    const diff = await get(app, `/api/sources/${source.id}/diff?from=${t1}&to=${t2}`);
    assertEquals(diff.status, 200);
    assertEquals(diff.body.changed, true);
    assert(diff.body.delta !== null, "delta no puede ser null si changed");
    assertEquals(
      applyPatch(structuredClone(base), diff.body.delta),
      mutado,
      "applyPatch(jsonFrom, delta) debe reproducir jsonTo",
    );

    const igualContenido = await get(app, `/api/sources/${source.id}/diff?from=${t2}&to=${t3}`);
    assertEquals(igualContenido.status, 200);
    assertEquals([igualContenido.body.changed, igualContenido.body.delta], [false, null]);

    const mismoSnapshot = await get(app, `/api/sources/${source.id}/diff?from=${t1}&to=${t1}`);
    assertEquals([mismoSnapshot.body.changed, mismoSnapshot.body.delta], [false, null]);

    const inexistente = await get(app, `/api/sources/${source.id}/diff?from=${t1}&to=1`);
    assertEquals(inexistente.status, 404);
    assert(typeof inexistente.body.error === "string");
  }, { fetchImpl: secuencial(fixtureText, mutadoText, unchangedText) });
});

// ---------------------------------------------------------------------------
// AC-4.4
// ---------------------------------------------------------------------------

Deno.test("AC-4.4: diff con params inválidos → 400 con issues y sin fetch", async () => {
  let invocaciones = 0;
  await withApp(async ({ app, source }) => {
    const casos = [
      `/api/sources/${source.id}/diff`,
      `/api/sources/${source.id}/diff?from=123`,
      `/api/sources/${source.id}/diff?from=abc&to=5`,
    ];
    for (const path of casos) {
      const { status, body } = await get(app, path);
      assertEquals(status, 400, `esperaba 400 en ${path}`);
      assert(typeof body.error === "string" && body.error.length > 0);
      assert(Array.isArray(body.issues), "el contrato 400 incluye issues");
    }
    assertEquals(invocaciones, 0, "la lectura nunca debe invocar el fetch");
  }, {
    fetchImpl: () => {
      invocaciones++;
      return Promise.resolve(new Response(fixtureText, { status: 200 }));
    },
  });
});

// ---------------------------------------------------------------------------
// AC-4.5
// ---------------------------------------------------------------------------

Deno.test("AC-4.5: el listado refleja el patrón de almacenamiento [base, delta, unchanged]", async () => {
  await withApp(async ({ app, source }) => {
    const [t1, t2, t3] = await secuencia(app, source.id, fixtureText, mutadoText, unchangedText);

    const { status, body } = await get(app, `/api/sources/${source.id}/snapshots`);
    assertEquals(status, 200);
    const [nuevo, medio, viejo] = body.snapshots;

    assertEquals([viejo.timestamp, viejo.hasBlob, viejo.hasDelta, viejo.sinceBase, viejo.deltaFrom], [
      t1,
      true,
      false,
      0,
      null,
    ]);

    assertEquals([medio.timestamp, medio.hasBlob, medio.hasDelta, medio.sinceBase, medio.deltaFrom], [
      t2,
      false,
      true,
      1,
      t1,
    ]);

    assertEquals([nuevo.timestamp, nuevo.changed, nuevo.hasBlob, nuevo.hasDelta, nuevo.sinceBase, nuevo.deltaFrom], [
      t3,
      false,
      false,
      false,
      null,
      null,
    ]);
  }, { fetchImpl: secuencial(fixtureText, mutadoText, unchangedText) });
});
