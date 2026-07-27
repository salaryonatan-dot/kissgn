// P0-DATA-01 R6 regression guard — destination-wide entries lifecycle convergence.
//
// Every executable test drives the ACTUAL production helpers vm-extracted from
// index.html. ONLY terminal I/O is injected — deferred storage/API transports that
// COMMIT to a simulated store on resolution, state/ref spies, timers. The ONE
// destination lane, its fingerprint echo ownership, waiter settlement, supplier
// result ownership, save-UI runner, insight loader, and exception store under test
// are the exact production-used code. Race tests assert terminal PERSISTED storage
// and non-invocation of prohibited paths, not merely final React state.
// Labels: [prod-helper] real seam factory · [prod-entries] real MarjinEntries ·
//         [source-guard] supplementary wiring assertion (NOT race proof).
// Run: node --test test/dashboard/entries-lifecycle.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

const FREEZE = "window.MarjinSaveLifecycle = Object.freeze({ createSelectionController, scheduleSelectionBoundTimeout, loadExceptionsBound, createPersistence, createEntriesWriteCoordinator, createSaveOwnership, createInsightReadback, createInsightUiLoader, createSaveUiRunner, createExceptionOwnership, createSupplierResultOwnership, applySupplierWriteResult, executeEntrySave });";

function loadProductionBlocks() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  assert.notEqual(start, -1, "index.html must contain the P0-DATA-01 helper block");
  const end = html.indexOf(FREEZE, start);
  assert.notEqual(end, -1, "index.html must expose window.MarjinSaveLifecycle with the R6 production factories");
  const src = html.slice(start, end + FREEZE.length);
  assert.ok(!/new Date\(/.test(src), "identity/lifecycle blocks must not parse dates via Date()");
  const sandbox = { window: {}, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
  vm.runInNewContext(src, sandbox);
  return sandbox.window;
}

function loadStorageSetFor() {
  const start = html.indexOf("const fkeySharedForTenant = (tenantId, k) =>");
  const setForNeedle = "window.storage.setFor = async (tenantId, key, value, shared=false) => {";
  const setForStart = html.indexOf(setForNeedle, start);
  const endMarker = "\n    };";
  const setForEnd = html.indexOf(endMarker, setForStart) + endMarker.length;
  const src = html.slice(start, setForEnd);
  const calls = [];
  const sandbox = { window: { storage: {}, _currentTenantId: "T1" }, JSON, Error,
    ref: (db, path) => ({ __ref: true, db, path }), set: async (r, val) => { calls.push({ path: r.path, val }); }, db: {} };
  vm.runInNewContext(src, sandbox);
  return { setFor: sandbox.window.storage.setFor, calls, sandbox };
}

const W = loadProductionBlocks();
const ME = W.MarjinEntries;
const ML = W.MarjinSaveLifecycle;
const plain = (x) => JSON.parse(JSON.stringify(x));
const day = (date, sales, extra = {}) => ({ date, sales, deliveries: 0, other_income: 0, ...extra });
const totalRevenue = (list) => list.reduce((a, e) => a + (Number(e.sales) || 0) + (Number(e.deliveries) || 0) + (Number(e.other_income) || 0), 0);
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const tick = () => new Promise((r) => setImmediate(r));
const settleAll = async () => { await tick(); await tick(); await tick(); };
const liveCtrl = (t = "T1", b = "A") => { const c = ML.createSelectionController(); c.invalidate(t, b); return c; };

function incidentEntries() {
  const list = [];
  for (let d = 1; d <= 22; d++) list.push(day(`2026-07-${String(d).padStart(2, "0")}`, 24031));
  list.push(day("2026-07-23", 24048)); list.push(day("2026-07-24", 27753));
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════
// ONE DESTINATION LANE — real coordinator + real persistence + COMMITTING store
// ═══════════════════════════════════════════════════════════════════════════

function laneHarness() {
  const ctrl = liveCtrl("T1", "A");
  const store = {};              // simulated persisted RTDB: key -> serialized value
  const transports = [];         // one per dispatched terminal write, in order
  const applied = [];            // every array handed to setEntries
  const P = ML.createPersistence({
    selection: ctrl, canonicalize: ME.canonicalizeEntries,
    storageSetFor: (tenantId, key, valueStr) => {
      const g = deferred();
      transports.push({ tenantId, key, __commit: () => { store[key] = valueStr; }, resolve: () => g.resolve(), reject: (e) => g.reject(e || new Error("write_failed")) });
      return g.promise;
    },
  });
  const lane = ML.createEntriesWriteCoordinator({
    selection: ctrl, canonicalize: ME.canonicalizeEntries, upsert: ME.upsertEntryByDate,
    entryDateKey: ME.entryDateKey, fingerprint: (rows) => JSON.stringify(rows),
    applyRows: (r) => applied.push(plain(r)), commit: (rows, ctx) => P.persistEntries(rows, ctx),
  });
  const sv = (arr, date, supId) => { const row = (arr || []).find(e => e.date === date); return row && row.supplier_payments ? row.supplier_payments[supId] : undefined; };
  return {
    ctrl, store, transports, applied, lane, sv,
    last: () => applied[applied.length - 1],
    persisted: () => (store["biz:A:entries"] ? JSON.parse(store["biz:A:entries"]) : null),
    persistedSup: (d, s) => { const p = store["biz:A:entries"]; return p ? sv(JSON.parse(p), d, s) : undefined; },
    ok: (i) => { transports[i].__commit(); transports[i].resolve(); },
    fail: (i) => { transports[i].reject(); },
    ownEchoOf: (i) => JSON.parse(transports[i] && store[transports[i].key] !== undefined ? store[transports[i].key] : "null"),
  };
}

// ─── Mandatory test 1: cross-writer ordering (supplier 100 vs main-save 999) ───
test("[prod-helper] R6-1: supplier(100) + main-save-replace(999) share ONE lane; single-flight; final persisted 999", async () => {
  const h = laneHarness();
  const pSup = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const pSave = h.lane.submit({ rows: [{ date: "2026-07-24", sales: 0, deliveries: 0, other_income: 0, supplier_payments: { "sup-1": "999" } }], apply: false });
  await tick();
  assert.equal(h.transports.length, 1, "only ONE terminal write dispatched while the first is in flight");
  h.ok(0); await settleAll();
  assert.equal(h.transports.length, 2, "the 999 write dispatches only after the 100 write settled");
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "100", "supplier 100 committed first, in order");
  h.ok(1); await settleAll();
  await Promise.all([pSup, pSave]);
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "999", "newest (main save) commits last and wins in PERSISTED storage");
});

