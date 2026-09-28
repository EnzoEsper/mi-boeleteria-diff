import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { getStats, saveStats, type SourceStats } from "../../server/kv.ts";
import type { FetchLike } from "../../server/snapshot.ts";
import type { Fuente, StatsFuente } from "../../web/src/api.ts";
import { createApi } from "../../web/src/api.ts";
import { apiStub, boton, buscar, click, createElement, montar } from "../support_ui.ts";
import { fetchSnapshot, fixtureText, type Fetcher, withApp } from "../support.ts";

const { SourceCard } = await import("../../web/src/SourceCard.tsx");
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

// 2023-11-14 22:13:20 UTC = 2023-11-14 19:13:20 Buenos Aires (fixture S22)
const TS_BA = Date.UTC(2023, 10, 14, 22, 13, 20);

async function statsDe(app: Fetcher, id: string): Promise<StatsFuente> {
  const res = await app.fetch(new Request(`http://localhost/api/sources/${id}/stats`));
  assertEquals(res.status, 200, `stats respondió ${res.status}`);
  return await res.json() as StatsFuente;
}

// ---------------------------------------------------------------------------
// AC-24.1
// ---------------------------------------------------------------------------

Deno.test("AC-24.1: GET stats refleja éxito y fallo de captura, y 404 para id desconocido", async () => {
  let llamada = 0;
  const fetchImpl: FetchLike = () => {
    llamada += 1;
    const ok = llamada === 1;
    return Promise.resolve(
      new Response(ok ? fixtureText : "boom", {
        status: ok ? 200 : 500,
        headers: { "content-type": "text/plain" },
      }),
    );
  };

  await withApp(async ({ app, source }) => {
    const noExiste = await app.fetch(new Request("http://localhost/api/sources/nope/stats"));
    assertEquals(noExiste.status, 404, "id desconocido debía 404");
    assertEquals(await noExiste.json(), { error: "fuente no encontrada" });

    const inicial = await statsDe(app, source.id);
    assertEquals(inicial.totalSnapshots, 0);
    assertEquals([inicial.errorCount, inicial.lastError, inicial.lastAttempt], [0, null, null]);

    const okRes = await fetchSnapshot(app, source.id);
    assertEquals(okRes.status, 200, "el primer fetch de prueba debía salir bien");
    const trasOk = await statsDe(app, source.id);
    assertEquals(trasOk.totalSnapshots, 1, "la captura exitosa no contó el snapshot");
    assertEquals(typeof trasOk.lastChangedAt, "number", "lastChangedAt debía ser numérico");
    assertEquals([trasOk.errorCount, trasOk.lastError], [0, null]);
    assertEquals(trasOk.lastAttempt?.ok, true, "el intento exitoso debía marcarse ok");
    assertEquals(typeof trasOk.lastAttempt?.at, "number");

    const falloRes = await fetchSnapshot(app, source.id);
    assertEquals(falloRes.status, 502, "el fetch con 500 debía fallar con 502");
    const trasFallo = await statsDe(app, source.id);
    assertEquals(trasFallo.errorCount, 1);
    assertStringIncludes(trasFallo.lastError?.message ?? "", "HTTP 500");
    assertEquals(typeof trasFallo.lastError?.at, "number");
    assertEquals(trasFallo.lastAttempt?.ok, false, "el último intento debía quedar como fallido");
    assertEquals(trasFallo.totalSnapshots, 1, "el fallo no debía contar snapshot");
  }, { fetchImpl });
});

// ---------------------------------------------------------------------------
// AC-24.2
// ---------------------------------------------------------------------------

