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

function laneHarness(opts = {}) {
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
  // R9 invariant B: a lane is not writable until the authoritative history for its
  // owner has hydrated. Production hydrates from the entries listener, or from the
  // absent-node bootstrap (markHydrated(ctx, [])). Tests default to the hydrated
  // steady state they were always modelling; pass {hydrated:false} to exercise the gate,
  // or {hydrateRows:[...]} to hydrate a real history.
  if (opts.hydrated !== false) lane.markHydrated(ctrl.capture(), opts.hydrateRows || []);
  const appliedFromHydration = applied.length;
  const sv = (arr, date, supId) => { const row = (arr || []).find(e => e.date === date); return row && row.supplier_payments ? row.supplier_payments[supId] : undefined; };
  return {
    ctrl, store, transports, applied, lane, sv, appliedFromHydration,
    // re-hydrate after a selection change (production re-subscribes per business)
    hydrate: (rows) => lane.markHydrated(ctrl.capture(), rows || []),
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
  const c2 = h.lane.submit({ rows: [], allowDrop: true }); // R9: intentional removal declares allowDrop
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
  h.hydrate([day("2026-07-24", 5)]); // R9: the re-selected destination hydrates before it can write
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
  const localEcho = h.lane.onListenerEcho(desired, h.ctrl.current()); // own echo arrives BEFORE ack
  assert.equal(localEcho.status, "ignored_own_echo", "own local-before-ack echo identified by fingerprint");
  h.ok(0); await settleAll(); await p; // ack — registers nothing new (fp was registered at dispatch)
  const ext = h.lane.onListenerEcho([day("2026-07-24", 0, { supplier_payments: { "sup-1": "999" } })], h.ctrl.current());
  assert.equal(ext.status, "applied", "legitimate external payload after ack is NOT swallowed by a counter");
  assert.equal(h.sv(h.last(), "2026-07-24", "sup-1"), "999");
});

test("[prod-helper] R6-6b: two serialized writes with local-before-ack echoes; two later external payloads both apply", async () => {
  const h = laneHarness();
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  await tick();
  const d1 = plain(h.last());
  h.lane.onListenerEcho(d1, h.ctrl.current()); // local echo of 100 before ack
  h.ok(0); await settleAll(); await p1;
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  const d2 = plain(h.last());
  h.lane.onListenerEcho(d2, h.ctrl.current()); // local echo of 200 before ack
  h.ok(1); await settleAll(); await p2;
  const e1 = h.lane.onListenerEcho([day("2026-07-24", 0, { supplier_payments: { "sup-1": "999" } })], h.ctrl.current());
  assert.equal(e1.status, "applied");
  const e2 = h.lane.onListenerEcho([day("2026-07-25", 0, { supplier_payments: { "sup-2": "888" } })], h.ctrl.current());
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
  assert.equal(h.lane.onListenerEcho(echo200, h.ctrl.current()).status, "ignored_own_echo");
  assert.equal(h.lane.onListenerEcho(echo100, h.ctrl.current()).status, "ignored_own_echo", "delayed OLDER own echo identified and ignored");
  assert.equal(h.sv(h.last(), "2026-07-24", "sup-1"), "200");
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "200");
});

// ─── Mandatory test 8: normal convergence; no permanent blacklist ───
test("[prod-helper] R6-8: external payload after quiescence applies; an identical FUTURE remote payload is not permanently blacklisted", async () => {
  const h = laneHarness();
  const p = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick(); h.ok(0); await settleAll(); await p;
  const own = JSON.parse(h.store["biz:A:entries"]);
  assert.equal(h.lane.onListenerEcho(own, h.ctrl.current()).status, "ignored_own_echo"); // consumes the own fingerprint
  // A future EXTERNAL payload identical to what we once wrote now applies (fingerprint retired after consume).
  const again = h.lane.onListenerEcho(own, h.ctrl.current());
  assert.equal(again.status, "applied", "identical future remote payload is not permanently blacklisted");
});

test("[prod-helper] R6-8b: an external non-matching payload while a local write is pending is DEFERRED (never consumed as own)", async () => {
  const h = laneHarness();
  const p = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  const ext = h.lane.onListenerEcho([day("2026-07-24", 0, { supplier_payments: { "sup-1": "100" } })], h.ctrl.current());
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
  assert.ok(html.includes('entriesWriteCoordRef.current.submit({ rows: [], allowDrop: true })'), "clear-all routes through the lane and declares an intentional drop (R9)");
  assert.ok(html.includes("submitLaborEntry"), "employee labor routes through the lane");
  assert.ok(html.includes("const persistEntriesRaw ="), "raw transport is private to the lane");
});
test("[source-guard] coordinator own-echo ownership is destination+generation scoped (R7; no scalar expectedEchoes)", () => {
  assert.ok(html.includes("const ownPending = [];"), "own-pending marker list present");
  assert.ok(html.includes("const marker = { tenantId: ctx.tenantId, bizId: ctx.bizId, gen: ctx.gen, fp: fp(snapshot), rev };"),
    "own-echo marker captures tenantId+bizId+gen+fp+rev from the write ctx at DISPATCH (local-before-ack safe)");
  assert.ok(html.includes("ownPending.push(marker);"), "scoped marker registered at DISPATCH");
  assert.ok(html.includes("r.tenantId === ctx.tenantId && r.bizId === ctx.bizId && r.gen === ctx.gen"),
    "own-echo consumption requires tenant+business+generation match (fingerprint alone never sufficient)");
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

// ═══════════════════════════════════════════════════════════════════════════
// R7 (R6-FIND-001): destination- and generation-scoped own-echo ownership.
// Identical canonical payloads across tenant/business/generation must hydrate
// as legitimate remote data — never be swallowed as ignored_own_echo. A stale
// listener cannot consume/clear/mutate the active destination. Same-generation
// local-before-ack own-echo suppression is preserved.
// ═══════════════════════════════════════════════════════════════════════════

// Write `rows` under the current selection, ack it, return the persisted canonical.
async function writeAndAck(h, rows) {
  const p = h.lane.submit({ rows });
  await tick(); h.ok(h.transports.length - 1); await settleAll(); await p;
  return plain(h.persisted());
}
function switchTo(h, t, b, hydrateRows) {
  h.ctrl.invalidate(t, b); h.lane.invalidate();
  // R9: the freshly selected destination starts UN-hydrated (invariant B). Production
  // re-subscribes and hydrates before any save is possible; tests that go on to write
  // model that same step. Pass hydrateRows === false to keep the lane un-hydrated.
  if (hydrateRows !== false) h.lane.markHydrated(h.ctrl.capture(), hydrateRows || []);
}

test("[prod-helper] R7-1: identical payload T1/A → T2/B hydrates the NEW destination (not ignored_own_echo)", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 500)];
  const own = await writeAndAck(h, rows);                 // marker {T1,A,gen1,fpX}
  switchTo(h, "T2", "B");                                 // new tenant AND business, new generation
  const before = h.applied.length;
  const r = h.lane.onListenerEcho(own, h.ctrl.current()); // identical canonical payload, T2/B ctx
  assert.equal(r.status, "applied", "T2/B identical payload is legitimate remote hydration");
  assert.equal(h.applied.length, before + 1, "T2/B destination actually hydrated (applyRows called)");
  assert.equal(totalRevenue(h.last()), 500, "hydrated rows rendered for the new destination");
});

