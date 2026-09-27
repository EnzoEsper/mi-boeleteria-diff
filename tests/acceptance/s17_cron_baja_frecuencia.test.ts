import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  createSource,
  getLatestTimestamp,
  getStats,
  masterTickKey,
} from "../../server/kv.ts";
import {
  cronTick,
  MASTER_CRON_DEFAULT,
  masterCronExpr,
  registerMasterCron,
} from "../../server/cron.ts";
import {
  fetchAndStore,
  fetchTimeoutMs,
  type FetchLike,
} from "../../server/snapshot.ts";
import { fixtureText, VALID_URL } from "../support.ts";

function localDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

async function withKv(fn: (kv: Deno.Kv) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "s17-" });
  const kv = await Deno.openKv(`${dir}/kv.db`);
  try {
    await fn(kv);
  } finally {
    kv.close();
    await Deno.remove(dir, { recursive: true });
  }
}

function fetchContador(llamadas: string[]): FetchLike {
  return (input) => {
    llamadas.push(String(input));
    return Promise.resolve(new Response(fixtureText, { status: 200 }));
  };
}

// ---------------------------------------------------------------------------
// AC-17.1
// ---------------------------------------------------------------------------

Deno.test("AC-17.1: masterCronExpr devuelve el default, la env válida o cae al default", () => {
  try {
    Deno.env.delete("MASTER_CRON");
    assertEquals(MASTER_CRON_DEFAULT, "0 9,21 * * *");
    assertEquals(masterCronExpr(), MASTER_CRON_DEFAULT, "sin env → default");

    Deno.env.set("MASTER_CRON", "*/10 * * * *");
    assertEquals(masterCronExpr(), "*/10 * * * *", "env válida → se usa");

    Deno.env.set("MASTER_CRON", "no-es-cron");
    assertEquals(masterCronExpr(), MASTER_CRON_DEFAULT, "env inválida → fallback");

    Deno.env.set("MASTER_CRON", "   ");
    assertEquals(masterCronExpr(), MASTER_CRON_DEFAULT, "env en blanco → default");
  } finally {
    Deno.env.delete("MASTER_CRON");
  }
});

Deno.test("AC-17.1: el maestro local y el de EA registran con masterCronExpr", async () => {
  const cronSource = await Deno.readTextFile(new URL("../../server/cron.ts", import.meta.url));
  assert(cronSource.includes("MASTER_CRON_DEFAULT"), "constante del default");
  assert(cronSource.includes("masterCronExpr()"), "registerMasterCron usa masterCronExpr()");

  const mainSource = await Deno.readTextFile(new URL("../../server/main.ts", import.meta.url));
  assert(mainSource.includes('"scheduler-deploy"'), "nombre del cron de EA");
  assert(mainSource.includes("masterCronExpr()"), "el registro de módulo de EA usa masterCronExpr()");
  assert(typeof registerMasterCron === "function", "export accesible");
});

// ---------------------------------------------------------------------------
// AC-17.2
// ---------------------------------------------------------------------------

Deno.test("AC-17.2: cronTick evalúa por ventana desde el último tick y lo persiste", async () => {
  await withKv(async (kv) => {
    const fuente = await createSource(kv, {
      name: "Cada 15",
      url: `${VALID_URL}?v17`,
      cronEnabled: true,
      cronExpr: "*/15 * * * *",
    });
    const llamadas: string[] = [];

    // Primer tick sin ["masterTick"]: ventana default de 24h → catch-up de la ocurrencia 14:00.
    const r1 = await cronTick(kv, {
      fetchImpl: fetchContador(llamadas),
      now: localDate(2026, 9, 26, 14, 7),
    });
    assertEquals(r1.ok, [fuente.id], "catch-up: 14:00 cae en la ventana de 24h");
    const t1 = await kv.get<number>(masterTickKey());
    assertEquals(t1.value, localDate(2026, 9, 26, 14, 7).getTime(), "masterTick = 14:07");

    // (14:07, 14:11] no contiene ocurrencias → skip.
    const r2 = await cronTick(kv, {
      fetchImpl: fetchContador(llamadas),
      now: localDate(2026, 9, 26, 14, 11),
    });
    assertEquals(r2.ok, []);
    assertEquals(r2.skipped, [fuente.id]);

    // (14:07, 14:15] contiene 14:15 → dispara y masterTick pasa a 14:15.
    const r3 = await cronTick(kv, {
      fetchImpl: fetchContador(llamadas),
      now: localDate(2026, 9, 26, 14, 15),
    });
    assertEquals(r3.ok, [fuente.id]);
    const t3 = await kv.get<number>(masterTickKey());
    assertEquals(t3.value, localDate(2026, 9, 26, 14, 15).getTime(), "masterTick = 14:15");

    // (14:15, 14:16] sin ocurrencias → no hay doble capture.
    const r4 = await cronTick(kv, {
      fetchImpl: fetchContador(llamadas),
      now: localDate(2026, 9, 26, 14, 16),
    });
    assertEquals(r4.ok, []);
    assertEquals(llamadas.length, 2, "solo dos fetch: catch-up y 14:15");
  });
});

