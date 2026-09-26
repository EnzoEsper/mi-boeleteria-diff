import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { checkRepo } from "../../scripts/spec_check.ts";

const ROOT = new URL("../../", import.meta.url);
const ac = (n: number, k: number) => `AC-${n}.${k}`;

// ---------------------------------------------------------------------------
// AC-0.1 — estructura
// ---------------------------------------------------------------------------

Deno.test("AC-0.1: existen los directorios base del repositorio", async () => {
  const dirs = ["specs/", "scripts/", "tests/acceptance/", "tests/fixtures/", "server/", "web/"];
  for (const dir of dirs) {
    const info = await Deno.stat(new URL(dir, ROOT)).catch(() => null);
    assert(info?.isDirectory, `falta directorio ${dir}`);
  }
});

Deno.test("AC-0.1: scaffold web expone build y vite.config", async () => {
  const pkg = JSON.parse(await Deno.readTextFile(new URL("web/package.json", ROOT)));
  assert(typeof pkg.scripts?.build === "string", "web/package.json sin script build");
  const vite = await Deno.stat(new URL("web/vite.config.ts", ROOT)).catch(() => null);
  assert(vite?.isFile, "falta web/vite.config.ts");
});

// ---------------------------------------------------------------------------
// AC-0.2 — tasks del loop
// ---------------------------------------------------------------------------

Deno.test("AC-0.2: deno.json define las tasks del loop", async () => {
  const denoJson = JSON.parse(await Deno.readTextFile(new URL("deno.json", ROOT)));
  const tasks: Record<string, string> = denoJson.tasks ?? {};
  for (const name of ["test", "spec:check", "check", "verify", "build"]) {
    assertStringIncludes(Object.keys(tasks).join(" "), name, `falta task "${name}"`);
  }

  const chain = tasks.verify.split("&&").map((part) => part.trim());
  assertEquals(chain.length, 5, "verify debe encadenar 5 comandos");
  assertStringIncludes(chain[0], "spec:check", "verify[0] = spec:check");
  assertStringIncludes(chain[1], "lint", "verify[1] = lint");
  assertStringIncludes(chain[2], "check", "verify[2] = check");
  assert(!chain[2].includes("spec:"), "verify[2] debe ser deno check, no spec:check");
  assertStringIncludes(chain[3], "test", "verify[3] = test");
  assertStringIncludes(chain[4], "build", "verify[4] = build");
});

// ---------------------------------------------------------------------------
// AC-0.3 — trazabilidad (repo real + casos sintéticos)
// ---------------------------------------------------------------------------

Deno.test("AC-0.3: spec_check pasa con cero errores sobre el repositorio real", () => {
  const errors = checkRepo(new URL("specs", ROOT), new URL("tests", ROOT));
  assertEquals(errors, [], errors.join("\n"));
});

type Synthetic = {
  specs: URL;
  tests: URL;
  cleanup: () => Promise<void>;
};

async function makeSynthetic(opts: {
  specAcs: string[];
  testAcs: string[];
  traceAcs: string[];
  estado?: string | null;
}): Promise<Synthetic> {
  const root = await Deno.makeTempDir({ prefix: "spec-check-" });
  const specs = new URL(`file://${root.replaceAll("\\", "/")}/specs/`);
  const tests = new URL(`file://${root.replaceAll("\\", "/")}/tests/`);
  await Deno.mkdir(new URL("acceptance/", tests), { recursive: true });
  await Deno.mkdir(specs, { recursive: true });

  const estado = opts.estado === undefined ? "## Estado: pendiente" : opts.estado;
  const headings = opts.specAcs.map((id) => `### ${id} — criterio sintético`).join("\n\n");
  await Deno.writeTextFile(
    new URL("S9-sintetica.md", specs),
    `# S9 — Sintética\n\n${estado}\n\n## Criterios de aceptación\n\n${headings}\n`,
  );
  const rows = opts.traceAcs.map((id) => `| ${id} | s9_test.test.ts | ✅ |`).join("\n");
  await Deno.writeTextFile(new URL("TRACEABILITY.md", specs), `| Spec | Test | Estado |\n|---|---|---|\n${rows}\n`);
  if (opts.testAcs.length > 0) {
    const body = opts.testAcs.map((id) => `Deno.test("${id}: sintético", () => {});`).join("\n");
    await Deno.writeTextFile(new URL("acceptance/s9_test.test.ts", tests), body);
  }
  return { specs, tests, cleanup: () => Deno.remove(root, { recursive: true }) };
}

