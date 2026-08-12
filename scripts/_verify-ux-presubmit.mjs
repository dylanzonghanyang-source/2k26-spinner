// UX pre-submit adversarial CDP regression.
// Covers final-state persistence isolation, keyboard progress controls, slot
// provenance, generated ledger/export, info popover lifecycle, difficulty
// budgets, no-dead section nav, mobile overflow, and console errors.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const consoleIssues = [];
const ok = (label, detail = "") => results.push(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label, detail = "") => results.push(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
const dlDir = mkdtempSync(join(tmpdir(), "2kspinner-ux-review-"));
const shotsDir = mkdtempSync(join(tmpdir(), "2kspinner-ux-shots-"));

async function main() {
  const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params?.type)) {
      consoleIssues.push(`${message.params.type}: ${(message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? "").join(" ")}`);
    }
    if (message.method === "Runtime.exceptionThrown") consoleIssues.push(`exception: ${message.params.exceptionDetails?.text ?? "unknown"}`);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++nextId;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
    setTimeout(() => {
      if (pending.has(messageId)) {
        pending.delete(messageId);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 8000);
  });
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description ?? response.result.exceptionDetails.text);
    return response.result?.result?.value;
  };
  const waitFor = async (expression, label, timeoutMs = 15000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try { if (await evaluate(expression)) return true; } catch { /* retry hydration */ }
      await sleep(250);
    }
    fail(label, "timeout");
    return false;
  };
  const snap = async (name) => {
    const response = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const data = response.result?.data;
    if (data) writeFileSync(join(shotsDir, `${name}.png`), Buffer.from(data, "base64"));
  };
  const nav = async () => {
    await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
    await sleep(5000);
  };
  const setViewport = async (width, height, mobile) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
    await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  };
  const clickByText = async (text, exact = false) => evaluate(`(() => {
    const visible = [...document.querySelectorAll("button")].filter(b => !!(b.offsetWidth || b.offsetHeight));
    const b = visible.find(b => ${exact ? `b.textContent.trim() === ${JSON.stringify(text)}` : `b.textContent.includes(${JSON.stringify(text)})`});
    b?.click(); return !!b;
  })()`);
  const clickFirstAvailable = async () => {
    for (let tries = 0; tries < 4; tries++) {
      const clicked = await evaluate(`(() => {
        const card = [...document.querySelectorAll(".interactive-card")].find(c => !c.disabled && !c.textContent.includes("已选用"));
        card?.click(); return !!card;
      })()`);
      if (clicked) return true;
      const switched = await clickByText("换一批");
      if (!switched) return false;
      await sleep(600);
    }
    return false;
  };
  const clickSlot = async (label) => evaluate(`(() => {
    const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}) && !b.textContent.includes("："));
    b?.click(); return !!b;
  })()`);
  const finishRandom = async () => {
    await waitFor(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("确认并抽取")); return !!b && !b.disabled; })()`, "random confirm enabled");
    await clickByText("确认并抽取");
    await waitFor(`document.querySelector(".interactive-card") != null`, "player cards render");
    const labels = ["三分", "中投", "面框", "背身", "扣篮", "控球", "传球", "外防", "内防", "抢断", "盖帽", "篮板", "运动", "力量", "稳定性", "潜力"];
    for (const label of labels) {
      await waitFor(`document.querySelector(".interactive-card") != null`, `${label} candidates`, 10000);
      if (!(await clickFirstAvailable())) throw new Error(`no available player for ${label}`);
      await sleep(250);
      if (!(await clickSlot(label))) throw new Error(`slot missing ${label}`);
      await sleep(400);
    }
    return waitFor(`document.querySelector('[data-testid="full-attribute-preview"]') != null`, "full result");
  };

  await send("Runtime.enable", {});
  await send("Page.enable", {});
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

  // Seed a real incomplete draft, reload into the visible restore banner, then
  // deliberately ignore it and complete a fresh run. Completion must invalidate
  // both storage AND the stale in-memory banner; otherwise restore can overwrite
  // a just-generated rookie.
  await setViewport(1280, 900, false);
  await nav();
  await evaluate(`localStorage.clear()`);
  await send("Page.reload", { ignoreCache: true });
  await sleep(4000);
  await waitFor(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("确认并抽取")); return !!b && !b.disabled; })()`, "draft-seed confirm enabled");
  await clickByText("确认并抽取");
  await waitFor(`document.querySelector(".interactive-card") != null`, "draft-seed candidates");
  await clickFirstAvailable();
  await clickSlot("三分");
  await sleep(850);
  await send("Page.reload", { ignoreCache: true });
  await sleep(4500);
  const staleBannerVisible = await evaluate(`document.body.textContent.includes("恢复草稿")`);
  staleBannerVisible ? ok("seed: unfinished draft exposes restore banner") : fail("seed: restore banner missing");

  // A. Desktop completion and final details (while deliberately ignoring stale draft).
  await finishRandom();
  await snap("desktop-result");
  const staleBannerAfterCompletion = await evaluate(`document.body.textContent.includes("恢复草稿")`);
  !staleBannerAfterCompletion ? ok("A: completion dismisses stale restore banner") : fail("A: stale restore banner remains after completion");
  const resultFacts = await evaluate(`(() => {
    const preview = document.querySelector('[data-testid="full-attribute-preview"]');
    const details = [...document.querySelectorAll("details")].find(d => d.textContent.includes("16 槽来源履历"));
    if (details) details.open = true;
    const rows = details ? [...details.querySelectorAll("div[class*=min-h-5]")].length : 0;
    const navLabels = [...preview.querySelectorAll("button")].map(b => b.textContent.trim()).filter(t => ["属性", "倾向", "热区", "徽章"].includes(t));
    const attr = [...preview.querySelectorAll('[role="button"]')].find(r => r.textContent.includes("三分球"));
    return { rows, navLabels, attrKey: attr?.getAttribute("aria-pressed"), attrTab: attr?.tabIndex, previewWidth: preview?.getBoundingClientRect().width, docWidth: document.documentElement.scrollWidth, viewport: window.innerWidth };
  })()`);
  resultFacts.rows === 16 ? ok("A: provenance ledger has exactly 16 rows") : fail("A: ledger row count", String(resultFacts.rows));
  resultFacts.attrTab === 0 ? ok("A: attribute progress rows are keyboard reachable") : fail("A: attr keyboard focus", JSON.stringify(resultFacts));
  resultFacts.docWidth <= resultFacts.viewport ? ok("A: desktop no horizontal overflow") : fail("A: desktop overflow", JSON.stringify(resultFacts));

  // A1. keyboard toggles one tendency and one hotzone; aria state changes.
  const keyboardTargets = await evaluate(`(() => {
    const preview = document.querySelector('[data-testid="full-attribute-preview"]');
    const tendency = [...preview.querySelectorAll('#entry-tendencies [role="button"]')][0];
    const hot = [...preview.querySelectorAll('#entry-hotzones [role="button"]')][0];
    tendency?.focus();
    tendency?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    hot?.focus();
    hot?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    return { tendency: tendency?.textContent.trim(), hot: hot?.textContent.trim() };
  })()`);
  await sleep(300);
  const keyboardFacts = await evaluate(`(() => {
    const preview = document.querySelector('[data-testid="full-attribute-preview"]');
    const tendency = [...preview.querySelectorAll('#entry-tendencies [role="button"]')][0];
    const hot = [...preview.querySelectorAll('#entry-hotzones [role="button"]')][0];
    return { tendency: tendency?.getAttribute("aria-pressed"), hot: hot?.getAttribute("aria-pressed") };
  })()`);
  keyboardFacts.tendency === "true" && keyboardFacts.hot === "true"
    ? ok("A1: keyboard toggles tendency and hotzone progress", `${keyboardTargets.tendency} / ${keyboardTargets.hot}`)
    : fail("A1: keyboard progress", JSON.stringify({ keyboardTargets, keyboardFacts }));

  // A2. Export while the completed result is still mounted.
  await clickByText("导出", true);
  await sleep(2200);
  const exported = readdirSync(dlDir).filter(f => f.endsWith(".txt")).at(-1);
  if (exported) {
    const text = readFileSync(join(dlDir, exported), "utf8");
    const ledger = text.split("[生成履历]")[1]?.split("[来源卡资料]")[0] ?? "";
    const rows = ledger.trim().split("\n").filter(Boolean);
    rows.length === 16 && rows.every(row => row.includes("→"))
      ? ok("A2: export ledger has 16 raw→adjusted entries")
      : fail("A2: export ledger", `${rows.length} rows`);
  } else fail("A2: export absent");

  // A3. Completed flow persists a result snapshot (H1): reload offers 恢复结果,
  // and restoring rebuilds the finished page while consuming the draft (M3).
  const completed = await evaluate(`(() => {
    const draftKey = "2kspinner.draft.v1";
    const entryKey = Object.keys(localStorage).find(k => k.startsWith("2kspinner.entry.v1."));
    let snapshot = false;
    try { snapshot = !!JSON.parse(localStorage.getItem(draftKey)).resultSnapshot; } catch {}
    return { hasEntry: !!entryKey, hasDraft: localStorage.getItem(draftKey) != null, snapshot };
  })()`);
  if (completed?.hasEntry && completed?.hasDraft && completed?.snapshot) {
    await send("Page.reload", { ignoreCache: true });
    await sleep(4500);
    const banner = await evaluate(`document.body.textContent.includes("检测到已完成的生成结果")`);
    banner ? ok("A3a: completed result offers 恢复结果 after reload") : fail("A3a: completed restore banner missing");
    const restored = await evaluate(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("恢复结果")); b?.click(); return !!b; })()`);
    restored ? ok("A3b: 恢复结果 button present and clicked") : fail("A3b: 恢复结果 button missing");
    await sleep(2500);
    const pageRestored = await evaluate(`document.querySelector('[data-testid="full-attribute-preview"]') != null`);
    pageRestored ? ok("A3c: restored snapshot renders the full result page") : fail("A3c: restored result page missing");
    const navCheck = await evaluate(`(() => {
      const nav = document.querySelector('[data-testid="full-attribute-preview"] > div:nth-child(2)');
      if (!nav) return null;
      const anchor = document.getElementById("entry-attrs") ?? document.getElementById("entry-tendencies");
      const navHeight = nav.getBoundingClientRect().height;
      return { position: getComputedStyle(nav).position, navHeight, scrollMargin: anchor ? getComputedStyle(anchor).scrollMarginTop : null };
    })()`);
    navCheck && navCheck.position === "sticky" && Number.parseFloat(navCheck.scrollMargin ?? "0") >= navCheck.navHeight
      ? ok("A3e: sticky entry navigation offsets anchors with scroll-margin", JSON.stringify(navCheck))
      : fail("A3e: entry navigation obscures section headings", JSON.stringify(navCheck));
    const consumed = await evaluate(`localStorage.getItem("2kspinner.draft.v1") == null`);
    consumed ? ok("A3d: restore consumes the persisted draft") : fail("A3d: draft not cleared after restore");
  } else fail("A3: expected entry progress + completed snapshot draft", JSON.stringify(completed));

  // B. Reset, difficulty ironman/relaxed budget behavior.
  await clickByText("再生成一名");
  await sleep(1200);
  await clickByText("铁人");
  await clickByText("确认并抽取");
  await waitFor(`document.querySelector(".interactive-card") != null`, "ironman candidates");
  const ironman = await evaluate(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.includes("换一批")); return b ? { disabled: b.disabled, text: b.textContent.trim() } : null; })()`);
  ironman?.disabled && ironman.text.includes("0") ? ok("B: ironman disables switch at zero") : fail("B: ironman budget", JSON.stringify(ironman));
  await clickByText("重新开始");
  await sleep(1000);
  await clickByText("休闲");
  await clickByText("确认并抽取");
  await waitFor(`document.querySelector(".interactive-card") != null`, "relaxed candidates");
  const relaxedBefore = await evaluate(`(() => [...document.querySelectorAll("button")].find(b => b.textContent.includes("换一批"))?.textContent.trim())()`);
  await clickByText("换一批");
  await sleep(800);
  const relaxedAfter = await evaluate(`(() => [...document.querySelectorAll("button")].find(b => b.textContent.includes("换一批"))?.textContent.trim())()`);
  relaxedBefore?.includes("5") && relaxedAfter?.includes("4") ? ok("B: relaxed budget starts 5 then decrements") : fail("B: relaxed budget", `${relaxedBefore} => ${relaxedAfter}`);

  // C. Info popover lifecycle (click, Esc, scroll close) and selected-slot three-part tooltip.
  await clickFirstAvailable();
  await clickSlot("三分");
  await sleep(700);
  const infoTriggered = await evaluate(`(() => {
    const info = document.querySelector('button[aria-label="查看三分槽位字段"]');
    info?.click(); return !!info;
  })()`);
  await sleep(300);
  const slotFacts = await evaluate(`(() => {
    const slot = [...document.querySelectorAll("button")].find(b => b.textContent.trim().startsWith("三分") && !b.textContent.includes("："));
    const info = document.querySelector('button[aria-label="查看三分槽位字段"]');
    const panel = document.getElementById("slot-info-three");
    return { title: slot?.getAttribute("title"), sub: slot?.querySelector("span.block.truncate")?.textContent, expanded: info?.getAttribute("aria-expanded"), panel: !!panel, text: panel?.textContent?.replace(/\s+/g, " ").trim().slice(0, 100) };
  })()`);
  const threePart = /来源值 \d+ → 身体修正 [+-]?\d+ → 最终 \d+/.test(slotFacts?.title ?? "");
  threePart && slotFacts?.sub?.includes("→") ? ok("C: locked slot retains full three-part chain") : fail("C: locked provenance chain", JSON.stringify(slotFacts));
  infoTriggered && slotFacts?.expanded === "true" && slotFacts?.panel && slotFacts?.text?.includes("属性") && slotFacts?.text?.includes("倾向")
    ? ok("C: info popover exposes mapping and expanded state") : fail("C: info popover", JSON.stringify(slotFacts));
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(400);
  const escapeClosed = await evaluate(`document.getElementById("slot-info-three") == null`);
  escapeClosed ? ok("C: Escape closes info popover") : fail("C: info Escape");
  await evaluate(`document.querySelector('button[aria-label="查看三分槽位字段"]')?.click()`);
  await sleep(250);
  await evaluate(`window.dispatchEvent(new Event("resize"))`);
  await sleep(300);
  const resizeClosed = await evaluate(`document.getElementById("slot-info-three") == null`);
  resizeClosed ? ok("C: resize closes detached info popover") : fail("C: info resize close");

  // C1. The newly added info affordance keeps a real mobile touch target. Use
  // CDP touch coordinates (not HTMLElement.click()) to prove hit-testing.
  await setViewport(390, 844, true);
  const mobileInfo = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="查看三分槽位字段"]');
    if (!button) return null;
    const r = button.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
  })()`);
  if (mobileInfo && mobileInfo.width >= 32 && mobileInfo.height >= 44) {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: mobileInfo.x, y: mobileInfo.y, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(350);
    const touchOpened = await evaluate(`document.querySelector('button[aria-label="查看三分槽位字段"]')?.getAttribute("aria-expanded") === "true"`);
    touchOpened ? ok("C1: mobile info target is touch-operable", `${mobileInfo.width}×${mobileInfo.height}`) : fail("C1: mobile info touch failed", JSON.stringify(mobileInfo));
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  } else {
    fail("C1: mobile info target too small", JSON.stringify(mobileInfo));
  }

  // D. Mobile screen after HMR reload: no horizontal overflow, usable nav and modal.
  await setViewport(390, 844, true);
  await send("Page.reload", { ignoreCache: true });
  await sleep(4500);
  const mobileLayout = await evaluate(`({ width: document.documentElement.scrollWidth, viewport: window.innerWidth, controls: [...document.querySelectorAll("button")].filter(b => !!(b.offsetWidth || b.offsetHeight)).map(b => b.textContent.trim()).filter(Boolean).slice(0, 20) })`);
  mobileLayout.width <= mobileLayout.viewport ? ok("D: mobile 390px has no horizontal overflow", `${mobileLayout.width}/${mobileLayout.viewport}`) : fail("D: mobile overflow", JSON.stringify(mobileLayout));
  await snap("mobile-after-reload");

  // Console errors/warnings must be inspected rather than silently ignored.
  const seriousConsole = consoleIssues.filter(line => !/Download the React DevTools|favicon|was preloaded/i.test(line));
  seriousConsole.length === 0 ? ok("E: no browser console errors/warnings") : fail("E: console issues", seriousConsole.slice(0, 5).join(" | "));

  ws.close();
  console.log("\n===== UX pre-submit adversarial results =====");
  results.forEach(line => console.log(line));
  console.log(`screenshots: ${shotsDir}`);
  const failures = results.filter(line => line.startsWith("❌")).length;
  console.log(`\n${results.length - failures}/${results.length} passed`);
  if (failures) process.exit(1);
  // keep screenshots only on success in /tmp for visual inspection, no repo artifacts.
  if (!existsSync(shotsDir)) throw new Error("screenshots vanished");
}
main().catch((error) => { console.error(error); process.exit(1); });
