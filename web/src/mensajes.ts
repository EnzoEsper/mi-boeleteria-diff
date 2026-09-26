import { ApiError } from "./api.ts";

export function mensajeDe(error: unknown): string {
  if (error instanceof ApiError) {
    const issues = error.issues.map((issue) => issue.message).join(", ");
    return issues ? `${error.message}: ${issues}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
