// Vercel serverless headshot proxy.
//
// Hardening (public-beta audit 2026-08-11): allowlist-only ids, GET/HEAD only,
// no redirects, magic-bytes validation, size cap, short negative cache.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowlistPath = path.join(__dirname, "..", "..", "deploy", "headshot-allowlist.json");
let NBA_IDS = new Set();
try {
  NBA_IDS = new Set(JSON.parse(fs.readFileSync(allowlistPath, "utf8")).nbaIds ?? []);
} catch {
  // allowlist missing: fail closed (empty set rejects everything)
}

const UPSTREAMS = [
  "https://cdn.nba.com/headshots/nba/latest/260x190",
  "https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190",
];
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const NEGATIVE_CACHE_MS = 60_000;
const negativeCache = new Map();

function isPng(buf) {
  return buf.length >= 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
}

function isJpeg(buf) {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).setHeader("Allow", "GET, HEAD").send("method not allowed");
    return;
  }
  const rawId = req.query?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id || !/^\d{4,10}$/.test(id) || id.length > 10) {
    res.status(400).send("invalid headshot id");
    return;
  }
  if (!NBA_IDS.has(id)) {
    res.status(404).send("unknown headshot id");
    return;
  }

  for (const upstream of UPSTREAMS) {
    const url = `${upstream}/${id}.png`;
    const now = Date.now();
    const lastFailure = negativeCache.get(url);
    if (lastFailure && now - lastFailure < NEGATIVE_CACHE_MS) continue;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        redirect: "error", // never follow upstream redirects
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.startsWith("image/")) {
        negativeCache.set(url, now);
        continue;
      }

      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_BODY_BYTES || (!isPng(body) && !isJpeg(body))) {
        negativeCache.set(url, now);
        continue;
      }
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(body.byteLength));
      res.status(200);
      if (req.method === "HEAD") res.end();
      else res.send(body);
      return;
    } catch {
      negativeCache.set(url, now);
      // Try the secondary NBA host before returning a controlled failure.
    }
  }

  res.status(502).send("headshot unavailable");
}
