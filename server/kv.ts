import type { JsonDelta } from "./diff.ts";

export type SourceType = "url" | "file";

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  headers: Record<string, string>;
  cronExpr: string | null;
  cronEnabled: boolean;
  createdAt: string;
}

export type SourceInput = {
  name: string;
  type?: SourceType;
  url?: string;
  headers?: Record<string, string>;
  cronExpr?: string | null;
  cronEnabled?: boolean;
};

export type SourcePatch = Partial<Pick<Source, "name" | "url" | "headers" | "cronExpr" | "cronEnabled">>;

export type SnapshotTrigger = "manual" | "cron" | "import";

export interface Snapshot {
  timestamp: number;
  hash: string;
  sizeBytes: number;
  changed: boolean;
  trigger: SnapshotTrigger;
  contentAt?: number;
  chunks?: number;
  delta?: JsonDelta;
  deltaFrom?: number;
  sinceBase?: number;
}

export interface SourceStats {
  totalSnapshots: number;
  lastChangedAt: number | null;
  errorCount: number;
  lastError: { message: string; at: number } | null;
  lastAttempt: { at: number; ok: boolean } | null;
}

export function emptyStats(): SourceStats {
  return { totalSnapshots: 0, lastChangedAt: null, errorCount: 0, lastError: null, lastAttempt: null };
}

const SOURCE_PREFIX = ["source"];
const SNAPSHOT_PREFIX = ["snapshot"];
const LATEST_PREFIX = ["latest"];
const STATS_PREFIX = ["stats"];

export function sourceKey(id: string): Deno.KvKey {
  return [...SOURCE_PREFIX, id];
}

export function snapshotKey(sourceId: string, timestamp: number): Deno.KvKey {
  return [...SNAPSHOT_PREFIX, sourceId, timestamp];
}

export function latestKey(sourceId: string): Deno.KvKey {
  return [...LATEST_PREFIX, sourceId];
}

export function statsKey(sourceId: string): Deno.KvKey {
  return [...STATS_PREFIX, sourceId];
}

export function masterTickKey(): Deno.KvKey {
  return ["masterTick"];
}

export async function createSource(kv: Deno.Kv, input: SourceInput): Promise<Source> {
  const source: Source = {
    id: crypto.randomUUID(),
    name: input.name,
    type: input.type ?? "url",
    url: input.url ?? "",
    headers: input.headers ?? {},
    cronExpr: input.cronExpr ?? null,
    cronEnabled: input.cronEnabled ?? false,
    createdAt: new Date().toISOString(),
  };
  await kv.set(sourceKey(source.id), source);
  return source;
}

export async function listSources(kv: Deno.Kv): Promise<Source[]> {
  const sources: Source[] = [];
  for await (const entry of kv.list<Source>({ prefix: [...SOURCE_PREFIX] })) {
    if (entry.key.length === SOURCE_PREFIX.length + 1) sources.push(entry.value);
  }
  return sources.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSource(kv: Deno.Kv, id: string): Promise<Source | null> {
  const entry = await kv.get<Source>(sourceKey(id));
  return entry.value;
}

export async function updateSource(kv: Deno.Kv, id: string, patch: SourcePatch): Promise<Source | null> {
  const entry = await kv.get<Source>(sourceKey(id));
  const previa = entry.value;
  if (!previa) return null;
  const actualizada: Source = { ...previa, ...patch };
  await kv.set(sourceKey(id), actualizada);
  return actualizada;
}

export async function deleteSource(kv: Deno.Kv, id: string): Promise<boolean> {
  if (!(await getSource(kv, id))) return false;
  // Las claves exactas (source/latest/stats) se borran directo: kv.list({prefix})
  // en Deno 2.6.7 EXCLUYE la clave igual al prefijo. Los prefijos con hijos
  // (snapshot/blob) sí se listan bien porque sus claves son estrictamente mayores.
  await kv.delete(sourceKey(id));
  await kv.delete(latestKey(id));
  await kv.delete(statsKey(id));
  for (const prefijo of [["snapshot", id], ["blob", id]] as const) {
    for await (const entry of kv.list({ prefix: prefijo })) {
      await kv.delete(entry.key);
    }
  }
  return true;
}

export async function getSnapshot(kv: Deno.Kv, sourceId: string, timestamp: number): Promise<Snapshot | null> {
  const entry = await kv.get<Snapshot>(["snapshot", sourceId, timestamp]);
  return entry.value;
}

export async function listSnapshots(kv: Deno.Kv, sourceId: string): Promise<Snapshot[]> {
  const snapshots: Snapshot[] = [];
  for await (const entry of kv.list<Snapshot>({ prefix: ["snapshot", sourceId] })) {
    snapshots.push(entry.value);
  }
  return snapshots.sort((a, b) => b.timestamp - a.timestamp);
}

export async function putSnapshot(kv: Deno.Kv, sourceId: string, snapshot: Snapshot): Promise<void> {
  await kv.set(snapshotKey(sourceId, snapshot.timestamp), snapshot);
}

export async function getLatestTimestamp(kv: Deno.Kv, sourceId: string): Promise<number | null> {
  const entry = await kv.get<number>(latestKey(sourceId));
  return entry.value;
}

export async function setLatestTimestamp(kv: Deno.Kv, sourceId: string, timestamp: number): Promise<void> {
  await kv.set(latestKey(sourceId), timestamp);
}

export async function getStats(kv: Deno.Kv, sourceId: string): Promise<SourceStats> {
  const entry = await kv.get<SourceStats>(statsKey(sourceId));
  // merge con emptyStats: las entradas viejas (sin lastAttempt) normalizan a null
  return { ...emptyStats(), ...(entry.value ?? {}) };
}

export async function saveStats(kv: Deno.Kv, sourceId: string, stats: SourceStats): Promise<void> {
  await kv.set(statsKey(sourceId), stats);
}

export const KV_MAX_VALUE_BYTES = 65_536;
export const BLOB_CHUNK_SIZE = 60_000;
export const SAFE_VALUE_BYTES = 60_000;

export function blobChunkKey(sourceId: string, timestamp: number, index: number): Deno.KvKey {
  return ["blob", sourceId, timestamp, index];
}

export async function putBlob(
  kv: Deno.Kv,
  sourceId: string,
  timestamp: number,
  text: string,
): Promise<number> {
  const bytes = new TextEncoder().encode(text);
  const chunkCount = Math.max(1, Math.ceil(bytes.length / BLOB_CHUNK_SIZE));
  for (let index = 0; index < chunkCount; index++) {
    const start = index * BLOB_CHUNK_SIZE;
    const end = Math.min(start + BLOB_CHUNK_SIZE, bytes.length);
    await kv.set(blobChunkKey(sourceId, timestamp, index), bytes.slice(start, end));
  }
  return chunkCount;
}

export async function getBlob(
  kv: Deno.Kv,
  sourceId: string,
  timestamp: number,
  chunkCount: number,
): Promise<string | null> {
  const parts: Uint8Array[] = [];
  for (let index = 0; index < chunkCount; index++) {
    const entry = await kv.get<Uint8Array>(blobChunkKey(sourceId, timestamp, index));
    if (!entry.value) return null;
    parts.push(entry.value);
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(merged);
}