Deno.test("AC-17.2: sin masterTick la ventana default es 24h y la ocurrencia anterior no dispara", async () => {
  await withKv(async (kv) => {
    const dentroDe24h = await createSource(kv, {
      name: "Ayer 04:00",
      url: `${VALID_URL}?d24a`,
      cronEnabled: true,
      cronExpr: "0 4 25 9 *",
    });
    const fueraDe24h = await createSource(kv, {
      name: "Antes de 24h",
      url: `${VALID_URL}?d24b`,
      cronEnabled: true,
      cronExpr: "0 4 25 9 *",
    });

    // Sin masterTick, ahora = 26-sep 03:00 → ventana (25-sep 03:00, 26-sep 03:00]:
    // la ocurrencia 25-sep 04:00 está dentro → dispara.
    const r1 = await cronTick(kv, {
      fetchImpl: fetchContador([]),
      now: localDate(2026, 9, 26, 3, 0),
    });
    assertEquals(r1.ok.sort(), [dentroDe24h.id, fueraDe24h.id].sort());

    // Borro el masterTick y evalúo a las 05:00 → ventana (25-sep 05:00, 26-sep 05:00]:
    // la única ocurrencia (25-sep 04:00) quedó fuera → skip.
    await kv.delete(masterTickKey());
    const r2 = await cronTick(kv, {
      fetchImpl: fetchContador([]),
      now: localDate(2026, 9, 26, 5, 0),
    });
    assertEquals(r2.ok, []);
    assertEquals(r2.skipped.sort(), [dentroDe24h.id, fueraDe24h.id].sort());
  });
});

Deno.test("AC-17.2: con masterTick a las 04:01 la ocurrencia de las 04:00 no vuelve a disparar", async () => {
  await withKv(async (kv) => {
    const fuente = await createSource(kv, {
      name: "Diaria",
      url: `${VALID_URL}?d04`,
      cronEnabled: true,
      cronExpr: "0 4 * * *",
    });
    await kv.set(masterTickKey(), localDate(2026, 9, 26, 4, 1).getTime());

    const r = await cronTick(kv, {
      fetchImpl: fetchContador([]),
      now: localDate(2026, 9, 26, 5, 0),
    });
    assertEquals(r.ok, []);
    assertEquals(r.skipped, [fuente.id]);
    assertEquals(await getLatestTimestamp(kv, fuente.id), null);
  });
});

// ---------------------------------------------------------------------------
// AC-17.3
// ---------------------------------------------------------------------------

Deno.test("AC-17.3: fetchAndStore envía AbortSignal.timeout con FETCH_TIMEOUT_MS", async () => {
  await withKv(async (kv) => {
    const fuente = await createSource(kv, { name: "Timeout", url: `${VALID_URL}?to` });
    let init: RequestInit | undefined;
    const captura: FetchLike = (_input, ini) => {
      init = ini;
      return Promise.resolve(new Response(fixtureText, { status: 200 }));
    };
    try {
      Deno.env.delete("FETCH_TIMEOUT_MS");
      assertEquals(fetchTimeoutMs(), 15_000, "default 15000");
      await fetchAndStore(kv, fuente, "manual", captura);
      assert(init?.signal instanceof AbortSignal, "el fetch debe llevar signal");

      Deno.env.set("FETCH_TIMEOUT_MS", "5000");
      assertEquals(fetchTimeoutMs(), 5000, "env numérica → se usa");

      Deno.env.set("FETCH_TIMEOUT_MS", "banana");
      assertEquals(fetchTimeoutMs(), 15_000, "env no numérica → default");

      Deno.env.set("FETCH_TIMEOUT_MS", "0");
      assertEquals(fetchTimeoutMs(), 15_000, "≤ 0 → default");
    } finally {
      Deno.env.delete("FETCH_TIMEOUT_MS");
    }
  });
});

Deno.test("AC-17.3: un fetch colgado aborta, registra el error y no crea snapshot", async () => {
  await withKv(async (kv) => {
    const fuente = await createSource(kv, { name: "Colgado", url: `${VALID_URL}?hang` });
    const colgado: FetchLike = (_input, ini) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = ini?.signal;
        if (!signal) {
          reject(new Error("el fetch no recibió signal"));
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    try {
      Deno.env.set("FETCH_TIMEOUT_MS", "50");
      await assertRejects(
        () => fetchAndStore(kv, fuente, "manual", colgado),
        Error,
        "fetch falló",
      );
    } finally {
      Deno.env.delete("FETCH_TIMEOUT_MS");
    }
    assertEquals(await getLatestTimestamp(kv, fuente.id), null, "sin snapshot");
    assertEquals((await getStats(kv, fuente.id)).errorCount, 1, "error registrado en stats");
  });
});

// ---------------------------------------------------------------------------
// AC-17.4
// ---------------------------------------------------------------------------

Deno.test("AC-17.4: README documenta MASTER_CRON, FETCH_TIMEOUT_MS y la semántica", async () => {
  const readme = await Deno.readTextFile(new URL("../../README.md", import.meta.url));
  assert(readme.includes("MASTER_CRON"), "documenta MASTER_CRON");
  assert(readme.includes("deno deploy env add MASTER_CRON"), "documenta cómo cambiarla en Deploy");
  assert(readme.includes("0 9,21 * * *"), "documenta el default");
  assert(readme.includes("FETCH_TIMEOUT_MS"), "documenta FETCH_TIMEOUT_MS");
  assert(/ventana/i.test(readme), "documenta la semántica de ventana");
});
