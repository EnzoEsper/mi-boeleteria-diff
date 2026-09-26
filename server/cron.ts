import { CronExpressionParser } from "cron-parser";
import { listSources } from "./kv.ts";
import { fetchAndStore, type FetchLike } from "./snapshot.ts";

export interface CronTickDeps {
  fetchImpl?: FetchLike;
  now?: Date;
}

export interface CronTickResult {
  ok: string[];
  skipped: string[];
  failures: { sourceId: string; error: string }[];
}

export function matchesCron(expr: string, date: Date): boolean {
  const aligned = new Date(date);
  aligned.setSeconds(0, 0);
  const prev = new Date(aligned.getTime() - 60_000);
  const next = CronExpressionParser.parse(expr, { currentDate: prev }).next().toDate();
  return next.getTime() === aligned.getTime();
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function cronTick(kv: Deno.Kv, deps: CronTickDeps = {}): Promise<CronTickResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? new Date();
  const result: CronTickResult = { ok: [], skipped: [], failures: [] };

  for (const source of await listSources(kv)) {
    if (source.type !== "url" || !source.cronEnabled) {
      result.skipped.push(source.id);
      continue;
    }
    if (source.cronExpr !== null) {
      let coincide = false;
      try {
        coincide = matchesCron(source.cronExpr, now);
      } catch (error) {
        result.failures.push({
          sourceId: source.id,
          error: `cron inválido (${source.cronExpr}): ${mensajeDe(error)}`,
        });
        continue;
      }
      if (!coincide) {
        result.skipped.push(source.id);
        continue;
      }
    }
    try {
      await fetchAndStore(kv, source, "cron", fetchImpl);
      result.ok.push(source.id);
    } catch (error) {
      result.failures.push({ sourceId: source.id, error: mensajeDe(error) });
    }
  }
  return result;
}

type DenoCronFn = (name: string, expression: string, handler: () => Promise<void>) => unknown;

export function registerMasterCron(kv: Deno.Kv, fetchImpl: FetchLike = fetch): boolean {
  const denoCron = (Deno as unknown as { cron?: DenoCronFn }).cron;
  if (typeof denoCron !== "function") return false;
  denoCron("scheduler", "* * * * *", async () => {
    await cronTick(kv, { fetchImpl });
  });
  return true;
}
