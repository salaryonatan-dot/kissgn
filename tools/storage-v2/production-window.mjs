// Storage V2 — PRODUCTION WINDOW (extracted verbatim from test/support/dashboard-wiring-harness.mjs for
// the canary tooling): executes the pinned pure helper blocks of index.html (MarjinEntries,
// MarjinSaveLifecycle, MarjinStorageV2, MarjinStoragePolicy) in a vm sandbox so operator tooling runs
// the EXACT production helper bytes. Missing/ambiguous anchors are an assertion failure, never a guess.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

export function loadProductionWindow(html = HTML) {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  assert.notEqual(start, -1, "P0-DATA-01 anchor");
  // VERSION FENCE: the policy block (window.MarjinStoragePolicy) directly follows the
  // storage block and is part of the production window the dashboard blocks call into.
  // (a pre-fence html — used as a NEGATIVE CONTROL by some suites — has no policy block;
  // the window then ends at the storage block exactly as before)
  const fv2 = html.indexOf("window.MarjinStorageV2 = Object.freeze({", start);
  assert.notEqual(fv2, -1, "MarjinStorageV2 export");
  const fp = html.indexOf("window.MarjinStoragePolicy = Object.freeze({", start);
  const f = fp === -1 ? fv2 : fp;
  if (fp !== -1) assert.ok(fv2 < fp, "MarjinStorageV2 export precedes the policy block");
  const events = new Map();
  const win = { crypto: globalThis.crypto,
    // browser event surface the selection effect uses for foreground / reconnect re-checks
    addEventListener: (n, fn) => { if (!events.has(n)) events.set(n, new Set()); events.get(n).add(fn); },
    removeEventListener: (n, fn) => { events.get(n)?.delete(fn); },
    dispatchEvent: (n) => { for (const fn of events.get(n) || []) fn(); return (events.get(n) || new Set()).size; },
    listenerCount: (n) => (events.get(n) || new Set()).size,
    document: { visibilityState: "visible" },
    location: { reload: () => { win.__reloads = (win.__reloads || 0) + 1; } } };
  const sandbox = { window: win, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
  vm.runInNewContext(html.slice(start, html.indexOf("});", f) + 3), sandbox);
  return sandbox.window;
}
