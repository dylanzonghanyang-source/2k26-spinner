// Standalone headshot proxy for 2kspinner (replaces Vercel api/nba-headshots).
// Listens on 127.0.0.1:3001, fronted by Caddy.
//
// Hardening (public-beta audit 2026-08-11):
// - allowlist only: ids/slugs the app actually references (deploy/headshot-allowlist.json)
// - GET/HEAD only; id/slug length caps
// - no redirects followed; content-type + magic-bytes validation (PNG/JPEG only)
// - response size cap; short negative cache on upstream failure; concurrency cap
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLOWLIST = JSON.parse(
  fs.readFileSync(path.join(__dirname, "headshot-allowlist.json"), "utf8"),
);
const NBA_IDS = new Set(ALLOWLIST.nbaIds ?? []);
const HISTORICAL_SLUGS = new Set(ALLOWLIST.historicalSlugs ?? []);

const NBA_UPSTREAMS = [
  "https://cdn.nba.com/headshots/nba/latest/260x190",
  "https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190",
];
const HISTORICAL_BASE =
  "https://www.basketball-reference.com/req/202605210/images/headshots";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
const NEGATIVE_CACHE_MS = 60_000;
const MAX_CONCURRENCY = 12;

let activeRequests = 0;
/** url -> lastFailureEpochMs */
const negativeCache = new Map();

function isPng(buf) {
  return buf.length >= 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
}

function isJpeg(buf) {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

async function fetchImage(url) {
  const now = Date.now();
  const lastFailure = negativeCache.get(url);
  if (lastFailure && now - lastFailure < NEGATIVE_CACHE_MS) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Referer: "https://www.nba.com/" },
      redirect: "error", // never follow upstream redirects
    });
    if (!res.ok) {
      negativeCache.set(url, now);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      negativeCache.set(url, now);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BODY_BYTES) {
      negativeCache.set(url, now);
      return null;
    }
    // magic bytes: PNG or JPEG only (content-type alone is spoofable)
    if (!isPng(buf) && !isJpeg(buf)) {
      negativeCache.set(url, now);
      return null;
    }
    return { contentType, buf };
  } catch {
    negativeCache.set(url, now);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end("method not allowed");
    return;
  }
  if (activeRequests >= MAX_CONCURRENCY) {
    res.writeHead(503).end("busy");
    return;
  }
  activeRequests += 1;

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let img = null;

  try {
    if (url.pathname.startsWith("/nba-headshots/")) {
      const id = url.pathname.slice("/nba-headshots/".length).replace(/\.png$/, "");
      if (!/^\d{4,10}$/.test(id) || id.length > 10) {
        res.writeHead(400).end("invalid headshot id");
        return;
      }
      if (!NBA_IDS.has(id)) {
        res.writeHead(404).end("unknown headshot id");
        return;
      }
      for (const upstream of NBA_UPSTREAMS) {
        img = await fetchImage(`${upstream}/${id}.png`);
        if (img) break;
      }
    } else if (url.pathname.startsWith("/historical-headshots/")) {
      const slug = url.pathname
        .slice("/historical-headshots/".length)
        .replace(/\.jpg$/, "");
      if (!/^[a-z0-9]{4,40}$/.test(slug)) {
        res.writeHead(400).end("invalid slug");
        return;
      }
      if (!HISTORICAL_SLUGS.has(slug)) {
        res.writeHead(404).end("unknown slug");
        return;
      }
      img = await fetchImage(`${HISTORICAL_BASE}/${slug}.jpg`);
    } else {
      res.writeHead(404).end("not found");
      return;
    }

    if (!img) {
      res.writeHead(502).end("headshot unavailable");
      return;
    }
    res.writeHead(200, {
      "Content-Type": img.contentType,
      "Content-Length": String(img.buf.length),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    });
    if (req.method === "HEAD") res.end();
    else res.end(img.buf);
  } finally {
    activeRequests -= 1;
  }
});

server.listen(3001, "127.0.0.1", () => {
  console.log("[headshots-proxy] listening on 127.0.0.1:3001");
});
