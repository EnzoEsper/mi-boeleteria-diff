import { assert, assertEquals, assertRejects } from "@std/assert";
import { ApiError, createApi, type FetchLike } from "../../web/src/api.ts";

interface Llamada {
  url: string;
  init?: RequestInit;
}

function capturador(respuestas: { status: number; body: unknown }[]): { llamadas: Llamada[]; fetchImpl: FetchLike } {
  const llamadas: Llamada[] = [];
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
  return { llamadas, fetchImpl };
}

// ---------------------------------------------------------------------------
// AC-7.1
// ---------------------------------------------------------------------------

Deno.test("AC-7.1: createApi ejecuta los requests del contrato", async () => {
  const { llamadas, fetchImpl } = capturador([{ status: 200, body: [] }]);
  const api = createApi(fetchImpl);

  await api.listSources();
  assertEquals([llamadas[0].url, llamadas[0].init?.method], ["http://localhost/api/sources", undefined]);

  await api.getSource("abc");
  assertEquals(llamadas[1].url, "http://localhost/api/sources/abc");

  const payload = { name: "MB", type: "file" as const };
  await api.createSource(payload);
  const post = llamadas[2];
  assertEquals(post.url, "http://localhost/api/sources");
  assertEquals(post.init?.method, "POST");
  assertEquals(
    (post.init?.headers as Record<string, string>)["content-type"],
    "application/json",
  );
  assertEquals(post.init?.body, JSON.stringify(payload));

  await api.fetchNow("abc");
  assertEquals([llamadas[3].url, llamadas[3].init?.method], ["http://localhost/api/sources/abc/fetch", "POST"]);

  await api.listSnapshots("abc");
  assertEquals(llamadas[4].url, "http://localhost/api/sources/abc/snapshots");

  await api.getSnapshot("abc", 1727400000000);
  assertEquals(llamadas[5].url, "http://localhost/api/sources/abc/snapshots/1727400000000");

  await api.getDiff("abc", 111, 222);
  assertEquals(llamadas[6].url, "http://localhost/api/sources/abc/diff?from=111&to=222");
  assertEquals(llamadas[6].init?.method, undefined, "GET no lleva method explícito");
});

Deno.test("AC-7.1: las respuestas 2xx se devuelven parseadas sin envoltorio", async () => {
  const cuerpo = { sourceId: "abc", snapshot: { timestamp: 1, hash: "h", changed: true } };
  const { fetchImpl } = capturador([{ status: 200, body: cuerpo }]);
  const api = createApi(fetchImpl);
  assertEquals(await api.fetchNow("abc"), cuerpo);
});

// ---------------------------------------------------------------------------
// AC-7.2
// ---------------------------------------------------------------------------

Deno.test("AC-7.2: importFile sube multipart con la parte file", async () => {
  const cuerpo = { sourceId: "abc", snapshot: { timestamp: 1, trigger: "import" } };
  const { llamadas, fetchImpl } = capturador([{ status: 200, body: cuerpo }]);
  const api = createApi(fetchImpl);

  const file = new File([fixtureJson()], "horarios.json", { type: "application/json" });
  const resultado = await api.importFile("abc", file);

  assertEquals(resultado, cuerpo);
  const llamada = llamadas[0];
  assertEquals(llamada.url, "http://localhost/api/sources/abc/import");
  assertEquals(llamada.init?.method, "POST");
  assertEquals(llamada.init?.headers, undefined, "el content-type con boundary lo arma fetch");
  const form = llamada.init?.body;
  assert(form instanceof FormData, "el body debe ser FormData");
  const parte = form.get("file");
  assert(parte instanceof File, "la parte file debe ser el File enviado");
  assertEquals(parte.name, "horarios.json");
});

function fixtureJson(): string {
  return '{"ciudades":[]}';
}

// ---------------------------------------------------------------------------
// AC-7.3
// ---------------------------------------------------------------------------

Deno.test("AC-7.3: errores 4xx/5xx se normalizan en ApiError", async () => {
  const casos = [
    {
      respuesta: { status: 400, body: { error: "validación fallida", issues: [{ path: "name", message: "requerido" }] } },
      esperado: { status: 400, message: "validación fallida", issues: 1 },
    },
    { respuesta: { status: 404, body: { error: "fuente no encontrada" } }, esperado: { status: 404, message: "fuente no encontrada", issues: 0 } },
    { respuesta: { status: 502, body: { error: "HTTP 500 al fetchear" } }, esperado: { status: 502, message: "HTTP 500 al fetchear", issues: 0 } },
  ];

  for (const caso of casos) {
    const { fetchImpl } = capturador([caso.respuesta]);
    const api = createApi(fetchImpl);
    const error = await assertRejects(() => api.listSources(), ApiError, caso.esperado.message);
    assertEquals(error.status, caso.esperado.status);
    assertEquals(error.message, caso.esperado.message);
    assertEquals(error.issues.length, caso.esperado.issues, `issues mal contados en ${caso.esperado.status}`);
    if (caso.esperado.issues > 0) assertEquals(error.issues[0].path, "name");
  }
});

Deno.test("AC-7.3: si fetch rechaza, la excepción original se propaga", async () => {
  const fetchImpl: FetchLike = () => Promise.reject(new TypeError("network down"));
  const api = createApi(fetchImpl);
  const error = await assertRejects(() => api.listSources(), TypeError, "network down");
  assert(!(error instanceof ApiError), "no debe convertirse en ApiError");
});

// ---------------------------------------------------------------------------
// AC-7.4
// ---------------------------------------------------------------------------

Deno.test("AC-7.4: vite.config.ts proxea /api al server Deno", async () => {
  const config = await Deno.readTextFile(new URL("../../web/vite.config.ts", import.meta.url));
  assert(config.includes("/api"), "falta el prefijo /api en el proxy");
  assert(config.includes("http://localhost:8000"), "falta el target del server Deno");
  assert(config.includes("changeOrigin"), "falta changeOrigin en el proxy");
});
