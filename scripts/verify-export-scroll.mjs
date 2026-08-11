// verify-export-scroll.mjs — mobile export-page scroll verification (native WebSocket CDP)
// Flow: mobile viewport → 新秀模式 → 确认并抽取 → lock all 16 slots → verify layout
const BASE = "http://localhost:5173";
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
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
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
  if (!page) throw new Error("no page target");
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
  });

  await cdp.send("Page.navigate", { url: BASE });
  await sleep(4000);

  const evalJs = async (expression) => {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result?.value;
  };

  // 1. Clear localStorage so we start in 新秀 mode
  await evalJs(`localStorage.clear(); location.reload(); true`);
  await sleep(4000);

  const dump = async (label) => {
    const s = await evalJs(`(() => ({
      label: ${JSON.stringify(label)},
      buttons: [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim().slice(0, 24)).filter(t => t),
      workspace: (() => {
        const w = document.querySelector('.builder-workspace');
        return w ? { height: getComputedStyle(w).height, overflow: getComputedStyle(w).overflow } : null;
      })(),
      resultPane: (() => {
        const r = document.querySelector('.builder-result-pane');
        return r ? { active: r.getAttribute('data-mobile-active'), overflowY: getComputedStyle(r).overflowY, scrollH: r.scrollHeight, clientH: r.clientHeight } : null;
      })(),
      fullPreview: (() => {
        const f = document.querySelector('.builder-full-preview');
        return f ? { active: f.getAttribute('data-mobile-active'), overflowY: getComputedStyle(f).overflowY, scrollH: f.scrollHeight, clientH: f.clientHeight } : null;
      })(),
      bodyScroll: document.body.scrollHeight > window.innerHeight,
      bodyScrollH: document.body.scrollHeight,
      innerH: window.innerHeight,
    }))()`);
    console.log(JSON.stringify(s, null, 1));
    return s;
  };

  await dump("initial");

  // 2. Click 确认并抽取
  const clicked = await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('确认并抽取'));
    if (b) { b.click(); return true; }
    return false;
  })()`);
  console.log("confirmSettings clicked:", clicked);
  await sleep(6000);

  await dump("after-confirm");

  // 3. Lock all attribute slots: pick candidate player → click slot → next team draws
  const lockResult = await evalJs(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 16; i++) {
      // (a) choose a candidate player (visible, enabled interactive-card)
      const players = [...document.querySelectorAll('.builder-player-pane .interactive-card')]
        .filter(b => b.offsetParent !== null && !b.disabled);
      if (!players.length) { await sleep(1500); continue; }
      players[0].click();
      await sleep(500);
      // (b) click first un-locked slot
      const slot = [...document.querySelectorAll('[aria-label^="锁定"]:not([aria-label^="已锁定"])')]
        .find(s => s.offsetParent !== null && !s.disabled);
      if (!slot) { await sleep(1000); continue; }
      slot.click();
      // (c) wait for next team draw to settle (animation + load)
      await sleep(3500);
      const locked = [...document.querySelectorAll('[aria-label^="已锁定"]')].length;
      console.log('  round', i + 1, 'locked:', locked);
      if (locked >= 16) break;
    }
    return { locked: [...document.querySelectorAll('[aria-label^="已锁定"]')].length };
  })()`);
  console.log("lock result:", JSON.stringify(lockResult));
  await sleep(2500);

  const final = await dump("final");

  // 4. Real scroll test: page must scroll (body), panes must NOT scroll independently
  const scrollTest = await evalJs(`(() => {
    const r = document.querySelector('.builder-result-pane');
    const f = document.querySelector('.builder-full-preview');
    const before = { rTop: r.scrollTop, fTop: f.scrollTop };
    window.scrollTo(0, 400);
    const after = { rTop: r.scrollTop, fTop: f.scrollTop, winY: window.scrollY, maxY: document.body.scrollHeight - window.innerHeight };
    window.scrollTo(0, 0);
    return { before, after };
  })()`);
  console.log("scroll test:", JSON.stringify(scrollTest, null, 1));

  cdp.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
