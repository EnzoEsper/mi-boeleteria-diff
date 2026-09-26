import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withApp } from "../support.ts";

const distIndex = "<!doctype html><html><body><div id=\"root\"></div></body></html>";

async function crearDist(conIndex = true): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "dist-" });
  await Deno.mkdir(`${dir}/assets`, { recursive: true });
  await Deno.writeTextFile(`${dir}/assets/app.js`, "console.log('bundle');");
  await Deno.writeTextFile(`${dir}/assets/app.css`, ":root { color: red; }");
  await Deno.writeTextFile(`${dir}/assets/logo.svg`, "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  if (conIndex) await Deno.writeTextFile(`${dir}/index.html`, distIndex);
  return dir;
}

async function get(app: { fetch(r: Request): Response | Promise<Response> }, path: string) {
  const res = await app.fetch(new Request(`http://localhost${path}`));
  return { res, text: await res.text() };
}

// ---------------------------------------------------------------------------
// AC-10.1
// ---------------------------------------------------------------------------

Deno.test("AC-10.1: GET / sirve index.html y las rutas sin extensión hacen SPA fallback", async () => {
  const distDir = await crearDist();
  try {
    await withApp(async ({ app }) => {
      const raiz = await get(app, "/");
      assertEquals(raiz.res.status, 200);
      assertStringIncludes(raiz.res.headers.get("content-type") ?? "", "text/html");
      assertEquals(raiz.text, distIndex);
      assertEquals(raiz.res.headers.get("cache-control"), "no-cache");

      const deepLink = await get(app, "/fuentes/abc");
      assertEquals(deepLink.res.status, 200);
      assertEquals(deepLink.text, distIndex);
      assertEquals(deepLink.res.headers.get("cache-control"), "no-cache");
    }, { distDir });
  } finally {
    await Deno.remove(distDir, { recursive: true });
  }
});

Deno.test("AC-10.1: sin build (falta index.html) la ruta responde 404 que menciona deno task build", async () => {
  const distDir = await crearDist(false);
  try {
    await withApp(async ({ app }) => {
      const { res, text } = await get(app, "/");
      assertEquals(res.status, 404);
      const body = JSON.parse(text);
      assertStringIncludes(String(body.error), "deno task build");
    }, { distDir });
  } finally {
    await Deno.remove(distDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// AC-10.2
// ---------------------------------------------------------------------------

Deno.test("AC-10.2: assets con su MIME y cache immutable; asset faltante 404 sin caer al index", async () => {
  const distDir = await crearDist();
  try {
    await withApp(async ({ app }) => {
      const js = await get(app, "/assets/app.js");
      assertEquals(js.res.status, 200);
      assertStringIncludes(js.res.headers.get("content-type") ?? "", "text/javascript");
      assertEquals(js.res.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assertEquals(js.text, "console.log('bundle');");

      const css = await get(app, "/assets/app.css");
      assertEquals(css.res.status, 200);
      assertStringIncludes(css.res.headers.get("content-type") ?? "", "text/css");
      assertEquals(css.res.headers.get("cache-control"), "public, max-age=31536000, immutable");

      const svg = await get(app, "/assets/logo.svg");
      assertEquals(svg.res.status, 200);
      assertStringIncludes(svg.res.headers.get("content-type") ?? "", "image/svg+xml");

      const index = await get(app, "/index.html");
      assertEquals(index.res.status, 200);
      assertEquals(index.res.headers.get("cache-control"), "no-cache");

      const falta = await get(app, "/assets/falta.js");
      assertEquals(falta.res.status, 404);
      assert(!falta.text.includes("<div id=\"root\">"), "un asset faltante no debe servir el index.html");
    }, { distDir });
  } finally {
    await Deno.remove(distDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// AC-10.3
// ---------------------------------------------------------------------------

Deno.test("AC-10.3: el API sigue intacto y /api/* desconocido responde 404 JSON, no index.html", async () => {
  const distDir = await crearDist();
  try {
    await withApp(async ({ app }) => {
      const lista = await get(app, "/api/sources");
      assertEquals(lista.res.status, 200);
      const fuentes = JSON.parse(lista.text);
      assert(Array.isArray(fuentes) && fuentes.length === 1, "la regresión del contrato S1–S6 debe seguir funcionando");

      const desconocida = await get(app, "/api/desconocida");
      assertEquals(desconocida.res.status, 404);
      assertStringIncludes(desconocida.res.headers.get("content-type") ?? "", "application/json");
      assertEquals(typeof JSON.parse(desconocida.text).error, "string");
      assert(!desconocida.text.includes("<div id=\"root\">"), "/api/* nunca debe servir index.html");
    }, { distDir });
  } finally {
    await Deno.remove(distDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// AC-10.4
// ---------------------------------------------------------------------------

Deno.test("AC-10.4: el path traversal queda dentro del dist y responde 404", async () => {
  const distDir = await crearDist();
  try {
    await withApp(async ({ app }) => {
      const { res, text } = await get(app, "/..%2Fdeno.json");
      assertEquals(res.status, 404);
      const body = JSON.parse(text);
      assert(!("tasks" in body), "no se debe entregar deno.json del repositorio");
      assert(!text.includes("spec:check"), "no se debe entregar deno.json del repositorio");
    }, { distDir });
  } finally {
    await Deno.remove(distDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// AC-10.5
// ---------------------------------------------------------------------------

Deno.test("AC-10.5: deno task build deja web/dist listo y main.ts sirve API + estáticos en un proceso", async () => {
  const denoJson = JSON.parse(await Deno.readTextFile(new URL("../../deno.json", import.meta.url)));
  assertStringIncludes(denoJson.tasks.build, "npm --prefix web run build");

  const main = await Deno.readTextFile(new URL("../../server/main.ts", import.meta.url));
  assertStringIncludes(main, "createApp(");
  assert(main.includes("Deno.serve({ port }, app.fetch)"), "main.ts debe servir API + estáticos con el mismo app.fetch");
});
