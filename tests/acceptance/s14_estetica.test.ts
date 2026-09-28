import { assert, assertEquals } from "@std/assert";

const src = new URL("../../web/src/", import.meta.url);

async function nombresDeComponentes(): Promise<string[]> {
  const nombres: string[] = [];
  for await (const entrada of Deno.readDir(src)) {
    if (entrada.isFile && entrada.name.endsWith(".tsx")) nombres.push(entrada.name);
  }
  return nombres.sort();
}

async function clasesUsadas(): Promise<string[]> {
  const clases = new Set<string>();
  for (const nombre of await nombresDeComponentes()) {
    const fuente = await Deno.readTextFile(new URL(nombre, src));
    for (const coincidencia of fuente.matchAll(/className="([^"]*)"/g)) {
      for (const clase of coincidencia[1].split(/\s+/).filter(Boolean)) clases.add(clase);
    }
  }
  return [...clases].sort();
}

// ---------------------------------------------------------------------------
// AC-14.1
// ---------------------------------------------------------------------------

Deno.test("AC-14.1: cada clase de los componentes tiene regla en index.css", async () => {
  const css = await Deno.readTextFile(new URL("index.css", src));
  const clases = await clasesUsadas();
  assert(clases.length > 0, "debe haber clases de componente para verificar");
  const faltantes = clases.filter((clase) => !css.includes(`.${clase}`));
  assertEquals(faltantes, [], `clases sin regla en index.css: ${faltantes.join(", ")}`);
});

// ---------------------------------------------------------------------------
// AC-14.2
// ---------------------------------------------------------------------------

Deno.test("AC-14.2: index.css define tokens, modo oscuro, responsive y reglas de estado", async () => {
  const css = await Deno.readTextFile(new URL("index.css", src));
  assert(/:root\s*\{[^}]*--accent/.test(css), "tokens de color en :root");
  assert(css.includes("prefers-color-scheme: dark"), "variante dark por media query");
  assert(css.includes("--sans"), "token de tipografía");
  assert(/body\s*\{[^}]*background/.test(css), "estilo de body con fondo");
  assert(/@media\s*\(max-width/.test(css), "breakpoint responsive");
  for (const selector of [".error", ".badge", ".resultado", ".filtros", ".comparador", ".timeline", ".diff-viewer"]) {
    assert(css.includes(selector), `falta la regla ${selector}`);
  }
  assert(/\.timeline\s*\{[^}]*display\s*:\s*flex/s.test(css), ".timeline debe ser flex");
  assert(/@media\s*\(prefers-color-scheme:\s*dark\)/.test(css) || css.includes("color-scheme"), "soporte de esquema de color");
});

// ---------------------------------------------------------------------------
// AC-14.3
// ---------------------------------------------------------------------------

Deno.test("AC-14.3: sin App.css ni imports de CSS fuera de main.tsx, diff integrado", async () => {
  let appCssExiste = true;
  try {
    await Deno.stat(new URL("App.css", src));
  } catch {
    appCssExiste = false;
  }
  assertEquals(appCssExiste, false, "el App.css del scaffold debe eliminarse");

  for (const nombre of await nombresDeComponentes()) {
    if (nombre === "main.tsx") continue; // único entrypoint: a él SÍ le corresponden los imports de CSS
    const fuente = await Deno.readTextFile(new URL(nombre, src));
    assert(!/from\s+["'][^"']*\.css["']/.test(fuente), `${nombre} no debe importar CSS`);
    assert(!/import\s+["'][^"']*\.css["']/.test(fuente), `${nombre} no debe importar CSS`);
  }

  const main = await Deno.readTextFile(new URL("main.tsx", src));
  assert(!main.includes("jsondiffpatch/formatters/styles/html.css"), "main.tsx ya no importa el CSS del formatter (S27)");
  assert(main.includes("./index.css"), "main.tsx importa index.css");

  const css = await Deno.readTextFile(new URL("index.css", src));
  assert(css.includes(".dif-"), "index.css integra las reglas del diff de líneas");
  assert(!css.includes(".jsondiffpatch-"), "index.css ya no tiene reglas del formatter (S27)");
});
