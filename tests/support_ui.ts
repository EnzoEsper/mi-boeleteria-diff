import { assert } from "@std/assert";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";
import type { Api } from "../web/src/api.ts";
import { instalarDom } from "./dom.ts";

// react-dom debe cargarse DESPUÉS del DOM: evalúa canUseDOM al importarse y,
// con window.document ausente, desactiva el soporte de eventos "input".
instalarDom();

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");

export { act, createElement };

export function apiStub(sobrescribir: Partial<Api>): Api {
  const noImplementado = () => Promise.reject(new Error("método no stubbeado"));
  return {
    listSources: noImplementado as Api["listSources"],
    getSource: noImplementado as Api["getSource"],
    createSource: noImplementado as Api["createSource"],
    fetchNow: noImplementado as Api["fetchNow"],
    listSnapshots: noImplementado as Api["listSnapshots"],
    getSnapshot: noImplementado as Api["getSnapshot"],
    getDiff: noImplementado as Api["getDiff"],
    importFile: noImplementado as Api["importFile"],
    deleteSource: noImplementado as Api["deleteSource"],
    ...sobrescribir,
  };
}

export const esperar = () => new Promise((resolve) => setTimeout(resolve, 0));

export interface Pagina {
  container: HTMLElement;
  desmontar: () => Promise<void>;
}

// Acción + flush en UN solo act: si se usa `await act(...)` dos veces, el await
// entre ambos cede y las microtasks de los .then de React corren fuera de act.
export async function montar(elemento: ReactNode): Promise<Pagina> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(elemento);
    await esperar();
  });
  return {
    container,
    desmontar: async () => {
      await act(() => {
        root.unmount();
      });
      container.remove();
      // la ruta no debe contaminar al siguiente test (S15: navegación por URL)
      globalThis.window.history.replaceState({}, "", "/");
    },
  };
}

export async function click(elemento: Element): Promise<void> {
  await act(async () => {
    // Un checkbox/radio necesita el click nativo (alterna checked y dispara el
    // evento como en el navegador); dispatchEvent a secas no alterna checked.
    if (elemento.nodeName === "INPUT") {
      const input = elemento as HTMLInputElement;
      if (input.type === "checkbox" || input.type === "radio") {
        input.click();
        await esperar();
        return;
      }
    }
    elemento.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await esperar();
  });
}

export async function enviarForm(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await esperar();
  });
}

function cambiarValor(el: HTMLInputElement | HTMLSelectElement, texto: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  assert(setter, "setter nativo de value no encontrado");
  setter.call(el, texto);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export async function escribirEn(el: HTMLInputElement | HTMLSelectElement, texto: string): Promise<void> {
  await act(async () => {
    cambiarValor(el, texto);
    await esperar();
  });
}

export async function elegirArchivo(input: HTMLInputElement, file: File): Promise<void> {
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await esperar();
  });
}

export function buscar<T extends Element>(container: HTMLElement, selector: string): T {
  const elemento = container.querySelector<T>(selector);
  assert(elemento, `no encontré ${selector} en: ${container.innerHTML.slice(0, 300)}`);
  return elemento;
}

export function boton(container: HTMLElement, texto: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === texto);
  assert(btn, `no encontré el botón "${texto}"`);
  return btn;
}
