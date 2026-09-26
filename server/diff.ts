import { create } from "jsondiffpatch";

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      result[key] = canonicalize(record[key]);
    }
    return result;
  }
  return value;
}

export async function hashJson(value: unknown): Promise<string> {
  const json = JSON.stringify(canonicalize(value));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const differ = create({
  objectHash: (value: unknown) => {
    if (value !== null && typeof value === "object" && "id" in value) {
      const id = (value as { id: unknown }).id;
      if (typeof id === "string" || typeof id === "number") return String(id);
    }
    return JSON.stringify(canonicalize(value));
  },
});

export type JsonDelta = NonNullable<ReturnType<typeof differ.diff>>;

export function diffJson(before: unknown, after: unknown): JsonDelta | undefined {
  return differ.diff(before, after);
}

export function applyPatch(target: unknown, delta: JsonDelta): unknown {
  return differ.patch(target, delta);
}
