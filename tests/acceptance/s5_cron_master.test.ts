import { assert, assertEquals } from "@std/assert";
import { createSource, getLatestTimestamp, getSnapshot, getStats } from "../../server/kv.ts";
import { matchesCron, cronTick, registerMasterCron } from "../../server/cron.ts";
import type { FetchLike } from "../../server/snapshot.ts";
import { fixtureText, mutarHorario, VALID_URL } from "../support.ts";

function localDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

async function withKv(fn: (kv: Deno.Kv) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "s5-" });
  const kv = await Deno.openKv(`${dir}/kv.db`);
  try {
    await fn(kv);
  } finally {
    kv.close();
    await Deno.remove(dir, { recursive: true });
  }
}

function fetchContador(llamadas: string[], porUrl: Record<string, FetchLike>): FetchLike {
  return (input) => {
    const url = String(input);
    llamadas.push(url);
    const impl = porUrl[url];
    if (impl) return impl(input);
    return Promise.resolve(new Response(fixtureText, { status: 200 }));
  };
}

// ---------------------------------------------------------------------------
// AC-5.1
// ---------------------------------------------------------------------------

Deno.test("AC-5.1: el pase solo fetchéa fuentes con cronEnabled", async () => {
  await withKv(async (kv) => {
    const habilitada = await createSource(kv, { name: "Habilitada", url: `${VALID_URL}?a`, cronEnabled: true });
    const deshabilitada = await createSource(kv, { name: "Deshabilitada", url: `${VALID_URL}?b` });
    assertEquals([deshabilitada.cronEnabled, habilitada.cronEnabled], [false, true]);

    const llamadas: string[] = [];
    const result = await cronTick(kv, { fetchImpl: fetchContador(llamadas, {}), now: localDate(2026, 9, 26, 14, 0) });

    assertEquals(result.ok, [habilitada.id]);
    assertEquals(result.skipped, [deshabilitada.id]);
    assertEquals(result.failures, []);
    assertEquals(llamadas, [habilitada.url], "solo la fuente habilitada debe invocarse");
    assert((await getLatestTimestamp(kv, habilitada.id)) !== null);
    assertEquals(await getLatestTimestamp(kv, deshabilitada.id), null, "la deshabilitada no captura");
  });
});

// ---------------------------------------------------------------------------
// AC-5.2
// ---------------------------------------------------------------------------

Deno.test("AC-5.2: los snapshots del pase quedan con trigger cron", async () => {
  await withKv(async (kv) => {
    const source = await createSource(kv, { name: "Auto", url: `${VALID_URL}?auto`, cronEnabled: true });
    const now = localDate(2026, 9, 26, 14, 0);
    const fetchDe = (texto: string): FetchLike => () =>
      Promise.resolve(new Response(texto, { status: 200 }));

    const mutadoText = JSON.stringify(mutarHorario(JSON.parse(fixtureText)));

    const r1 = await cronTick(kv, { fetchImpl: fetchDe(fixtureText), now });
    const t1 = (await getLatestTimestamp(kv, source.id))!;
    const r2 = await cronTick(kv, { fetchImpl: fetchDe(fixtureText), now });
    const t2 = (await getLatestTimestamp(kv, source.id))!;
    const r3 = await cronTick(kv, { fetchImpl: fetchDe(mutadoText), now });
    const t3 = (await getLatestTimestamp(kv, source.id))!;

    assertEquals([r1.ok, r2.ok, r3.ok], [[source.id], [source.id], [source.id]]);
    assertEquals([r1.failures, r2.failures, r3.failures], [[], [], []]);
    assert(t1 < t2 && t2 < t3, "los timestamps crecen sin colisionar");

    const s1 = await getSnapshot(kv, source.id, t1);
    assert(s1);
    assertEquals([s1.trigger, s1.changed], ["cron", true], "primer pase: base con trigger cron");

    const s2 = await getSnapshot(kv, source.id, t2);
    assert(s2);
    assertEquals([s2.trigger, s2.changed], ["cron", false], "contenido idéntico → unchanged con trigger cron");

    const s3 = await getSnapshot(kv, source.id, t3);
    assert(s3);
    assertEquals([s3.trigger, s3.changed], ["cron", true], "contenido mutado → changed");

    const stats = await getStats(kv, source.id);
    assertEquals(stats.totalSnapshots, 3);
    assertEquals(stats.lastChangedAt, t3);
    assertEquals(stats.errorCount, 0);
  });
});

// ---------------------------------------------------------------------------
// AC-5.3
// ---------------------------------------------------------------------------

