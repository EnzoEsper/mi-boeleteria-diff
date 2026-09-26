import { assert, assertEquals } from "@std/assert";
import type { Source } from "../../server/kv.ts";
import { createApp } from "../../server/router.ts";

type Fetcher = { fetch(request: Request): Response | Promise<Response> };

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VALID_URL = "https://miboleteria.com.ar/xml/horarios.txt";

async function withApp(fn: (ctx: { app: Fetcher; kv: Deno.Kv }) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "s1-kv-" });
  const kv = await Deno.openKv(`${dir}/kv.db`);
  try {
    await fn({ app: createApp(kv), kv });
  } finally {
    kv.close();
    await Deno.remove(dir, { recursive: true });
  }
}

function request(path: string, init: { method?: string; body?: unknown } = {}): Request {
  const { method = "GET", body } = init;
  return new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createSource(app: Fetcher, overrides: Record<string, unknown> = {}): Promise<Source> {
  const res = await app.fetch(
    request("/api/sources", {
      method: "POST",
      body: { name: "Horarios MB", url: VALID_URL, ...overrides },
    }),
  );
  assertEquals(res.status, 201);
  return await res.json();
}

// ---------------------------------------------------------------------------
// AC-1.1
// ---------------------------------------------------------------------------

Deno.test("AC-1.1: POST /api/sources crea una fuente URL con valores por defecto", async () => {
  await withApp(async ({ app }) => {
    const res = await app.fetch(
      request("/api/sources", { method: "POST", body: { name: "Horarios MB", url: VALID_URL } }),
    );
    assertEquals(res.status, 201);
    const body = await res.json();

    assertEquals(
      Object.keys(body).sort(),
      ["createdAt", "cronEnabled", "cronExpr", "headers", "id", "name", "type", "url"].sort(),
    );
    assertEquals(body.name, "Horarios MB");
    assertEquals(body.type, "url");
    assertEquals(body.url, VALID_URL);
    assertEquals(body.headers, {});
    assertEquals(body.cronExpr, null);
    assertEquals(body.cronEnabled, false);
    assert(UUID_V4_RE.test(body.id), `id no es uuid v4: ${body.id}`);
    assert(!Number.isNaN(Date.parse(body.createdAt)), `createdAt no es ISO: ${body.createdAt}`);
  });
});

// ---------------------------------------------------------------------------
// AC-1.2
// ---------------------------------------------------------------------------

Deno.test("AC-1.2: rechaza payloads inválidos con 400 + issues", async () => {
  await withApp(async ({ app }) => {
    const invalidos: { body: unknown; path: string }[] = [
      { body: { url: VALID_URL }, path: "name" },
      { body: { name: "   ", url: VALID_URL }, path: "name" },
      { body: { name: "x", url: "ftp://host/horarios.txt" }, path: "url" },
      { body: { name: "x", url: "no-es-url" }, path: "url" },
      { body: { name: "x", url: VALID_URL, headers: "nope" }, path: "headers" },
      { body: { name: "x", url: VALID_URL, cronEnabled: "si" }, path: "cronEnabled" },
      { body: { name: "x", url: VALID_URL, cronExpr: 42 }, path: "cronExpr" },
      { body: "esto no es un objeto", path: "" },
    ];

    for (const { body: payload, path } of invalidos) {
      const res = await app.fetch(request("/api/sources", { method: "POST", body: payload }));
      assertEquals(res.status, 400, `esperaba 400 para ${JSON.stringify(payload)}`);
      const body = await res.json();
      assert(typeof body.error === "string" && body.error.length > 0, "falta error");
      assert(Array.isArray(body.issues) && body.issues.length > 0, "falta issues");
      assertEquals(body.issues[0].path, path, `path incorrecto para ${JSON.stringify(payload)}`);
      assert(typeof body.issues[0].message === "string");
    }
  });
});

Deno.test("AC-1.2: body que no es JSON válido → 400", async () => {
  await withApp(async ({ app }) => {
    const res = await app.fetch(
      new Request("http://localhost/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ no es json",
      }),
    );
    assertEquals(res.status, 400);
    const body = await res.json();
    assert(Array.isArray(body.issues));
  });
});

Deno.test("AC-1.2: campos desconocidos se descartan sin romper", async () => {
  await withApp(async ({ app }) => {
    const res = await app.fetch(
      request("/api/sources", {
        method: "POST",
        body: { name: "x", url: VALID_URL, campoDesconocido: 123 },
      }),
    );
    assertEquals(res.status, 201);
    const body = await res.json();
    assert(!("campoDesconocido" in body), "el campo desconocido persistió");
  });
});

