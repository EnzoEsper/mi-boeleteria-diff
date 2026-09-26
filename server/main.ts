import { registerMasterCron } from "./cron.ts";
import { createApp } from "./router.ts";

export interface OpcionesDeInicio {
  port?: number;
  kvPath?: string;
  distDir?: string;
  cron?: boolean;
}

export async function start(opciones: OpcionesDeInicio = {}) {
  const port = opciones.port ?? Number(Deno.env.get("PORT") ?? 8000);
  const kv = opciones.kvPath ? await Deno.openKv(opciones.kvPath) : await Deno.openKv();
  const app = createApp(kv, opciones.distDir ? { distDir: opciones.distDir } : {});
  const cron = opciones.cron === false ? false : registerMasterCron(kv);
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
