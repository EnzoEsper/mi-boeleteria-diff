import { JSDOM } from "jsdom";

let instalado = false;

export function instalarDom(): void {
  if (instalado) return;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const globales = globalThis as unknown as Record<string, unknown>;
  globales.window = dom.window;
  globales.document = dom.window.document;
  try {
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  } catch {
    // Deno expone navigator propio; React no lo requiere para renderizar
  }
  globales.HTMLElement = dom.window.HTMLElement;
  globales.Element = dom.window.Element;
  globales.Node = dom.window.Node;
  globales.Event = dom.window.Event;
  globales.MouseEvent = dom.window.MouseEvent;
  globales.IS_REACT_ACT_ENVIRONMENT = true;
  instalado = true;
}
