// P0-DATA-01 R5 regression guard — final production lifecycle convergence.
//
// Every executable test drives the ACTUAL production helpers vm-extracted from
// index.html (window.MarjinEntries + window.MarjinSaveLifecycle factories). ONLY
// terminal I/O is injected — deferred storage/API transports that COMMIT to a
// simulated store on resolution, state/ref spies, timers. The persistence,
// single-flight write pump, generation-lane accounting, ownership, insight-UI
// setter orchestration and exception-op-ID logic under test are the exact
// production-used code, not re-implementations. Race tests assert prohibited
// calls/setters were NOT invoked AND that terminal persisted storage is correct,
// not merely that final React state matched.
// Labels:
//   [prod-helper]  — runs a real production seam factory/helper (deferred transport)
//   [prod-entries] — runs the real window.MarjinEntries canonicalization helpers
//   [source-guard] — supplementary static-source wiring assertion (NOT race proof)
// Run: node --test test/dashboard/entries-lifecycle.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

const FREEZE = "window.MarjinSaveLifecycle = Object.freeze({ createSelectionController, scheduleSelectionBoundTimeout, loadExceptionsBound, createPersistence, createEntriesWriteCoordinator, createSaveOwnership, createInsightReadback, createInsightUiLoader, createSaveUiRunner, createExceptionOwnership, applySupplierWriteResult, executeEntrySave });";

function loadProductionBlocks() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  assert.notEqual(start, -1, "index.html must contain the P0-DATA-01 helper block");
  const end = html.indexOf(FREEZE, start);
  assert.notEqual(end, -1, "index.html must expose window.MarjinSaveLifecycle with the R5 production factories");
  const src = html.slice(start, end + FREEZE.length);
  assert.ok(!/new Date\(/.test(src), "identity/lifecycle blocks must not parse dates via Date()");
  const sandbox = { window: {}, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
  vm.runInNewContext(src, sandbox);
  return sandbox.window;
}

// Extract the PRODUCTION window.storage.setFor boundary (explicit-tenant write)
// with stubbed ref/set/db, to execute it directly (scenario H).
function loadStorageSetFor() {
  const start = html.indexOf("const fkeySharedForTenant = (tenantId, k) =>");
  assert.notEqual(start, -1, "index.html must define fkeySharedForTenant");
  const setForNeedle = "window.storage.setFor = async (tenantId, key, value, shared=false) => {";
  const setForStart = html.indexOf(setForNeedle, start);
  assert.notEqual(setForStart, -1, "index.html must define window.storage.setFor");
  const endMarker = "\n    };";
  const setForEnd = html.indexOf(endMarker, setForStart) + endMarker.length;
  const src = html.slice(start, setForEnd);
  const calls = [];
  const sandbox = {
    window: { storage: {}, _currentTenantId: "T1" },
    JSON, Error,
    ref: (db, path) => ({ __ref: true, db, path }),
    set: async (r, val) => { calls.push({ path: r.path, val }); },
    db: { __db: true },
  };
  vm.runInNewContext(src, sandbox);
  return { setFor: sandbox.window.storage.setFor, calls, sandbox };
}

const W = loadProductionBlocks();
const ME = W.MarjinEntries;
const ML = W.MarjinSaveLifecycle;
const plain = (x) => JSON.parse(JSON.stringify(x));
const day = (date, sales, extra = {}) => ({ date, sales, deliveries: 0, other_income: 0, ...extra });
const totalRevenue = (list) =>
  list.reduce((a, e) => a + (Number(e.sales) || 0) + (Number(e.deliveries) || 0) + (Number(e.other_income) || 0), 0);
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const tick = () => new Promise((r) => setImmediate(r));
const settleAll = async () => { await tick(); await tick(); await tick(); };
const liveCtrl = (t = "T1", b = "A") => { const c = ML.createSelectionController(); c.invalidate(t, b); return c; };

function incidentEntries() {
  const list = [];
  for (let d = 1; d <= 22; d++) list.push(day(`2026-07-${String(d).padStart(2, "0")}`, 24031));
  list.push(day("2026-07-23", 24048));
  list.push(day("2026-07-24", 27753));
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE + INCIDENT (scenarios 32, 43)
// ═══════════════════════════════════════════════════════════════════════════

test("[prod-entries] incident fixture arithmetic is exact (raw 608,236 / canonical 580,483 / delta 27,753)", () => {
  const list = incidentEntries();
  assert.equal(list.length, 24);
  assert.equal(totalRevenue(list), 580483);
  assert.equal(580483 + 27753, 608236);
});

test("[prod-entries] S43: duplicate incident rows canonicalize to 580,483; state == persisted payload", async () => {
  const raw = [...incidentEntries(), day("2026-07-24", 27753)];
  assert.equal(totalRevenue(raw), 608236);
  const canonical = ME.canonicalizeEntries(raw);
  assert.equal(canonical.length, 24);
  assert.equal(totalRevenue(canonical), 580483);
  const ctrl = liveCtrl();
  let written = null;
  const P = ML.createPersistence({ selection: ctrl, canonicalize: ME.canonicalizeEntries, storageSetFor: async (t, k, v) => { written = JSON.parse(v); } });
  const res = await P.persistEntries(raw, ctrl.capture());
  assert.equal(res.ok, true);
  assert.equal(totalRevenue(res.canonical), 580483);
  assert.deepEqual(plain(written), plain(res.canonical));
});

// ═══════════════════════════════════════════════════════════════════════════
// MANDATORY-CONTEXT PERSISTENCE — createPersistence (scenarios 1-5, 9)
// ═══════════════════════════════════════════════════════════════════════════

function persistHarness(t = "T1", b = "A") {
  const ctrl = liveCtrl(t, b);
  const calls = [];
  let gate = null;
  const P = ML.createPersistence({
    selection: ctrl,
    canonicalize: ME.canonicalizeEntries,
    storageSetFor: async (tenantId, key, valueStr) => { calls.push([tenantId, key, valueStr]); if (gate) await gate.promise; },
  });
  return { ctrl, calls, P, setGate: (g) => { gate = g; } };
}

test("[prod-helper] S3: persistEntries with MISSING context is rejected before any storage request", async () => {
  const h = persistHarness();
  const r = await h.P.persistEntries([day("2026-07-01", 1)], null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "missing_context");
  assert.equal(h.calls.length, 0);
  const r2 = await h.P.persistEntries([day("2026-07-01", 1)], { tenantId: "T1" });
  assert.equal(r2.ok, false);
  assert.equal(h.calls.length, 0);
});

test("[prod-helper] S4: persistEntries storage KEY uses captured ctx.bizId", async () => {
  const h = persistHarness("T1", "A");
  const ctx = h.ctrl.capture();
  h.ctrl.invalidate("T1", "B");
  const r = await h.P.persistEntries([day("2026-07-01", 1)], ctx);
  assert.equal(r.stale, true);
  assert.equal(h.calls.length, 0);
  const h2 = persistHarness("T1", "A");
  await h2.P.persistEntries([day("2026-07-01", 1)], h2.ctrl.capture());
  assert.equal(h2.calls[0][1], "biz:A:entries");
});

test("[prod-helper] S1+S5: entries write under T1/A carries tenant T1; switching to T2/B issues NO later write", async () => {
  const h = persistHarness("T1", "A");
  const gate = deferred();
  h.setGate(gate);
  const ctx = h.ctrl.capture();
  const p = h.P.persistEntries([day("2026-07-01", 1)], ctx);
  await tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "T1");
  assert.equal(h.calls[0][1], "biz:A:entries");
  h.ctrl.invalidate("T2", "B");
  gate.resolve();
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(r.staleAfterWrite, true);
  assert.equal(h.calls.length, 1);
});

test("[prod-helper] S2: same biz id 'A' under NEW tenant T2 is a different context (write rejected)", async () => {
  const h = persistHarness("T1", "A");
  const ctx = h.ctrl.capture();
  h.ctrl.invalidate("T2", "A");
  const r = await h.P.persistEntries([day("2026-07-01", 1)], ctx);
  assert.equal(r.stale, true);
  assert.equal(h.calls.length, 0);
});

test("[prod-helper] S9: clear-all-shaped entries write requires and uses mandatory context", async () => {
  const h = persistHarness("T1", "A");
  const r = await h.P.persistEntries([], h.ctrl.capture());
  assert.equal(r.ok, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1], "biz:A:entries");
  assert.deepEqual(JSON.parse(h.calls[0][2]), []);
});