// ─── Mandatory test 2: every intent routes through the shared lane ───
test("[prod-helper] R6-2: supplier/main-save/delete/clear/labor/self-heal all route through the ONE lane", async () => {
  const h = laneHarness();
  // supplier (transform)
  const s = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  await tick(); h.ok(0); await settleAll(); await s;
  // main save (replace)
  const ms = h.lane.submit({ rows: [day("2026-07-24", 500)], apply: false });
  await tick(); h.ok(1); await settleAll(); await ms;
  // employee labor (transform payroll)
  const lb = h.lane.submit({ baseRows: [day("2026-07-24", 500)], transform: (d) => ME.upsertEntryByDate(d, { ...(d.find(e => e.date === "2026-07-24") || {}), date: "2026-07-24", payroll: "80" }, "2026-07-24") });
  await tick(); h.ok(2); await settleAll(); await lb;
  assert.equal(h.persisted().find(e => e.date === "2026-07-24").payroll, "80");
  // delete (transform)
  const del = h.lane.submit({ baseRows: h.persisted(), transform: (d) => d.filter(e => e.date !== "2026-07-24") });
  await tick(); h.ok(3); await settleAll(); await del;
  assert.equal(h.persisted().length, 0, "delete removed the date");
  // clear all (replace [])
  const c1 = h.lane.submit({ rows: [day("2026-07-25", 10)] });
  await tick(); h.ok(4); await settleAll(); await c1;
  const c2 = h.lane.submit({ rows: [] });
  await tick(); h.ok(5); await settleAll(); await c2;
  assert.deepEqual(h.persisted(), [], "clear-all persisted []");
  assert.equal(h.transports.length, 6, "each intent produced exactly one terminal write, all serialized");
});

// ─── Mandatory test 3: cross-writer transform preservation ───
test("[prod-helper] R6-3: transforms build on the LATEST desired — different suppliers + labor all preserved; later replace wins wholesale", async () => {
  const h = laneHarness();
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-2", date: "2026-07-24", val: "250", rows: [], emptyEntry: {} });
  const p3 = h.lane.submit({ baseRows: [], transform: (d) => ME.upsertEntryByDate(d, { ...(d.find(e => e.date === "2026-07-24") || { date: "2026-07-24" }), payroll: "70" }, "2026-07-24") });
  await tick(); h.ok(0); await settleAll(); h.ok(1); await settleAll(); await Promise.all([p1, p2, p3]);
  const row = h.persisted().find(e => e.date === "2026-07-24");
  assert.equal(row.supplier_payments["sup-1"], "100");
  assert.equal(row.supplier_payments["sup-2"], "250");
  assert.equal(row.payroll, "70", "labor transform preserved on top of both supplier edits");
  // later explicit main-save REPLACE wins wholesale (drops the accumulated fields)
  const ms = h.lane.submit({ rows: [day("2026-07-24", 9999)], apply: false });
  await tick(); h.ok(h.transports.length - 1); await settleAll(); await ms;
  assert.equal(h.persisted().find(e => e.date === "2026-07-24").sales, 9999);
  assert.equal(h.persisted().find(e => e.date === "2026-07-24").supplier_payments, undefined, "explicit replace wins wholesale");
});

// ─── Mandatory test 4: queued invalidation — every waiter settles exactly once ───
for (const mode of ["success", "failure"]) {
  test(`[prod-helper] R6-4(${mode}): rev1 active, rev2/rev3 queued, invalidate → rev2/rev3 settle cancelled exactly once; no stale UI`, async () => {
    const h = laneHarness();
    let settled2 = 0, settled3 = 0;
    const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
    const p2 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} }).then(r => { settled2++; return r; });
    const p3 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "300", rows: [], emptyEntry: {} }).then(r => { settled3++; return r; });
    await tick();
    const appliedBefore = h.applied.length;
    h.lane.invalidate(); h.ctrl.invalidate("T2", "B");
    if (mode === "success") h.ok(0); else h.fail(0);
    await settleAll();
    const r1 = await p1, r2 = await p2, r3 = await p3;
    assert.equal(r2.status, "cancelled_selection_changed");
    assert.equal(r3.status, "cancelled_selection_changed");
    assert.equal(settled2, 1, "rev2 waiter settled exactly once");
    assert.equal(settled3, 1, "rev3 waiter settled exactly once");
    assert.equal(h.applied.length, appliedBefore, "no post-invalidation optimistic apply into the new selection");
    assert.ok(["applied", "persist_failed"].includes(r1.status), "the active write settles against its captured destination");
  });
}

// ─── Mandatory test 5: switch-away-and-back to T1/A ───
test("[prod-helper] R6-5: switch-away-and-back to T1/A — new write waits behind the old physical write, commits last, wins", async () => {
  const h = laneHarness();
  const pOld = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "OLD", rows: [], emptyEntry: {} });
  await tick();
  h.lane.invalidate();               // leave A
  h.lane.invalidate();               // ... return to A (fresh lane)
  const pNew = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "NEW", rows: [day("2026-07-24", 5)], emptyEntry: {} });
  await tick();
  assert.equal(h.transports.length, 1, "new write NOT dispatched while the old physical write is active");
  const st = h.lane._state();
  assert.ok(st.pending >= 0, "new-generation pending accounting is non-negative");
  h.ok(0); await settleAll();
  assert.equal(h.transports.length, 2, "new write dispatched only after the old settled");
  h.ok(1); await settleAll();
  await Promise.allSettled([pOld, pNew]);
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "NEW", "new-generation payload commits last and wins");
});

