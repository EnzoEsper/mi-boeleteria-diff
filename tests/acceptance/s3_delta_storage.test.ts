import { assert, assertEquals } from "@std/assert";
import { getSnapshot, type Snapshot } from "../../server/kv.ts";
import { applyPatch, diffJson } from "../../server/diff.ts";
import { rebuildJson } from "../../server/snapshot.ts";
import {
  fetchSnapshot,
  fixtureText,
  mutarTiempo,
  revertirOrden,
  secuencial,
  withApp,
} from "../support.ts";

const base = JSON.parse(fixtureText) as unknown;
const conHora = (hora: string) => JSON.stringify(mutarTiempo(JSON.parse(fixtureText), hora));

async function leerRegistro(kv: Deno.Kv, sourceId: string, timestamp: number): Promise<Snapshot> {
  const snapshot = await getSnapshot(kv, sourceId, timestamp);
  assert(snapshot, `snapshot ${timestamp} no persistido`);
  return snapshot;
}

// ---------------------------------------------------------------------------
// AC-3.1
// ---------------------------------------------------------------------------

Deno.test("AC-3.1: base y delta persistidos con deltaFrom al contenido anterior", async () => {
  const mutado = JSON.parse(conHora("23:59")) as unknown;

  await withApp(async ({ app, kv, source }) => {
    const t1 = (await fetchSnapshot(app, source.id)).body.snapshot.timestamp as number;
    const t2 = (await fetchSnapshot(app, source.id)).body.snapshot.timestamp as number;

    const r1 = await leerRegistro(kv, source.id, t1);
    const r2 = await leerRegistro(kv, source.id, t2);

    assert(r1.chunks !== undefined, "el primer changed debe ser base con chunks");
    assertEquals(r1.delta, undefined, "la base no lleva delta");
    assertEquals(r1.sinceBase, 0);

    assert(r2.delta !== undefined, "el segundo changed debe guardar delta");
    assertEquals(r2.deltaFrom, t1, "deltaFrom debe apuntar al snapshot anterior");
    assertEquals(r2.chunks, undefined, "el delta no debe guardar blob");
    assertEquals(r2.sinceBase, 1);

    assertEquals(applyPatch(structuredClone(base), r2.delta), mutado, "patch(delta) no reproduce el contenido");
    assertEquals(await rebuildJson(kv, source.id, t2), mutado, "rebuild del snapshot con delta");
    assertEquals(await rebuildJson(kv, source.id, t1), base, "rebuild de la base");
  }, { fetchImpl: secuencial(fixtureText, conHora("23:59")) });
});

// ---------------------------------------------------------------------------
// AC-3.2
// ---------------------------------------------------------------------------

Deno.test("AC-3.2: objectHash produce moves (no add/remove) en arrays", async () => {
  const delta = diffJson([{ id: "1" }, { id: "2" }, { id: "3" }], [{ id: "3" }, { id: "1" }, { id: "2" }]);
  assertEquals(delta, { _t: "a", _2: ["", 0, 3] }, "delta de reordenamiento puro");

  const data = JSON.parse(fixtureText) as [{ cinemas: unknown[] }];
  data[0].cinemas.reverse();
  const reordenado = JSON.stringify(data);
  assert(reordenado !== fixtureText, "la inversión de cinemas debía cambiar la serialización");

  await withApp(async ({ app, kv, source }) => {
    const t1 = (await fetchSnapshot(app, source.id)).body.snapshot.timestamp as number;
    const t2 = (await fetchSnapshot(app, source.id)).body.snapshot.timestamp as number;

    const r2 = await leerRegistro(kv, source.id, t2);
    assert(r2.delta !== undefined, "el reordenamiento debe producir delta");
    assert(
      JSON.stringify(r2.delta).includes('"_t":"a"'),
      "el delta debe usar diff de arrays con objectHash (flag _t)",
    );
    assertEquals(await rebuildJson(kv, source.id, t2), data, "rebuild debe devolver los cinemas invertidos");
    assertEquals(await rebuildJson(kv, source.id, t1), base);
  }, { fetchImpl: secuencial(fixtureText, reordenado) });
});

// ---------------------------------------------------------------------------
// AC-3.3
// ---------------------------------------------------------------------------

Deno.test("AC-3.3: fullEvery controla cada cuántos changed vuelve a haber base", async () => {
  const contenidos = [fixtureText, conHora("23:59"), conHora("22:00"), conHora("21:00")];

  await withApp(async ({ app, kv, source }) => {
    const timestamps: number[] = [];
    for (let i = 0; i < 4; i++) {
      timestamps.push((await fetchSnapshot(app, source.id)).body.snapshot.timestamp as number);
    }
    const registros: Snapshot[] = [];
    for (const timestamp of timestamps) registros.push(await leerRegistro(kv, source.id, timestamp));

    assert(registros[0].chunks !== undefined, "1° changed = base");
    assertEquals(registros[0].sinceBase, 0);

    assert(registros[1].delta !== undefined, "2° changed = delta");
    assertEquals(registros[1].sinceBase, 1);

    assert(registros[2].delta !== undefined, "3° changed = delta");
    assertEquals(registros[2].sinceBase, 2);

    assert(registros[3].chunks !== undefined, "4° changed = base (fullEvery=3)");
    assertEquals(registros[3].delta, undefined);
    assertEquals(registros[3].sinceBase, 0);

    assertEquals(
      await rebuildJson(kv, source.id, timestamps[3]),
      JSON.parse(contenidos[3]),
      "la nueva base reconstruye su contenido",
    );
  }, { fetchImpl: secuencial(...contenidos), fullEvery: 3 });
});

