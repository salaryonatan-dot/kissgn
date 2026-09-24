// Marjin — P0-DATA-01 STORAGE V2: PRODUCTION DASHBOARD WIRING HARNESS.
//
// Runs the ACTUAL dashboard initialization block of index.html (the refs that wire the
// legacy engine, the V2 engine, the storage router and the entries write coordinator
// together — the exact code Codex R1-F1 found dropping the captured binding) and the
// ACTUAL selection-effect listener/bootstrap block (subscribeNode → readEntriesNode →
// mode ref → coordinator echo; read-only absent probe), inside a vm sandbox whose only
// substitutions are React's `useRef`/`useState` setters and the `window.storage`
// transport seams. Nothing about the wiring is re-typed here: the blocks are sliced
// from index.html by source anchors and executed verbatim, so a drift in either block
// changes what these tests exercise.
//
// Two transports are provided: an in-memory RTDB (CAS transactions, async listeners,
// injection hooks for deterministic interleavings) and a builder for an Admin-SDK
// backed transport used by the emulator matrix.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const HTML = readFileSync(join(ROOT, "index.html"), "utf8");
export const plain = (v) => JSON.parse(JSON.stringify(v));

// ── production modules ───────────────────────────────────────────────────────
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

// ── the two production blocks, by anchor ─────────────────────────────────────
export const INIT_START = "  const entriesMutatorRef = useRef(null);";
export const INIT_END = "  const saveOwnershipCtrlRef = useRef(null);";        // after submitLaborEntry
export const LISTENER_START = "    const subNodeEntries = (key, onNode, onErr) => {";
export const LISTENER_END = "    loadEntryExceptions(ctxAtSetup); // R3";
export const SELECTION_HELPERS = ["  const captureSelectionCtx = () => selectionCtrlRef.current.capture();",
                                  "  const isSelectionLive = (ctx) => selectionCtrlRef.current.isLive(ctx);"];
export const EFFECT_RESET_LINE = "    entriesStorageModeRef.current = null;";
export const EFFECT_POLICY_RESET_LINE = "    entriesPolicyRef.current = null;   // VERSION FENCE: a new selection starts with no policy lane";

export function extractInitBlock(html = HTML) {
  const a = html.indexOf(INIT_START), b = html.indexOf(INIT_END, a);
  assert.ok(a > 0 && b > a, "dashboard initialization block anchors");
  return html.slice(a, b);
}
export function extractListenerBlock(html = HTML) {
  const a = html.indexOf(LISTENER_START), b = html.indexOf(LISTENER_END, a);
  assert.ok(a > 0 && b > a, "selection-effect listener block anchors");
  return html.slice(a, b);
}