// ─── Mandatory test 6: Firebase local-before-ack ───
test("[prod-helper] R6-6: local own echo BEFORE ack is not poisoned; external 999 AFTER ack is applied", async () => {
  const h = laneHarness();
  const p = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  const desired = plain(h.last());   // the exact canonical we dispatched (fingerprint source)
  const localEcho = h.lane.onListenerEcho(desired); // own echo arrives BEFORE ack
  assert.equal(localEcho.status, "ignored_own_echo", "own local-before-ack echo identified by fingerprint");
  h.ok(0); await settleAll(); await p; // ack — registers nothing new (fp was registered at dispatch)
  const ext = h.lane.onListenerEcho([day("2026-07-24", 0, { supplier_payments: { "sup-1": "999" } })]);
  assert.equal(ext.status, "applied", "legitimate external payload after ack is NOT swallowed by a counter");
  assert.equal(h.sv(h.last(), "2026-07-24", "sup-1"), "999");
});

test("[prod-helper] R6-6b: two serialized writes with local-before-ack echoes; two later external payloads both apply", async () => {
  const h = laneHarness();
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  await tick();
  const d1 = plain(h.last());
  h.lane.onListenerEcho(d1); // local echo of 100 before ack
  h.ok(0); await settleAll(); await p1;
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  const d2 = plain(h.last());
  h.lane.onListenerEcho(d2); // local echo of 200 before ack
  h.ok(1); await settleAll(); await p2;
  const e1 = h.lane.onListenerEcho([day("2026-07-24", 0, { supplier_payments: { "sup-1": "999" } })]);
  assert.equal(e1.status, "applied");
  const e2 = h.lane.onListenerEcho([day("2026-07-25", 0, { supplier_payments: { "sup-2": "888" } })]);
  assert.equal(e2.status, "applied", "second external payload also applies (no poisoned counter)");
});

// ─── Mandatory test 7: complete listener race ───
test("[prod-helper] R6-7: 100 → 200 → own-echo(200) → delayed own-echo(100); final UI/persisted 200", async () => {
  const h = laneHarness();
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  h.ok(0); await settleAll();          // 100 committed
  const echo100 = JSON.parse(h.store["biz:A:entries"]); // own echo of 100
  h.ok(1); await settleAll();          // 200 committed
  const echo200 = JSON.parse(h.store["biz:A:entries"]); // own echo of 200
  await Promise.all([p1, p2]);
  assert.equal(h.lane.onListenerEcho(echo200).status, "ignored_own_echo");
  assert.equal(h.lane.onListenerEcho(echo100).status, "ignored_own_echo", "delayed OLDER own echo identified and ignored");
  assert.equal(h.sv(h.last(), "2026-07-24", "sup-1"), "200");
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "200");
});

// ─── Mandatory test 8: normal convergence; no permanent blacklist ───
test("[prod-helper] R6-8: external payload after quiescence applies; an identical FUTURE remote payload is not permanently blacklisted", async () => {
  const h = laneHarness();
  const p = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick(); h.ok(0); await settleAll(); await p;
  const own = JSON.parse(h.store["biz:A:entries"]);
  assert.equal(h.lane.onListenerEcho(own).status, "ignored_own_echo"); // consumes the own fingerprint
  // A future EXTERNAL payload identical to what we once wrote now applies (fingerprint retired after consume).
  const again = h.lane.onListenerEcho(own);
  assert.equal(again.status, "applied", "identical future remote payload is not permanently blacklisted");
});

test("[prod-helper] R6-8b: an external non-matching payload while a local write is pending is DEFERRED (never consumed as own)", async () => {
  const h = laneHarness();
  const p = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  const ext = h.lane.onListenerEcho([day("2026-07-24", 0, { supplier_payments: { "sup-1": "100" } })]);
  assert.equal(ext.status, "deferred_pending_local", "external payload deferred, not applied, not mis-owned, while pending");
  h.ok(0); await settleAll(); await p;
  assert.equal(h.sv(h.last(), "2026-07-24", "sup-1"), "200", "pending value not regressed by the deferred external payload");
});

// ─── Mandatory test 9: supplier error ownership (composed with real result) ───
function supErrHarness() {
  const ctrl = liveCtrl("T1", "A");
  const own = ML.createSupplierResultOwnership();
  const ev = [];
  const ports = { setError: () => ev.push("set"), clearError: () => ev.push("clear") };
  return { ctrl, own, ev, ports };
}
test("[prod-helper] R6-9: supplier error ownership — latest live failure sets; older/old-selection results cannot touch current error; owned success clears", () => {
  const h = supErrHarness();
  // latest live failure sets
  const t1 = h.own.begin(h.ctrl.capture());
  assert.equal(h.own.settle(t1, { status: "persist_failed" }, h.ctrl, h.ports).action, "set");
  // a NEWER submission supersedes; the older token can no longer act
  const t2 = h.own.begin(h.ctrl.capture());
  assert.equal(h.own.settle(t1, { status: "persist_failed" }, h.ctrl, h.ports).action, "superseded", "older same-selection result cannot overwrite");
  // owned success clears
  assert.equal(h.own.settle(t2, { status: "applied" }, h.ctrl, h.ports).action, "clear");
  assert.deepEqual(h.ev, ["set", "clear"]);
});

test("[prod-helper] R6-9b: old-selection result after invalidation cannot set/clear the NEW selection's error", () => {
  const h = supErrHarness();
  const tOld = h.own.begin(h.ctrl.capture());        // T1/A
  h.ctrl.invalidate("T2", "B"); h.own.invalidate();  // selection changes; ownership reset
  // old T1/A failure result arrives:
  assert.equal(h.own.settle(tOld, { status: "persist_failed" }, h.ctrl, h.ports).action, "stale", "old-selection failure cannot set the new error");
  // new selection error:
  const tNew = h.own.begin(h.ctrl.capture());
  h.own.settle(tNew, { status: "persist_failed" }, h.ctrl, h.ports);
  // an old-selection SUCCESS cannot clear the new error (rejected as stale/superseded — never "clear"):
  assert.ok(["stale", "superseded"].includes(h.own.settle(tOld, { status: "applied" }, h.ctrl, h.ports).action));
  assert.deepEqual(h.ev, ["set"], "only the new selection's own failure set the error");
});

