// Standalone headshot proxy for 2kspinner (replaces Vercel api/nba-headshots).
// Listens on 127.0.0.1:3001, fronted by Caddy.
import http from "node:http";

const NBA_UPSTREAMS = [
  "https://cdn.nba.com/headshots/nba/latest/260x190",
  "https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190",
];
const HISTORICAL_BASE =
  "https://www.basketball-reference.com/req/202605210/images/headshots";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function fetchImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Referer: "https://www.nba.com/" },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return { contentType, buf };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let img = null;

  if (url.pathname.startsWith("/nba-headshots/")) {
    const id = url.pathname.slice("/nba-headshots/".length).replace(/\.png$/, "");
    if (!/^\d+$/.test(id)) {
      res.writeHead(400).end("invalid headshot id");
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
    if (!/^[a-z0-9]+$/.test(slug)) {
      res.writeHead(400).end("invalid slug");
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
  res.end(img.buf);
});

server.listen(3001, "127.0.0.1", () => {
  console.log("[headshots-proxy] listening on 127.0.0.1:3001");
});