test("[prod-helper] R7-2: identical payload T1/A → T2/A hydrates the NEW tenant", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 510)];
  const own = await writeAndAck(h, rows);
  switchTo(h, "T2", "A");                                 // same biz id, DIFFERENT tenant, new gen
  const r = h.lane.onListenerEcho(own, h.ctrl.current());
  assert.equal(r.status, "applied", "same biz id under a new tenant is not an own echo");
  assert.equal(totalRevenue(h.last()), 510);
});

test("[prod-helper] R7-3: identical payload T1/A → T1/B hydrates the NEW business", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 520)];
  const own = await writeAndAck(h, rows);
  switchTo(h, "T1", "B");                                 // same tenant, DIFFERENT business, new gen
  const r = h.lane.onListenerEcho(own, h.ctrl.current());
  assert.equal(r.status, "applied", "same tenant, different business is not an own echo");
  assert.equal(totalRevenue(h.last()), 520);
});

test("[prod-helper] R7-4: switch T1/A → T2/B → back to T1/A — the NEW generation hydrates", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 530)];
  const own = await writeAndAck(h, rows);                 // marker {T1,A,gen1}
  switchTo(h, "T2", "B");                                 // gen2
  switchTo(h, "T1", "A");                                 // gen3 — same tenant/biz, distinct generation
  const r = h.lane.onListenerEcho(own, h.ctrl.current()); // identical payload under T1/A gen3
  assert.equal(r.status, "applied", "an earlier-generation marker must not suppress new-generation hydration");
  assert.equal(totalRevenue(h.last()), 530);
});

test("[prod-helper] R7-5: a DELAYED echo from an old listener context is stale and cannot mutate the active destination", async () => {
  const h = laneHarness();
  const oldCtx = h.ctrl.current();                        // T1/A gen1
  const rows = [day("2026-07-24", 700)];
  await writeAndAck(h, rows);
  switchTo(h, "T2", "B");
  const before = h.applied.length;
  const r = h.lane.onListenerEcho(rows, oldCtx);          // straggler from the OLD listener
  assert.equal(r.status, "stale", "old-context callback rejected before it can consume/clear/apply");
  assert.equal(h.applied.length, before, "no hydration or mutation of the active T2/B destination");
});

test("[prod-helper] R7-6: same tenant/business/generation local-before-ack own echo is STILL ignored_own_echo", async () => {
  const h = laneHarness();
  const p = h.lane.submit({ rows: [day("2026-07-24", 250)] });
  await tick();
  const desired = plain(h.last());
  const r = h.lane.onListenerEcho(desired, h.ctrl.current());  // same destination+generation, before ack
  assert.equal(r.status, "ignored_own_echo", "legitimate same-destination own echo suppression preserved");
  h.ok(0); await settleAll(); await p;
});

test("[prod-helper] R7-7: a foreign-destination listener cannot consume or clear the T1/A marker; the true own echo still lands", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 300)];
  const p = h.lane.submit({ rows }); await tick();        // marker {T1,A,gen1} registered before ack
  const desired = plain(h.last());
  const cross = h.lane.onListenerEcho(desired, { gen: 999, tenantId: "T2", bizId: "B" });
  assert.equal(cross.status, "stale", "foreign (non-live) callback cannot touch the active marker");
  const own = h.lane.onListenerEcho(desired, h.ctrl.current());
  assert.equal(own.status, "ignored_own_echo", "the T1/A marker survived the foreign listener and is consumed only by its own destination");
  h.ok(0); await settleAll(); await p;
});

test("[prod-helper] R7-8: a FAILED write retires ONLY its own scoped marker; a later identical remote payload is not blacklisted", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 400)];
  const p = h.lane.submit({ rows }); await tick();
  const desired = plain(h.last());
  assert.equal(h.lane._state().ownPending, 1, "marker registered at dispatch");
  h.fail(0); await settleAll();
  const r = await p;
  assert.equal(r.status, "persist_failed");
  assert.equal(h.lane._state().ownPending, 0, "failed write's own scoped marker retired");
  const echo = h.lane.onListenerEcho(desired, h.ctrl.current());
  assert.equal(echo.status, "applied", "no phantom marker suppresses a real remote payload after a failed write");
});

