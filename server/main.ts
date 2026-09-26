import { cronTick, registerMasterCron } from "./cron.ts";
import { createApp } from "./router.ts";

export interface OpcionesDeInicio {
  port?: number;
  kvPath?: string;
  distDir?: string;
  cron?: boolean;
}

type DenoCronFn = (name: string, expression: string, handler: () => Promise<void>) => unknown;

// Deno Deploy EA descubre `Deno.cron()` solo a nivel de módulo: los registros
// hechos dentro de start() o tras awaits no se agendan. El handler abre su
// propia KV (la gestionada asignada al app, sin path).
const denoCron = (Deno as unknown as { cron?: DenoCronFn }).cron;
if (Deno.env.get("DENO_DEPLOY") === "1" && typeof denoCron === "function") {
  denoCron("scheduler-deploy", "* * * * *", async () => {
    const kv = await Deno.openKv();
    try {
      await cronTick(kv);
    } finally {
      kv.close();
    }
  });
}

export async function start(opciones: OpcionesDeInicio = {}) {
  const port = opciones.port ?? Number(Deno.env.get("PORT") ?? 8000);
  const kv = opciones.kvPath ? await Deno.openKv(opciones.kvPath) : await Deno.openKv();
  const app = createApp(kv, opciones.distDir ? { distDir: opciones.distDir } : {});
  const enEA = Deno.env.get("DENO_DEPLOY") === "1";
  const cron = opciones.cron === false || enEA ? false : registerMasterCron(kv);
  const estadoCron = opciones.cron === false ? "deshabilitado" : cron ? "activo" : "no soportado";
  const server = await Deno.serve({ port }, app.fetch);
  const direccion = server.addr;
  const puertoReal = direccion.transport === "tcp" ? direccion.port : port;
  console.log(`server escuchando en http://localhost:${puertoReal} (cron maestro: ${estadoCron})`);
  server.finished.catch(() => {}).finally(() => kv.close());
  return server;
}

if (import.meta.main) {
  await start();
}
