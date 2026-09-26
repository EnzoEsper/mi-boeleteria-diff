import { extname, fromFileUrl, isAbsolute, join, normalize, SEPARATOR } from "@std/path";
import type { Context } from "hono";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const CACHE_ASSETS = "public, max-age=31536000, immutable";
const CACHE_NO_CACHE = "no-cache";

export const DIST_POR_DEFECTO = fromFileUrl(new URL("../web/dist", import.meta.url));

function cacheDe(rutaRelativa: string): string {
  return rutaRelativa.replace(/^\/+/, "").startsWith("assets/") ? CACHE_ASSETS : CACHE_NO_CACHE;
}

async function servirArchivo(c: Context, ruta: string, cacheControl: string): Promise<Response | null> {
  try {
    const info = await Deno.stat(ruta);
    if (!info.isFile) return null;
    const contenido = await Deno.readFile(ruta);
    const tipo = MIME[extname(ruta).toLowerCase()] ?? "application/octet-stream";
    return c.body(new Uint8Array(contenido), 200, { "content-type": tipo, "cache-control": cacheControl });
  } catch {
    return null;
  }
}

export async function servirEstatico(c: Context, distDir: string): Promise<Response> {
  let path: string;
  try {
    path = decodeURIComponent(c.req.path);
  } catch {
    return c.json({ error: "ruta inválida" }, 404);
  }

  const relativa = path.replace(/^\/+/, "");
  const normalizada = normalize(relativa);
  const escapa = normalizada === ".." ||
    normalizada.startsWith(`..${SEPARATOR}`) ||
    normalizada.startsWith("../") ||
    isAbsolute(normalizada);
  if (escapa) return c.json({ error: "ruta inválida" }, 404);
  const destino = join(distDir, normalizada);
  if (destino !== distDir && !destino.startsWith(distDir + SEPARATOR)) {
    return c.json({ error: "ruta inválida" }, 404);
  }

  const esArchivo = extname(relativa) !== "" && !path.endsWith("/");
  if (esArchivo) {
    const respuesta = await servirArchivo(c, destino, cacheDe(relativa));
    if (respuesta) return respuesta;
    return c.json({ error: "no encontrado" }, 404);
  }

  const index = await servirArchivo(c, join(distDir, "index.html"), CACHE_NO_CACHE);
  if (index) return index;
  return c.json({ error: "web/dist no encontrado — corré deno task build" }, 404);
}