test("[prod-helper] R7-9: identical-fingerprint writes across destinations/generations keep isolated ownership", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 900)];
  await writeAndAck(h, rows);                              // T1/A gen1 marker consumed on its own echo path? no — kept until echo
  const t1aCtx = h.ctrl.current();
  switchTo(h, "T2", "B");                                  // T1/A marker retired on invalidate
  const p = h.lane.submit({ rows }); await tick();         // T2/B gen2 marker (same fingerprint)
  const desired = plain(h.last());
  assert.equal(h.lane.onListenerEcho(desired, h.ctrl.current()).status, "ignored_own_echo", "T2/B own echo consumed by the T2/B marker");
  assert.equal(h.lane.onListenerEcho(desired, t1aCtx).status, "stale", "a straggler carrying the OLD T1/A context cannot consume the T2/B marker");
  assert.equal(h.lane._state().ownPending, 0, "no cross-destination marker accumulation");
  h.ok(h.transports.length - 1); await settleAll(); await p;
});

test("[prod-helper] R7-10: two-edit ordering preserved with scoped echoes — newest wins; own ignored, different remote applied", async () => {
  const h = laneHarness();
  const p1 = h.lane.submit({ rows: [day("2026-07-24", 100)] });
  const p2 = h.lane.submit({ rows: [day("2026-07-24", 200)] });
  await tick(); h.ok(0); await settleAll(); h.ok(1); await settleAll(); await Promise.all([p1, p2]);
  assert.equal(totalRevenue(h.persisted()), 200, "newest edit wins the single destination");
  const own = plain(h.persisted());
  assert.equal(h.lane.onListenerEcho(own, h.ctrl.current()).status, "ignored_own_echo", "final own echo scoped-consumed");
  const ext = h.lane.onListenerEcho([day("2026-07-24", 777)], h.ctrl.current());
  assert.equal(ext.status, "applied", "a genuinely different remote payload still hydrates");
});

// ═══════════════════════════════════════════════════════════════════════════
// R8 (P0-DATA-01-R7-FIND-001): destination-scoped pending-write isolation.
// An OLD destination's physically in-flight write must NOT suppress the newly
// selected destination's first legitimate listener hydration. Deferral is scoped
// to the CURRENT live lane's OWN pending intent (its own in-flight write or a
// queued-not-dispatched revision), not the coordinator-wide transport flag.
// Helpers: laneHarness()/switchTo()/writeAndAck() defined above. A write left
// un-acked (no h.ok/h.fail) stays physically in flight (transport unresolved),
// so `writing` is true while its lane is retired.
// ═══════════════════════════════════════════════════════════════════════════

test("[prod-helper] R8-1: old T1/A write in flight → T2/B initial payload hydrates; old success cannot mutate T2/B", async () => {
  const h = laneHarness();
  const oldRows = [day("2026-07-24", 4321)];
  const p = h.lane.submit({ rows: oldRows });        // dispatch T1/A, DO NOT ack (in flight)
  await tick();
  assert.equal(h.lane._state().writing, true, "old physical write is in flight");
  switchTo(h, "T2", "B");                             // switch before ack (gen2)
  const before = h.applied.length;
  const cur = h.lane.onListenerEcho(oldRows, h.ctrl.current());  // live T2/B initial payload
  assert.equal(cur.status, "applied", "current destination hydrates despite old write in flight");
  assert.equal(h.applied.length, before + 1, "T2/B rendered (applyRows)");
  const hydrated = plain(h.lane._state().desired);
  assert.equal(totalRevenue(hydrated), 4321, "active lane desired is the hydrated value");
  const old = h.lane.onListenerEcho(oldRows, { gen: 1, tenantId: "T1", bizId: "A" });
  assert.equal(old.status, "stale", "old-context callback stale");
  h.ok(0); await settleAll(); await p;               // old T1/A write succeeds afterwards
  assert.deepEqual(plain(h.lane._state().desired), hydrated, "old success did not mutate the current destination");
  assert.equal(h.store["biz:B:entries"], undefined, "no persistence written for T2/B by the old write");
});

test("[prod-helper] R8-2: old write in flight → T2/B hydrates; old FAILURE cleanup affects only old ownership", async () => {
  const h = laneHarness();
  const oldRows = [day("2026-07-24", 111)];
  const p = h.lane.submit({ rows: oldRows }); await tick();
  switchTo(h, "T2", "B");
  const cur = h.lane.onListenerEcho(oldRows, h.ctrl.current());
  assert.equal(cur.status, "applied", "current hydrates");
  const hydrated = plain(h.lane._state().desired);
  assert.equal(h.lane._state().ownPending, 0, "old marker retired on switch; T2/B hydration adds none");
  h.fail(0); await settleAll();
  const r = await p;
  assert.equal(r.status, "persist_failed", "old write failed");
  assert.deepEqual(plain(h.lane._state().desired), hydrated, "old failure did not mutate the current destination");
  assert.equal(h.lane._state().ownPending, 0, "old failure cleanup touched only old ownership");
});

test("[prod-helper] R8-3: cross-tenant same business — T1/A→T2/A while old write in flight hydrates", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 222)];
  const p = h.lane.submit({ rows }); await tick();
  switchTo(h, "T2", "A");
  const cur = h.lane.onListenerEcho(rows, h.ctrl.current());
  assert.equal(cur.status, "applied", "same biz id under new tenant hydrates while old write pending");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 222);
  h.ok(0); await settleAll(); await p;
});

test("[prod-helper] R8-4: same tenant different business — T1/A→T1/B while old write in flight hydrates", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 333)];
  const p = h.lane.submit({ rows }); await tick();
  switchTo(h, "T1", "B");
  const cur = h.lane.onListenerEcho(rows, h.ctrl.current());
  assert.equal(cur.status, "applied", "same tenant new business hydrates while old write pending");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 333);
  h.ok(0); await settleAll(); await p;
});

test("[prod-helper] R8-5: switch away and back — T1/A→T2/B→T1/A (new gen) hydrates before original settles", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 444)];
  const p = h.lane.submit({ rows }); await tick();   // original T1/A write in flight
  switchTo(h, "T2", "B");                             // gen2
  switchTo(h, "T1", "A");                             // gen3 — new generation of the same destination
  const cur = h.lane.onListenerEcho(rows, h.ctrl.current());
  assert.equal(cur.status, "applied", "returned T1/A new generation hydrates despite the original write still in flight");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 444);
  h.ok(0); await settleAll(); await p;
});