// ---------------------------------------------------------------------------
// AC-3.4
// ---------------------------------------------------------------------------

Deno.test("AC-3.4: delta que excede el límite de value cae a base", async () => {
  const data = JSON.parse(fixtureText) as [{ cinemas: [{ shows: unknown[] }] }];
  for (let i = 0; i < 3000; i++) {
    data[0].cinemas[0].shows.push({
      title: `Fake ${i}`,
      id: `fake-${i}`,
      dates: [{ dateTxt: "2026-10-01", times: [{ time: "20:00", id: `fake-t-${i}` }] }],
    });
  }
  const gigante = JSON.stringify(data);
  assert(gigante.length > 300_000, `payload gigante sospechoso: ${gigante.length}`);

  await withApp(async ({ app, kv, source }) => {
    const t1 = (await fetchSnapshot(app, source.id)).body.snapshot.timestamp as number;
    const t2 = (await fetchSnapshot(app, source.id)).body.snapshot.timestamp as number;

    const r2 = await leerRegistro(kv, source.id, t2);
    assert(r2.chunks !== undefined, "el delta gigante debe caer a base con chunks");
    assertEquals(r2.delta, undefined, "no debe persistir un delta que no cabe en 64 KiB");
    assertEquals(r2.sinceBase, 0);

    const recordBytes = new TextEncoder().encode(JSON.stringify(r2)).length;
    assert(recordBytes <= 65_536, `registro excede 64 KiB: ${recordBytes}`);

    assertEquals(await rebuildJson(kv, source.id, t2), data);
    assertEquals(await rebuildJson(kv, source.id, t1), base);
  }, { fetchImpl: secuencial(fixtureText, gigante) });
});

// ---------------------------------------------------------------------------
// AC-3.5
// ---------------------------------------------------------------------------

Deno.test("AC-3.5: el unchanged en el medio se salta en contentAt y deltaFrom", async () => {
  const reordenado = JSON.stringify(revertirOrden(JSON.parse(fixtureText)));
  const mutado = JSON.parse(conHora("23:59")) as unknown;

  await withApp(async ({ app, kv, source }) => {
    const t1 = (await fetchSnapshot(app, source.id)).body.snapshot.timestamp as number;
    const t2 = (await fetchSnapshot(app, source.id)).body.snapshot.timestamp as number;
    const t3 = (await fetchSnapshot(app, source.id)).body.snapshot.timestamp as number;

    const r2 = await leerRegistro(kv, source.id, t2);
    const r3 = await leerRegistro(kv, source.id, t3);

    assertEquals(r2.changed, false);
    assertEquals(r2.contentAt, t1, "contentAt debe replicar el snapshot con contenido");
    assertEquals(r2.delta, undefined);
    assertEquals(r2.chunks, undefined);

    assert(r3.delta !== undefined, "el tercer changed debe guardar delta");
    assertEquals(r3.deltaFrom, t1, "deltaFrom debe saltar el unchanged");

    assertEquals(await rebuildJson(kv, source.id, t2), base, "rebuild del unchanged replica su contenido");
    assertEquals(await rebuildJson(kv, source.id, t3), mutado);
  }, { fetchImpl: secuencial(fixtureText, reordenado, conHora("23:59")) });
});

// ---------------------------------------------------------------------------
// AC-3.6
// ---------------------------------------------------------------------------

Deno.test("AC-3.6: rebuildJson reconstruye exactamente cada snapshot de la secuencia", async () => {
  const mutA = conHora("23:59");
  const mutB = conHora("22:00");
  const mutC = conHora("21:00");
  const unchangedDeA = JSON.stringify(revertirOrden(JSON.parse(mutA)));
  const contenidos = [fixtureText, mutA, unchangedDeA, mutB, mutC];
  const esperados: unknown[] = [base, JSON.parse(mutA), JSON.parse(mutA), JSON.parse(mutB), JSON.parse(mutC)];

  await withApp(async ({ app, kv, source }) => {
    const timestamps: number[] = [];
    for (let i = 0; i < 5; i++) {
      timestamps.push((await fetchSnapshot(app, source.id)).body.snapshot.timestamp as number);
    }

    for (let i = 0; i < timestamps.length; i++) {
      assertEquals(
        await rebuildJson(kv, source.id, timestamps[i]),
        esperados[i],
        `el snapshot #${i + 1} (${timestamps[i]}) reconstruye distinto`,
      );
    }

    const registros: Snapshot[] = [];
    for (const timestamp of timestamps) registros.push(await leerRegistro(kv, source.id, timestamp));
    assertEquals(
      [
        registros[0].chunks !== undefined,
        registros[1].delta !== undefined,
        registros[2].changed,
        registros[3].chunks !== undefined,
        registros[4].delta !== undefined,
      ],
      [true, true, false, true, true],
      "patrón esperado con fullEvery=2: base, delta, unchanged, base, delta",
    );
  }, { fetchImpl: secuencial(...contenidos), fullEvery: 2 });
});