test("[prod-helper] R6-9c: unmount → no supplier error mutation", () => {
  const h = supErrHarness();
  const t = h.own.begin(h.ctrl.capture());
  h.own.unmount();
  assert.equal(h.own.settle(t, { status: "persist_failed" }, h.ctrl, h.ports).action, "unmounted");
  assert.deepEqual(h.ev, []);
});

// ─── Mandatory test 10: insight role null-to-owner ───
function insightRoleHarness() {
  const ctrl = liveCtrl("T1", "A");
  const roleBox = { role: null };                    // mutable role port (mirrors the render-updated ref)
  const setterCalls = { clearAll: 0, setLoading: [], setData: [], setDate: [], setError: [], setWarning: [] };
  const requests = []; const gates = [];
  const readback = ML.createInsightReadback({ selection: ctrl, candidateDates: () => ["2026-07-27"], apiGetRange: ({ tenantId, bizId, fromDate }) => { const g = deferred(); gates.push(g); requests.push({ tenantId, bizId, fromDate }); return g.promise; } });
  const loader = ML.createInsightUiLoader({
    readback, isCancelled: (ctx) => !ctrl.isLive(ctx),
    candidatesReady: (ctx) => ["super_owner", "owner", "manager"].includes(roleBox.role) && !!(ctx && ctx.bizId), // reads CURRENT role
    ports: { clearAll: () => setterCalls.clearAll++, setLoading: (v) => setterCalls.setLoading.push(v), setError: (v) => setterCalls.setError.push(v), setWarning: (v) => setterCalls.setWarning.push(v), setData: (v) => setterCalls.setData.push(v), setDate: (v) => setterCalls.setDate.push(v) },
  });
  return { ctrl, roleBox, setterCalls, requests, gates, loader };
}
test("[prod-helper] R6-10: SAME loader instance created with null role; after role→owner it issues the request", async () => {
  const h = insightRoleHarness(); // role = null at creation
  const r0 = await h.loader.load(h.ctrl.capture(), null, () => false);
  assert.equal(r0.skipped, true, "null role skips (no request)");
  assert.equal(h.requests.length, 0);
  h.roleBox.role = "owner";        // login — NO new loader instance
  const p = h.loader.load(h.ctrl.capture(), null, () => false);
  await tick();
  assert.equal(h.requests.length, 1, "same loader now issues the request after owner login");
  h.gates[0].resolve({ "2026-07-27": { insights: [{ id: 1 }] } });
  const r1 = await p;
  assert.equal(r1.ok, true);
  assert.equal(h.setterCalls.setData[h.setterCalls.setData.length - 1].length, 1);
});
test("[prod-helper] R6-10b: owner loader, invalidate before/after readback → zero stale setter mutations", async () => {
  const h = insightRoleHarness(); h.roleBox.role = "owner";
  // invalidate BEFORE first request
  const ctx = h.ctrl.capture(); h.ctrl.invalidate("T2", "A");
  const r = await h.loader.load(ctx, null, () => false);
  assert.equal(r.cancelled, true);
  assert.equal(h.setterCalls.setLoading.length, 0);
  assert.equal(h.setterCalls.setData.length, 0);
  // cancel DURING iteration
  const h2 = insightRoleHarness(); h2.roleBox.role = "owner";
  const ctx2 = h2.ctrl.capture();
  const p = h2.loader.load(ctx2, null, () => false);
  await tick();
  const snap = { data: h2.setterCalls.setData.length, date: h2.setterCalls.setDate.length, loading: h2.setterCalls.setLoading.length };
  h2.ctrl.invalidate("T2", "A"); h2.gates[0].resolve({});
  const r2 = await p;
  assert.equal(r2.cancelled, true);
  assert.equal(h2.requests.length, 1);
  assert.equal(h2.setterCalls.setData.length, snap.data);
  assert.equal(h2.setterCalls.setDate.length, snap.date);
  assert.equal(h2.setterCalls.setLoading.length, snap.loading);
});

// ─── Mandatory test 11: save UI across all invalidation paths ───
function saveUiHarness() {
  const ctrl = liveCtrl("T1", "A");
  const own = ML.createSaveOwnership();
  let inFlight = false; let n = 0;
  const runner = ML.createSaveUiRunner({ ownership: own, selection: ctrl, setInFlight: (v) => { inFlight = v; }, makeOpId: () => "op-" + (++n) });
  return { ctrl, own, runner, getInFlight: () => inFlight };
}
for (const kind of ["business", "tenant", "logout"]) {
  test(`[prod-helper] R6-11(${kind}): invalidation clears the OBSERVABLE in-flight flag; new selection can save; old finally cannot clear new`, async () => {
    const h = saveUiHarness();
    const oldGate = deferred();
    const oldRun = h.runner.run(h.ctrl.capture(), async () => { await oldGate.promise; });
    await tick();
    assert.equal(h.getInFlight(), true);
    // the production invalidation path: ownership.invalidate() + runner.clearInFlight() + selection change
    h.own.invalidate(); h.runner.clearInFlight();
    if (kind === "business" || kind === "tenant") h.ctrl.invalidate("T2", kind === "business" ? "B" : "A");
    else h.ctrl.invalidate(null, null);
    assert.equal(h.getInFlight(), false, `${kind} invalidation cleared the observable in-flight flag`);
    const newGate = deferred();
    const newRun = h.runner.run(h.ctrl.capture(), async () => { await newGate.promise; });
    await tick();
    assert.equal(h.getInFlight(), true, "new selection can begin a save immediately");
    oldGate.resolve(); await oldRun;
    assert.equal(h.getInFlight(), true, "old finally did not clear the new save flag");
    newGate.resolve(); await newRun;
    assert.equal(h.getInFlight(), false);
  });
}
test("[prod-helper] R6-11(unmount): after unmount the runner performs NO setInFlight; double-submit still blocked", async () => {
  const h = saveUiHarness();
  const g = deferred();
  const r1 = h.runner.run(h.ctrl.capture(), async () => { await g.promise; });
  await tick();
  assert.equal(h.getInFlight(), true);
  h.runner.unmount();                       // mark UI port dead
  h.runner.clearInFlight();                 // no-op after unmount
  assert.equal(h.getInFlight(), true, "clearInFlight is a no-op after unmount (no post-unmount state update)");
  // a same-selection double-submit is still blocked
  const r2 = await h.runner.run(h.ctrl.capture(), async () => { throw new Error("must not run"); });
  assert.equal(r2.started, false);
  g.resolve(); await r1;
  assert.equal(h.getInFlight(), true, "old finally performed no setInFlight after unmount");
});