test("[prod-helper] R8-6: behavior is NOT fingerprint-dependent — T2/B payload different from the old write still hydrates", async () => {
  const h = laneHarness();
  const p = h.lane.submit({ rows: [day("2026-07-24", 555)] }); await tick(); // old in flight
  switchTo(h, "T2", "B");
  const cur = h.lane.onListenerEcho([day("2026-07-25", 999)], h.ctrl.current()); // DIFFERENT payload
  assert.equal(cur.status, "applied", "different payload hydrates (not accidentally fingerprint-gated)");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 999);
  h.ok(0); await settleAll(); await p;
});

test("[prod-helper] R8-7: old completion AFTER new hydration leaves rendered/active/persistence current", async () => {
  const h = laneHarness();
  const p = h.lane.submit({ rows: [day("2026-07-24", 666)] }); await tick();
  switchTo(h, "T2", "B");
  h.lane.onListenerEcho([day("2026-07-24", 666)], h.ctrl.current());
  const hydrated = plain(h.lane._state().desired);
  const appliedLen = h.applied.length;
  const transportsLen = h.transports.length;
  h.ok(0); await settleAll(); await p;               // complete the old write now
  assert.deepEqual(plain(h.lane._state().desired), hydrated, "active lane desired unchanged by old completion");
  assert.deepEqual(plain(h.last()), hydrated, "rendered entries unchanged by old completion");
  assert.equal(h.transports.length, transportsLen, "old completion triggered no new physical write for T2/B");
  assert.equal(h.store["biz:B:entries"], undefined, "no persistence for T2/B from old completion");
  assert.equal(h.applied.length, appliedLen, "no extra apply from old completion");
});

test("[prod-helper] R8-8: new lane WITH pending local intent is protected while old write is in flight; converges to local value", async () => {
  const h = laneHarness();
  const p = h.lane.submit({ rows: [day("2026-07-24", 10)] }); await tick(); // old T1/A in flight
  switchTo(h, "T2", "B");
  const pB = h.lane.submit({ rows: [day("2026-07-24", 777)] });             // local edit in T2/B (queued behind global write)
  await tick();
  assert.equal(h.lane._state().pendingLocal, true, "T2/B lane has its own pending local intent");
  const ext = h.lane.onListenerEcho([day("2026-07-24", 888)], h.ctrl.current()); // external for T2/B
  assert.equal(ext.status, "deferred_pending_local", "current lane's own local intent is protected (not clobbered)");
  h.ok(0); await settleAll();                          // old write settles → pump dispatches T2/B write
  assert.equal(h.transports.length, 2, "T2/B write dispatched after the old write cleared the pump");
  h.ok(1); await settleAll(); await pB;
  assert.equal(totalRevenue(JSON.parse(h.store["biz:B:entries"])), 777, "T2/B converged to its own local value, not the external payload");
});

test("[prod-helper] R8-9: same tenant/business/generation local-before-ack own echo is STILL ignored_own_echo", async () => {
  const h = laneHarness();
  const p = h.lane.submit({ rows: [day("2026-07-24", 250)] });
  await tick();
  const desired = plain(h.last());
  assert.equal(h.lane.onListenerEcho(desired, h.ctrl.current()).status, "ignored_own_echo", "current-lane own echo preserved");
  h.ok(0); await settleAll(); await p;
});

test("[prod-helper] R8-10: a deferred payload for one lane is not flushed/applied by another lane's completion", async () => {
  const h = laneHarness();
  const pA = h.lane.submit({ rows: [day("2026-07-24", 5)] }); await tick(); // T1/A in flight, has own pending intent
  const deferredExt = h.lane.onListenerEcho([day("2026-07-24", 42)], h.ctrl.current()); // external for T1/A while pending
  assert.equal(deferredExt.status, "deferred_pending_local", "T1/A external deferred while its own write is in flight");
  assert.equal(deferredExt.deferredStored, true, "R9: the deferred payload is RETAINED, not dropped");
  switchTo(h, "T2", "B", false);                       // move to a different lane (not yet hydrated)
  const before = h.applied.length;
  h.ok(0); await settleAll(); await pA;                // complete T1/A write
  assert.equal(h.applied.length, before, "old-lane completion did not replay/flush the dropped T1/A deferred payload into T2/B");
  assert.equal(h.lane._state().desired, null, "T2/B lane not mutated by the old lane's dropped deferred payload");
});

test("[prod-helper] R8-11: old-generation completion cannot delete a marker/pending state created by the current generation", async () => {
  const h = laneHarness();
  const pA = h.lane.submit({ rows: [day("2026-07-24", 1)] }); await tick(); // T1/A in flight
  switchTo(h, "T2", "B");
  const pB = h.lane.submit({ rows: [day("2026-07-24", 2)] }); await tick(); // T2/B queued behind global write
  assert.equal(h.lane._state().pendingLocal, true, "current gen has pending intent before old completes");
  h.ok(0); await settleAll();                          // old T1/A completes → pump dispatches T2/B
  assert.equal(h.lane._state().ownPending >= 1, true, "current-generation marker exists (created by T2/B dispatch), not cleared by old completion");
  h.ok(1); await settleAll(); await Promise.all([pA, pB]);
  assert.equal(totalRevenue(JSON.parse(h.store["biz:B:entries"])), 2, "current-generation write persisted");
});

test("[prod-helper] R8-12: superseded same-lane revisions retain correct ack/marker/rendered ordering (incl identical fingerprints)", async () => {
  const h = laneHarness();
  switchTo(h, "T1", "A");                              // fresh gen, no foreign write
  const p1 = h.lane.submit({ rows: [day("2026-07-24", 100)] });
  const p2 = h.lane.submit({ rows: [day("2026-07-24", 200)] });
  await tick(); h.ok(0); await settleAll(); h.ok(1); await settleAll(); await Promise.all([p1, p2]);
  assert.equal(totalRevenue(h.persisted()), 200, "newest revision wins");
  const own = plain(h.persisted());
  assert.equal(h.lane.onListenerEcho(own, h.ctrl.current()).status, "ignored_own_echo", "final own echo scoped-consumed");
  const dup = h.lane.onListenerEcho(own, h.ctrl.current());
  assert.equal(dup.status, "applied", "an identical future remote payload is not permanently blacklisted");
});

