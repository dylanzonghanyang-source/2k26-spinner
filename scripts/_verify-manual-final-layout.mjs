// CDP regression: manual (自选) mode final page must stack the three panes
// vertically on desktop. Regression for the grid-row:1 overlap bug where the
// attribute slots, result card (copy/export) and full attribute preview all
// landed in the same grid row — X/info buttons floated over the preview and
// the copy/export buttons were hidden.
// Usage: dev server on 5173 + headless Chrome on 9223 (see other _verify-*.mjs).
import { writeFileSync } from "node:fs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const issues = [];
const ok = (label, detail = "") => results.push(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label, detail = "") => results.push(`❌ ${label}${detail ? ` — ${detail}` : ""}`);

async function main() {
  const targets = await (await fetch("http://127.0.0.1:9224/json")).json();
  const target = targets.find((item) => item.type === "page");
  if (!target) throw new Error("missing CDP page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error("ws timeout")), 10000); ws.onopen = () => { clearTimeout(t); resolve(); }; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params?.type)) {
      issues.push(`${message.params.type}: ${(message.params.args ?? []).map((x) => x.value ?? x.description ?? "").join(" ")}`);
    }
    if (message.method === "Runtime.exceptionThrown") issues.push(`exception: ${message.params.exceptionDetails?.text ?? "unknown"}`);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text);
    return reply.result?.result?.value;
  };
  const waitFor = async (expression, label, timeout = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try { if (await evaluate(expression)) return true; } catch { }
      await sleep(250);
    }
    fail(label, "timeout"); return false;
  };

  await send("Runtime.enable", {});
  await send("Page.enable", {});
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://localhost:5177/" });
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    try { ready = await evaluate(`document.readyState === "complete" && (() => { try { localStorage.setItem("__p","1"); localStorage.removeItem("__p"); return true; } catch { return false; } })()`); } catch { }
  }
  await sleep(1500);
  await evaluate("localStorage.clear()");
  await send("Page.reload", { ignoreCache: true });
  await sleep(5000);

  const bundleIds = ["three","mid","face","post","dunk","handle","passing","perimeter","interior","steal","block","rebound","athletic","strength","stability","potential"];
  const slugs = ["cooper-flagg","v-j-edgecombe","ace-bailey","kasparas-jakucionis","kon-knueppel","nolan-traore","khaman-maluach","tre-johnson","egor-demin","liam-mcneeley","derik-queen","ryan-kalkbrenner","jeremiah-fears","tyrese-proctor","rasheer-fleming","hugo-gonzalez"];
  const locks = {};
  bundleIds.forEach((id, i) => { locks[id] = { kind: "player", playerId: `card:${slugs[i]}` }; });
  const draft = {
    version: 1, savedAt: Date.now(), firstName: "Test", lastName: "Rookie",
    position: "PG", secondaryPosition: null, secondaryEnabled: false, age: 19,
    body: { height: 185, weight: 82, wingspan: 46, shoulder: 46, neck: 50, torso: 48 },
    settingsLocked: true, manualFinalize: true, locks, switchesLeft: 3,
    selectionMode: "manual", manualSetupDone: true, skipBodyConstraints: false,
    difficulty: "standard", round: null, status: "ok",
  };
  await evaluate(`localStorage.setItem("2kspinner.draft.v1", ${JSON.stringify(JSON.stringify(draft))})`);
  await send("Page.reload", { ignoreCache: true });
  await sleep(6000);
  const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll("button")].find(x => x.textContent.includes("恢复草稿") && (x.offsetWidth || x.offsetHeight)); b?.click(); return !!b; })()`);
  clicked ? ok("restore banner accepted") : fail("restore banner click");
  await waitFor(`document.querySelector('[data-testid="full-attribute-preview"]') != null`, "full preview visible");
  await sleep(1200);

  const probe = await evaluate(`(() => {
    const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const copyBtn = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "复制");
    const exportBtn = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "导出");
    const cr = copyBtn ? copyBtn.getBoundingClientRect() : null;
    const er = exportBtn ? exportBtn.getBoundingClientRect() : null;
    const a = rect("#builder-pane-attributes"), r2 = rect("#builder-pane-result"), p = rect("[data-testid=full-attribute-preview]");
    // Any unlock button whose center lies inside the preview pane is a floating overlay.
    const preview = document.querySelector("[data-testid=full-attribute-preview]");
    const pr = preview?.getBoundingClientRect();
    const floating = [...document.querySelectorAll("button[aria-label^=\\"解锁\\"]")].filter(b => {
      const br = b.getBoundingClientRect(); return br.width > 0 && br.height > 0 && pr && br.left >= pr.left && br.right <= pr.right && br.top >= pr.top && br.bottom <= pr.bottom;
    }).length;
    return {
      attrs: a, result: r2, preview: p,
      stacked: !!(a && r2 && p && r2.y >= a.y + a.h - 2 && p.y >= r2.y + r2.h - 2),
      copyVisible: cr ? cr.width > 0 && cr.height > 0 : false,
      exportVisible: er ? er.width > 0 && er.height > 0 : false,
      floatingUnlockInPreview: floating,
      docWidth: document.documentElement.scrollWidth, viewport: window.innerWidth,
    };
  })()`);
  probe.stacked ? ok("desktop panes stacked vertically", `attrs y=${probe.attrs?.y} → result y=${probe.result?.y} → preview y=${probe.preview?.y}`) : fail("desktop pane overlap", JSON.stringify({ a: probe.attrs, r: probe.result, p: probe.preview }));
  probe.copyVisible && probe.exportVisible ? ok("copy/export buttons visible") : fail("copy/export hidden", JSON.stringify({ copy: probe.copyVisible, export: probe.exportVisible }));
  probe.floatingUnlockInPreview === 0 ? ok("no unlock buttons floating over preview") : fail("floating unlock buttons", `${probe.floatingUnlockInPreview} inside preview`);
  probe.docWidth <= probe.viewport ? ok("no horizontal overflow") : fail("horizontal overflow", JSON.stringify(probe));

  const serious = issues.filter((line) => !/Download the React DevTools|favicon|was preloaded/i.test(line));
  serious.length ? fail("console", serious.slice(0, 4).join(" | ")) : ok("console clean");

  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("/tmp/manual-final-regression.png", Buffer.from(shot.result.data, "base64"));
  ws.close();
  console.log("===== manual final layout =====\n" + results.join("\n"));
  const failures = results.filter((line) => line.startsWith("❌")).length;
  console.log(`${results.length - failures}/${results.length} passed`);
  if (failures) process.exit(1);
}
main().catch((error) => { console.error(error); process.exit(1); });
