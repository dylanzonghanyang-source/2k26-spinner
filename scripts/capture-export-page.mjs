// capture-export-page.mjs — screenshot the completed export page (mobile viewport)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(debuggerUrl) {
    const ws = new WebSocket(debuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { resolve, reject } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws.close(); }
}

async function main() {
  const list = await (await fetch("http://localhost:9222/json/list")).json();
  const page = list.find((t) => t.type === "page");
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");

  // Full-page screenshot at mobile width
  const { result } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
  });  const fs = await import("node:fs");
  fs.writeFileSync("/tmp/2kspinner-export-mobile.png", Buffer.from(result.data, "base64"));
  console.log("saved /tmp/2kspinner-export-mobile.png");
  cdp.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