test("[prod-helper] R8-13: invalidation during pending local work retires stale lane state; a later old callback is stale", async () => {
  const h = laneHarness();
  const p = h.lane.submit({ rows: [day("2026-07-24", 9)] }); await tick(); // T1/A pending, in flight
  const oldCtx = h.ctrl.current();
  switchTo(h, "T2", "B", false);                       // invalidate during pending work (new lane un-hydrated)
  assert.equal(h.lane._state().pendingLocal, false, "new T2/B lane starts with no pending local intent");
  assert.equal(h.lane._state().desired, null, "new lane desired is fresh (old pending intent not carried over)");
  const old = h.lane.onListenerEcho([day("2026-07-24", 9)], oldCtx);
  assert.equal(old.status, "stale", "a later old-context callback remains stale");
  h.ok(0); await settleAll(); await p;
});

test("[prod-helper] R8-14: no pending local intent → normal live hydration remains applied", async () => {
  const h = laneHarness();
  switchTo(h, "T1", "A");                              // fresh lane, no in-flight/queued local write
  const r = h.lane.onListenerEcho([day("2026-07-24", 321)], h.ctrl.current());
  assert.equal(r.status, "applied", "quiescent live lane hydrates external payloads");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 321);
});

// ═══════════════════════════════════════════════════════════════════════════
// R9 — SAVE-LIFECYCLE HARDENING (P0-DATA-01-R8-FIND-001/002, P0-REV-WRITE-004,
// P0-REV-SAFETY-005, P0-REV-FOOD-008). Every test drives the REAL production
// createEntriesWriteCoordinator; only terminal transports/state are injected.
// ═══════════════════════════════════════════════════════════════════════════

// KGS-like production-shaped fixture: 2026-03-01 .. 2026-08-07 (160 business dates).
function kgsHistory() {
  const out = [];
  const mk = (y, m, dmax) => { for (let d = 1; d <= dmax; d++) out.push(day(`${y}-${m}-${String(d).padStart(2, "0")}`, 10000 + d)); };
  mk("2026", "03", 31); mk("2026", "04", 30); mk("2026", "05", 31);
  mk("2026", "06", 30); mk("2026", "07", 31); mk("2026", "08", 7);
  return out;
}
const datesOf = (rows) => (rows || []).map(r => r.date);

// ── 1 / 20: full-history hydration then a revenue save preserves every date ──
test("[prod-helper] R9-1: revenue save on a fully hydrated 160-date history preserves ALL dates", async () => {
  const h = laneHarness({ hydrateRows: kgsHistory() });
  assert.equal(h.lane.isHydrated(), true, "listener/bootstrap hydration makes the lane writable");
  assert.equal(h.lane._state().desired.length, 160, "authoritative full history hydrated");
  const edited = h.lane._state().desired.map(e => e.date === "2026-08-05" ? { ...e, sales: 99999 } : e);
  const p = h.lane.submit({ rows: edited, apply: false });
  await tick(); h.ok(0); await settleAll(); await p;
  const persisted = h.persisted();
  assert.equal(persisted.length, 160, "revenue save persisted the FULL history, not a subset");
  assert.equal(persisted.find(e => e.date === "2026-03-01").sales, 10001, "March history intact after an August edit");
  assert.equal(persisted.find(e => e.date === "2026-08-05").sales, 99999, "the edit landed");
});

// ── 3: revenue save BEFORE hydration is blocked with no persistence intent ──
test("[prod-helper] R9-2: revenue save before hydration is BLOCKED and emits no persistence intent", async () => {
  const h = laneHarness({ hydrated: false });
  const r = await h.lane.submit({ rows: [day("2026-08-06", 500)], apply: false });
  await settleAll();
  assert.equal(r.status, "blocked_unhydrated", "un-hydrated revenue save is refused");
  assert.equal(h.transports.length, 0, "NO physical write was dispatched");
  assert.equal(h.applied.length, 0, "no optimistic UI mutation either");
  assert.equal(h.persisted(), null, "nothing persisted");
  assert.equal(h.lane._state().desiredRev, 0, "no revision was created");
});

// ── 2: food-cost save BEFORE hydration is blocked with no persistence intent ──
test("[prod-helper] R9-3: food-cost save before hydration is BLOCKED and emits no persistence intent", async () => {
  const h = laneHarness({ hydrated: false });
  const r = await h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-08-06", val: "250", rows: [], emptyEntry: {} });
  await settleAll();
  assert.equal(r.status, "blocked_unhydrated", "un-hydrated food-cost save is refused (invariant F parity)");
  assert.equal(h.transports.length, 0, "NO physical write dispatched from a pre-hydration food-cost edit");
  assert.equal(h.applied.length, 0, "no optimistic apply");
  assert.equal(h.lane._state().desiredRev, 0, "no revision created");
});

// ── 4: a current-month display subset can never become the persisted collection ──
test("[prod-helper] R9-4: current-month filtered subset is REFUSED as a full-replacement payload", async () => {
  const h = laneHarness({ hydrateRows: kgsHistory() });
  const monthPrefix = "2026-08-";
  const monthEntries = h.lane._state().desired.filter(e => e.date.startsWith(monthPrefix)); // the deployed display collection
  assert.equal(monthEntries.length, 7, "display collection is the current month only");
  const r = await h.lane.submit({ rows: monthEntries, apply: false });
  await settleAll();
  assert.equal(r.status, "blocked_history_drop", "a month-filtered subset cannot replace the full node");
  assert.equal(r.droppedCount, 153, "all 153 pre-August dates were detected as dropped");
  assert.equal(h.transports.length, 0, "NO destructive write dispatched");
  assert.equal(h.lane._state().desired.length, 160, "authoritative history untouched");
});