// ── in-memory RTDB transport (per tenant key) ────────────────────────────────
// hooks: { beforeRun, beforeCommit, afterCommit, silent }  (all optional, per call)
export function makeMemoryStorage() {
  const nodes = new Map();            // key -> node | null
  const listeners = new Map();        // key -> Set<fn>
  const log = [];
  // VERSION FENCE: server-owned policy records, keyed "tenantId/bizId"; `policyFailures`
  // makes a subscription/read fail (permission error) instead of delivering a value.
  const policies = new Map();
  const policyListeners = new Map();
  const policyFailures = new Set();
  const pkey = (t, b) => `${t}/${b}`;
  const emitPolicy = (k) => { const v = policies.has(k) ? canon(policies.get(k)) : null; for (const l of policyListeners.get(k) || []) l(v); };
  let hooks = {};
  const canon = (v) => JSON.parse(JSON.stringify(v));
  const prune = (o) => { for (const k of Object.keys(o)) { if (o[k] === null || o[k] === undefined) delete o[k];
    else if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) { prune(o[k]); if (!Object.keys(o[k]).length) delete o[k]; } } };
  const norm = (v) => { if (v === null || v === undefined) return null; const c = canon(v); if (c && typeof c === "object" && !Array.isArray(c)) { prune(c); if (!Object.keys(c).length) return null; } return c; };
  const getAt = (key, sub) => { let cur = nodes.get(key) ?? null; for (const p of sub ? sub.split("/") : []) cur = cur && typeof cur === "object" ? (cur[p] ?? null) : null; return cur === null ? null : canon(cur); };
  const setAt = (key, sub, value) => {
    if (!sub) { nodes.set(key, norm(value)); return; }
    let node = nodes.get(key); if (!node) { node = {}; nodes.set(key, node); }
    const parts = sub.split("/"); let cur = node;
    for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]]; }
    const nv = norm(value); if (nv === null) delete cur[parts[parts.length - 1]]; else cur[parts[parts.length - 1]] = nv;
    prune(node); if (!Object.keys(node).length) nodes.set(key, null);
  };
  const emit = (key) => { const v = getAt(key, ""); for (const l of listeners.get(key) || []) l(v); };
  const transact = async (key, sub, fn, h) => {
    const hk = { ...hooks, ...(h || {}) };
    log.push({ key, sub });
    if (hk.beforeRun) await hk.beforeRun();
    const next = fn(getAt(key, sub));
    if (next === undefined) return { committed: false };
    if (hk.denyIf && hk.denyIf(key, sub, next)) { const e = new Error("PERMISSION_DENIED: Permission denied"); e.code = "PERMISSION_DENIED"; throw e; }
    if (hk.beforeCommit) await hk.beforeCommit();
    setAt(key, sub, next);
    if (!hk.silent) emit(key);
    if (hk.afterCommit) await hk.afterCommit();
    return { committed: true };
  };
  const storage = {
    // production seams (the shapes index.html calls)
    mutateFor: (tenantId, key, fn) => transact(key, "", fn),
    mutateForPath: (tenantId, key, subPath, fn) => transact(key, String(subPath), fn),
    subscribeNode: (key, cb, onErr) => {
      const l = (v) => { if (v !== null) cb(v); };                 // production: only existing nodes are delivered
      if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(l);
      const v = getAt(key, ""); queueMicrotask(() => { if (listeners.get(key)?.has(l) && v !== null) cb(v); });   // Firebase delivers asynchronously
      return () => listeners.get(key)?.delete(l);
    },
    get: async (key) => { const v = getAt(key, ""); if (v === null) throw new Error("not found"); return { key, value: JSON.stringify(v), shared: true }; },
    subscribePolicy: (tenantId, bizId, cb, onErr) => {
      const k = pkey(tenantId, bizId);
      if (policyFailures.has(k)) { queueMicrotask(() => onErr && onErr(new Error("PERMISSION_DENIED: Permission denied"))); return () => {}; }
      if (!policyListeners.has(k)) policyListeners.set(k, new Set()); policyListeners.get(k).add(cb);
      const v = policies.has(k) ? canon(policies.get(k)) : null;
      queueMicrotask(() => { if (policyListeners.get(k)?.has(cb)) cb(v); });           // Firebase delivers asynchronously, null for an absent node
      return () => policyListeners.get(k)?.delete(cb);
    },
    getPolicy: async (tenantId, bizId) => { const k = pkey(tenantId, bizId); if (policyFailures.has(k)) throw new Error("PERMISSION_DENIED: Permission denied"); return policies.has(k) ? canon(policies.get(k)) : null; },
    // test controls
    seedPolicy: (tenantId, bizId, record) => { const k = pkey(tenantId, bizId); if (record === null || record === undefined) policies.delete(k); else policies.set(k, canon(record)); },
    injectPolicy: (tenantId, bizId, record) => { const k = pkey(tenantId, bizId); if (record === null || record === undefined) policies.delete(k); else policies.set(k, canon(record)); emitPolicy(k); },
    failPolicy: (tenantId, bizId, fail = true) => { const k = pkey(tenantId, bizId); if (fail) policyFailures.add(k); else policyFailures.delete(k); },
    policyListenerCount: (tenantId, bizId) => (policyListeners.get(pkey(tenantId, bizId)) || new Set()).size,
    seed: (key, value) => { nodes.set(key, norm(value)); },
    inject: (key, sub, value) => { setAt(key, sub, value); emit(key); },           // a foreign writer landing a value
    read: (key, sub = "") => getAt(key, sub),
    emit,
    setHooks: (h) => { hooks = h || {}; },
    log,
    listenerCount: (key) => (listeners.get(key) || new Set()).size,
  };
  return storage;
}

