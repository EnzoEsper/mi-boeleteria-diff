export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface Issue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly issues: Issue[];

  constructor(status: number, message: string, issues: Issue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

export interface Fuente {
  id: string;
  name: string;
  type: "url" | "file";
  url: string;
  headers: Record<string, string>;
  cronExpr: string | null;
  cronEnabled: boolean;
  createdAt: string;
}

export interface CrearFuenteInput {
  name: string;
  type?: "url" | "file";
  url?: string;
  headers?: Record<string, string>;
  cronExpr?: string | null;
  cronEnabled?: boolean;
}

export interface ActualizarFuenteInput {
  name?: string;
  url?: string;
  headers?: Record<string, string>;
  cronExpr?: string | null;
  cronEnabled?: boolean;
}

export interface SnapshotResumen {
  timestamp: number;
  hash: string;
  sizeBytes: number;
  changed: boolean;
  trigger: "manual" | "cron" | "import";
  chunks?: number;
}

export interface EntradaSnapshot {
  timestamp: number;
  hash: string;
  sizeBytes: number;
  changed: boolean;
  trigger: "manual" | "cron" | "import";
  hasBlob: boolean;
  hasDelta: boolean;
  sinceBase: number | null;
  deltaFrom: number | null;
}

export interface ListadoSnapshots {
  sourceId: string;
  snapshots: EntradaSnapshot[];
}

export interface SnapshotDetalle {
  sourceId: string;
  snapshot: SnapshotResumen;
  json: unknown;
}

export interface FetchResponse {
  sourceId: string;
  snapshot: SnapshotResumen;
}

export interface DiffResponse {
  sourceId: string;
  from: number;
  to: number;
  changed: boolean;
  delta: unknown;
}

async function lanzarSiError(res: Response): Promise<void> {
  if (res.ok) return;
  let message = "error inesperado";
  let issues: Issue[] = [];
  try {
    const body = await res.json() as { error?: unknown; issues?: unknown };
    if (typeof body.error === "string") message = body.error;
    if (Array.isArray(body.issues)) issues = body.issues as Issue[];
  } catch {
    // body sin JSON: message por defecto
  }
  throw new ApiError(res.status, message, issues);
}

export function createApi(fetchImpl: FetchLike = fetch) {
  async function get(path: string): Promise<unknown> {
    const res = await fetchImpl(`${path}`);
    await lanzarSiError(res);
    return await res.json();
  }

  async function post(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetchImpl(`${path}`, { method: "POST", ...init });
    await lanzarSiError(res);
    return await res.json();
  }

  async function del(path: string): Promise<unknown> {
    const res = await fetchImpl(`${path}`, { method: "DELETE" });
    await lanzarSiError(res);
    return await res.json();
  }

  async function patch(path: string, body: unknown): Promise<unknown> {
    const res = await fetchImpl(`${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await lanzarSiError(res);
    return await res.json();
  }

  return {
    listSources: (): Promise<Fuente[]> => get("/api/sources") as Promise<Fuente[]>,
    getSource: (id: string): Promise<Fuente> => get(`/api/sources/${id}`) as Promise<Fuente>,
    createSource: (input: CrearFuenteInput): Promise<Fuente> =>
      post("/api/sources", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }) as Promise<Fuente>,
    fetchNow: (id: string): Promise<FetchResponse> =>
      post(`/api/sources/${id}/fetch`) as Promise<FetchResponse>,
    listSnapshots: (id: string): Promise<ListadoSnapshots> =>
      get(`/api/sources/${id}/snapshots`) as Promise<ListadoSnapshots>,
    getSnapshot: (id: string, timestamp: number): Promise<SnapshotDetalle> =>
      get(`/api/sources/${id}/snapshots/${timestamp}`) as Promise<SnapshotDetalle>,
    getDiff: (id: string, from: number, to: number): Promise<DiffResponse> =>
      get(`/api/sources/${id}/diff?from=${from}&to=${to}`) as Promise<DiffResponse>,
    importFile: (id: string, file: File): Promise<FetchResponse> => {
      const form = new FormData();
      form.append("file", file, file.name);
      return post(`/api/sources/${id}/import`, { body: form }) as Promise<FetchResponse>;
    },
    deleteSource: (id: string): Promise<{ deleted: string }> =>
      del(`/api/sources/${id}`) as Promise<{ deleted: string }>,
    updateSource: (id: string, input: ActualizarFuenteInput): Promise<Fuente> =>
      patch(`/api/sources/${id}`, input) as Promise<Fuente>,
  };
}

export type Api = ReturnType<typeof createApi>;