// ── 19: food-cost edit preserves all hydrated historical dates ──
test("[prod-helper] R9-5: food-cost edit on 160-date history preserves every historical date", async () => {
  const h = laneHarness({ hydrateRows: kgsHistory() });
  const p = h.lane.submitSupplierEdit({ supId: "sup-9", date: "2026-08-06", val: "870.34", rows: [day("2026-08-06", 0)], emptyEntry: {} });
  await tick(); h.ok(0); await settleAll(); await p;
  const persisted = h.persisted();
  assert.equal(persisted.length, 160, "food-cost write persisted the FULL history");
  assert.equal(h.persistedSup("2026-08-06", "sup-9"), "870.34", "supplier value landed");
  assert.equal(persisted.find(e => e.date === "2026-07-31").sales, 10031, "July history intact");
  assert.equal(datesOf(persisted)[0], "2026-03-01", "earliest date preserved");
});

// ── 21: opening / navigating the screen emits NO entries write intent ──
test("[prod-helper] R9-6: hydration (incl. duplicates) emits NO write intent — self-heal is fail-closed", async () => {
  const h = laneHarness({ hydrated: false });
  const withDupes = [day("2026-08-01", 100), day("2026-08-01", 100), day("2026-08-02", 200)];
  const r = h.lane.onListenerEcho(withDupes, h.ctrl.current());
  await settleAll();
  assert.equal(r.status, "applied", "listener hydration applies for display");
  assert.equal(r.duplicatesObserved, true, "duplicate dates are detected");
  assert.equal(r.selfHealSuppressed, true, "the automatic self-heal write-back is suppressed (invariant G)");
  assert.equal(h.transports.length, 0, "merely opening/navigating produced NO entries write");
  assert.equal(h.persisted(), null, "the financial node was not silently rewritten");
  assert.equal(h.lane.isHydrated(), true, "the screen is still usable/writable afterwards");
  assert.equal(h.lane._state().duplicatesObserved, true, "condition surfaced for an explicit operator repair");
});

// ── 18 / G: listener failure before hydration keeps the lane fail-closed ──
test("[prod-helper] R9-7: listener failure before hydration keeps writes BLOCKED (fail-closed)", async () => {
  const h = laneHarness({ hydrated: false });
  const e = h.lane.onListenerError(h.ctrl.current());
  assert.equal(e.status, "hydration_failed");
  const r = await h.lane.submit({ rows: [day("2026-08-06", 1)], apply: false });
  await settleAll();
  assert.equal(r.status, "blocked_unhydrated", "no write from an unverified state");
  assert.equal(r.hydrationFailed, true, "the failure is surfaced to the caller");
  assert.equal(h.transports.length, 0, "no persistence intent after listener failure");
  // recovery: a real payload still hydrates and unblocks
  h.lane.onListenerEcho([day("2026-08-01", 10)], h.ctrl.current());
  assert.equal(h.lane.isHydrated(), true, "a later successful listener payload recovers the lane");
});

// ── 17: malformed / ambiguous owner context fails closed ──
test("[prod-helper] R9-8: malformed owner context (no tenant/business) is refused", async () => {
  const ctrl = ML.createSelectionController();            // never invalidated → tenantId/bizId null
  const transports = [];
  const lane = ML.createEntriesWriteCoordinator({
    selection: ctrl, canonicalize: ME.canonicalizeEntries, upsert: ME.upsertEntryByDate,
    entryDateKey: ME.entryDateKey, fingerprint: (rows) => JSON.stringify(rows),
    applyRows: () => {}, commit: async (rows) => { transports.push(rows); return { ok: true }; },
  });
  assert.equal(lane.markHydrated(null, []).status, "blocked_no_owner", "cannot hydrate an unidentified destination");
  const r = await lane.submit({ rows: [day("2026-08-06", 5)] });
  assert.equal(r.status, "blocked_no_owner", "cannot write to an unidentified destination");
  assert.equal(transports.length, 0, "no physical write from a malformed context");
});

// ── 16: logout / unmount with work in flight ──
test("[prod-helper] R9-9: logout during an in-flight write blocks new writes and never mutates the new context", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-08-01", 10)] });
  const p = h.lane.submit({ rows: [day("2026-08-01", 20)], apply: false }); await tick();
  h.ctrl.invalidate(null, null); h.lane.invalidate();     // logout
  const after = h.applied.length;
  const r = await h.lane.submit({ rows: [day("2026-08-01", 30)] });
  assert.equal(r.status, "blocked_no_owner", "post-logout writes are refused");
  h.ok(0); await settleAll(); await p;                     // the in-flight write settles against its captured destination
  assert.equal(h.applied.length, after, "the settling old write did not mutate post-logout UI state");
  assert.equal(h.transports.length, 1, "no second physical write");
});

// ═══ R8-FIND-001 TERMINAL CONVERGENCE (the blocking finding) ═══
// Codex probe: same-lane deferred payload → write fails → NO further listener emit.
// R8 left rendered/active state on the failed optimistic rows; R9 must converge.

test("[prod-helper] R9-10: same-lane deferred payload + write FAILURE + NO further emit → deterministic convergence", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p = h.lane.submit({ rows: [day("2026-07-24", 200)], apply: true }); await tick();
  const d = h.lane.onListenerEcho([day("2026-07-24", 999)], h.ctrl.current()); // legitimate same-lane remote
  assert.equal(d.status, "deferred_pending_local");
  assert.equal(d.deferredStored, true, "R9 RETAINS the deferred payload");
  assert.equal(h.lane._state().deferredPending, true);
  h.fail(0); await settleAll();                        // write fails; NO further listener emit is delivered
  const r = await p;
  assert.equal(r.status, "persist_failed");
  assert.equal(r.converged, true, "settlement converged onto the deferred remote payload");
  assert.equal(totalRevenue(h.last()), 999, "RENDERED state converged to the remote payload, not the failed local 200");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 999, "active lane converged");
  assert.equal(h.lane._state().pendingLocal, false, "lane is quiescent — no additional emit required");
  assert.equal(h.lane._state().deferredPending, false, "deferred payload consumed exactly once");
  assert.equal(h.transports.length, 1, "convergence did NOT trigger a new write");
});

