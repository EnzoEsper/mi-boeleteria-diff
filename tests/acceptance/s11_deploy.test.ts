import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { start } from "../../server/main.ts";

const raiz = (ruta: string) => new URL(`../../${ruta}`, import.meta.url);

async function leer(ruta: string): Promise<string> {
  return await Deno.readTextFile(raiz(ruta));
}

// ---------------------------------------------------------------------------
// AC-11.1
// ---------------------------------------------------------------------------

Deno.test("AC-11.1: deno.json expone tasks.deploy con build previo y deployctl --entrypoint", async () => {
  const denoJson = JSON.parse(await leer("deno.json"));
  const deploy = denoJson.tasks?.deploy;
  assert(typeof deploy === "string", "falta la task deploy en deno.json");
  assertStringIncludes(deploy, "deno task build");
  assertStringIncludes(deploy, "deployctl");
  assertStringIncludes(deploy, "--entrypoint=server/main.ts");
});

// ---------------------------------------------------------------------------
// AC-11.2
// ---------------------------------------------------------------------------

Deno.test("AC-11.2: .gitignore excluye artefactos, KV local, smoke y .env", async () => {
  const gitignore = await leer(".gitignore");
  for (const patron of ["node_modules/", "web/node_modules/", "web/dist/", "kv.sqlite*", "smoke.*", ".env"]) {
    assert(gitignore.includes(patron), `.gitignore debe ignorar ${patron}`);
  }
});

// ---------------------------------------------------------------------------
// AC-11.3
// ---------------------------------------------------------------------------

Deno.test("AC-11.3: README documenta el deploy (dashboard, entrypoint, build, KV, token)", async () => {
  const readme = await leer("README.md");
  for (const fragmento of [
    "dash.deno.com",
    "server/main.ts",
    "deno task build",
    "DENO_DEPLOY_TOKEN",
    "deno task deploy",
    "KV",
  ]) {
    assertStringIncludes(readme, fragmento, `README debe mencionar ${fragmento}`);
  }
  assert(/##\s+Deploy/.test(readme), "README debe tener una sección ## Deploy");
});

// ---------------------------------------------------------------------------
// AC-11.4
// ---------------------------------------------------------------------------

Deno.test("AC-11.4: start() levanta un proceso único con API + estáticos y cierra limpio", async () => {
  const distDir = await Deno.makeTempDir({ prefix: "dist-boot-" });
  const kvDir = await Deno.makeTempDir({ prefix: "kv-boot-" });
  await Deno.writeTextFile(`${distDir}/index.html`, "<!doctype html><div id=\"root\"></div>");
  let server: Deno.HttpServer | null = null;
  try {
    server = await start({ port: 0, kvPath: `${kvDir}/kv.db`, distDir, cron: false });
    assert(server.addr.transport === "tcp", "el server debe escuchar por TCP");
    const puerto = server.addr.port;
    assert(puerto > 0, "el puerto efímero debe resolverse");

    const index = await fetch(`http://localhost:${puerto}/`);
    assertEquals(index.status, 200);
    assertStringIncludes(index.headers.get("content-type") ?? "", "text/html");
    assertStringIncludes(await index.text(), "<div id=\"root\">");

    const api = await fetch(`http://localhost:${puerto}/api/sources`);
    assertEquals(api.status, 200);
    assertStringIncludes(api.headers.get("content-type") ?? "", "application/json");
    assertEquals(await api.json(), []);
  } finally {
    if (server) {
      await server.shutdown();
      await server.finished;
    }
    await Deno.remove(distDir, { recursive: true });
    await Deno.remove(kvDir, { recursive: true });
  }
});

Deno.test("AC-11.4: start() sigue registrando el cron maestro por defecto (regresión AC-5.6)", async () => {
  const main = await leer("server/main.ts");
  assert(main.includes("registerMasterCron("), "start() debe invocar registerMasterCron(kv)");
  assert(main.includes("await start()"), "el entrypoint mantiene el arranque por defecto");
  const mainFuente = await Deno.readTextFile(raiz("server/main.ts"));
  assert(/Deno\.env\.get\("PORT"\)/.test(mainFuente), "PORT sigue siendo opcional con default 8000");
});