Deno.test("AC-5.3: un fallo o cronExpr inválido no abortan el pase", async () => {
  await withKv(async (kv) => {
    const sana = await createSource(kv, { name: "Sana", url: `${VALID_URL}?ok`, cronEnabled: true });
    const rota = await createSource(kv, { name: "Rota", url: `${VALID_URL}?500`, cronEnabled: true });
    const invalida = await createSource(kv, {
      name: "Cron inválido",
      url: `${VALID_URL}?cron`,
      cronEnabled: true,
      cronExpr: "no-es-cron",
    });

    const porUrl: Record<string, FetchLike> = {
      [rota.url]: () => Promise.resolve(new Response("boom", { status: 500 })),
    };
    const llamadas: string[] = [];
    const result = await cronTick(kv, {
      fetchImpl: fetchContador(llamadas, porUrl),
      now: localDate(2026, 9, 26, 14, 0),
    });

    assertEquals(result.ok, [sana.id], "la fuente sana se procesó pese a las demás");
    assertEquals(result.failures.map((f) => f.sourceId).sort(), [rota.id, invalida.id].sort());

    const falloRota = result.failures.find((f) => f.sourceId === rota.id);
    assert(falloRota && falloRota.error.includes("HTTP 500"), `error: ${falloRota?.error}`);
    const falloCron = result.failures.find((f) => f.sourceId === invalida.id);
    assert(falloCron && falloCron.error.includes("cron inválido"), `error: ${falloCron?.error}`);

    assertEquals((await getStats(kv, rota.id)).errorCount, 1);
    assertEquals(await getLatestTimestamp(kv, invalida.id), null);
    assert((await getLatestTimestamp(kv, sana.id)) !== null);
    assertEquals(llamadas.sort(), [sana.url, rota.url].sort(), "la inválida no llega al fetch");
  });
});

// ---------------------------------------------------------------------------
// AC-5.4
// ---------------------------------------------------------------------------

Deno.test("AC-5.4: matchesCron evalúa la ventana del minuto", () => {
  const cada15 = "*/15 * * * *";
  assertEquals(matchesCron(cada15, localDate(2026, 9, 26, 14, 0)), true);
  assertEquals(matchesCron(cada15, localDate(2026, 9, 26, 14, 15)), true);
  assertEquals(matchesCron(cada15, localDate(2026, 9, 26, 14, 30)), true);
  assertEquals(matchesCron(cada15, localDate(2026, 9, 26, 14, 45)), true);
  assertEquals(matchesCron(cada15, localDate(2026, 9, 26, 14, 7)), false);

  assertEquals(matchesCron("0 3 * * *", localDate(2026, 9, 26, 3, 0)), true);
  assertEquals(matchesCron("0 3 * * *", localDate(2026, 9, 26, 3, 1)), false);

  assertEquals(matchesCron("* * * * *", localDate(2026, 9, 26, 14, 7)), true);
  assertEquals(matchesCron("* * * * *", localDate(2026, 1, 1, 0, 0)), true);
});

// ---------------------------------------------------------------------------
// AC-5.5
// ---------------------------------------------------------------------------

Deno.test("AC-5.5: el cronExpr decide qué fuentes se procesan en cada tick", async () => {
  await withKv(async (kv) => {
    const cada15 = await createSource(kv, {
      name: "Cada 15",
      url: `${VALID_URL}?c15`,
      cronEnabled: true,
      cronExpr: "*/15 * * * *",
    });
    const siempre = await createSource(kv, { name: "Siempre", url: `${VALID_URL}?siem`, cronEnabled: true });

    const fueraDeVentana = await cronTick(kv, {
      fetchImpl: fetchContador([], {}),
      now: localDate(2026, 9, 26, 14, 7),
    });
    assertEquals(fueraDeVentana.ok, [siempre.id]);
    assertEquals(fueraDeVentana.skipped, [cada15.id]);
    assertEquals(await getLatestTimestamp(kv, cada15.id), null);
    assert((await getLatestTimestamp(kv, siempre.id)) !== null);

    const enVentana = await cronTick(kv, {
      fetchImpl: fetchContador([], {}),
      now: localDate(2026, 9, 26, 14, 15),
    });
    assertEquals(enVentana.ok.sort(), [cada15.id, siempre.id].sort());
    const ts = await getLatestTimestamp(kv, cada15.id);
    assert(ts !== null, "dentro de la ventana debe capturar");
    const snapshot = await getSnapshot(kv, cada15.id, ts);
    assert(snapshot);
    assertEquals(snapshot.trigger, "cron");
  });
});

// ---------------------------------------------------------------------------
// AC-5.6
// ---------------------------------------------------------------------------

Deno.test("AC-5.6: main.ts registra el cron maestro con guard en Deno.cron", async () => {
  const cronSource = await Deno.readTextFile(new URL("../../server/cron.ts", import.meta.url));
  assert(cronSource.includes("export function registerMasterCron"));
  assert(cronSource.includes('"scheduler"'), "nombre del cron maestro");
  assert(cronSource.includes('"* * * * *"'), "cadencia fija cada minuto");
  assert(cronSource.includes("cronTick"), "el handler delega en cronTick");
  assert(
    /typeof denoCron !== "function"/.test(cronSource),
    "guard defensivo: solo registra si el runtime expone Deno.cron",
  );

  const mainSource = await Deno.readTextFile(new URL("../../server/main.ts", import.meta.url));
  assert(mainSource.includes("registerMasterCron("), "start() debe registrar el cron maestro");
  assert(typeof registerMasterCron === "function", "export accesible");
});