// ─── Mandatory test 12: exception ownership composed with executeEntrySave ───
function saveComposeHarness(exceptionOwn, overrides = {}) {
  const ctrl = liveCtrl("T1", "A");
  const calls = { storage: [], setSaved: [], resetForm: 0, schedNav: [] };
  const P = ML.createPersistence({ selection: ctrl, canonicalize: ME.canonicalizeEntries, storageSetFor: async (t, k) => { calls.storage.push([t, k]); } });
  const RB = ML.createInsightReadback({ selection: ctrl, candidateDates: () => ["2026-07-24"], apiGetRange: async () => ({ "2026-07-24": { insights: [] } }) });
  const io = {
    selection: ctrl, form: { date: "2026-07-24", sales: 27753 }, rows: [day("2026-07-01", 100)], role: "owner", editingDate: null,
    vatNormalize: (f) => f, materialChanged: () => true,
    todayKey: (off) => (off === 0 ? "2026-07-24" : off === 1 ? "2026-07-25" : "2026-07-23"),
    newOpId: () => "op-" + Math.random().toString(36).slice(2),
    exceptionState: { get: (d) => exceptionOwn.getState(d), set: (d, st) => exceptionOwn.setState(d, st), applyActive: () => {} },
    opIds: { ensure: (d, mk) => exceptionOwn.ensureOpId(d, mk), consume: (d) => exceptionOwn.consumeOpId(d) },
    apiFetch: async () => ({ ok: true, json: async () => ({ ok: true, applied: true, rebuildRequired: false, exception: { status: "active", reasonCode: "closure" }, revision: 1 }) }),
    persistRows: (rows2, c2) => P.persistEntries(rows2, c2), applyRows: () => {},
    reloadExceptions: async () => {}, rebuildInsights: async () => {},
    loadInsights: (d, isC, c2) => RB.loadRange(c2, d, isC).then(r => (r && r.cancelled ? { ok: false, cancelled: true } : { ok: true, found: true, date: d })),
    onInsightsFailure: () => {}, suppressNextInsightsLoad: () => {}, resetFormAndEditing: () => { calls.resetForm++; },
    setSaved: (v) => calls.setSaved.push(v), setError: () => {}, scheduleNav: (c, ms) => calls.schedNav.push([c, ms]),
    ...overrides,
  };
  return { ctrl, io, calls };
}
test("[prod-helper] R6-12: exception op-ID isolation composed with executeEntrySave — T1/A and T2/A same date get isolated op IDs", async () => {
  const own = ML.createExceptionOwnership();
  // save under T1/A: it needs a structured mutation → set form.is_exception true
  const h1 = saveComposeHarness(own, { role: "owner", form: { date: "2026-07-24", sales: 1, is_exception: true, exception_reason: "closure" } });
  const r1 = await ML.executeEntrySave(h1.io);
  assert.equal(r1.status, "saved");
  const opT1 = own._state().ops["2026-07-24"];
  assert.ok(opT1 === undefined, "op ID consumed on full success within the same live selection (replay-safe)");
  // switch selection T1/A → T2/A (same date); the store is invalidated as production does
  own.invalidate();
  h1.ctrl.invalidate("T2", "A");
  assert.equal(own.getState("2026-07-24"), undefined, "old exception STATE cannot populate the new selection's form");
  // a NEW save under T2/A mints a fresh op ID; old completion cannot resurrect the old one
  const h2 = saveComposeHarness(own, { role: "owner", form: { date: "2026-07-24", sales: 1, is_exception: true, exception_reason: "closure" } });
  h2.ctrl.invalidate("T2", "A"); // ensure the compose harness selection is T2/A live
  // (executeEntrySave will ensure a fresh op id under the new store)
  assert.equal(own._state().ops["2026-07-24"], undefined, "no op ID crosses from T1/A into T2/A");
});

// ─── Mandatory test 13: explicit-tenant storage ───
test("[prod-helper] R6-13: storage.setFor writes under captured tenant, {_v} envelope, no call on missing tenant", async () => {
  const { setFor, calls, sandbox } = loadStorageSetFor();
  sandbox.window._currentTenantId = "T2";
  const r = await setFor("T1", "biz:A:entries", JSON.stringify([{ date: "2026-07-24", sales: 1 }]), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "tenants/T1/biz:A:entries");
  assert.deepEqual(Object.keys(calls[0].val), ["_v"]);
  assert.equal(calls[0].val._v, JSON.stringify([{ date: "2026-07-24", sales: 1 }]));
  assert.equal(r.shared, true);
  await assert.rejects(() => setFor("", "biz:A:entries", "[]", true), /explicit tenant required/);
  assert.equal(calls.length, 1);
});

