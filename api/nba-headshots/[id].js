const UPSTREAMS = [
  "https://cdn.nba.com/headshots/nba/latest/260x190",
  "https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190",
];

export default async function handler(req, res) {
  const rawId = req.query?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!id || !/^\d+$/.test(id)) {
    res.status(400).send("invalid headshot id");
    return;
  }

  for (const upstream of UPSTREAMS) {
    try {
      const response = await fetch(`${upstream}/${id}.png`, {
        signal: AbortSignal.timeout(8000),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.startsWith("image/")) continue;

      const body = Buffer.from(await response.arrayBuffer());
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(body.byteLength));
      res.status(200).send(body);
      return;
    } catch {
      // Try the secondary NBA host before returning a controlled failure.
    }
  }

  res.status(502).send("headshot unavailable");
}
