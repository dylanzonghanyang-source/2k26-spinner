// Some browsers/contexts (privacy sandbox, restricted iframes, certain
// enterprise policies) throw SecurityError on any Storage access. All
// storage reads/writes must survive that.

export function safeGetStorageItem(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function safeSetStorageItem(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

export function safeRemoveStorageItem(key: string): void {
  try { window.localStorage.removeItem(key); } catch { /* storage blocked */ }
}