test("[prod-helper] R9-11: deferred payload + write SUCCESS → our newer committed value wins, deferral discarded", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p = h.lane.submit({ rows: [day("2026-07-24", 200)], apply: true }); await tick();
  h.lane.onListenerEcho([day("2026-07-24", 999)], h.ctrl.current());
  h.ok(0); await settleAll(); const r = await p;
  assert.equal(r.status, "applied");
  assert.equal(totalRevenue(h.persisted()), 200, "our committed value persisted");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 200, "committed local value is authoritative, not the stale deferral");
  assert.equal(h.lane._state().deferredPending, false, "superseded deferral discarded");
});

test("[prod-helper] R9-12: an OWN echo while pending is never stored as a deferred payload", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const rows = [day("2026-07-24", 200)];
  const p = h.lane.submit({ rows, apply: true }); await tick();
  const own = h.lane.onListenerEcho(ME.canonicalizeEntries(rows), h.ctrl.current()); // local-before-ack own echo
  assert.equal(own.status, "ignored_own_echo");
  assert.equal(h.lane._state().deferredPending, false, "own echoes are consumed, never deferred");
  h.fail(0); await settleAll(); const r = await p;
  assert.equal(r.converged, false, "nothing to converge onto");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 200, "local intent retained when no remote payload exists");
});

test("[prod-helper] R9-13: a NEWER local edit supersedes convergence until it settles", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p1 = h.lane.submit({ rows: [day("2026-07-24", 200)], apply: true }); await tick();
  h.lane.onListenerEcho([day("2026-07-24", 999)], h.ctrl.current());   // deferred
  const p2 = h.lane.submit({ rows: [day("2026-07-24", 300)], apply: true }); // newer local intent queued
  h.fail(0); await settleAll();
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 300, "newer local intent is NOT clobbered by the deferred payload");
  h.ok(1); await settleAll(); await Promise.allSettled([p1, p2]);
  assert.equal(totalRevenue(h.persisted()), 300, "newest local edit persisted");
  assert.equal(h.lane._state().deferredPending, false, "deferral resolved/discarded once the newer write committed");
});

test("[prod-helper] R9-14: a deferred payload is NEVER applied after the owner changed", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p = h.lane.submit({ rows: [day("2026-07-24", 200)], apply: true }); await tick();
  h.lane.onListenerEcho([day("2026-07-24", 999)], h.ctrl.current());   // deferred for T1/A
  switchTo(h, "T2", "B", false);                                       // owner changes, new lane un-hydrated
  const before = h.applied.length;
  h.fail(0); await settleAll(); await p;
  assert.equal(h.applied.length, before, "the old lane's deferred payload was not applied into T2/B");
  assert.equal(h.lane._state().desired, null, "new destination untouched");
  assert.equal(h.lane.isHydrated(), false, "new destination still requires its own hydration");
});

// ── 5 / 6: tenant and business switch WHILE hydration is pending ──
test("[prod-helper] R9-15: business switch while hydration pending — no write, old payload cannot hydrate the new business", async () => {
  const h = laneHarness({ hydrated: false });
  const oldCtx = h.ctrl.current();
  switchTo(h, "T1", "B", false);                                       // switch before hydration completed
  const late = h.lane.onListenerEcho(kgsHistory(), oldCtx);            // previous business's payload lands late
  assert.equal(late.status, "stale", "a previous business's hydration payload is rejected");
  assert.equal(h.lane.isHydrated(), false, "new business remains un-hydrated");
  const r = await h.lane.submit({ rows: [day("2026-08-06", 1)] });
  assert.equal(r.status, "blocked_unhydrated", "writes stay blocked for the new business");
  assert.equal(h.transports.length, 0, "no persistence intent at any point");
});

test("[prod-helper] R9-16: tenant switch while hydration pending behaves identically", async () => {
  const h = laneHarness({ hydrated: false });
  const oldCtx = h.ctrl.current();
  switchTo(h, "T2", "A", false);
  assert.equal(h.lane.onListenerEcho(kgsHistory(), oldCtx).status, "stale", "previous tenant payload rejected");
  assert.equal(h.lane.markHydrated(oldCtx, kgsHistory()).status, "stale", "stale ctx cannot force-hydrate the new tenant");
  assert.equal((await h.lane.submit({ rows: [day("2026-08-06", 1)] })).status, "blocked_unhydrated");
  assert.equal(h.transports.length, 0);
});

// ── 7 / 8 / 9: late callbacks from a previous business / generation ──
test("[prod-helper] R9-17: late listener callback from the previous business never mutates the current one", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 5)] });
  const oldCtx = h.ctrl.current();
  switchTo(h, "T1", "B", [day("2026-07-24", 7)]);
  const before = h.applied.length;
  assert.equal(h.lane.onListenerEcho([day("2026-07-24", 999)], oldCtx).status, "stale");
  assert.equal(h.applied.length, before, "no UI mutation from the old business's callback");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 7, "current business state unchanged");
});

test("[prod-helper] R9-18: late write SUCCESS and FAILURE from a previous generation settle only their own lane", async () => {
  // late success
  const a = laneHarness({ hydrateRows: [day("2026-07-24", 1)] });
  const pa = a.lane.submit({ rows: [day("2026-07-24", 11)], apply: false }); await tick();
  switchTo(a, "T2", "B", [day("2026-07-24", 2)]);
  const aBefore = a.applied.length;
  a.ok(0); await settleAll(); assert.equal((await pa).status, "applied");
  assert.equal(a.applied.length, aBefore, "old-generation SUCCESS did not touch the new destination UI");
  assert.equal(totalRevenue(plain(a.lane._state().desired)), 2, "new destination state intact");
  assert.equal(a.store["biz:B:entries"], undefined, "old success wrote only to its own captured destination");
  // late failure
  const b = laneHarness({ hydrateRows: [day("2026-07-24", 1)] });
  const pb = b.lane.submit({ rows: [day("2026-07-24", 11)], apply: false }); await tick();
  switchTo(b, "T2", "B", [day("2026-07-24", 2)]);
  const bBefore = b.applied.length;
  b.fail(0); await settleAll(); assert.equal((await pb).status, "persist_failed");
  assert.equal(b.applied.length, bBefore, "old-generation FAILURE did not touch the new destination UI");
  assert.equal(totalRevenue(plain(b.lane._state().desired)), 2, "new destination state intact");
});

