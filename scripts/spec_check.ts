import { fromFileUrl, join } from "@std/path";

const AC_HEADING_RE = /^###\s+(AC-\d+\.\d+)\b/gm;
const AC_ANY_RE = /\bAC-\d+\.\d+\b/g;
const ESTADO_RE = /^##\s*Estado:\s*(pendiente|verde)\s*$/m;
const SPEC_FILE_RE = /^S\d+.*\.md$/i;

type Doc = { name: string; text: string };

function toPath(input: string | URL): string {
  return typeof input === "string" ? input : fromFileUrl(input);
}

function readSpecs(specsDir: string): Doc[] {
  const docs: Doc[] = [];
  for (const entry of Deno.readDirSync(specsDir)) {
    if (entry.isFile && SPEC_FILE_RE.test(entry.name)) {
      docs.push({ name: entry.name, text: Deno.readTextFileSync(join(specsDir, entry.name)) });
    }
  }
  return docs.sort((a, b) => a.name.localeCompare(b.name));
}

function readTests(dir: string, out: Doc[] = []): Doc[] {
  for (const entry of Deno.readDirSync(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      if (entry.name !== "node_modules") readTests(path, out);
    } else if (entry.isFile && entry.name.endsWith(".test.ts")) {
      out.push({ name: path, text: Deno.readTextFileSync(path) });
    }
  }
  return out;
}

function idsIn(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => (m.length > 1 ? m[1] : m[0]));
}

function group(ids: string[], source: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const id of ids) {
    const prev = map.get(id);
    if (prev) {
      if (!prev.includes(source)) prev.push(source);
    } else {
      map.set(id, [source]);
    }
  }
  return map;
}

function merge(target: Map<string, string[]>, source: Map<string, string[]>): Map<string, string[]> {
  for (const [id, files] of source) {
    const prev = target.get(id);
    if (prev) {
      for (const file of files) {
        if (!prev.includes(file)) prev.push(file);
      }
    } else {
      target.set(id, [...files]);
    }
  }
  return target;
}

export function checkRepo(specsDir: string | URL, testsDir: string | URL): string[] {
  const errors: string[] = [];
  const specsPath = toPath(specsDir);
  const testsPath = toPath(testsDir);

  let specs: Doc[];
  try {
    specs = readSpecs(specsPath);
  } catch {
    return [`no se pudo leer el directorio de specs: ${specsPath}`];
  }
  if (specs.length === 0) errors.push(`no hay specs (specs/S*.md) en ${specsPath}`);

  const defined = new Map<string, string[]>();
  for (const spec of specs) {
    if (!ESTADO_RE.test(spec.text)) {
      errors.push(`${spec.name}: falta "## Estado: pendiente|verde"`);
    }
    merge(defined, group(idsIn(spec.text, AC_HEADING_RE), spec.name));
  }
  for (const [id, files] of defined) {
    if (files.length > 1) errors.push(`${id} duplicado en ${files.join(", ")}`);
  }

  let traceIds = new Set<string>();
  try {
    traceIds = new Set(idsIn(Deno.readTextFileSync(join(specsPath, "TRACEABILITY.md")), AC_ANY_RE));
  } catch {
    errors.push(`falta specs/TRACEABILITY.md en ${specsPath}`);
  }
  for (const [id, files] of defined) {
    if (!traceIds.has(id)) errors.push(`${id} definido en ${files.join(", ")} ausente en specs/TRACEABILITY.md`);
  }
  for (const id of traceIds) {
    if (!defined.has(id)) errors.push(`specs/TRACEABILITY.md referencia ${id} inexistente`);
  }

  const referenced = new Map<string, string[]>();
  try {
    for (const test of readTests(testsPath)) merge(referenced, group(idsIn(test.text, AC_ANY_RE), test.name));
  } catch {
    errors.push(`no se pudo leer el directorio de tests: ${testsPath}`);
  }
  for (const [id, files] of defined) {
    if (!referenced.has(id)) errors.push(`${id} definido en ${files.join(", ")} sin test que lo referencie`);
  }
  for (const [id, files] of referenced) {
    if (!defined.has(id)) {
      errors.push(`${id} referenciado en ${files.join(", ")} es huérfano: no está definido en ninguna spec`);
    }
  }

  return [...new Set(errors)].sort();
}

if (import.meta.main) {
  const errors = checkRepo("specs", "tests");
  if (errors.length > 0) {
    console.error(`spec:check — ${errors.length} error(es):`);
    for (const error of errors) console.error(`  - ${error}`);
    Deno.exit(1);
  }
  console.log("spec:check — trazabilidad OK (specs \u2194 tests \u2194 TRACEABILITY)");
}