Deno.test("AC-0.3: detecta AC definido sin test que lo referencie", async () => {
  const id = ac(9, 1);
  const s = await makeSynthetic({ specAcs: [id], testAcs: [], traceAcs: [id] });
  try {
    const errors = checkRepo(s.specs, s.tests);
    assertEquals(errors.length, 1, errors.join("\n"));
    assertStringIncludes(errors[0], id);
    assertStringIncludes(errors[0], "sin test");
  } finally {
    await s.cleanup();
  }
});

Deno.test("AC-0.3: detecta test que referencia un AC inexistente (huérfano)", async () => {
  const defined = ac(9, 1);
  const orphan = ac(9, 2);
  const s = await makeSynthetic({ specAcs: [defined], testAcs: [defined, orphan], traceAcs: [defined] });
  try {
    const errors = checkRepo(s.specs, s.tests);
    assertEquals(errors.length, 1, errors.join("\n"));
    assertStringIncludes(errors[0], orphan);
    assertStringIncludes(errors[0], "huérfano");
  } finally {
    await s.cleanup();
  }
});

Deno.test("AC-0.3: detecta spec sin campo Estado", async () => {
  const id = ac(9, 1);
  const s = await makeSynthetic({ specAcs: [id], testAcs: [id], traceAcs: [id], estado: null });
  try {
    const errors = checkRepo(s.specs, s.tests);
    assertEquals(errors.length, 1, errors.join("\n"));
    assertStringIncludes(errors[0], "Estado");
  } finally {
    await s.cleanup();
  }
});

Deno.test("AC-0.3: detecta AC ausente en TRACEABILITY.md", async () => {
  const id = ac(9, 1);
  const s = await makeSynthetic({ specAcs: [id], testAcs: [id], traceAcs: [] });
  try {
    const errors = checkRepo(s.specs, s.tests);
    assertEquals(errors.length, 1, errors.join("\n"));
    assertStringIncludes(errors[0], "TRACEABILITY");
  } finally {
    await s.cleanup();
  }
});

Deno.test("AC-0.3: detecta fila de TRACEABILITY con AC inexistente", async () => {
  const id = ac(9, 1);
  const stale = ac(9, 7);
  const s = await makeSynthetic({ specAcs: [id], testAcs: [id], traceAcs: [id, stale] });
  try {
    const errors = checkRepo(s.specs, s.tests);
    assertEquals(errors.length, 1, errors.join("\n"));
    assertStringIncludes(errors[0], stale);
    assertStringIncludes(errors[0], "inexistente");
  } finally {
    await s.cleanup();
  }
});