Deno.test("AC-24.2: lastAttempt se escribe en JSON inválido y al éxito; entradas viejas normalizan a null", async () => {
  let llamada = 0;
  const fetchImpl: FetchLike = () => {
    llamada += 1;
    const texto = llamada === 1 ? "no-es-json" : fixtureText;
    return Promise.resolve(new Response(texto, { status: 200, headers: { "content-type": "text/plain" } }));
  };

  await withApp(async ({ app, source }) => {
    const invalido = await fetchSnapshot(app, source.id);
    assertEquals(invalido.status, 502, "el JSON inválido debía fallar con 502");
    const trasInvalido = await statsDe(app, source.id);
    assertEquals(trasInvalido.lastAttempt?.ok, false, "JSON inválido debía marcar intento fallido");
    assertStringIncludes(trasInvalido.lastError?.message ?? "", "JSON válido");
    assertEquals(trasInvalido.errorCount, 1);

    const valido = await fetchSnapshot(app, source.id);
    assertEquals(valido.status, 200);
    const trasValido = await statsDe(app, source.id);
    assertEquals(trasValido.lastAttempt?.ok, true, "un éxito posterior debía reemplazar el intento");
    assertEquals(trasValido.errorCount, 1, "errorCount es acumulativo");
    assertStringIncludes(trasValido.lastError?.message ?? "", "JSON válido", "lastError no se limpia con éxitos");
  }, { fetchImpl });
});

Deno.test("AC-24.2: getStats normaliza entradas viejas de KV sin lastAttempt", async () => {
  await withApp(async ({ kv, source }) => {
    const vieja = {
      totalSnapshots: 5,
      lastChangedAt: 111,
      errorCount: 2,
      lastError: { message: "viejo error", at: 222 },
    } as unknown as SourceStats;
    await saveStats(kv, source.id, vieja);

    const stats = await getStats(kv, source.id);
    assertEquals(stats.lastAttempt, null, "la entrada vieja debía normalizarse a null");
    assertEquals([stats.totalSnapshots, stats.lastChangedAt, stats.errorCount], [5, 111, 2]);
    assertEquals(stats.lastError, { message: "viejo error", at: 222 });
  });
});

// ---------------------------------------------------------------------------
// AC-24.3
// ---------------------------------------------------------------------------

