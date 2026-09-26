import { applyPatch, diffJson, hashJson, type JsonDelta } from "./diff.ts";
import {
  getBlob,
  getLatestTimestamp,
  getSnapshot,
  getStats,
  putBlob,
  putSnapshot,
  SAFE_VALUE_BYTES,
  saveStats,
  setLatestTimestamp,
  type Snapshot,
  type SnapshotTrigger,
  type Source,
} from "./kv.ts";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const FULL_EVERY_DEFAULT = 20;

export interface SnapshotOptions {
  fullEvery?: number;
}

export class FetchSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchSourceError";
  }
}

async function recordError(kv: Deno.Kv, sourceId: string, message: string): Promise<void> {
  const stats = await getStats(kv, sourceId);
  stats.errorCount += 1;
  stats.lastError = { message, at: Date.now() };
  await saveStats(kv, sourceId, stats);
}

export async function fetchAndStore(
  kv: Deno.Kv,
  source: Source,
  trigger: SnapshotTrigger,
  fetchImpl: FetchLike = fetch,
  options: SnapshotOptions = {},
): Promise<Snapshot> {
  let text: string;
  try {
    const response = await fetchImpl(source.url, { headers: source.headers });
    if (!response.ok) throw new FetchSourceError(`HTTP ${response.status} al fetchear ${source.url}`);
    text = await response.text();
  } catch (error) {
    const message = error instanceof FetchSourceError
      ? error.message
      : `fetch falló: ${error instanceof Error ? error.message : String(error)}`;
    await recordError(kv, source.id, message);
    throw new FetchSourceError(message);
  }
  return await ingestText(kv, source, trigger, text, options);
}

export async function ingestText(
  kv: Deno.Kv,
  source: Source,
  trigger: SnapshotTrigger,
  text: string,
  options: SnapshotOptions = {},
): Promise<Snapshot> {
  const fullEvery = options.fullEvery ?? FULL_EVERY_DEFAULT;

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const message = `la respuesta no es JSON válido (${source.url})`;
    await recordError(kv, source.id, message);
    throw new FetchSourceError(message);
  }

  const hash = await hashJson(data);
  const sizeBytes = new TextEncoder().encode(text).length;
  const latestTimestamp = await getLatestTimestamp(kv, source.id);
  const previous = latestTimestamp === null ? null : await getSnapshot(kv, source.id, latestTimestamp);
  const changed = previous === null || previous.hash !== hash;

  let timestamp = Date.now();
  while (await getSnapshot(kv, source.id, timestamp)) timestamp += 1;

  const snapshot: Snapshot = { timestamp, hash, sizeBytes, changed, trigger };

  if (!changed && previous) {
    snapshot.contentAt = previous.contentAt ?? previous.timestamp;
  } else {
    const previousContentTs = previous ? previous.contentAt ?? previous.timestamp : null;
    const previousContent = previousContentTs === null
      ? null
      : await getSnapshot(kv, source.id, previousContentTs);

    let delta: JsonDelta | undefined;
    let deltaFrom: number | undefined;
    let sinceBase = 0;

    if (previousContent) {
      const before = await rebuildJson(kv, source.id, previousContent.timestamp);
      if (before !== null) {
        delta = diffJson(before, data);
        deltaFrom = previousContent.timestamp;
        sinceBase = (previousContent.sinceBase ?? 0) + 1;
      }
    }

    snapshot.contentAt = timestamp;
    const registro = { ...snapshot, delta, deltaFrom, sinceBase };
    const deltaBytes = delta === undefined
      ? 0
      : new TextEncoder().encode(JSON.stringify(delta)).length;
    const registroBytes = delta === undefined
      ? 0
      : new TextEncoder().encode(JSON.stringify(registro)).length;
    const esBase = delta === undefined ||
      sinceBase >= fullEvery ||
      deltaBytes >= sizeBytes ||
      registroBytes > SAFE_VALUE_BYTES;

    if (esBase || delta === undefined) {
      snapshot.chunks = await putBlob(kv, source.id, timestamp, text);
      snapshot.sinceBase = 0;
    } else {
      snapshot.delta = delta;
      snapshot.deltaFrom = deltaFrom;
      snapshot.sinceBase = sinceBase;
    }
  }

  await putSnapshot(kv, source.id, snapshot);
  await setLatestTimestamp(kv, source.id, timestamp);

  const stats = await getStats(kv, source.id);
  stats.totalSnapshots += 1;
  if (changed) stats.lastChangedAt = timestamp;
  await saveStats(kv, source.id, stats);

  return snapshot;
}

export function summarizeSnapshot(snapshot: Snapshot): Snapshot {
  const summary: Snapshot = {
    timestamp: snapshot.timestamp,
    hash: snapshot.hash,
    sizeBytes: snapshot.sizeBytes,
    changed: snapshot.changed,
    trigger: snapshot.trigger,
  };
  if (snapshot.chunks !== undefined) summary.chunks = snapshot.chunks;
  return summary;
}

export async function readSnapshotJson(kv: Deno.Kv, sourceId: string, snapshot: Snapshot): Promise<unknown> {
  if (snapshot.chunks === undefined) return null;
  const text = await getBlob(kv, sourceId, snapshot.timestamp, snapshot.chunks);
  if (text === null) return null;
  return JSON.parse(text);
}

export async function rebuildJson(kv: Deno.Kv, sourceId: string, timestamp: number): Promise<unknown | null> {
  const snapshot = await getSnapshot(kv, sourceId, timestamp);
  if (!snapshot) return null;

  if (snapshot.chunks !== undefined) {
    return await readSnapshotJson(kv, sourceId, snapshot);
  }
  if (snapshot.delta !== undefined && snapshot.deltaFrom !== undefined) {
    const before = await rebuildJson(kv, sourceId, snapshot.deltaFrom);
    if (before === null) return null;
    return applyPatch(before, snapshot.delta);
  }
  if (!snapshot.changed && snapshot.contentAt !== undefined && snapshot.contentAt !== timestamp) {
    return await rebuildJson(kv, sourceId, snapshot.contentAt);
  }
  return null;
}