// Domain separation (scenarios 6, 7, 8)
test("[prod-helper] S6/S7: persistEntries writes ONLY the entries key — never fixed", async () => {
  const h = persistHarness("T1", "A");
  await h.P.persistEntries([day("2026-07-01", 1, { payroll: 500, supplier_payments: { "sup-1": "100" } })], h.ctrl.capture());
  assert.equal(h.calls.length, 1);
  assert.ok(h.calls.every(c => c[1] === "biz:A:entries"));
  assert.ok(!h.calls.some(c => c[1].endsWith(":fixed")));
});

test("[prod-helper] S8: persistFixed writes ONLY the fixed key — never entries", async () => {
  const h = persistHarness("T1", "A");
  const r = await h.P.persistFixed([{ id: "fixed-1", amount: 10 }], h.ctrl.capture());
  assert.equal(r.ok, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1], "biz:A:fixed");
  assert.ok(!h.calls.some(c => c[1].endsWith(":entries")));
});

test("[prod-helper] persistFixed rejects missing context before any request", async () => {
  const h = persistHarness();
  const r = await h.P.persistFixed([{ id: "f", amount: 1 }], null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "missing_context");
  assert.equal(h.calls.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPLICIT-TENANT STORAGE BOUNDARY — window.storage.setFor (scenario H)
// ═══════════════════════════════════════════════════════════════════════════

test("[prod-helper] H: storage.setFor writes under captured tenant, {_v} envelope, no call on missing tenant", async () => {
  const { setFor, calls, sandbox } = loadStorageSetFor();
  sandbox.window._currentTenantId = "T2"; // mutate the global — path must stay under the EXPLICIT T1
  const r = await setFor("T1", "biz:A:entries", JSON.stringify([{ date: "2026-07-24", sales: 1 }]), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "tenants/T1/biz:A:entries", "path uses the explicit tenant, not the mutated global");
  assert.deepEqual(Object.keys(calls[0].val), ["_v"], "envelope is exactly { _v: ... }");
  assert.equal(calls[0].val._v, JSON.stringify([{ date: "2026-07-24", sales: 1 }]));
  assert.equal(r.shared, true);
  await assert.rejects(() => setFor("", "biz:A:entries", "[]", true), /explicit tenant required/);
  assert.equal(calls.length, 1, "no terminal set() on missing tenant");
});

// ═══════════════════════════════════════════════════════════════════════════
// SINGLE-FLIGHT SUPPLIER COORDINATOR — real coordinator + real persistence +
// COMMITTING deferred store (scenarios 6,7,25-33; probes A,B,C)
// ═══════════════════════════════════════════════════════════════════════════

function coordHarness() {
  const ctrl = liveCtrl("T1", "A");
  const store = {};
  const transports = [];
  const applied = [];
  const P = ML.createPersistence({
    selection: ctrl,
    canonicalize: ME.canonicalizeEntries,
    storageSetFor: (tenantId, key, valueStr) => {
      const g = deferred();
      transports.push({ tenantId, key, __commit: () => { store[key] = valueStr; }, resolve: () => g.resolve() });
      return g.promise;
    },
  });
  const coord = ML.createEntriesWriteCoordinator({
    selection: ctrl, canonicalize: ME.canonicalizeEntries, upsert: ME.upsertEntryByDate,
    entryDateKey: ME.entryDateKey, applyRows: (r) => applied.push(plain(r)),
    persistEntries: (rows, ctx) => P.persistEntries(rows, ctx),
  });
  const supVal = (arr, date, supId) => { const row = (arr || []).find(e => e.date === date); return row && row.supplier_payments ? row.supplier_payments[supId] : undefined; };
  return {
    ctrl, store, transports, applied, coord, supVal,
    last: () => applied[applied.length - 1],
    persistedSup: (date, supId) => { const raw = store["biz:A:entries"]; return raw ? supVal(JSON.parse(raw), date, supId) : undefined; },
    ok: (i) => { transports[i].__commit(); transports[i].resolve(); },
  };
}

test("[prod-helper] PROBE A / S25+S33: terminal writes are single-flight — 200 not dispatched before 100 settles; final persisted 200", async () => {
  const h = coordHarness();
  const p1 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  assert.equal(h.transports.length, 1, "only ONE terminal write dispatched while the first is in flight");
  h.ok(0); await settleAll();
  assert.equal(h.transports.length, 2, "second terminal write dispatched only after the first settled");
  assert.deepEqual(JSON.parse(h.store["biz:A:entries"])[0].supplier_payments, { "sup-1": "100" }, "storage committed 100 first (in order)");
  h.ok(1); await settleAll();
  await Promise.all([p1, p2]);
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "200", "final UI 200");
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "200", "final PERSISTED storage 200 (not the older 100)");
});

test("[prod-helper] PROBE B / S26: complete listener race 100->200->echo200->delayed-echo100 ends at 200", async () => {
  const h = coordHarness();
  const p1 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  h.ok(0); await settleAll();
  h.ok(1); await settleAll();
  await Promise.all([p1, p2]);
  const e200 = h.coord.onListenerEcho([{ date: "2026-07-24", sales: 0, supplier_payments: { "sup-1": "200" } }]);
  const e100 = h.coord.onListenerEcho([{ date: "2026-07-24", sales: 0, supplier_payments: { "sup-1": "100" } }]);
  assert.equal(e200.status, "ignored_own_echo", "our own 200 echo drained, not applied");
  assert.equal(e100.status, "ignored_own_echo", "the delayed older 100 echo drained, cannot regress");
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "200");
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "200");
});

