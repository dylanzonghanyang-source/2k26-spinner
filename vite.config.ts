import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const HEADSHOT_UPSTREAMS = [
  "https://cdn.nba.com/headshots/nba/latest/260x190",
  "https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190",
] as const;
const HEADSHOT_CACHE_LIMIT = 128;
const headshotCache = new Map<string, { body: Buffer; contentType: string }>();

function cacheHeadshot(id: string, body: Buffer, contentType: string) {
  if (headshotCache.size >= HEADSHOT_CACHE_LIMIT) {
    const oldestKey = headshotCache.keys().next().value;
    if (oldestKey) headshotCache.delete(oldestKey);
  }
  headshotCache.set(id, { body, contentType });
}

function sendHeadshot(res: ServerResponse, body: Buffer, contentType: string, cacheState: "HIT" | "MISS") {
  res.writeHead(200, {
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "Content-Length": String(body.byteLength),
    "Content-Type": contentType,
    "X-Headshot-Cache": cacheState,
  });
  res.end(body);
}

async function headshotMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  const id = req.url?.match(/^\/nba-headshots\/(\d+)\.png(?:\?.*)?$/)?.[1];
  if (!id) {
    next();
    return;
  }

  const cached = headshotCache.get(id);
  if (cached) {
    sendHeadshot(res, cached.body, cached.contentType, "HIT");
    return;
  }

  for (const upstream of HEADSHOT_UPSTREAMS) {
    try {
      const response = await fetch(`${upstream}/${id}.png`, {
        signal: AbortSignal.timeout(8000),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.startsWith("image/")) continue;

      const body = Buffer.from(await response.arrayBuffer());
      cacheHeadshot(id, body, contentType);
      sendHeadshot(res, body, contentType, "MISS");
      return;
    } catch {
      // Try the next trusted NBA image host before returning a controlled failure.
    }
  }

  res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("headshot unavailable");
}

function headshotProxyPlugin(): Plugin {
  return {
    name: "nba-headshot-proxy",
    configureServer(server) {
      server.middlewares.use(headshotMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(headshotMiddleware);
    },
  };
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/2k26-spinner/" : "/",
  plugins: [headshotProxyPlugin(), react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (normalized.includes("/node_modules/")) return "vendor";
          if (normalized.endsWith("/src/data/players.json")) return "players-data";
          if (normalized.endsWith("/src/data/rosterCatalog.json")) return "roster-data";
          if (/\/src\/data\/badgeProfiles\.2k\d+\.json$/.test(normalized)) return "badge-data";
          if (normalized.includes("/src/data/versions/2k26/players.json")) return "players-2k26-data";
          if (normalized.includes("/src/data/versions/2k27-play-now/players.json")) return "players-2k27-data";
          if (normalized.includes("/src/data/versions/2k26/rosterCatalog.json")) return "roster-2k26-data";
          if (normalized.includes("/src/data/versions/2k27-play-now/rosterCatalog.json")) return "roster-2k27-data";
          if (normalized.includes("/src/data/versions/2k26/badges.json")) return "badges-2k26-data";
          if (normalized.includes("/src/data/versions/2k27-play-now/badges.json")) return "badges-2k27-data";
          if (normalized.includes("/src/data/versions/2k26/rookieOverallModel.json")) return "ovr-2k26-model";
          if (normalized.includes("/src/data/versions/2k27-play-now/rookieOverallModel.json")) return "ovr-2k27-model";
          return undefined;
        },
      },
    },
  },
});