// ── the dashboard, wired by the production blocks ────────────────────────────
export function createDashboard({ html = HTML, storage, tenantId = "T1", bizId = "A", W } = {}) {
  const win = W || loadProductionWindow(html);
  win.storage = storage;
  const ML = win.MarjinSaveLifecycle;
  const st = { displayed: [], selections: [], policyUi: null, policyUiLog: [] };
  const EMPTY_ENTRY = { date: "", sales: "", deliveries: "", food_cost: "", payroll: "", hourly_payroll: "",
                        other_expense: "", other_income: "", supplier_payments: {}, weather_impact: "",
                        security_event: false, includeVat: false, notes: "", is_exception: false, exception_reason: "", exception_note: "" };
  const sandbox = {
    window: win, console, Promise, Object, Array, JSON, Math, Number, String, Error, setTimeout, queueMicrotask,
    useRef: (v) => ({ current: v }),
    selectionCtrlRef: { current: ML.createSelectionController() },
    setEntries: (rows) => { st.displayed = rows; },
    setEntriesPolicyUi: (d) => { st.policyUi = d; st.policyUiLog.push(d); },
    EMPTY_ENTRY,
    get entries() { return st.displayed; },              // React state the labor call site reads
    activeBizIdRef: { current: null },
    editingDateRef: { current: null },
    exceptionOwnershipRef: { current: null },
    suppressNextDashboardInsightsLoadForBizRef: { current: null },
    saveOwnershipCtrlRef: { current: null },
    loadEntryExceptions: () => {},
  };
  const initBlock = extractInitBlock(html);
  vm.runInNewContext(SELECTION_HELPERS.join("\n") + "\n" + initBlock +
    "\nthis.__refs = { coord: entriesWriteCoordRef, mode: entriesStorageModeRef, policy: (typeof entriesPolicyRef !== 'undefined' ? entriesPolicyRef : { current: null }), router: entriesStorageRouterRef, v2: entriesV2MutatorRef, legacy: entriesMutatorRef, submitLaborEntry, newRowId, captureSelectionCtx, isSelectionLive };",
    sandbox, { filename: "index.html#dashboard-init" });
  const refs = sandbox.__refs;
  let effect = null;                                     // { live, unsubs }
  const selectBusiness = (nextBizId) => {
    if (effect) { effect.live = false; effect.unsubs.forEach((u) => { try { u(); } catch (_) {} }); }
    // production invalidateSelection() essentials for the entries lane
    sandbox.selectionCtrlRef.current.invalidate(tenantId, nextBizId);
    sandbox.activeBizIdRef.current = nextBizId;
    refs.coord.current.invalidate();
    // production selection effect prefix (pinned by source assertion)
    assert.ok(html.includes(EFFECT_RESET_LINE), "mode ref reset line is in the selection effect");
    if (html.includes("window.MarjinStoragePolicy = Object.freeze({")) assert.ok(html.includes(EFFECT_POLICY_RESET_LINE), "policy lane reset line is in the selection effect");
    refs.mode.current = null;
    refs.policy.current = null;
    st.policyUi = null;
    st.displayed = [];
    st.selections.push(nextBizId);
    const eff = { live: true, unsubs: [] };
    effect = eff;
    const scope = Object.create(sandbox);
    Object.assign(scope, { currentBizId: nextBizId, unsubs: eff.unsubs, ctxAtSetup: refs.captureSelectionCtx(),
      entriesStorageModeRef: refs.mode, entriesPolicyRef: refs.policy, entriesWriteCoordRef: refs.coord, isSelectionLive: refs.isSelectionLive });
    Object.defineProperty(scope, "live", { get: () => eff.live });
    vm.runInNewContext(extractListenerBlock(html), scope, { filename: "index.html#selection-effect" });
    return eff;
  };
  const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
  return {
    W: win, ML, V2: win.MarjinStorageV2, ME: win.MarjinEntries, st, refs, sandbox, EMPTY_ENTRY,
    coord: () => refs.coord.current, mode: () => refs.mode.current,
    policy: () => refs.policy.current, policyUi: () => st.policyUi,
    submitLaborEntry: (date, val) => refs.submitLaborEntry(date, val),
    newRowId: () => refs.newRowId(),
    selectBusiness, settle,
    displayed: () => st.displayed,
    salesOf: (id) => { const r = (st.displayed || []).find((x) => x.id === id); return r ? r.sales : undefined; },
    ctx: () => sandbox.selectionCtrlRef.current.capture(),
    fingerprint: () => refs.coord.current.currentFingerprint(),
    // the real history-screen clear-all arguments (see the "מחק הכל" onClick)
    clearAll: () => refs.coord.current.submitClearAll({ expectedNodeFingerprint: refs.coord.current.currentFingerprint(), confirmToken: refs.newRowId() }),
    tenantId,
  };
}

// ── Admin-SDK backed transport for the emulator matrix ───────────────────────
export function makeSdkStorage(db, tenantId, hooks = {}) {
  const path = (key) => `tenants/${tenantId}/${key}`;
  return {
    hooks,
    mutateFor: async (t, key, fn) => { const r = await db.ref(path(key)).transaction(fn, undefined, false); if (hooks.afterNode) await hooks.afterNode(); return { committed: r.committed }; },
    mutateForPath: async (t, key, subPath, fn) => { if (hooks.beforeRow) await hooks.beforeRow(); const r = await db.ref(path(key) + "/" + String(subPath).replace(/[.#$[\]]/g, "_")).transaction(fn, undefined, false); return { committed: r.committed }; },
    subscribeNode: (key, cb, onErr) => { const ref = db.ref(path(key)); const h = ref.on("value", (snap) => { if (snap.exists()) cb(snap.val()); }, (e) => onErr && onErr(e)); return () => ref.off("value", h); },
    get: async (key) => { const snap = await db.ref(path(key)).once("value"); if (!snap.exists()) throw new Error("not found"); return { key, value: JSON.stringify(snap.val()), shared: true }; },
    // VERSION FENCE: the production policy transport shape over the real SDK
    subscribePolicy: (t, b, cb, onErr) => { const ref = db.ref(`storage_v2_control/${t}/${b}`); const h = ref.on("value", (snap) => cb(snap.exists() ? snap.val() : null), (e) => onErr && onErr(e)); return () => ref.off("value", h); },
    getPolicy: async (t, b) => { const snap = await db.ref(`storage_v2_control/${t}/${b}`).once("value"); return snap.exists() ? snap.val() : null; },
  };
}