test("[prod-helper] S27: echo before newest completion cannot regress a pending value", async () => {
  const h = coordHarness();
  const p = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  const echo = h.coord.onListenerEcho([{ date: "2026-07-24", sales: 0, supplier_payments: { "sup-1": "100" } }]);
  assert.equal(echo.status, "ignored_pending");
  h.ok(0); await settleAll();
  await p;
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "200");
});

test("[prod-helper] S28: external echo after quiescence converges (not permanently rejected)", async () => {
  const h = coordHarness();
  const p = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick(); h.ok(0); await settleAll(); await p;
  assert.equal(h.coord.onListenerEcho([{ date: "2026-07-24", sales: 0, supplier_payments: { "sup-1": "200" } }]).status, "ignored_own_echo");
  const ext = h.coord.onListenerEcho([{ date: "2026-07-24", sales: 0, supplier_payments: { "sup-1": "999" } }]);
  assert.equal(ext.status, "applied");
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "999");
});

test("[prod-helper] PROBE C / invalidation accounting: old completion cannot corrupt new lane; stale echo rejected; pending never negative", async () => {
  const h = coordHarness();
  const pOld = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "OLD", rows: [], emptyEntry: {} });
  await tick();
  h.coord.invalidate(); h.ctrl.invalidate("T2", "B");
  const pNew = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "NEW", rows: [], emptyEntry: {} });
  await tick();
  h.ok(0); await settleAll();
  const st = h.coord._state();
  assert.ok(st.pending >= 0, "pending never negative in the new lane");
  const stale = h.coord.onListenerEcho([{ date: "2026-07-24", sales: 0, supplier_payments: { "sup-1": "OLD" } }]);
  assert.notEqual(stale.status, "applied", "stale echo not applied while the new write is pending");
  h.ok(1); await settleAll();
  await Promise.allSettled([pOld, pNew]);
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "NEW");
});

test("[prod-helper] switch-away-and-back to same tenant/business: an older terminal write cannot beat newer data", async () => {
  const h = coordHarness();
  const pOld = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "OLD", rows: [], emptyEntry: {} });
  await tick();
  h.coord.invalidate();
  h.coord.invalidate();
  const pNew = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "NEW", rows: [day("2026-07-24", 5)], emptyEntry: {} });
  await tick();
  assert.equal(h.transports.length, 1, "global single-flight: new write NOT dispatched while the old is in flight");
  h.ok(0); await settleAll();                    // old (retired) write settles first → releases the lane
  assert.equal(h.transports.length, 2, "new write dispatched only after the old settled");
  h.ok(1); await settleAll();                    // new write settles last → commits NEW
  await Promise.allSettled([pOld, pNew]);
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "NEW", "the retired-lane write cannot overwrite newer persisted data");
});

test("[prod-helper] S29: two rapid edits to DIFFERENT suppliers preserve both (state and persisted)", async () => {
  const h = coordHarness();
  const p1 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.coord.submitSupplierEdit({ supId: "sup-2", date: "2026-07-24", val: "250", rows: [], emptyEntry: {} });
  await tick(); h.ok(0); await settleAll(); h.ok(1); await settleAll();
  await Promise.all([p1, p2]);
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "100");
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-2"), "250");
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "100");
  assert.equal(h.persistedSup("2026-07-24", "sup-2"), "250");
});

