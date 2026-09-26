import { assert, assertStringIncludes } from "@std/assert";

const raiz = (ruta: string) => new URL(`../../${ruta}`, import.meta.url);

async function leer(ruta: string): Promise<string> {
  return await Deno.readTextFile(raiz(ruta));
}

// ---------------------------------------------------------------------------
// AC-16.1
// ---------------------------------------------------------------------------

Deno.test("AC-16.1: tasks.deploy usa deno deploy (EA) y ya no referencia npm:deployctl", async () => {
  const denoJson = JSON.parse(await leer("deno.json"));
  const deploy = denoJson.tasks?.deploy;
  assert(typeof deploy === "string", "falta la task deploy en deno.json");
  assertStringIncludes(deploy, "deno task build", "el deploy mantiene el build previo");
  assertStringIncludes(deploy, "deno deploy", "la task debe invocar el comando deno deploy (EA)");
  assertStringIncludes(deploy, "--app mi-boleteria-diff", "falta el nombre de la app");
  assert(
    !deploy.includes("npm:deployctl") && !deploy.includes("--project="),
    "la task sigue apuntando a deployctl Classic",
  );
});

// ---------------------------------------------------------------------------
// AC-16.2
// ---------------------------------------------------------------------------

Deno.test("AC-16.2: main.ts registra el cron maestro a nivel de módulo cuando DENO_DEPLOY=1", async () => {
  const main = await leer("server/main.ts");

  assertStringIncludes(main, "DENO_DEPLOY", "falta la detección de Deno Deploy EA");
  assert(/denoCron\(|Deno\.cron\(/.test(main), "falta la llamada a Deno.cron");

  const registro = main.search(/DENO_DEPLOY[\s\S]{0,200}?(denoCron|Deno\.cron)\(/);
  assert(registro >= 0, "el registro del cron no está asociado a DENO_DEPLOY");
  const inicioStart = main.indexOf("export async function start");
  assert(inicioStart >= 0, "falta export async function start");
  assert(
    registro < inicioStart,
    "el registro de cron debe estar a nivel de módulo, antes de start()",
  );

  assertStringIncludes(main, "registerMasterCron(", "start() mantiene el registro local (AC-5.6)");
  assertStringIncludes(main, "await Deno.openKv()", "producción debe abrir la KV sin path (gestionada)");
});

Deno.test("AC-16.2: start() no duplica el cron en EA y cierra la KV igual", async () => {
  const main = await leer("server/main.ts");
  assert(
    /DENO_DEPLOY[\s\S]{0,300}?registerMasterCron\(/.test(main) ||
      /opciones\.cron[\s\S]{0,120}?registerMasterCron\(/.test(main),
    "el registro de start() debe quedar cubierto por el guard de EA o el de cron:false",
  );
  assert(main.includes("kv.close()"), "start() debe cerrar la KV al apagarse");
});

// ---------------------------------------------------------------------------
// AC-16.3
// ---------------------------------------------------------------------------

Deno.test("AC-16.3: README documenta el flujo de Deno Deploy EA sin restos de Classic", async () => {
  const readme = await leer("README.md");
  for (const fragmento of [
    "## Deploy",
    "deno deploy",
    "deno task deploy",
    "deno task build",
    "server/main.ts",
    "DENO_DEPLOY=1",
    "denokv",
    "KV",
  ]) {
    assertStringIncludes(readme, fragmento, `README debe mencionar ${fragmento}`);
  }
  for (const viejo of ["deployctl", "dash.deno.com", "DENO_DEPLOY_TOKEN"]) {
    assert(!readme.includes(viejo), `README aún menciona ${viejo} (Classic apagado)`);
  }
});