// ---------------------------------------------------------------------------
// AC-1.3
// ---------------------------------------------------------------------------

Deno.test("AC-1.3: GET /api/sources devuelve [] con KV vacío", async () => {
  await withApp(async ({ app }) => {
    const res = await app.fetch(request("/api/sources"));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), []);
  });
});

Deno.test("AC-1.3: listado ordenado por createdAt descendente", async () => {
  await withApp(async ({ app }) => {
    const primera = await createSource(app, { name: "Primera" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const segunda = await createSource(app, { name: "Segunda" });

    const res = await app.fetch(request("/api/sources"));
    assertEquals(res.status, 200);
    const list = await res.json();
    assertEquals(list.map((s: { name: string }) => s.name), ["Segunda", "Primera"]);
    assert(Date.parse(list[0].createdAt) >= Date.parse(list[1].createdAt));
    assertEquals(list[1].id, primera.id);
    assertEquals(list[0].id, segunda.id);
  });
});

// ---------------------------------------------------------------------------
// AC-1.4
// ---------------------------------------------------------------------------

Deno.test("AC-1.4: GET por id devuelve la fuente y persiste en ['source', id]", async () => {
  await withApp(async ({ app, kv }) => {
    const creada = await createSource(app);

    const res = await app.fetch(request(`/api/sources/${creada.id}`));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), creada);

    const enKv = await kv.get<Source>(["source", creada.id]);
    assertEquals(enKv.value, creada, "el objeto no está persistido en la clave ['source', id]");
  });
});

Deno.test("AC-1.4: id inexistente → 404 con error", async () => {
  await withApp(async ({ app }) => {
    const res = await app.fetch(request("/api/sources/00000000-0000-4000-8000-000000000000"));
    assertEquals(res.status, 404);
    const body = await res.json();
    assert(typeof body.error === "string" && body.error.length > 0);
  });
});

// ---------------------------------------------------------------------------
// AC-1.5
// ---------------------------------------------------------------------------

Deno.test("AC-1.5: dos altas producen ids únicos y ambas son recuperables", async () => {
  await withApp(async ({ app }) => {
    const a = await createSource(app, { name: "Fuente A" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await createSource(app, { name: "Fuente B" });

    assert(a.id !== b.id, "los ids deben ser distintos");
    const [ra, rb] = await Promise.all([
      app.fetch(request(`/api/sources/${a.id}`)),
      app.fetch(request(`/api/sources/${b.id}`)),
    ]);
    assertEquals(ra.status, 200);
    assertEquals(rb.status, 200);

    const list = await (await app.fetch(request("/api/sources"))).json();
    assertEquals(list.length, 2);
  });
});

// ---------------------------------------------------------------------------
// AC-1.6
// ---------------------------------------------------------------------------

Deno.test("AC-1.6: headers y config de cron opcionales se persisten tal cual", async () => {
  await withApp(async ({ app, kv }) => {
    const creada = await createSource(app, {
      headers: { "User-Agent": "diff-tracker/1.0", Accept: "application/json" },
      cronExpr: "*/15 * * * *",
      cronEnabled: true,
    });

    assertEquals(creada.headers, { "User-Agent": "diff-tracker/1.0", Accept: "application/json" });
    assertEquals(creada.cronExpr, "*/15 * * * *");
    assertEquals(creada.cronEnabled, true);

    const enKv = await kv.get<Source>(["source", creada.id]);
    assertEquals(enKv.value, creada);
  });
});

// ---------------------------------------------------------------------------
// AC-1.7
// ---------------------------------------------------------------------------

Deno.test("AC-1.7: tasks dev/check apuntan a server/main.ts y KV está habilitada", async () => {
  const denoJson = JSON.parse(await Deno.readTextFile(new URL("../../deno.json", import.meta.url)));
  assertStringIncludesTask(denoJson.tasks?.dev, "server/main.ts", "dev");
  assertStringIncludesTask(denoJson.tasks?.check, "server/main.ts", "check");
  assert(Array.isArray(denoJson.unstable) && denoJson.unstable.includes("kv"), 'deno.json sin "unstable": ["kv"]');
});

function assertStringIncludesTask(task: unknown, needle: string, name: string): void {
  assert(typeof task === "string", `falta task ${name}`);
  assert(task.includes(needle), `task ${name} no ejecuta ${needle}: ${task}`);
}
