// Focused CDP regression: manual-mode draft survives refresh with its mode and
// card:<slug> pseudo source reconstructed from the lazy rookie-card index.
import { writeFileSync } from "node:fs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const issues = [];
const ok = (label, detail = "") => results.push(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label, detail = "") => results.push(`❌ ${label}${detail ? ` — ${detail}` : ""}`);

async function main() {
  const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
  const target = targets.find((item) => item.type === "page");
  if (!target) throw new Error("missing CDP page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
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
  const evalSync = async (expression) => {
    const reply = await send("Runtime.evaluate", { expression, returnByValue: true });
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text);
    return reply.result?.result?.value;
  };
  const waitFor = async (expression, label, timeout = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try { if (await evalSync(expression)) return true; } catch { /* hydration */ }
      await sleep(250);
    }
    fail(label, "timeout"); return false;
  };
  const click = async (selector) => evalSync(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element?.click(); return !!element; })()`);
  const clickText = async (text) => evalSync(`(() => { const b = [...document.querySelectorAll("button")].find(x => !!(x.offsetWidth || x.offsetHeight) && x.textContent.includes(${JSON.stringify(text)}) && !x.disabled); b?.click(); return !!b; })()`);

  await send("Runtime.enable", {});
  await send("Page.enable", {});
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
  await sleep(4500);
  await evalSync("localStorage.clear()");
  await send("Page.reload", { ignoreCache: true });
  await sleep(4500);

  // Enter custom mode → complete setup → open first slot → choose a card.
  await clickText("自选生成");
  const setupReady = await waitFor(`document.querySelector('[role="dialog"][aria-label="自选生成设置"]') != null`, "custom setup dialog");
  if (setupReady) {
    const ready = await waitFor(`(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("进入自选生成")); return !!b && !b.disabled; })()`, "rookie cards loaded");
    if (ready) {
      await clickText("进入自选生成");
      const slotReady = await waitFor(`document.querySelector('button[aria-label="锁定三分"]') != null`, "manual slot buttons");
      if (slotReady) {
        await click('button[aria-label="锁定三分"]');
        const pickerReady = await waitFor(`document.querySelector('[role="dialog"][aria-label*="三分槽位"]') != null`, "slot picker");
        if (pickerReady) {
          // desktop picker: click first visible year then first eligible card.
          await evalSync(`(() => { const dialog=document.querySelector('[role="dialog"]'); const year=[...dialog.querySelectorAll("button")].find(b=>/^20\d{2}$/.test(b.textContent.trim())); year?.click(); return !!year; })()`);
          await sleep(400);
          const chosen = await evalSync(`(() => { const dialog=document.querySelector('[role="dialog"]'); const card=[...dialog.querySelectorAll("button")].find(b => b.classList.contains("interactive-card") && !b.disabled); card?.click(); return card?.textContent.trim() ?? null; })()`);
          chosen ? ok("seed: manual card selected", chosen.slice(0, 40)) : fail("seed: manual card selection");
          await sleep(900);
          const stored = await waitFor(`localStorage.getItem("2kspinner.draft.v1")?.includes("card:") === true`, "manual draft persisted");
          if (stored) {
            await send("Page.reload", { ignoreCache: true });
            await sleep(5000);
            const beforeRestore = await evalSync(`({ custom: document.body.textContent.includes("自选生成"), restore: document.body.textContent.includes("恢复草稿"), draft: JSON.parse(localStorage.getItem("2kspinner.draft.v1") || "{}").selectionMode })`);
            beforeRestore.custom && beforeRestore.restore && beforeRestore.draft === "manual"
              ? ok("restore: manual draft returns to custom mode", JSON.stringify(beforeRestore))
              : fail("restore: manual mode selection", JSON.stringify(beforeRestore));
            await clickText("恢复草稿");
            await sleep(800);
            const mode = await evalSync(`({ selected: document.querySelector('button[aria-label="已锁定三分"]')?.textContent.trim() ?? null, source: document.querySelector('button[aria-label="已锁定三分"] span.block.truncate')?.textContent ?? null, evaluated: document.querySelector('button[aria-label="已锁定三分"]')?.getAttribute("title") ?? null })`);
            mode.selected && mode.source && /来源值 \d+ → 身体修正/.test(mode.evaluated ?? "")
              ? ok("restore: manual card source rebuilt after accepting draft", JSON.stringify(mode))
              : fail("restore: manual card source", JSON.stringify(mode));
          }
        }
      }
    }
  }
  const serious = issues.filter((line) => !/Download the React DevTools|favicon|was preloaded/i.test(line));
  serious.length ? fail("console", serious.slice(0, 4).join(" | ")) : ok("console clean");
  ws.close();
  console.log("===== manual draft restore ====="); results.forEach((line) => console.log(line));
  const failures = results.filter((line) => line.startsWith("❌")).length;
  console.log(`${results.length - failures}/${results.length} passed`);
  if (failures) process.exit(1);
}
main().catch((error) => { console.error(error); process.exit(1); });