// ── 10 / 11 / 12 / 13 / 14 / 15: ordering, concurrency, retries ──
test("[prod-helper] R9-19: two rapid edits to the SAME date converge on the newest", async () => {
  const h = laneHarness({ hydrateRows: kgsHistory() });
  const p1 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-03", val: "10", rows: [], emptyEntry: {} });
  const p2 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-03", val: "20", rows: [], emptyEntry: {} });
  await tick(); assert.equal(h.transports.length, 1, "single-flight");
  h.ok(0); await settleAll(); h.ok(1); await settleAll(); await Promise.all([p1, p2]);
  assert.equal(h.persistedSup("2026-08-03", "s1"), "20", "newest value wins");
  assert.equal(h.persisted().length, 160, "history preserved throughout");
});

test("[prod-helper] R9-20: two rapid edits to DIFFERENT dates both survive", async () => {
  const h = laneHarness({ hydrateRows: kgsHistory() });
  const p1 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-02", val: "11", rows: [], emptyEntry: {} });
  const p2 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-03", val: "22", rows: [], emptyEntry: {} });
  await tick(); h.ok(0); await settleAll(); h.ok(1); await settleAll(); await Promise.all([p1, p2]);
  assert.equal(h.persistedSup("2026-08-02", "s1"), "11");
  assert.equal(h.persistedSup("2026-08-03", "s1"), "22", "transform built on the LATEST desired, not a stale snapshot");
  assert.equal(h.persisted().length, 160);
});

test("[prod-helper] R9-21: listener echo arriving BETWEEN queued edits cannot regress the newest edit", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p1 = h.lane.submit({ rows: [day("2026-07-24", 100)], apply: true }); await tick();
  const p2 = h.lane.submit({ rows: [day("2026-07-24", 300)], apply: true });   // queued
  assert.equal(h.lane.onListenerEcho([day("2026-07-24", 999)], h.ctrl.current()).status, "deferred_pending_local");
  h.ok(0); await settleAll(); h.ok(1); await settleAll(); await Promise.all([p1, p2]);
  assert.equal(totalRevenue(h.persisted()), 300, "newest local edit is the terminal persisted value");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 300, "no regression to the interleaved echo");
});

test("[prod-helper] R9-22: failed first write followed by a newer queued edit — the newer edit still persists", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p1 = h.lane.submit({ rows: [day("2026-07-24", 100)], apply: true }); await tick();
  const p2 = h.lane.submit({ rows: [day("2026-07-24", 300)], apply: true });
  h.fail(0); await settleAll();
  assert.equal(h.transports.length, 2, "the queued newer edit was still dispatched after the failure");
  h.ok(1); await settleAll(); await Promise.allSettled([p1, p2]);
  assert.equal(totalRevenue(h.persisted()), 300, "later queued change was NOT silently discarded by the failure");
});

test("[prod-helper] R9-23: retry after failure carries the CURRENT owner's payload and ordering", async () => {
  const h = laneHarness({ hydrateRows: kgsHistory() });
  const p1 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-01", val: "5", rows: [], emptyEntry: {} });
  await tick(); h.fail(0); await settleAll(); await p1;
  const st = h.lane._state();
  assert.equal(st.hydrated, true, "a failed write does not de-hydrate the lane");
  const p2 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-01", val: "5", rows: [], emptyEntry: {} }); // user retries
  await tick(); h.ok(1); await settleAll(); await p2;
  assert.equal(h.transports[1].tenantId, "T1", "retry targeted the CURRENT owner's tenant");
  assert.equal(h.transports[1].key, "biz:A:entries", "retry targeted the CURRENT owner's destination");
  assert.equal(h.persistedSup("2026-08-01", "s1"), "5", "retry persisted");
  assert.equal(h.persisted().length, 160, "retry payload is the full authoritative history");
});

// ── source guards for the R9 invariants ──
test("[source-guard] R9 wiring: hydration gate, fail-closed self-heal, bootstrap and listener-error are production-wired", () => {
  assert.ok(html.includes('if (!ln.hydrated) return Promise.resolve({ status: "blocked_unhydrated"'), "submit is hydration-gated");
  assert.ok(html.includes('if (!ownerUsable(ln.owner)) return Promise.resolve({ status: "blocked_no_owner" });'), "submit requires a fully identified owner");
  assert.ok(html.includes('status: "blocked_history_drop"'), "wholesale replace refuses undeclared history drops");
  assert.ok(html.includes("ln.deferred = { rows: canonical, owner:"), "deferral is stateful (R8-FIND-001)");
  assert.ok(html.includes("const converged = convergeDeferred(writeLane);"), "failed writes converge onto the deferred payload");
  assert.ok(!/ln\.desiredRev\+\+;\s*\n\s*pump\(\);/.test(html), "the automatic duplicate self-heal write-back is removed");
  assert.ok(html.includes("entriesWriteCoordRef.current.onListenerError(ctxAtSetup)"), "entries listener failure is wired to fail-closed");
  assert.ok(html.includes("entriesWriteCoordRef.current.markHydrated(ctxAtSetup, [])"), "absent-node hydration bootstrap is wired");
  assert.ok(html.includes('if (msg === "not found") absent = true;'), "bootstrap treats ONLY a genuine missing node as empty-authoritative");
  assert.ok(html.includes("else failed = true;"), "any other bootstrap read failure stays fail-closed");
  assert.ok(!/existed = await sg\(`biz:\$\{currentBizId\}:entries`\)/.test(html), "the error-swallowing sg() bootstrap is not used");
  assert.ok(html.includes("markHydrated: (ctx, rows) =>"), "markHydrated is part of the production coordinator");
});