test("[prod-helper] S32: duplicated starting rows collapse to ONE canonical date row", async () => {
  const h = coordHarness();
  const p = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [day("2026-07-24", 27753), day("2026-07-24", 27753)], emptyEntry: {} });
  await tick();
  assert.equal(h.last().filter(e => e.date === "2026-07-24").length, 1);
  h.ok(0); await settleAll(); await p;
  assert.equal(JSON.parse(h.store["biz:A:entries"]).filter(e => e.date === "2026-07-24").length, 1);
});

// Failure surfacing (scenarios 30, 31) with committing store + fail support
function coordFailHarness() {
  const ctrl = liveCtrl("T1", "A");
  const store = {}; const transports = []; const applied = [];
  const P = ML.createPersistence({
    selection: ctrl, canonicalize: ME.canonicalizeEntries,
    storageSetFor: (tenantId, key, valueStr) => {
      const g = deferred();
      transports.push({ key, ok: () => { store[key] = valueStr; g.resolve(); }, fail: () => { g.reject(new Error("write_failed")); } });
      return g.promise;
    },
  });
  const coord = ML.createEntriesWriteCoordinator({
    selection: ctrl, canonicalize: ME.canonicalizeEntries, upsert: ME.upsertEntryByDate,
    entryDateKey: ME.entryDateKey, applyRows: (r) => applied.push(plain(r)),
    persistEntries: (rows, ctx) => P.persistEntries(rows, ctx),
  });
  const supVal = (arr, d, s) => { const row = (arr || []).find(e => e.date === d); return row && row.supplier_payments ? row.supplier_payments[s] : undefined; };
  return { ctrl, store, transports, applied, coord, supVal, last: () => applied[applied.length - 1] };
}

test("[prod-helper] S30: older FAILURE cannot roll back newer success (final persisted 200)", async () => {
  const h = coordFailHarness();
  const p1 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  h.transports[0].fail(); await settleAll();
  const r1 = await p1;
  assert.equal(r1.status, "persist_failed");
  assert.equal(r1.latest, false);
  h.transports[1].ok(); await settleAll();
  const r2 = await p2;
  assert.equal(r2.status, "applied");
  assert.equal(r2.latest, true);
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "200");
  assert.equal(JSON.parse(h.store["biz:A:entries"])[0].supplier_payments["sup-1"], "200");
});

test("[prod-helper] S31: LATEST failure is reported latest:true; an older completion cannot win", async () => {
  const h = coordFailHarness();
  const p1 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  h.transports[0].ok(); await settleAll();
  const r1 = await p1;
  assert.equal(r1.latest, false);
  h.transports[1].fail(); await settleAll();
  const r2 = await p2;
  assert.equal(r2.status, "persist_failed");
  assert.equal(r2.latest, true, "latest failure flagged latest:true for the caller to surface");
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "200", "optimistic newest retained; not regressed to 100");
});

// ═══════════════════════════════════════════════════════════════════════════
// SUPPLIER FAILURE VISIBILITY — applySupplierWriteResult (production caller)
// ═══════════════════════════════════════════════════════════════════════════

test("[prod-helper] supplier failure reaches the production error setter; older result cannot overwrite; owned success clears", () => {
  const ev = [];
  const ports = { setError: () => ev.push("set"), clearError: () => ev.push("clear") };
  ML.applySupplierWriteResult({ status: "persist_failed", latest: true }, ports);
  ML.applySupplierWriteResult({ status: "persist_failed", latest: false }, ports);
  ML.applySupplierWriteResult({ status: "applied", latest: false }, ports);
  ML.applySupplierWriteResult({ status: "applied", latest: true }, ports);
  assert.deepEqual(ev, ["set", "clear"], "only latest results touch the surface: set then clear");
});

// ═══════════════════════════════════════════════════════════════════════════
// SAVE UI OWNERSHIP through the production wrapper — createSaveUiRunner (19-24)
// ═══════════════════════════════════════════════════════════════════════════

function saveUiHarness() {
  const ctrl = liveCtrl("T1", "A");
  const own = ML.createSaveOwnership();
  const flags = [];
  let inFlight = false;
  let n = 0;
  const runner = ML.createSaveUiRunner({
    ownership: own, selection: ctrl,
    setInFlight: (v) => { inFlight = v; flags.push(v); },
    makeOpId: () => "op-" + (++n),
  });
  return { ctrl, own, runner, flags, getInFlight: () => inFlight };
}

test("[prod-helper] S19-S22: production runner — old save pending; invalidate; new save starts; old finally cannot clear new flag", async () => {
  const h = saveUiHarness();
  const oldGate = deferred();
  const oldRun = h.runner.run(h.ctrl.capture(), async () => { await oldGate.promise; });
  await tick();
  assert.equal(h.getInFlight(), true, "old save set in-flight");
  h.own.invalidate(); h.ctrl.invalidate("T2", "B"); h.flags.push("switch:false");
  const newGate = deferred();
  const newRun = h.runner.run(h.ctrl.capture(), async () => { await newGate.promise; });
  await tick();
  assert.equal(h.getInFlight(), true, "new save owns the in-flight flag");
  const flagsBefore = h.flags.length;
  oldGate.resolve(); await oldRun;
  assert.equal(h.getInFlight(), true, "old finally did NOT clear the new selection's in-flight flag");
  assert.ok(!h.flags.slice(flagsBefore).includes(false), "old finally emitted no setInFlight(false)");
  newGate.resolve(); await newRun;
  assert.equal(h.getInFlight(), false, "new save's own finally clears its flag");
});

test("[prod-helper] S23: production runner blocks a same-selection double submit", async () => {
  const h = saveUiHarness();
  const g = deferred();
  const r1 = h.runner.run(h.ctrl.capture(), async () => { await g.promise; });
  await tick();
  const r2 = await h.runner.run(h.ctrl.capture(), async () => { throw new Error("should not run"); });
  assert.equal(r2.started, false, "duplicate same-selection submit blocked");
  assert.equal(r2.reason, "duplicate");
  g.resolve(); await r1;
});