Deno.test("AC-0.3: detecta AC duplicado entre specs", async () => {
  const id = ac(9, 1);
  const s = await makeSynthetic({ specAcs: [id], testAcs: [id], traceAcs: [id] });
  try {
    await Deno.writeTextFile(
      new URL("S8-duplicada.md", s.specs),
    `# S8 — Duplicada\n\n## Estado: pendiente\n\n### ${id} — criterio repetido\n`,
    );
    const errors = checkRepo(s.specs, s.tests);
    assertEquals(errors.length, 1, errors.join("\n"));
    assertStringIncludes(errors[0], id);
    assertStringIncludes(errors[0], "duplicado");
  } finally {
    await s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC-0.4 — fixture del endpoint
// ---------------------------------------------------------------------------

type HorariosTime = { time?: unknown; id?: unknown };
type HorariosDate = { times?: unknown };
type HorariosShow = { dates?: unknown };
type HorariosCinema = { shows?: unknown };
type HorariosCity = { title?: unknown; id?: unknown; cinemas?: unknown };

function validateHorarios(data: unknown): string[] {
  const errors: string[] = [];
  if (!Array.isArray(data)) return ["la raíz no es un array"];
  if (data.length === 0) errors.push("la raíz está vacía");

  data.forEach((city, ci) => {
    const c = city as HorariosCity;
    const at = `ciudad[${ci}]`;
    if (typeof c?.title !== "string") errors.push(`${at}: falta title (string)`);
    if (typeof c?.id !== "string") errors.push(`${at}: falta id (string)`);
    if (!Array.isArray(c?.cinemas)) {
      errors.push(`${at}: falta cinemas[]`);
      return;
    }
    c.cinemas.forEach((cinema, ni) => {
      const n = cinema as HorariosCinema;
      const at2 = `${at}.cinema[${ni}]`;
      if (!Array.isArray(n?.shows)) {
        errors.push(`${at2}: falta shows[]`);
        return;
      }
      n.shows.forEach((show, si) => {
        const s = show as HorariosShow;
        const at3 = `${at2}.show[${si}]`;
        if (!Array.isArray(s?.dates)) {
          errors.push(`${at3}: falta dates[]`);
          return;
        }
        s.dates.forEach((date, di) => {
          const d = date as HorariosDate;
          const at4 = `${at3}.date[${di}]`;
          if (!Array.isArray(d?.times)) {
            errors.push(`${at4}: falta times[]`);
            return;
          }
          (d.times as HorariosTime[]).forEach((t, ti) => {
            if (typeof t?.time !== "string") errors.push(`${at4}.time[${ti}]: falta time (string)`);
            if (typeof t?.id !== "string") errors.push(`${at4}.time[${ti}]: falta id (string)`);
          });
        });
      });
    });
  });
  return errors;
}

Deno.test("AC-0.4: fixture del endpoint es JSON con la estructura esperada", async () => {
  const text = await Deno.readTextFile(new URL("tests/fixtures/horarios-t0.json", ROOT));
  const data = JSON.parse(text);
  const errors = validateHorarios(data);
  assertEquals(errors.slice(0, 5), [], `${errors.length} errores; primeros: ${errors.slice(0, 5).join("; ")}`);
});

// ---------------------------------------------------------------------------
// AC-0.5 — spike jsondiffpatch
// ---------------------------------------------------------------------------

Deno.test("AC-0.5: jsondiffpatch produce delta serializable con roundtrip patch/unpatch", async () => {
  const { create } = await import("jsondiffpatch");
  const jp = create({ objectHash: (o: { id?: string } | null) => o?.id ?? JSON.stringify(o) });

  const antes = { funciones: [{ id: "1", hora: "14:20" }, { id: "2", hora: "17:00" }], version: 1 };
  const despues = { funciones: [{ id: "1", hora: "14:50" }, { id: "3", hora: "20:00" }], version: 2 };

  const delta = jp.diff(antes, despues);
  assert(delta !== undefined, "diff devolvió undefined (sin cambios)");
  assert(typeof JSON.stringify(delta) === "string", "delta no es serializable");

  assertEquals(jp.patch(structuredClone(antes), delta), despues, "patch no reconstruye la versión nueva");
  assertEquals(jp.unpatch(structuredClone(despues), delta), antes, "unpatch no recupera la versión anterior");
});

Deno.test("AC-0.5: objectHash detecta moves en arrays", async () => {
  const { create } = await import("jsondiffpatch");
  const jp = create({ objectHash: (o: { id?: string } | null) => o?.id ?? JSON.stringify(o) });

  const a = [{ id: "1", v: "x" }, { id: "2", v: "y" }, { id: "3", v: "z" }];
  const b = [{ id: "3", v: "z" }, { id: "1", v: "x" }, { id: "2", v: "y2" }];
  const delta = jp.diff(a, b) as Record<string, unknown>;

  assertEquals(delta._t, "a", "delta de array sin flag _t");
  assertEquals(delta._2, ["", 0, 3], "no se detectó el move del item id=2 hacia el índice 3");
  assertEquals(delta, { "2": { v: ["y", "y2"] }, _t: "a", _2: ["", 0, 3] }, "estructura del delta inesperada");
});

// ---------------------------------------------------------------------------
// AC-0.6 — README del loop
// ---------------------------------------------------------------------------

Deno.test("AC-0.6: README documenta el micro-loop y sus comandos", async () => {
  const readme = await Deno.readTextFile(new URL("README.md", ROOT));
  for (const token of ["①", "⑦", "deno task verify", "deno task spec:check", "TRACEABILITY", "specs/S"]) {
    assertStringIncludes(readme, token, `README sin "${token}"`);
  }
});
