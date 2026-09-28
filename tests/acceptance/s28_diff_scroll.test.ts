import { assert, assertEquals } from "@std/assert";
import { boton, buscar, click, createElement, montar } from "../support_ui.ts";

const { DiffViewer } = await import("../../web/src/DiffViewer.tsx");

const DELTA = { h: ["10:00", "11:00"] };
const LEFT = { h: "10:00" };

function bloque(css: string, selector: string): string {
  return css.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`))?.[0] ?? "";
}

// ---------------------------------------------------------------------------
// AC-28.1
// ---------------------------------------------------------------------------

Deno.test("AC-28.1: las celdas de código envuelven sin scroll ni recorte", async () => {
  const css = await Deno.readTextFile(new URL("../../web/src/index.css", import.meta.url));
  const regla = bloque(css, ".dif-codigo");
  assert(regla, "falta la regla .dif-codigo en index.css");
  assert(regla.includes("white-space: pre-wrap"), "el código debe envolver en lugar de scrollear");
  assert(regla.includes("overflow-wrap: anywhere"), "las palabras largas deben poder cortarse");
  assert(!regla.includes("overflow-x"), ".dif-codigo ya no debe declarar scroll horizontal");
  assert(!regla.includes("text-overflow"), ".dif-codigo no debe recortar con ellipsis");
});

Deno.test("AC-28.1: una línea larga se muestra completa en ambos lados", async () => {
  const largo = "A".repeat(240);
  const pagina = await montar(
    createElement(DiffViewer, {
      delta: { u: [`${largo}1`, `${largo}2`] },
      left: { u: `${largo}1` },
      nombre: "largo",
    }),
  );

  const viejo = buscar(pagina.container, ".dif-codigo.dif-del");
  const nuevo = buscar(pagina.container, ".dif-codigo.dif-add");
  assert((viejo.textContent ?? "").includes(largo), "el texto viejo completo debe estar en el DOM");
  assert((nuevo.textContent ?? "").includes(largo), "el texto nuevo completo debe estar en el DOM");

  await pagina.desmontar();
});

// ---------------------------------------------------------------------------
// AC-28.2
// ---------------------------------------------------------------------------

Deno.test("AC-28.2: la tabla es de columnas fijas con colgroup por modo", async () => {
  const css = await Deno.readTextFile(new URL("../../web/src/index.css", import.meta.url));
  const tabla = bloque(css, ".dif-tabla");
  assert(tabla.includes("table-layout: fixed"), "la tabla debe ser de columnas fijas");
  assert(/width:\s*60px/.test(bloque(css, ".dif-col-num")), ".dif-col-num debe reservar 60px");
  assert(/width:\s*20px/.test(bloque(css, ".dif-col-marca")), ".dif-col-marca debe reservar 20px");

  const pagina = await montar(createElement(DiffViewer, { delta: DELTA, left: LEFT }));
  const cols = () =>
    [...pagina.container.querySelectorAll(".dif-tabla col")].map((c) => c.getAttribute("class") ?? "");

  assertEquals(
    cols(),
    ["dif-col-num", "", "dif-col-num", ""],
    "split: dos columnas de números y dos de código sin width (50/50)",
  );

  await click(boton(pagina.container, "Unified"));
  assertEquals(
    cols(),
    ["dif-col-num", "dif-col-num", "dif-col-marca", ""],
    "unified: números, marca y la columna de código",
  );

  await pagina.desmontar();
});
