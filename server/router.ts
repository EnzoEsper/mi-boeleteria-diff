import { Hono } from "hono";
import { z } from "zod";
import { diffJson } from "./diff.ts";
import { createSource, deleteSource, getSource, getSnapshot, listSnapshots, listSources } from "./kv.ts";
import {
  fetchAndStore,
  FetchSourceError,
  ingestText,
  rebuildJson,
  summarizeSnapshot,
  type FetchLike,
} from "./snapshot.ts";
import { DIST_POR_DEFECTO, servirEstatico } from "./static.ts";

export const sourceInputSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(["url", "file"]).optional(),
  url: z
    .url()
    .refine((value) => value.startsWith("http://") || value.startsWith("https://"))
    .optional(),
  headers: z.record(z.string(), z.string()).optional(),
  cronExpr: z.string().nullable().optional(),
  cronEnabled: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if ((value.type ?? "url") === "url" && value.url === undefined) {
    ctx.addIssue({ code: "custom", path: ["url"], message: "url es requerida para type url" });
  }
});

export const diffQuerySchema = z.object({
  from: z.coerce.number().int(),
  to: z.coerce.number().int(),
});

function issuesDe(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
}

export interface AppDeps {
  fetchImpl?: FetchLike;
  fullEvery?: number;
  distDir?: string;
}

export function createApp(kv: Deno.Kv, deps: AppDeps = {}): Hono {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const distDir = deps.distDir ?? DIST_POR_DEFECTO;
  const app = new Hono();

  app.post("/api/sources", async (c) => {
    let raw: unknown = null;
    try {
      raw = await c.req.json();
    } catch {
      raw = null;
    }
    const parsed = sourceInputSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validación fallida", issues: issuesDe(parsed.error) }, 400);
    }
    return c.json(await createSource(kv, parsed.data), 201);
  });

  app.get("/api/sources", async (c) => c.json(await listSources(kv)));

  app.get("/api/sources/:id", async (c) => {
    const source = await getSource(kv, c.req.param("id"));
    if (!source) return c.json({ error: "fuente no encontrada" }, 404);
    return c.json(source);
  });

  app.delete("/api/sources/:id", async (c) => {
    const id = c.req.param("id");
    const borrada = await deleteSource(kv, id);
    if (!borrada) return c.json({ error: "fuente no encontrada" }, 404);
    return c.json({ deleted: id });
  });

  app.post("/api/sources/:id/fetch", async (c) => {
    const source = await getSource(kv, c.req.param("id"));
    if (!source) return c.json({ error: "fuente no encontrada" }, 404);
    try {
      const snapshot = await fetchAndStore(kv, source, "manual", fetchImpl, { fullEvery: deps.fullEvery });
      return c.json({ sourceId: source.id, snapshot: summarizeSnapshot(snapshot) });
    } catch (error) {
      if (error instanceof FetchSourceError) return c.json({ error: error.message }, 502);
      throw error;
    }
  });

  app.post("/api/sources/:id/import", async (c) => {
    const source = await getSource(kv, c.req.param("id"));
    if (!source) return c.json({ error: "fuente no encontrada" }, 404);
    if (source.type !== "file") {
      return c.json({ error: "solo las fuentes de tipo file admiten import" }, 400);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await c.req.parseBody();
    } catch {
      body = {};
    }
    const file = body.file;
    if (!(file instanceof Blob)) {
      return c.json({
        error: "validación fallida",
        issues: [{ path: "file", message: "archivo requerido (parte file)" }],
      }, 400);
    }
    const text = await file.text();
    try {
      JSON.parse(text);
    } catch {
      return c.json({
        error: "validación fallida",
        issues: [{ path: "file", message: "el archivo debe contener JSON válido" }],
      }, 400);
    }

    try {
      const snapshot = await ingestText(kv, source, "import", text, { fullEvery: deps.fullEvery });
      return c.json({ sourceId: source.id, snapshot: summarizeSnapshot(snapshot) });
    } catch (error) {
      if (error instanceof FetchSourceError) return c.json({ error: error.message }, 502);
      throw error;
    }
  });

  app.get("/api/sources/:id/snapshots", async (c) => {
    const source = await getSource(kv, c.req.param("id"));
    if (!source) return c.json({ error: "fuente no encontrada" }, 404);
    const snapshots = await listSnapshots(kv, source.id);
    return c.json({
      sourceId: source.id,
      snapshots: snapshots.map((snapshot) => ({
        timestamp: snapshot.timestamp,
        hash: snapshot.hash,
        sizeBytes: snapshot.sizeBytes,
        changed: snapshot.changed,
        trigger: snapshot.trigger,
        hasBlob: snapshot.chunks !== undefined,
        hasDelta: snapshot.delta !== undefined,
        sinceBase: snapshot.changed ? snapshot.sinceBase ?? 0 : null,
        deltaFrom: snapshot.deltaFrom ?? null,
      })),
    });
  });

  app.get("/api/sources/:id/snapshots/:ts", async (c) => {
    const source = await getSource(kv, c.req.param("id"));
    if (!source) return c.json({ error: "fuente no encontrada" }, 404);
    const timestamp = Number(c.req.param("ts"));
    const snapshot = Number.isInteger(timestamp) ? await getSnapshot(kv, source.id, timestamp) : null;
    if (!snapshot) return c.json({ error: "snapshot no encontrado" }, 404);
    const json = await rebuildJson(kv, source.id, snapshot.timestamp);
    if (json === null) return c.json({ error: "snapshot no encontrado" }, 404);
    return c.json({ sourceId: source.id, snapshot: summarizeSnapshot(snapshot), json });
  });

  app.get("/api/sources/:id/diff", async (c) => {
    const source = await getSource(kv, c.req.param("id"));
    if (!source) return c.json({ error: "fuente no encontrada" }, 404);
    const parsed = diffQuerySchema.safeParse({ from: c.req.query("from"), to: c.req.query("to") });
    if (!parsed.success) {
      return c.json({ error: "validación fallida", issues: issuesDe(parsed.error) }, 400);
    }
    const jsonFrom = await rebuildJson(kv, source.id, parsed.data.from);
    const jsonTo = await rebuildJson(kv, source.id, parsed.data.to);
    if (jsonFrom === null || jsonTo === null) return c.json({ error: "snapshot no encontrado" }, 404);
    const delta = diffJson(jsonFrom, jsonTo) ?? null;
    return c.json({
      sourceId: source.id,
      from: parsed.data.from,
      to: parsed.data.to,
      changed: delta !== null,
      delta,
    });
  });

  app.notFound((c) => {
    const path = c.req.path;
    const esApi = path === "/api" || path.startsWith("/api/");
    if (esApi || (c.req.method !== "GET" && c.req.method !== "HEAD")) {
      return c.json({ error: "no encontrado" }, 404);
    }
    return servirEstatico(c, distDir);
  });

  return app;
}