test("[prod-helper] S24: tenant switch / logout / unmount free ownership so the next selection can save", async () => {
  for (const kind of ["tenant", "logout", "unmount"]) {
    const h = saveUiHarness();
    const g = deferred();
    const r1 = h.runner.run(h.ctrl.capture(), async () => { await g.promise; });
    await tick();
    h.own.invalidate();
    if (kind === "tenant") h.ctrl.invalidate("T9", "A");
    else h.ctrl.invalidate(null, null);
    const r2 = await h.runner.run(h.ctrl.capture(), async () => "ok");
    assert.equal(r2.started, true, `${kind}: new selection can begin a save`);
    g.resolve(); await r1;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHT UI WRAPPER setters — createInsightUiLoader (scenario 14)
// ═══════════════════════════════════════════════════════════════════════════

function insightUiHarness(candidates = ["2026-07-27", "2026-07-26"]) {
  const ctrl = liveCtrl("T1", "A");
  const setterCalls = { clearAll: 0, setLoading: [], setError: [], setWarning: [], setData: [], setDate: [] };
  const requests = []; const gates = [];
  const readback = ML.createInsightReadback({
    selection: ctrl,
    candidateDates: () => candidates,
    apiGetRange: ({ tenantId, bizId, fromDate }) => { const g = deferred(); gates.push(g); requests.push({ tenantId, bizId, fromDate }); return g.promise; },
  });
  const loader = ML.createInsightUiLoader({
    readback,
    isCancelled: (ctx) => !ctrl.isLive(ctx),
    candidatesReady: (ctx) => !!(ctx && ctx.bizId),
    ports: {
      clearAll: () => setterCalls.clearAll++,
      setLoading: (v) => setterCalls.setLoading.push(v),
      setError: (v) => setterCalls.setError.push(v),
      setWarning: (v) => setterCalls.setWarning.push(v),
      setData: (v) => setterCalls.setData.push(v),
      setDate: (v) => setterCalls.setDate.push(v),
    },
  });
  return { ctrl, setterCalls, requests, gates, loader };
}

test("[prod-helper] S14: insight UI wrapper — invalidate BEFORE first request → ZERO setter mutations", async () => {
  const h = insightUiHarness();
  const ctx = h.ctrl.capture();
  h.ctrl.invalidate("T2", "A");
  const res = await h.loader.load(ctx, null, () => false);
  assert.equal(res.cancelled, true);
  assert.equal(h.setterCalls.setLoading.length, 0, "no loading setter");
  assert.equal(h.setterCalls.setData.length, 0, "no data setter");
  assert.equal(h.setterCalls.setDate.length, 0, "no date setter");
  assert.equal(h.setterCalls.setError.length, 0, "no error setter");
  assert.equal(h.setterCalls.setWarning.length, 0, "no warning setter");
  assert.equal(h.requests.length, 0);
});

test("[prod-helper] S14: insight UI wrapper — cancel DURING candidate iteration → no result setters after readback", async () => {
  const h = insightUiHarness();
  const ctx = h.ctrl.capture();
  const p = h.loader.load(ctx, null, () => false);
  await tick();
  assert.equal(h.setterCalls.setLoading[0], true, "loading set true on live entry");
  assert.equal(h.requests.length, 1);
  // Snapshot setter counts AFTER the live-entry clear; nothing more may fire once cancelled.
  const snap = { data: h.setterCalls.setData.length, date: h.setterCalls.setDate.length, loading: h.setterCalls.setLoading.length };
  h.ctrl.invalidate("T2", "A");
  h.gates[0].resolve({});
  const res = await p;
  assert.equal(res.cancelled, true);
  assert.equal(h.requests.length, 1, "no second candidate request");
  assert.equal(h.setterCalls.setData.length, snap.data, "no data setter fired AFTER cancellation");
  assert.equal(h.setterCalls.setDate.length, snap.date, "no date setter fired AFTER cancellation");
  assert.equal(h.setterCalls.setLoading.length, snap.loading, "no loading setter fired AFTER cancellation (no false result-path)");
  // The only data/date writes were the live-entry clears (to null); no stale insight data was ever set.
  assert.ok(h.setterCalls.setData.every(v => v === null), "data setter was only the live-entry clear, never stale insight data");
});

test("[prod-helper] insight UI wrapper — happy path sets data/date and clears loading", async () => {
  const h = insightUiHarness(["2026-07-27"]);
  const ctx = h.ctrl.capture();
  const p = h.loader.load(ctx, null, () => false);
  await tick();
  h.gates[0].resolve({ "2026-07-27": { insights: [{ id: 1 }] } });
  const res = await p;
  assert.equal(res.ok, true);
  assert.equal(res.found, true);
  assert.deepEqual(plain(h.setterCalls.setData[h.setterCalls.setData.length - 1]), [{ id: 1 }]);
  assert.equal(h.setterCalls.setDate[h.setterCalls.setDate.length - 1], "2026-07-27");
  assert.equal(h.setterCalls.setLoading[h.setterCalls.setLoading.length - 1], false);
});

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHT READBACK identity/cancellation — createInsightReadback (11-13)
// ═══════════════════════════════════════════════════════════════════════════

function readbackHarness(candidates) {
  const ctrl = liveCtrl("T1", "A");
  const requests = []; const gates = [];
  const readback = ML.createInsightReadback({
    selection: ctrl, candidateDates: () => candidates,
    apiGetRange: ({ tenantId, bizId, fromDate }) => { const g = deferred(); gates.push(g); requests.push({ tenantId, bizId, fromDate }); return g.promise; },
  });
  return { ctrl, requests, gates, readback };
}

test("[prod-helper] S11: first candidate deferred, invalidate, not found → NO second request", async () => {
  const h = readbackHarness(["2026-07-27", "2026-07-26"]);
  const ctx = h.ctrl.capture();
  const p = h.readback.loadRange(ctx, null, () => false);
  await tick();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].tenantId, "T1");
  assert.equal(h.requests[0].bizId, "A");
  h.ctrl.invalidate("T2", "A");
  h.gates[0].resolve({});
  const res = await p;
  assert.equal(res.cancelled, true);
  assert.equal(h.requests.length, 1);
});

test("[prod-helper] S12: logout T1 / login T2 same biz id — stale readback issues no second request", async () => {
  const h = readbackHarness(["2026-07-27", "2026-07-26"]);
  const ctx = h.ctrl.capture();
  const p = h.readback.loadRange(ctx, null, () => false);
  await tick();
  h.ctrl.invalidate("T2", "A");
  h.gates[0].resolve({});
  const res = await p;
  assert.equal(res.cancelled, true);
  assert.equal(h.requests.length, 1);
});

test("[prod-helper] S13: every insight request derives tenant AND business from captured ctx", async () => {
  const h = readbackHarness(["2026-07-27", "2026-07-26", "2026-07-25"]);
  const ctx = h.ctrl.capture();
  const p = h.readback.loadRange(ctx, null, () => false);
  await tick(); h.gates[0].resolve({}); await tick();
  h.gates[1].resolve({}); await tick();
  h.gates[2].resolve({ "2026-07-25": { insights: [] } });
  const res = await p;
  assert.equal(res.found, true);
  assert.ok(h.requests.every(r => r.tenantId === "T1" && r.bizId === "A"));
});

// ═══════════════════════════════════════════════════════════════════════════
// EXCEPTION REQUEST GATE — loadExceptionsBound (15, 16)
// ═══════════════════════════════════════════════════════════════════════════

function excHarness() {
  const ctrl = liveCtrl("T1", "A");
  const requests = []; const applied = [];
  const io = {
    selection: ctrl,
    todayKey: (off) => (off === 1 ? "2026-07-28" : "2026-04-23"),
    apiFetch: async (url) => { requests.push(url); return { ok: true, json: async () => ({ ok: true, exceptions: { "2026-07-20": { status: "active", source: "structured", revision: 1, reasonCode: "closure" } } }) }; },
    applyState: (stateMap, boolMap) => applied.push({ stateMap: plain(stateMap), boolMap: plain(boolMap) }),
  };
  return { ctrl, requests, applied, io };
}

test("[prod-helper] S15: loadExceptionsBound with ALREADY-STALE context sends ZERO requests", async () => {
  const h = excHarness();
  const ctx = h.ctrl.capture();
  h.ctrl.invalidate("T2", "B");
  const r = await ML.loadExceptionsBound(h.io, ctx);
  assert.equal(r.status, "stale");
  assert.equal(h.requests.length, 0);
  assert.equal(h.applied.length, 0);
});

test("[prod-helper] S16: context stale DURING fetch — response/JSON applies nothing", async () => {
  const ctrl = liveCtrl("T1", "A");
  const requests = []; const applied = [];
  const respGate = deferred();
  const io = {
    selection: ctrl, todayKey: (off) => (off === 1 ? "2026-07-28" : "2026-04-23"),
    apiFetch: async (url) => { requests.push(url); return { ok: true, json: async () => { await respGate.promise; return { ok: true, exceptions: {} }; } }; },
    applyState: (s, b) => applied.push([s, b]),
  };
  const p = ML.loadExceptionsBound(io, ctrl.capture());
  await tick();
  assert.equal(requests.length, 1);
  ctrl.invalidate("T2", "B");
  respGate.resolve();
  const r = await p;
  assert.equal(r.status, "stale");
  assert.equal(applied.length, 0);
});

test("[prod-helper] S15b: a LIVE context issues exactly one request and applies state", async () => {
  const h = excHarness();
  const r = await ML.loadExceptionsBound(h.io, h.ctrl.capture());
  assert.equal(r.status, "applied");
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].includes("tenantId=T1"));
  assert.ok(h.requests[0].includes("bizId=A"));
  assert.equal(h.applied[0].boolMap["2026-07-20"], true);
});

