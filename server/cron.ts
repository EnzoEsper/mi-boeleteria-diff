import { CronExpressionParser } from "cron-parser";
import { listSources, masterTickKey } from "./kv.ts";
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

export const MASTER_CRON_DEFAULT = "0 9,21 * * *";
const VENTANA_PRIMER_TICK_MS = 24 * 60 * 60 * 1000;

export function masterCronExpr(): string {
  const expr = Deno.env.get("MASTER_CRON")?.trim();
  if (expr) {
    try {
      CronExpressionParser.parse(expr);
      return expr;
    } catch {
      // env inválida → default
    }
  }
  return MASTER_CRON_DEFAULT;
}

function alinearAMinuto(date: Date): Date {
  const aligned = new Date(date);
  aligned.setSeconds(0, 0);
  return aligned;
}

export function matchesCron(expr: string, desde: Date, hasta: Date): boolean {
  const primera = CronExpressionParser.parse(expr, { currentDate: desde }).next().toDate();
  return primera.getTime() <= hasta.getTime();
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function cronTick(kv: Deno.Kv, deps: CronTickDeps = {}): Promise<CronTickResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const hasta = alinearAMinuto(deps.now ?? new Date());
  const ultimo = await kv.get<number>(masterTickKey());
  const desde = ultimo.value !== null
    ? new Date(ultimo.value)
    : new Date(hasta.getTime() - VENTANA_PRIMER_TICK_MS);
  const result: CronTickResult = { ok: [], skipped: [], failures: [] };

  for (const source of await listSources(kv)) {
    if (source.type !== "url" || !source.cronEnabled) {
      result.skipped.push(source.id);
      continue;
    }
    if (source.cronExpr !== null) {
      let coincide = false;
      try {
        coincide = matchesCron(source.cronExpr, desde, hasta);
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
  await kv.set(masterTickKey(), hasta.getTime());
  return result;
}

type DenoCronFn = (name: string, expression: string, handler: () => Promise<void>) => unknown;

export function registerMasterCron(kv: Deno.Kv, fetchImpl: FetchLike = fetch): boolean {
  const denoCron = (Deno as unknown as { cron?: DenoCronFn }).cron;
  if (typeof denoCron !== "function") return false;
  denoCron("scheduler", masterCronExpr(), async () => {
    await cronTick(kv, { fetchImpl });
  });
  return true;
}
