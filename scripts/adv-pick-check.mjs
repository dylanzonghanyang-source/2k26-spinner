// Verify pick-order sort after draft pick patch
import { writeFileSync } from "node:fs";

const CDP = "http://127.0.0.1:9230";
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
  await send("Page.navigate", { url: "http://localhost:5215" });
  await sleep(4000);
  await clickByText("数据库");
  await sleep(2500);
  await clickByText("2024");

  const rows = await evalJs(`(() => {
    const list = [...document.querySelectorAll('button')].filter(b => /届/.test(b.textContent || '') && (b.textContent || '').length < 150);
    return list.slice(0, 8).map(r => r.textContent.trim().replace(/\\s+/g, ' ').slice(0, 42));
  })()`);
  console.log("2024 前 8 行:");
  rows.forEach((r) => console.log(" ", r));

  // verify global monotonicity of picks for 2024 (first 60 rows)
  const order = await evalJs(`(() => {
    const list = [...document.querySelectorAll('button')].filter(b => /届/.test(b.textContent || '') && (b.textContent || '').length < 150);
    const picks = list.map(r => { const m = (r.textContent || '').match(/第 (\\d+) 顺位/); return m ? +m[1] : null; }).filter(p => p != null);
    let monotonic = true, badAt = -1;
    for (let i = 1; i < picks.length; i++) { if (picks[i] < picks[i-1]) { monotonic = false; badAt = i; break; } }
    return { count: picks.length, first: picks[0], last: picks[picks.length - 1], monotonic, badAt };
  })()`);
  console.log("顺位单调性:", JSON.stringify(order));

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("/tmp/database-pick-sort.png", Buffer.from(shot.result.data, "base64"));
  console.log("shot /tmp/database-pick-sort.png");
  ws.close();
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