// ═══════════════════════════════════════════════════════════════════════════
// EXCEPTION OP-ID / STATE OWNERSHIP — createExceptionOwnership (17, 18)
// ═══════════════════════════════════════════════════════════════════════════

test("[prod-helper] S18: op IDs are selection/generation bound — T1/A and T2/A same date are isolated", () => {
  const own = ML.createExceptionOwnership();
  const op1 = own.ensureOpId("2026-07-24", () => "op-t1");
  assert.equal(own.ensureOpId("2026-07-24", () => "op-DIFFERENT"), op1, "replay within one live selection reuses the op ID");
  own.invalidate();
  assert.equal(own._state().ops["2026-07-24"], undefined, "old op ID does not exist under the new selection");
  const op2 = own.ensureOpId("2026-07-24", () => "op-t2");
  assert.equal(op2, "op-t2");
  assert.notEqual(op2, op1, "T2/A gets its own operation ownership for the same business date");
});

test("[prod-helper] S18b: an old completion cannot resurrect the retired op ID into the new selection", () => {
  const own = ML.createExceptionOwnership();
  own.ensureOpId("2026-07-24", () => "op-t1");
  own.invalidate();
  own.ensureOpId("2026-07-24", () => "op-t2");
  own.consumeOpId("2026-07-24");
  const op3 = own.ensureOpId("2026-07-24", () => "op-t3");
  assert.notEqual(op3, "op-t1", "the retired op ID can never be resurrected into the new selection");
});

