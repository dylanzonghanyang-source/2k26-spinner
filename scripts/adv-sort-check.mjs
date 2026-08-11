// Verify sort: year selected -> pick asc; overview -> OVR desc
import { writeFileSync } from "node:fs";

const CDP = "http://127.0.0.1:9229";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tabs = await (await fetch(`${CDP}/json`)).json();
  const page = tabs.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => (ws.onopen = res));
  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };
  const clickByText = async (text) => {
    await evalJs(`(() => {
      const el = [...document.querySelectorAll('button')].find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}));
      el?.click(); return true;
    })()`);
    await sleep(600);
  };

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: "http://localhost:5214" });
  await sleep(4000);
  await clickByText("数据库");
  await sleep(2500);

  const overview = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('button')].filter(b => /届/.test(b.textContent || '') && (b.textContent || '').length < 150);
    return { first: rows[0]?.textContent.trim().replace(/\\s+/g, ' ').slice(0, 50), count: rows.length };
  })()`);
  console.log("总览首行:", JSON.stringify(overview));

  await clickByText("2024");
  const year2024 = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('button')].filter(b => /届/.test(b.textContent || '') && (b.textContent || '').length < 150);
    return rows.slice(0, 6).map(r => r.textContent.trim().replace(/\\s+/g, ' ').slice(0, 45));
  })()`);
  console.log("2024 前 6 行:", JSON.stringify(year2024, null, 1));

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("/tmp/database-sort.png", Buffer.from(shot.result.data, "base64"));
  console.log("shot /tmp/database-sort.png");
  ws.close();
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