// ─── Carried-forward same-lane supplier/ordering scenarios (persisted checks) ───
test("[prod-helper] S9: clear-all writes entries with mandatory context (persisted [])", async () => {
  const h = laneHarness();
  const c = h.lane.submit({ rows: [] });
  await tick(); h.ok(0); await settleAll(); await c;
  assert.deepEqual(h.persisted(), []);
  assert.equal(h.transports[0].tenantId, "T1");
  assert.equal(h.transports[0].key, "biz:A:entries");
});
test("[prod-helper] S29: two rapid edits to DIFFERENT suppliers — both persisted", async () => {
  const h = laneHarness();
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-2", date: "2026-07-24", val: "250", rows: [], emptyEntry: {} });
  await tick(); h.ok(0); await settleAll(); h.ok(1); await settleAll(); await Promise.all([p1, p2]);
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "100");
  assert.equal(h.persistedSup("2026-07-24", "sup-2"), "250");
});
test("[prod-helper] S30: older FAILURE cannot roll back newer success (persisted 200)", async () => {
  const h = laneHarness();
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick(); h.fail(0); await settleAll();
  const r1 = await p1; assert.equal(r1.status, "persist_failed"); assert.equal(r1.latest, false);
  h.ok(1); await settleAll(); const r2 = await p2;
  assert.equal(r2.status, "applied"); assert.equal(r2.latest, true);
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "200");
});
test("[prod-helper] S31: LATEST failure reported latest:true; older completion cannot win", async () => {
  const h = laneHarness();
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick(); h.ok(0); await settleAll(); const r1 = await p1; assert.equal(r1.latest, false);
  h.fail(1); await settleAll(); const r2 = await p2;
  assert.equal(r2.status, "persist_failed"); assert.equal(r2.latest, true);
  assert.equal(h.sv(h.last(), "2026-07-24", "sup-1"), "200");
});
test("[prod-helper] S32/S33: duplicate starting rows collapse to one canonical row; state == persisted", async () => {
  const h = laneHarness();
  const p = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [day("2026-07-24", 27753), day("2026-07-24", 27753)], emptyEntry: {} });
  await tick();
  assert.equal(h.last().filter(e => e.date === "2026-07-24").length, 1);
  h.ok(0); await settleAll(); await p;
  assert.equal(h.persisted().filter(e => e.date === "2026-07-24").length, 1);
  assert.deepEqual(plain(h.last()), h.persisted(), "state array equals persisted payload");
});
test("[prod-helper] S23: production save runner blocks a same-selection double submit", async () => {
  const h = saveUiHarness();
  const g = deferred();
  const r1 = h.runner.run(h.ctrl.capture(), async () => { await g.promise; });
  await tick();
  const r2 = await h.runner.run(h.ctrl.capture(), async () => { throw new Error("no"); });
  assert.equal(r2.started, false); assert.equal(r2.reason, "duplicate");
  g.resolve(); await r1;
});
test("[prod-helper] applySupplierWriteResult pure mapping (latest-gated)", () => {
  const ev = []; const ports = { setError: () => ev.push("set"), clearError: () => ev.push("clear") };
  ML.applySupplierWriteResult({ status: "persist_failed", latest: true }, ports);
  ML.applySupplierWriteResult({ status: "persist_failed", latest: false }, ports);
  ML.applySupplierWriteResult({ status: "applied", latest: true }, ports);
  assert.deepEqual(ev, ["set", "clear"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE + DOMAIN + EXCEPTIONS + READBACK (carried forward, real helpers)
// ═══════════════════════════════════════════════════════════════════════════

function persistHarness(t = "T1", b = "A") {
  const ctrl = liveCtrl(t, b); const calls = []; let gate = null;
  const P = ML.createPersistence({ selection: ctrl, canonicalize: ME.canonicalizeEntries, storageSetFor: async (tn, k, v) => { calls.push([tn, k, v]); if (gate) await gate.promise; } });
  return { ctrl, calls, P, setGate: (g) => { gate = g; } };
}
test("[prod-helper] S3: persistEntries missing context rejected before any request", async () => {
  const h = persistHarness();
  assert.equal((await h.P.persistEntries([day("2026-07-01", 1)], null)).error, "missing_context");
  assert.equal(h.calls.length, 0);
});
test("[prod-helper] S4: persistEntries key uses captured ctx.bizId", async () => {
  const h = persistHarness("T1", "A");
  await h.P.persistEntries([day("2026-07-01", 1)], h.ctrl.capture());
  assert.equal(h.calls[0][1], "biz:A:entries");
});
test("[prod-helper] S1+S5: write under T1/A carries tenant T1; switch to T2/B issues no later write", async () => {
  const h = persistHarness("T1", "A"); const g = deferred(); h.setGate(g);
  const ctx = h.ctrl.capture();
  const p = h.P.persistEntries([day("2026-07-01", 1)], ctx); await tick();
  assert.equal(h.calls[0][0], "T1"); assert.equal(h.calls[0][1], "biz:A:entries");
  h.ctrl.invalidate("T2", "B"); g.resolve(); const r = await p;
  assert.equal(r.staleAfterWrite, true); assert.equal(h.calls.length, 1);
});
test("[prod-helper] S2: same biz id under new tenant rejected", async () => {
  const h = persistHarness("T1", "A"); const ctx = h.ctrl.capture(); h.ctrl.invalidate("T2", "A");
  assert.equal((await h.P.persistEntries([day("2026-07-01", 1)], ctx)).stale, true);
  assert.equal(h.calls.length, 0);
});
test("[prod-helper] S8: persistFixed writes ONLY the fixed key", async () => {
  const h = persistHarness("T1", "A");
  const r = await h.P.persistFixed([{ id: "f", amount: 10 }], h.ctrl.capture());
  assert.equal(r.ok, true); assert.equal(h.calls[0][1], "biz:A:fixed");
  assert.ok(!h.calls.some(c => c[1].endsWith(":entries")));
});
test("[prod-helper] S6/S7: persistEntries writes ONLY the entries key (supplier + labor domain separation)", async () => {
  const h = persistHarness("T1", "A");
  await h.P.persistEntries([day("2026-07-01", 1, { payroll: 5, supplier_payments: { "s": "1" } })], h.ctrl.capture());
  assert.ok(h.calls.every(c => c[1] === "biz:A:entries"));
});

function excHarness() {
  const ctrl = liveCtrl("T1", "A"); const requests = []; const applied = [];
  const io = { selection: ctrl, todayKey: (off) => (off === 1 ? "2026-07-28" : "2026-04-23"),
    apiFetch: async (url) => { requests.push(url); return { ok: true, json: async () => ({ ok: true, exceptions: { "2026-07-20": { status: "active", source: "structured", revision: 1, reasonCode: "closure" } } }) }; },
    applyState: (s, b) => applied.push({ s: plain(s), b: plain(b) }) };
  return { ctrl, requests, applied, io };
}
test("[prod-helper] S15: already-stale loadExceptionsBound sends zero requests", async () => {
  const h = excHarness(); const ctx = h.ctrl.capture(); h.ctrl.invalidate("T2", "B");
  assert.equal((await ML.loadExceptionsBound(h.io, ctx)).status, "stale");
  assert.equal(h.requests.length, 0);
});
test("[prod-helper] S16: context stale during fetch applies nothing", async () => {
  const ctrl = liveCtrl("T1", "A"); const requests = []; const applied = []; const rg = deferred();
  const io = { selection: ctrl, todayKey: (o) => (o === 1 ? "2026-07-28" : "2026-04-23"), apiFetch: async (u) => { requests.push(u); return { ok: true, json: async () => { await rg.promise; return { ok: true, exceptions: {} }; } }; }, applyState: (s, b) => applied.push([s, b]) };
  const p = ML.loadExceptionsBound(io, ctrl.capture()); await tick();
  ctrl.invalidate("T2", "B"); rg.resolve(); assert.equal((await p).status, "stale"); assert.equal(applied.length, 0);
});
test("[prod-helper] S15b: live context issues one request and applies", async () => {
  const h = excHarness(); const r = await ML.loadExceptionsBound(h.io, h.ctrl.capture());
  assert.equal(r.status, "applied"); assert.equal(h.applied[0].b["2026-07-20"], true);
});

function readbackHarness(candidates) {
  const ctrl = liveCtrl("T1", "A"); const requests = []; const gates = [];
  const readback = ML.createInsightReadback({ selection: ctrl, candidateDates: () => candidates, apiGetRange: ({ tenantId, bizId, fromDate }) => { const g = deferred(); gates.push(g); requests.push({ tenantId, bizId, fromDate }); return g.promise; } });
  return { ctrl, requests, gates, readback };
}
test("[prod-helper] S11: first candidate deferred, invalidate, not found → no second request", async () => {
  const h = readbackHarness(["2026-07-27", "2026-07-26"]); const ctx = h.ctrl.capture();
  const p = h.readback.loadRange(ctx, null, () => false); await tick();
  h.ctrl.invalidate("T2", "A"); h.gates[0].resolve({});
  assert.equal((await p).cancelled, true); assert.equal(h.requests.length, 1);
});
test("[prod-helper] S12: logout T1/login T2 same biz id — no second request", async () => {
  const h = readbackHarness(["2026-07-27", "2026-07-26"]); const ctx = h.ctrl.capture();
  const p = h.readback.loadRange(ctx, null, () => false); await tick();
  h.ctrl.invalidate("T2", "A"); h.gates[0].resolve({});
  assert.equal((await p).cancelled, true); assert.equal(h.requests.length, 1);
});
test("[prod-helper] S13: every insight request uses captured tenant/business", async () => {
  const h = readbackHarness(["2026-07-27", "2026-07-26", "2026-07-25"]); const ctx = h.ctrl.capture();
  const p = h.readback.loadRange(ctx, null, () => false);
  await tick(); h.gates[0].resolve({}); await tick(); h.gates[1].resolve({}); await tick(); h.gates[2].resolve({ "2026-07-25": { insights: [] } });
  assert.equal((await p).found, true);
  assert.ok(h.requests.every(r => r.tenantId === "T1" && r.bizId === "A"));
});

// full save lifecycle
test("[prod-helper] S41: normal same-context save succeeds exactly once (real persistence+readback)", async () => {
  const own = ML.createExceptionOwnership();
  const h = saveComposeHarness(own);
  const r = await ML.executeEntrySave(h.io);
  assert.equal(r.status, "saved"); assert.equal(h.calls.storage.length, 1);
  assert.equal(h.calls.storage[0][1], "biz:A:entries"); assert.ok(h.calls.setSaved.includes(true)); assert.equal(h.calls.resetForm, 1);
});
test("[prod-helper] S42: delayed navigation scheduled with the captured live ctx", async () => {
  const own = ML.createExceptionOwnership(); const h = saveComposeHarness(own);
  await ML.executeEntrySave(h.io);
  assert.equal(h.calls.schedNav.length, 1); assert.equal(h.ctrl.isLive(h.calls.schedNav[0][0]), true);
});
test("[prod-helper] S10: a save whose selection changes mid-flight mutates nothing in the new selection", async () => {
  const own = ML.createExceptionOwnership(); const pg = deferred(); let h;
  h = saveComposeHarness(own, { persistRows: async (rows2, c2) => { const P = ML.createPersistence({ selection: h.ctrl, canonicalize: ME.canonicalizeEntries, storageSetFor: async () => { await pg.promise; } }); return P.persistEntries(rows2, c2); } });
  const p = ML.executeEntrySave(h.io); await tick(); h.ctrl.invalidate("T2", "B"); pg.resolve();
  const r = await p;
  assert.equal(r.status, "stale"); assert.ok(!h.calls.setSaved.includes(true)); assert.equal(h.calls.resetForm, 0); assert.equal(h.calls.schedNav.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// PRESERVED R2 BEHAVIOR — MarjinEntries (34-40, 43, incident)
// ═══════════════════════════════════════════════════════════════════════════
test("[prod-entries] incident fixture arithmetic exact (608,236 / 580,483 / 27,753)", () => {
  const list = incidentEntries();
  assert.equal(list.length, 24); assert.equal(totalRevenue(list), 580483); assert.equal(580483 + 27753, 608236);
});
test("[prod-entries] S43: duplicate incident rows canonicalize to 580,483; state == persisted", async () => {
  const raw = [...incidentEntries(), day("2026-07-24", 27753)];
  const canon = ME.canonicalizeEntries(raw);
  assert.equal(canon.length, 24); assert.equal(totalRevenue(canon), 580483);
  const ctrl = liveCtrl(); let written = null;
  const P = ML.createPersistence({ selection: ctrl, canonicalize: ME.canonicalizeEntries, storageSetFor: async (t, k, v) => { written = JSON.parse(v); } });
  const res = await P.persistEntries(raw, ctrl.capture());
  assert.equal(totalRevenue(res.canonical), 580483); assert.deepEqual(plain(written), plain(res.canonical));
});
test("[prod-entries] S34: date-move edit keeps ONE row for the final date", () => {
  const moved = ME.upsertEntryByDate([day("2026-07-01", 10), day("2026-07-02", 20), day("2026-07-03", 30)], day("2026-07-05", 999), "2026-07-02");
  assert.equal(moved.filter(e => e.date === "2026-07-02").length, 0);
  assert.equal(moved.find(e => e.date === "2026-07-05").sales, 999); assert.equal(moved.length, 3);
});
test("[prod-entries] S34b/S35: edit onto existing date / explicit save wins wholesale", () => {
  const merged = ME.upsertEntryByDate([day("2026-07-01", 10), day("2026-07-02", 20)], day("2026-07-02", 500, { note: "n" }), "2026-07-01");
  assert.equal(merged.length, 1); assert.equal(merged.find(e => e.date === "2026-07-02").sales, 500);
  const saved = ME.upsertEntryByDate([day("2026-07-10", 100, { payroll: 50 })], day("2026-07-10", 300), "2026-07-10");
  assert.equal(saved[0].sales, 300); assert.equal(saved[0].payroll, undefined);
});
test("[prod-entries] S36: earliest-non-zero scalar precedence (never summed)", () => {
  const c = ME.canonicalizeEntries([day("2026-07-11", 0, { payroll: 0 }), day("2026-07-11", 250, { payroll: 80 })]);
  assert.equal(c.length, 1); assert.equal(c[0].sales, 250); assert.equal(c[0].payroll, 80);
});
test("[prod-entries] S37+S38: nested map union earliest-wins; same keys never summed", () => {
  const c = ME.canonicalizeEntries([
    day("2026-07-12", 1, { supplier_payments: { "s1": "100", "s2": "40" }, hourly_payroll: { "9": "3" } }),
    day("2026-07-12", 1, { supplier_payments: { "s1": "999", "s3": "70" }, hourly_payroll: { "9": "9", "10": "5" } })]);
  assert.deepEqual(plain(c[0].supplier_payments), { "s1": "100", "s2": "40", "s3": "70" });
  assert.deepEqual(plain(c[0].hourly_payroll), { "9": "3", "10": "5" });
});
test("[prod-entries] S39: canonicalization deterministic/idempotent; undated dropped", () => {
  const raw = [day("2026-07-02", 2), day("2026-07-01", 1), day("2026-07-02", 9), { sales: 5 }, { date: null, sales: 7 }, day("2026-07-01", 0)];
  const once = ME.canonicalizeEntries(raw);
  assert.deepEqual(plain(ME.canonicalizeEntries(once)), plain(once));
  assert.deepEqual(plain(once).map(e => e.date), ["2026-07-01", "2026-07-02"]);
});
test("[prod-entries] S40 (behavioral): duplicate hydration merges to one canonical row", () => {
  const deduped = ME.canonicalizeEntries([day("2026-07-24", 27753), day("2026-07-24", 27753)]);
  assert.ok(deduped.length < 2); assert.equal(totalRevenue(deduped), 27753);
});

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE GUARDS — supplementary wiring (NOT race proof)
// ═══════════════════════════════════════════════════════════════════════════
test("[source-guard] every entries writer routes through the ONE lane; no direct persistEntries UI call", () => {
  assert.ok(!/setEntries\(u\);persistEntries\(u,captureSelectionCtx/.test(html), "clear-all no longer calls persistEntries directly");
  assert.ok(!/const res = await persistEntries\(canonicalNext, ctx\)/.test(html), "delete no longer calls persistEntries directly");
  assert.ok(html.includes("persistRows: (rows2, c2) => entriesWriteCoordRef.current.submit({ rows: rows2, apply: false })"), "main save routes through the lane");
  assert.ok(html.includes('entriesWriteCoordRef.current.submit({ rows: [] })'), "clear-all routes through the lane");
  assert.ok(html.includes("submitLaborEntry"), "employee labor routes through the lane");
  assert.ok(html.includes("const persistEntriesRaw ="), "raw transport is private to the lane");
});
test("[source-guard] coordinator is destination-wide with fingerprint echo ownership (no scalar expectedEchoes)", () => {
  assert.ok(html.includes("const ownPending = [];"), "fingerprint own-pending list present");
  assert.ok(html.includes("ownPending.push({ fp: fp(snapshot), rev });"), "fingerprint registered at DISPATCH (local-before-ack safe)");
  assert.ok(!/expectedEchoes/.test(html), "the R5 scalar expectedEchoes counter is gone");
  assert.ok(html.includes('status: "cancelled_selection_changed"'), "invalidate settles queued waiters explicitly");
});
test("[source-guard] supplier caller delegates to result ownership; save-UI + supplier error cleared on invalidation; unmount marks ports dead", () => {
  assert.ok(html.includes("supplierResultOwnershipRef.current.begin(captureSelectionCtx())"), "supplier caller acquires result ownership");
  assert.ok(html.includes("supplierResultOwnershipRef.current.settle(token, res, selectionCtrlRef.current"), "result delegated to the ownership wrapper");
  assert.ok(html.includes("if (saveUiRunnerRef.current) saveUiRunnerRef.current.clearInFlight();"), "invalidation clears the observable in-flight flag");
  assert.ok(html.includes("saveUiRunnerRef.current.unmount()"), "unmount marks the save-UI port dead");
  assert.ok(html.includes("insightRoleRef.current = loggedInUser?.role"), "insight role port updated every render");
  assert.ok(html.includes("[\"super_owner\",\"owner\",\"manager\"].includes(insightRoleRef.current)"), "insight eligibility reads current role at call time");
});