test("[prod-helper] S17: old exception STATE cannot populate the new selection's form", () => {
  const own = ML.createExceptionOwnership();
  own.replaceStates({ "2026-07-24": { status: "active", reasonCode: "closure", revision: 3 } });
  assert.equal(own.getState("2026-07-24").status, "active");
  own.invalidate();
  assert.equal(own.getState("2026-07-24"), undefined, "old effective-exception state cannot bleed into the new selection's form");
});

// ═══════════════════════════════════════════════════════════════════════════
// FULL SAVE LIFECYCLE — executeEntrySave over REAL persistence + readback (10,41,42)
// ═══════════════════════════════════════════════════════════════════════════

function saveHarness(overrides = {}) {
  const ctrl = liveCtrl("T1", "A");
  const calls = { storage: [], apiRange: [], setSaved: [], resetForm: 0, schedNav: [], suppress: [] };
  const excStore = {}, opStore = {};
  const P = ML.createPersistence({ selection: ctrl, canonicalize: ME.canonicalizeEntries, storageSetFor: async (t, k) => { calls.storage.push([t, k]); } });
  const RB = ML.createInsightReadback({ selection: ctrl, candidateDates: () => ["2026-07-24"], apiGetRange: async ({ tenantId, bizId, fromDate }) => { calls.apiRange.push({ tenantId, bizId, fromDate }); return { "2026-07-24": { insights: [] } }; } });
  const io = {
    selection: ctrl,
    form: { date: "2026-07-24", sales: 27753 },
    rows: [day("2026-07-01", 100)],
    role: "owner", editingDate: null,
    vatNormalize: (f) => f, materialChanged: () => true,
    todayKey: (off) => (off === 0 ? "2026-07-24" : off === 1 ? "2026-07-25" : "2026-07-23"),
    newOpId: () => "op-fixed",
    exceptionState: { get: (d) => excStore[d], set: (d, st) => { excStore[d] = st; }, applyActive: () => {} },
    opIds: { ensure: (d, mk) => { if (!opStore[d]) opStore[d] = mk(); return opStore[d]; }, consume: (d) => { delete opStore[d]; } },
    apiFetch: async () => ({ ok: true, json: async () => ({ ok: true, applied: true, rebuildRequired: false, exception: { status: "active", reasonCode: "closure" }, revision: 1 }) }),
    persistRows: (rows2, c2) => P.persistEntries(rows2, c2),
    applyRows: () => {},
    reloadExceptions: async () => {},
    rebuildInsights: async () => {},
    loadInsights: (d, isCancelled, c2) => RB.loadRange(c2, d, isCancelled).then(r => (r && r.cancelled ? { ok: false, cancelled: true } : { ok: true, found: !!(r && r.found), date: d })),
    onInsightsFailure: () => {},
    suppressNextInsightsLoad: (c) => calls.suppress.push(c),
    resetFormAndEditing: () => { calls.resetForm++; },
    setSaved: (v) => calls.setSaved.push(v),
    setError: () => {},
    scheduleNav: (c, ms) => calls.schedNav.push([c, ms]),
    ...overrides,
  };
  return { ctrl, io, calls };
}

test("[prod-helper] S41: normal same-context save succeeds exactly once over real persistence+readback", async () => {
  const h = saveHarness();
  const r = await ML.executeEntrySave(h.io);
  assert.equal(r.status, "saved");
  assert.equal(h.calls.storage.length, 1);
  assert.equal(h.calls.storage[0][1], "biz:A:entries");
  assert.equal(h.calls.storage[0][0], "T1");
  assert.ok(h.calls.setSaved.includes(true));
  assert.equal(h.calls.resetForm, 1);
  assert.ok(h.calls.apiRange.every(x => x.tenantId === "T1" && x.bizId === "A"));
});

test("[prod-helper] S42: delayed navigation scheduled with the captured live ctx", async () => {
  const h = saveHarness();
  await ML.executeEntrySave(h.io);
  assert.equal(h.calls.schedNav.length, 1);
  assert.equal(h.ctrl.isLive(h.calls.schedNav[0][0]), true);
});

