// Public-beta critical-flow regression via CDP (Task 13).
// Requires: dev server on localhost:5173, headless Chrome on :9223.
// Scenarios:
//   A. reduced-motion full 16-slot random flow -> completion -> download -> 再生成一名
//   B. mid-flow exit (重新开始 visible and functional)
//   C. rapid same-tick double-slot click commits once (race guard)
//   D. chunk block -> visible error -> reload recovers
//   E. self-pick setup dialog Escape closes (modal behavior)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const ok = (label, detail = "") => results.push(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label, detail = "") => results.push(`❌ ${label}${detail ? ` — ${detail}` : ""}`);

const dlDir = mkdtempSync(join(tmpdir(), "2kspinner-dl-"));

async function main() {
  const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  const evalJs = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text);
    return result.result?.result?.value;
  };
  const waitFor = async (expression, label, timeoutMs = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        if (await evalJs(expression)) return true;
      } catch { /* retry */ }
      await sleep(300);
    }
    fail(label, `timeout waiting for condition`);
    return false;
  };

  const nav = async (url = "http://localhost:5173/") => {
    await send("Page.navigate", { url });
    await sleep(5000);
  };

  const clickConfirm = async () => {
    await evalJs(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("确认并抽取")); b?.click(); return !!b; })()`);
    await sleep(1800);
  };

  const clickFirstPlayer = async () => {
    await evalJs(`(() => { const b = document.querySelector(".interactive-card"); b?.click(); return !!b; })()`);
    await sleep(400);
  };

  const clickSlot = async (index) => {
    const labels = ["三分", "中投", "面框", "背身", "扣篮", "控球", "传球", "外防", "内防", "抢断", "盖帽", "篮板", "运动", "力量", "稳定性", "潜力"];
    await evalJs(`(() => {
      const label = ${JSON.stringify(labels[index])};
      const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim().startsWith(label) && !b.textContent.includes("："));
      b?.click(); return !!b;
    })()`);
    await sleep(300);
  };

  const lockCount = () => evalJs(`(() => {
    const m = document.body.textContent.match(/(\\d+)\\/16/);
    return m ? Number(m[1]) : -1;
  })()`);

  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });

  // ---------- A. full 16-slot flow (mobile 390x844, reduced motion) ----------
  await nav();
  await waitFor(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("确认并抽取")); return !!b && !b.disabled; })()`, "A: confirm button enabled");
  await clickConfirm();
  await waitFor(`document.querySelector(".interactive-card") != null`, "A: players rendered after team draw");
  for (let i = 0; i < 16; i++) {
    // 每轮等球员列表渲染完成再点（抽队后列表会重新挂载）
    await waitFor(`document.querySelector(".interactive-card") != null`, `A: players rendered round ${i + 1}`, 10000);
    await clickFirstPlayer();
    await clickSlot(i);
    await sleep(500);
  }
  const progressAfterLoop = await lockCount();
  ok(`A: lock progress after 16 rounds`, `${progressAfterLoop}/16`);
  await waitFor(`document.querySelector('[data-testid="full-attribute-preview"]') != null`, "A: full preview after 16 slots");
  const overall = await evalJs(`document.querySelector('[data-testid="rookie-overall"]')?.textContent`);
  if (overall && /^\d+$/.test(overall)) ok("A: completion shows OVR", overall);
  else fail("A: completion OVR", overall);
  const restartBtn = await evalJs(`(() => {
    const visible = [...document.querySelectorAll("button")].filter(b => !!(b.offsetWidth || b.offsetHeight));
    const b = visible.find(b => b.textContent.includes("再生成一名"));
    return !!b;
  })()`);
  restartBtn ? ok("A: 再生成一名 visible on completion") : fail("A: 再生成一名 missing");

  // Download verification (copy is unreliable in headless)
  await evalJs(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "导出"); b?.click(); return !!b; })()`);
  await sleep(2500);
  const files = readdirSync(dlDir).filter((f) => f.endsWith(".txt"));
  if (files.length > 0) {
    const content = readFileSync(join(dlDir, files[0]), "utf8");
    const hasName = content.includes("姓名:");
    const hasNoDashTemplates = !content.split("[模板]")[1]?.split("[来源卡资料]")[0]?.includes(": --");
    (hasName && hasNoDashTemplates) ? ok("A: downloaded txt has generated name + resolved templates", files[0])
      : fail("A: downloaded txt content", `${files[0]} name=${hasName} templates=${hasNoDashTemplates}`);
  } else {
    fail("A: download produced no txt file", dlDir);
  }

  // 再生成一名 returns to initial setup
  await evalJs(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("再生成一名")); b?.click(); return !!b; })()`);
  await sleep(1500);
  const backToSetup = await evalJs(`(() => {
    const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("确认并抽取"));
    return !!b && !b.disabled;
  })()`);
  backToSetup ? ok("A: 再生成一名 resets to setup") : fail("A: reset to setup failed");

  // ---------- B. mid-flow exit ----------
  await clickConfirm();
  await waitFor(`document.querySelector(".interactive-card") != null`, "B: players rendered");
  await clickFirstPlayer();
  await clickSlot(0);
  await sleep(600);
  const midResetVisible = await evalJs(`(() => {
    const visible = [...document.querySelectorAll("button")].filter(b => !!(b.offsetWidth || b.offsetHeight));
    const b = visible.find(b => b.textContent.includes("重新开始"));
    return !!b;
  })()`);
  midResetVisible ? ok("B: 重新开始 visible mid-flow on mobile") : fail("B: 重新开始 missing mid-flow");
  await evalJs(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("重新开始")); b?.click(); return !!b; })()`);
  await sleep(1500);
  const midResetWorked = await evalJs(`(() => {
    const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("确认并抽取"));
    return !!b && !b.disabled;
  })()`);
  midResetWorked ? ok("B: mid-flow reset returns to setup") : fail("B: mid-flow reset failed");

  // ---------- C. rapid same-tick double slot click (race guard) ----------
  await clickConfirm();
  await waitFor(`document.body.textContent.includes("球队已确定")`, "C: team settled after confirm", 15000);
  await waitFor(`document.querySelector(".interactive-card") != null`, "C: players rendered");
  await clickFirstPlayer();
  await waitFor(`document.body.textContent.includes("已选择")`, "C: player selection confirmed", 8000);
  await sleep(300);
  const rapidResult = await evalJs(`(() => {
    const labels = ["三分", "中投"];
    const btns = labels.map(label => [...document.querySelectorAll("button")].find(b => b.textContent.trim().startsWith(label) && !b.textContent.includes("：")));
    btns.forEach(b => b?.click());
    return btns.every(Boolean);
  })()`);
  await sleep(1200);
  const afterRapid = await lockCount();
  if (rapidResult && afterRapid === 1) ok("C: rapid double-slot click commits once", `progress=${afterRapid}/16`);
  else fail("C: rapid double-slot race guard", `progress=${afterRapid}/16 rapid=${rapidResult}`);

  // ---------- D. chunk block -> visible error -> reload recovery ----------
  await send("Network.enable", {});
  await send("Network.setBlockedURLs", { urls: ["*rookieCardIndex*"] });
  await send("Page.reload", { ignoreCache: true });
  await sleep(5000);
  const errorVisible = await evalJs(`(() => {
    const alert = [...document.querySelectorAll('[role="alert"]')].find(a => a.textContent.includes("新秀卡数据加载失败"));
    return !!alert && !!(alert.offsetWidth || alert.offsetHeight);
  })()`);
  errorVisible ? ok("D: chunk block shows visible error banner") : fail("D: chunk error banner missing");
  await send("Network.setBlockedURLs", { urls: [] });
  await evalJs(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("重新加载应用")); b?.click(); return !!b; })()`);
  await sleep(6000);
  const recovered = await waitFor(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("确认并抽取")); return !!b && !b.disabled; })()`, "D: recovery after reload", 20000);
  recovered ? ok("D: reload recovers from chunk block") : fail("D: reload recovery failed");

  // ---------- E. self-pick setup dialog Escape ----------
  await evalJs(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("自选")); b?.click(); return !!b; })()`);
  await sleep(2000);
  const dialogOpen = await evalJs(`document.querySelector('[role="dialog"]') != null`);
  if (!dialogOpen) {
    // self-pick may need the nav re-enabled after flow reset; try again
    await evalJs(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("自选")); b?.click(); return !!b; })()`);
    await sleep(2000);
  }
  const dialogOpen2 = await evalJs(`document.querySelector('[role="dialog"]') != null`);
  if (dialogOpen2) {
    ok("E: self-pick setup dialog opens");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(1200);
    const dialogClosed = await evalJs(`document.querySelector('[role="dialog"]') == null`);
    dialogClosed ? ok("E: Escape closes setup dialog") : fail("E: Escape did not close dialog");
    // focus must not remain trapped inside the (closed) dialog
    const focusOk = await evalJs(`document.activeElement == null || !document.activeElement.closest('[role="dialog"]')`);
    focusOk ? ok("E: focus left the dialog after close") : fail("E: focus trapped after close");
  } else {
    fail("E: self-pick setup dialog did not open", `dialog=${dialogOpen}`);
  }

  ws.close();
  console.log("\n===== beta critical-flow results =====");
  for (const line of results) console.log(line);
  const failures = results.filter((r) => r.startsWith("❌")).length;
  console.log(`\n${results.length - failures}/${results.length} passed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
