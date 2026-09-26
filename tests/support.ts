import { createSource, type Source } from "../server/kv.ts";
import { createApp, type AppDeps } from "../server/router.ts";
import type { FetchLike } from "../server/snapshot.ts";

export type Fetcher = { fetch(request: Request): Response | Promise<Response> };

export const VALID_URL = "https://miboleteria.com.ar/xml/horarios.txt";
export const HEX64_RE = /^[0-9a-f]{64}$/;
export const fixtureText = await Deno.readTextFile(new URL("./fixtures/horarios-t0.json", import.meta.url));

export function respuesta(texto: string, status = 200): FetchLike {
  return () => Promise.resolve(new Response(texto, { status, headers: { "content-type": "text/plain" } }));
}

export function secuencial(...textos: string[]): FetchLike {
  let llamada = 0;
  return () => {
    const texto = textos[Math.min(llamada, textos.length - 1)];
    llamada++;
    return Promise.resolve(new Response(texto, { status: 200, headers: { "content-type": "text/plain" } }));
  };
}

export function revertirOrden(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(revertirOrden);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).reverse()) out[key] = revertirOrden(src[key]);
    return out;
  }
  return value;
}

export function mutarTiempo(value: unknown, hora: string): unknown {
  const data = structuredClone(value) as [{ cinemas: [{ shows: [{ dates: [{ times: [{ time: string }] }] }] }] }];
  data[0].cinemas[0].shows[0].dates[0].times[0].time = hora;
  return data;
}

export function mutarHorario(value: unknown): unknown {
  return mutarTiempo(value, "23:59");
}

export async function withApp(
  fn: (ctx: { app: Fetcher; kv: Deno.Kv; source: Source }) => Promise<void>,
  deps: AppDeps = {},
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "kv-" });
  const kv = await Deno.openKv(`${dir}/kv.db`);
  try {
    const source = await createSource(kv, { name: "Horarios MB", url: VALID_URL });
    await fn({ app: createApp(kv, deps), kv, source });
  } finally {
    kv.close();
    await Deno.remove(dir, { recursive: true });
  }
}

export async function fetchSnapshot(app: Fetcher, sourceId: string) {
  const res = await app.fetch(
    new Request(`http://localhost/api/sources/${sourceId}/fetch`, { method: "POST" }),
  );
  return { status: res.status, body: await res.json() };
}