test("[prod-helper] S10: a save whose selection changes mid-flight mutates NOTHING in the new selection", async () => {
  const persistGate = deferred();
  let h;
  h = saveHarness({
    persistRows: async (rows2, c2) => { const P = ML.createPersistence({ selection: h.ctrl, canonicalize: ME.canonicalizeEntries, storageSetFor: async () => { await persistGate.promise; } }); return P.persistEntries(rows2, c2); },
  });
  const p = ML.executeEntrySave(h.io);
  await tick();
  h.ctrl.invalidate("T2", "B");
  persistGate.resolve();
  const r = await p;
  assert.equal(r.status, "stale");
  assert.ok(!h.calls.setSaved.includes(true));
  assert.equal(h.calls.resetForm, 0);
  assert.equal(h.calls.schedNav.length, 0);
  assert.equal(h.calls.suppress.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// PRESERVED BEHAVIOR — MarjinEntries replay/canonicalization (34-40)
// ═══════════════════════════════════════════════════════════════════════════

test("[prod-entries] S34: date-move edit keeps ONE row for the final date (identity by date)", () => {
  const rows = [day("2026-07-01", 10), day("2026-07-02", 20), day("2026-07-03", 30)];
  const moved = ME.upsertEntryByDate(rows, day("2026-07-05", 999), "2026-07-02");
  assert.equal(moved.filter(e => e.date === "2026-07-02").length, 0);
  assert.equal(moved.filter(e => e.date === "2026-07-05").length, 1);
  assert.equal(moved.find(e => e.date === "2026-07-05").sales, 999);
  assert.equal(moved.length, 3);
});

test("[prod-entries] S34b: edit onto an EXISTING date collapses to one row (explicit save wins)", () => {
  const rows = [day("2026-07-01", 10), day("2026-07-02", 20)];
  const merged = ME.upsertEntryByDate(rows, day("2026-07-02", 500, { note: "new" }), "2026-07-01");
  assert.equal(merged.filter(e => e.date === "2026-07-02").length, 1);
  assert.equal(merged.find(e => e.date === "2026-07-02").sales, 500);
  assert.equal(merged.length, 1);
});

test("[prod-entries] S35: explicit save wins wholesale over a hydrated duplicate", () => {
  const hydrated = [day("2026-07-10", 100, { payroll: 50 })];
  const saved = ME.upsertEntryByDate(hydrated, day("2026-07-10", 300), "2026-07-10");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sales, 300);
  assert.equal(saved[0].payroll, undefined);
});

test("[prod-entries] S36: earliest-non-zero scalar precedence (never summed)", () => {
  const dup = [day("2026-07-11", 0, { payroll: 0 }), day("2026-07-11", 250, { payroll: 80 })];
  const canon = ME.canonicalizeEntries(dup);
  assert.equal(canon.length, 1);
  assert.equal(canon[0].sales, 250);
  assert.equal(canon[0].payroll, 80);
});

test("[prod-entries] S37+S38: nested map union earliest-wins; same keys never summed", () => {
  const dup = [
    day("2026-07-12", 1, { supplier_payments: { "s1": "100", "s2": "40" }, hourly_payroll: { "9": "3" } }),
    day("2026-07-12", 1, { supplier_payments: { "s1": "999", "s3": "70" }, hourly_payroll: { "9": "9", "10": "5" } }),
  ];
  const canon = ME.canonicalizeEntries(dup);
  assert.equal(canon.length, 1);
  assert.deepEqual(plain(canon[0].supplier_payments), { "s1": "100", "s2": "40", "s3": "70" });
  assert.deepEqual(plain(canon[0].hourly_payroll), { "9": "3", "10": "5" });
});

test("[prod-entries] S39: canonicalization is deterministic and idempotent; undated dropped", () => {
  const raw = [day("2026-07-02", 2), day("2026-07-01", 1), day("2026-07-02", 9), { sales: 5 }, { date: null, sales: 7 }, day("2026-07-01", 0)];
  const once = ME.canonicalizeEntries(raw);
  const twice = ME.canonicalizeEntries(once);
  assert.deepEqual(plain(twice), plain(once));
  assert.deepEqual(plain(once).map(e => e.date), ["2026-07-01", "2026-07-02"]);
});

test("[prod-entries] S40 (behavioral): duplicate hydration merges to one canonical row", () => {
  const val = [day("2026-07-24", 27753), day("2026-07-24", 27753)];
  const deduped = ME.canonicalizeEntries(val);
  assert.ok(deduped.length < val.length);
  assert.equal(totalRevenue(deduped), 27753);
});

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE GUARDS — supplementary wiring assertions (NOT race proof)
// ═══════════════════════════════════════════════════════════════════════════

test("[source-guard] the legacy multi-write persist(e,f,ctx) helper is removed; no entries+fixed multi-write", () => {
  assert.ok(!/const persist = async \(e, f, ctx\)/.test(html));
  assert.ok(!/setFixedList\(u\);persist\(entries,u\)/.test(html));
  assert.ok(!/persist\(newEntries, fixedList\)/.test(html));
});

test("[source-guard] supplier caller inspects the coordinator result and surfaces failure via the production helper", () => {
  assert.ok(html.includes("window.MarjinSaveLifecycle.applySupplierWriteResult(res, {"), "setSupPayDate delegates to the production error-arbitration helper");
  assert.ok(html.includes("setError: () => setSupplierWriteError("), "latest failure sets a visible supplier error");
  assert.ok(html.includes("{supplierWriteError}"), "the supplier error state is rendered visibly");
});

test("[source-guard] entries listener delegates to the coordinator with the captured effect ctx; self-heal is not a raw window.storage.set", () => {
  assert.ok(html.includes("entriesWriteCoordRef.current.onListenerEcho(val, ctxAtSetup)"), "listener passes its captured selection context");
  assert.ok(!/window\.storage\.set\(`biz:\$\{currentBizId\}:entries`, JSON\.stringify\(deduped\)/.test(html), "the raw mutable-tenant self-heal write is gone");
});

test("[source-guard] production wrappers are wired: save UI runner, insight UI loader, exception ownership", () => {
  assert.ok(html.includes("saveUiRunnerRef.current.run(ownCtx"), "saveEntry delegates to createSaveUiRunner");
  assert.ok(html.includes("insightUiLoaderRef.current.load(effCtx"), "loadDashboardInsights delegates to createInsightUiLoader");
  assert.ok(html.includes("exceptionOwnershipRef.current.ensureOpId"), "op IDs go through createExceptionOwnership");
  assert.ok(html.includes("if (exceptionOwnershipRef.current) exceptionOwnershipRef.current.invalidate();"), "invalidateSelection resets the exception ownership store");
});

test("[source-guard] coordinator is single-flight lane-based (no shared pending counter that old promises decrement)", () => {
  assert.ok(html.includes("const newLane = (gen) =>"), "generation lanes present");
  assert.ok(html.includes("if (writing) return;"), "global single-flight guard present");
  assert.ok(html.includes("let writing = false;"), "single global in-flight flag (not per-lane, not a shared decremented counter)");
  assert.ok(!/finally \{ pending--; \}/.test(html), "the R4 shared pending-- counter is gone");
});

test("[source-guard] explicit-tenant storage.setFor exists and persistence uses ctx tenant/key", () => {
  assert.ok(html.includes("window.storage.setFor = async (tenantId, key, value, shared=false)"));
  assert.ok(html.includes("io.storageSetFor(ctx.tenantId, `biz:${ctx.bizId}:entries`"));
  assert.ok(html.includes("`biz:${ctx.bizId}:entries`"));
});