Deno.test("AC-24.3: getStats emite GET a la ruta relativa y normaliza errores", async () => {
  const llamadas: { url: string; init?: RequestInit }[] = [];
  const respuestas: { status: number; body: unknown }[] = [
    {
      status: 200,
      body: { totalSnapshots: 3, lastChangedAt: 9, errorCount: 1, lastError: null, lastAttempt: { at: 7, ok: true } },
    },
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
  const stats = await api.getStats("abc");
  assertEquals(stats.totalSnapshots, 3, "no devolvió las stats parseadas");
  assertEquals(stats.lastAttempt, { at: 7, ok: true });
  assertEquals(llamadas[0].url, "/api/sources/abc/stats", "no emitió GET a la ruta relativa");
  assertEquals(llamadas[0].init?.method, undefined, "el GET no debe llevar method");

  const error = await assertRejects(() => api.getStats("nope"), ApiError, "fuente no encontrada");
  assertEquals(error.status, 404, "el 4xx no se normalizó en ApiError");

  const apiRota = createApi(() => Promise.reject(new TypeError("network down")));
  await assertRejects(() => apiRota.getStats("abc"), TypeError, "network down");
});

// ---------------------------------------------------------------------------
// AC-24.4
// ---------------------------------------------------------------------------

Deno.test("AC-24.4: badge ok muestra la fecha de Buenos Aires", async () => {
  const pagina = await montar(
    createElement(SourceCard, {
      api: apiStub({
        getStats: () =>
          Promise.resolve({
            totalSnapshots: 3,
            lastChangedAt: TS_BA,
            errorCount: 0,
            lastError: null,
            lastAttempt: { at: TS_BA, ok: true },
          }),
      }),
      fuente: FUENTE,
    }),
  );
  try {
    const badge = buscar<HTMLSpanElement>(pagina.container, '[data-stats="ok"]');
    assert(badge.classList.contains("stats"), "el badge ok debía usar la clase .stats");
    assert(badge.textContent?.includes("última:"), `texto inesperado: ${badge.textContent}`);
    assert(badge.textContent?.includes("2023-11-14 19:13:20"), "la fecha debía formatearse en Buenos Aires");
    assertEquals(pagina.container.querySelector('[data-stats="error"]'), null);
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-24.4: badge error muestra mensaje, fecha y contador de errores", async () => {
  const pagina = await montar(
    createElement(SourceCard, {
      api: apiStub({
        getStats: () =>
          Promise.resolve({
            totalSnapshots: 4,
            lastChangedAt: 1,
            errorCount: 2,
            lastError: { message: "HTTP 500 al fetchear https://x.test/a.json", at: TS_BA },
            lastAttempt: { at: TS_BA, ok: false },
          }),
      }),
      fuente: FUENTE,
    }),
  );
  try {
    const badge = buscar(pagina.container, '[data-stats="error"]');
    assert(badge.classList.contains("error"), "el badge de error debía usar la clase .error");
    const texto = badge.textContent ?? "";
    for (const parte of ["falló", "HTTP 500 al fetchear", "×2", "2023-11-14 19:13:20"]) {
      assert(texto.includes(parte), `el badge error no contenía "${parte}": ${texto}`);
    }
    assertEquals(pagina.container.querySelector('[data-stats="ok"]'), null);
  } finally {
    await pagina.desmontar();
  }
});

Deno.test("AC-24.4: sin intentos no hay badge y si getStats falla la fila queda intacta", async () => {
  const sinIntentos = await montar(
    createElement(SourceCard, {
      api: apiStub({
        getStats: () =>
          Promise.resolve({
            totalSnapshots: 0,
            lastChangedAt: null,
            errorCount: 0,
            lastError: null,
            lastAttempt: null,
          }),
      }),
      fuente: FUENTE,
    }),
  );
  try {
    assertEquals(sinIntentos.container.querySelector("[data-stats]"), null, "lastAttempt null no debía pintar badge");
  } finally {
    await sinIntentos.desmontar();
  }

  const rota = await montar(
    createElement(SourceCard, {
      api: apiStub({ getStats: () => Promise.reject(new ApiError(500, "KV reventó")) }),
      fuente: FUENTE,
    }),
  );
  try {
    assertEquals(rota.container.querySelector("[data-stats]"), null, "un fallo de getStats no debía pintar badge");
    assert(rota.container.textContent?.includes(FUENTE.name), "la fila debía quedar intacta");
    assertEquals(rota.container.textContent?.includes("KV reventó"), false, "el error de stats no es un error de la fila");
  } finally {
    await rota.desmontar();
  }
});

Deno.test("AC-24.4: Capturar refresca el badge", async () => {
  let pedidos = 0;
  const pagina = await montar(
    createElement(SourceCard, {
      api: apiStub({
        getStats: () => {
          pedidos += 1;
          return Promise.resolve(
            pedidos === 1
              ? {
                totalSnapshots: 1,
                lastChangedAt: 1,
                errorCount: 0,
                lastError: null,
                lastAttempt: { at: 1, ok: true },
              }
              : {
                totalSnapshots: 1,
                lastChangedAt: 1,
                errorCount: 1,
                lastError: { message: "HTTP 500 al fetchear x", at: 2 },
                lastAttempt: { at: 2, ok: false },
              },
          );
        },
        fetchNow: () =>
          Promise.resolve({
            sourceId: FUENTE.id,
            snapshot: { timestamp: 5, hash: "abc", sizeBytes: 10, changed: false, trigger: "manual" as const },
          }),
      }),
      fuente: FUENTE,
    }),
  );
  try {
    buscar(pagina.container, '[data-stats="ok"]');
    await click(boton(pagina.container, "Capturar"));
    buscar(pagina.container, '[data-stats="error"]');
    assertEquals(pedidos, 2, "Capturar debía recargar las stats");
    assert(pagina.container.textContent?.includes("changed=false"), "falta el resultado de la captura");
  } finally {
    await pagina.desmontar();
  }
});
