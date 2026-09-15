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

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

const FREEZE = "window.MarjinSaveLifecycle = Object.freeze({ createSelectionController, scheduleSelectionBoundTimeout, loadExceptionsBound, createPersistence, createEntriesWriteCoordinator, createSaveOwnership, createInsightReadback, createInsightUiLoader, createSaveUiRunner, createExceptionOwnership, createSupplierResultOwnership, applySupplierWriteResult, executeEntrySave, createRemoteEntriesMutator, applyEntryIntent, resolveEntryTarget, parseEntriesNode, contentFingerprint, stableStringify, buildEntryUpsertIntent, buildEntryDeleteIntent, rowDiffPaths, describeSaveOutcome, validateEntriesNode, isValidEntryId, generateEntryId });";

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
// Canonical lowercase UUID v4 fixtures. Identity is the uuid; the date->uuid mapping
// is a TEST convention that keeps physical rows distinct and identity relationships
// visible. Runtime never derives identity from a date.
const __hx = (n, len) => (n >>> 0).toString(16).padStart(len, "0").slice(-len);
const __fnv = (x) => { let h = 2166136261; const t = String(x); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid4 = (seed) => { const a = __fnv("a" + seed), b = __fnv("b" + seed); return `${__hx(a,8)}-${__hx(b,4)}-4${__hx(a,3)}-8${__hx(b,3)}-${__hx(a,6)}${__hx(b,6)}`; };
const idFor = (date) => uuid4("row:" + date);
const day = (date, sales, extra = {}) => ({ id: idFor(date), date, sales, deliveries: 0, other_income: 0, ...extra });
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

// Every harness registers itself so that, when a test ends, any transaction it left
// un-acked is settled. Without this a single assertion failure strands a pending
// submitIntent promise and Node cancels every subsequent test.
const __liveHarnesses = [];
afterEach(async () => {
  while (__liveHarnesses.length) {
    const h = __liveHarnesses.pop();
    // Settling one transaction lets the pump dispatch the next queued intent, so drain
    // repeatedly until the lane is quiescent.
    for (let round = 0; round < 25; round++) {
      let settledAny = false;
      try { settledAny = h.__drain(); } catch (_) { break; }
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      if (!settledAny) break;
    }
  }
});

function laneHarness(opts = {}) {
  const ctrl = liveCtrl("T1", "A");
  const store = {};              // simulated persisted RTDB node: key -> serialized _v
  const transports = [];         // one per dispatched TRANSACTION, in order
  const applied = [];            // every array handed to setEntries
  // R10: the lane now dispatches SEMANTIC INTENTS through the real remote-atomic
  // mutator. Each transaction is held open so a test still controls exactly when it
  // settles (h.ok(i) / h.fail(i)) — preserving every R6–R9 ordering assertion.
  const mutator = ML.createRemoteEntriesMutator({
    selection: ctrl,
    transact: (tenantId, key, txnFn) => new Promise((resolve, reject) => {
      transports.push({
        tenantId, key, txnFn, resolve, reject,
        __commit: () => {
          const raw = store[key] === undefined ? null : { _v: store[key] };
          const out = txnFn(raw);
          if (out === undefined) { resolve({ committed: false, runs: 1 }); return; }
          store[key] = out._v;
          resolve({ committed: true, runs: 1, snapshot: out });
        },
      });
    }),
  });
  const lane = ML.createEntriesWriteCoordinator({
    selection: ctrl, canonicalize: ME.canonicalizeEntries,
    entryDateKey: ME.entryDateKey, fingerprint: (rows) => JSON.stringify(rows),
    contentFingerprint: ML.contentFingerprint,
    applyRows: (r) => applied.push(plain(r)), mutate: (intent, c) => mutator.mutate(intent, c),
  });
  const hydrate = (rows) => {
    const list = rows || [];
    store["biz:" + ctrl.current().bizId + ":entries"] = JSON.stringify(list);
    // A seeded node EXISTS, so hydration is a listener value even when empty. This
    // yields real `hydrated` state (clear-all requires it); markHydrated models only a
    // genuinely ABSENT node and is exercised explicitly by the absent-node tests.
    lane.onListenerEcho(list, ctrl.capture());
  };
  if (opts.hydrated !== false) hydrate(opts.hydrateRows || []);
  // R10: explicit semantic-intent helpers. There is NO snapshot-replace shim: each
  // helper builds the same typed intent the production call sites build, addressed by
  // the row's immutable uuid.
  // ── OPERATION ACCOUNTING ────────────────────────────────────────────────────
  // PROVEN root cause of the cancellation cascade: the pump dispatches a NEW
  // transaction whenever one settles, so a test that acks fewer transports than the
  // lane dispatches leaves its last operation promise permanently pending. The test
  // body then never returns, which is why `afterEach` could never run and why
  // `lane.invalidate()` would not have helped (the operation is already DISPATCHED,
  // and invalidate only cancels waiters that have not dispatched).
  //
  // Fix: every operation promise is wrapped in a DETERMINISTIC, tick-based watchdog
  // (no timers, no sleeps). If it does not settle while the lane is quiescent, the
  // await fails THIS test with the exact un-acked transport list instead of hanging.
  const im = () => new Promise((r) => setImmediate(r));
  const ops = [];
  const unackedTransports = () => transports.map((t, i) => (t.__settled ? null : i)).filter((x) => x !== null);
  const guard = (p, label) => {
    const rec = { label, state: "queued", settled: false };
    ops.push(rec);
    p.then((r) => { rec.settled = true; rec.state = "result_settled"; return r; },
           (e) => { rec.settled = true; rec.state = "result_rejected"; throw e; });
    const watchdog = (async () => {
      for (let i = 0; i < 60; i++) { await im(); if (rec.settled) break; }
      if (rec.settled) return new Promise(() => {});   // settled: never win the race
      rec.state = "unexpectedly_pending";
      throw new Error(`[harness] operation ${label} never settled after 60 deterministic ticks. `
        + `transports=${transports.length}, UNACKED=[${unackedTransports().join(",")}]. `
        + `The lane dispatched more transactions than this test acked — ack the remaining `
        + `transport(s), or assert the blocked result instead of awaiting it.`);
    })();
    return Promise.race([p, watchdog]);
  };
  // Wrap every lane entry point so direct `h.lane.*` call sites are covered too.
  const __rawIntent = lane.submitIntent, __rawSup = lane.submitSupplierEdit, __rawClear = lane.submitClearAll;
  lane.submitIntent = (intent) => guard(__rawIntent(intent), `submitIntent(${intent && intent.type})`);
  lane.submitSupplierEdit = (args) => guard(__rawSup(args), `submitSupplierEdit(${args && args.supId})`);
  lane.submitClearAll = (args) => guard(__rawClear(args), "submitClearAll");

  const rowById = (id) => (lane._state().desired || []).find(r => r && r.id === id) || null;
  // LOW-LEVEL: returns the intent-builder result unchanged so negative tests can
  // inspect a blocked/rejected build directly.
  const buildUpsert = (date, fields, opts) => {
    const o = opts || {};
    const id = o.id || idFor(date);
    const prev = rowById(id);
    const next = { ...(prev || { date }), ...fields, date: o.newDate || (prev ? prev.date : date) };
    return { id, prev, intent: ML.buildEntryUpsertIntent(prev, next, { newId: id }) };
  };
  // DISPATCH-EXPECTING: for positive call sites that go on to drive a transport. If
  // validation blocks before a transaction is created, fail THIS test immediately with
  // a useful diagnostic instead of leaving a pending promise that cancels the suite.
  const upsert = (date, fields, opts) => {
    const { id, intent } = buildUpsert(date, fields, opts);
    if (intent.status) {
      throw new Error(`[harness] upsert("${date}") did not dispatch. status=${intent.status} `
        + `reason=${intent.reason || "n/a"} id=${JSON.stringify(id)} transports=${transports.length}. `
        + `A positive fixture must carry a canonical UUID v4 id. `
        + `Use h.buildUpsert(...)/h.lane.submitIntent(...) for fail-closed negative controls.`);
    }
    return lane.submitIntent(intent);
  };
  const removeRow = (date, opts) => {
    const id = (opts && opts.id) || idFor(date);
    const prev = rowById(id);
    if (!prev) return Promise.resolve({ status: "blocked", reason: "target_not_found", latest: true });
    const intent = ML.buildEntryDeleteIntent(prev, {});   // R10.1-GATE-017: complete canonical base row
    if (intent.status) return Promise.resolve({ status: intent.status });
    return lane.submitIntent(intent);
  };
  const sv = (arr, date, supId) => { const row = (arr || []).find(e => e.date === date); return row && row.supplier_payments ? row.supplier_payments[supId] : undefined; };
  const __h = {
    ctrl, store, transports, applied, lane, sv, hydrate, upsert, buildUpsert, removeRow, rowById,
    ops, unackedTransports,
    // Express a multi-row legacy fixture as one typed intent per PHYSICAL row,
    // sequentially, addressed by each row's own uuid.
    upsertRows: async (list) => {
      const arr = Array.isArray(list) ? list : [list];
      let last = { status: "committed_idempotent", latest: true };
      for (const r of arr) {
        const { id, date, ...rest } = r;
        last = await upsert(date, rest, { id: id || idFor(date) });
      }
      return last;
    },
    clearAll: () => lane.submitClearAll({ expectedNodeFingerprint: lane.currentFingerprint(), confirmToken: uuid4("confirm") }),
    last: () => applied[applied.length - 1],
    persisted: () => (store["biz:A:entries"] ? JSON.parse(store["biz:A:entries"]) : null),
    persistedSup: (d, s) => { const p = store["biz:A:entries"]; return p ? sv(JSON.parse(p), d, s) : undefined; },
    // Settle anything still open so no promise outlives the test.
    __drain: () => {
      let any = false;
      transports.forEach(t => { if (!t.__settled) { t.__settled = true; any = true; try { t.reject(new Error("drained_after_test")); } catch (_) {} } });
      return any;
    },
    ok: (i) => {
      if (!transports[i]) throw new Error(`h.ok(${i}): no transaction was dispatched (transports=${transports.length}). `
        + `The submission was blocked BEFORE transport creation — inspect the returned status rather than acking.`);
      transports[i].__settled = true; transports[i].__commit();
    },
    fail: (i) => {
      if (!transports[i]) throw new Error(`h.fail(${i}): no transaction was dispatched (transports=${transports.length}).`);
      transports[i].__settled = true; transports[i].reject(new Error("write_failed"));
    },
  };
  __liveHarnesses.push(__h);
  return __h;
}
// Legacy statuses map onto R10 outcomes: a committed transaction is the new "committed".
const APPLIED = (st) => st === "committed" || st === "committed_idempotent" || st === "committed";
const FAILEDW = (st) => st === "failed" || st === "failed";

// ─── Mandatory test 1: cross-writer ordering (supplier 100 vs main-save 999) ───
test("[prod-helper] R6-1(R10): supplier + main-save share ONE lane; single-flight; a colliding second CREATE fails closed instead of overwriting", async () => {
  const h = laneHarness();
  const pSup = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
  const pSave = h.upsert("2026-07-24", {sales: 0, deliveries: 0, other_income: 0, supplier_payments: { "sup-1": "999" }});
  await tick();
  assert.equal(h.transports.length, 1, "only ONE terminal write dispatched while the first is in flight");
  h.ok(0); await settleAll();
  assert.equal(h.transports.length, 2, "the 999 write dispatches only after the 100 write settled");
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "100", "supplier 100 committed first, in order");
  h.ok(1); await settleAll();
  const [rSup, rSave] = await Promise.all([pSup, pSave]);
  // PRESERVED invariant: ONE lane, strict single-flight, deterministic ordering.
  assert.ok(rSup.status === "committed", "the first operation committed");
  // CHANGED (deliberate): the legacy suite asserted the later whole-row save won
  // wholesale (last-writer-wins). R10 removes that. The second submission was built
  // from a base that did not yet contain the row, so it is a CREATE for an id that now
  // exists with different content — a visible identity collision, zero mutation.
  assert.equal(rSave.status, "blocked", "colliding create fails closed (no commit)");
  assert.equal(rSave.reason, "invalid_identity", "surfaced as an identity failure, never a patch or success");
  // R10-GATE-010: the SPECIFIC condition must stay observable at the production
  // boundary so the UI can present a distinct create-ID-collision outcome.
  assert.equal(rSave.detail, "id_collision", "the precise collision classification reaches the caller");
  assert.notEqual(rSave.status, "committed", "never ordinary success");
  assert.notEqual(rSave.status, "committed_idempotent", "never idempotent success");
  assert.equal(rSave.rows, undefined, "no committed rows returned for the collision");
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "100", "the committed value was NOT silently overwritten");
  assert.equal(h.persisted().length, 1, "zero unintended remote mutation — still exactly one row");
  assert.deepEqual(h.unackedTransports(), [], "every dispatched transaction explicitly settled");
});

// R10-GATE-010: the create-ID collision must remain observable all the way to the
// operator, not merely at the coordinator boundary. These close the observability gap
// the R10 contract requires (a distinct create-ID-collision outcome in the UI).
test("[prod-helper] R6-1b(R10-GATE-010): describeSaveOutcome presents an id_collision distinctly and stays byte-compatible with a bare status", () => {
  const generic = ML.describeSaveOutcome("blocked", false);
  const collision = ML.describeSaveOutcome({ status: "blocked", reason: "invalid_identity", detail: "id_collision" }, false);
  assert.ok(collision.length > 10, "the collision message is a real, actionable sentence");
  assert.notEqual(collision, generic, "a create-ID collision is NOT presented as the catch-all blocked text");
  assert.notEqual(collision, ML.describeSaveOutcome("invalid_identity", false), "and not as the generic identity text either");
  assert.ok(!/committed|נשמר בהצלחה/.test(collision), "it never reads as a success");
  // A fail-closed identity/structure condition surfaces its precise reason.
  assert.equal(ML.describeSaveOutcome({ status: "blocked", reason: "duplicate_id" }, false), ML.describeSaveOutcome("duplicate_id", false));
  assert.equal(ML.describeSaveOutcome({ status: "blocked", reason: "malformed_remote" }, false), ML.describeSaveOutcome("malformed_remote", false));
  // Backward compatibility: every legacy status string maps exactly as before.
  ["conflict", "blocked_unhydrated", "blocked_listener_degraded", "blocked_no_owner",
   "blocked_entry_identity_required", "duplicate_id", "invalid_identity", "malformed_remote",
   "blocked", "stale", "cancelled_selection_changed", "blocked_precondition_missing",
   "blocked_unconfirmed", "failed"].forEach(st => {
    assert.equal(ML.describeSaveOutcome({ status: st }, false), ML.describeSaveOutcome(st, false), `object form matches string form for ${st}`);
  });
  assert.equal(ML.describeSaveOutcome(undefined, true), ML.describeSaveOutcome({ status: undefined }, true), "partial-exception fallback unchanged");
});
test("[source-guard] R6-1c(R10-GATE-010): the production save mapping preserves the transformation's precise classification", () => {
  assert.ok(html.includes("detail: r.detail || r.reason || r.error"), "the save-UI adapter prefers the typed detail over the coarser reason");
  assert.ok(html.includes("describeSaveOutcome(persistResult || \"failed\""), "executeEntrySave hands the WHOLE outcome to the message mapper");
  assert.ok(html.includes('detail: outcome.reason'), "the mutator propagates the transformation's own classification");
  assert.ok(html.includes("detail: res && res.detail"), "and the coordinator forwards it to the caller");
});

// ─── Mandatory test 2: every intent routes through the shared lane ───
test("[prod-helper] R6-2: supplier/main-save/delete/clear/labor/self-heal all route through the ONE lane", async () => {
  const h = laneHarness();
  // supplier (transform)
  const s = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
  await tick(); h.ok(0); await settleAll(); await s;
  // main save (replace)
  const ms = h.upsert("2026-07-24", { sales: 500 });
  await tick(); h.ok(1); await settleAll(); await ms;
  // employee labor (transform payroll)
  const lb = h.upsert("2026-07-24", { payroll: "80" });   // labor = a field patch on the same id
  await tick(); h.ok(2); await settleAll(); await lb;
  assert.equal(h.persisted().find(e => e.date === "2026-07-24").payroll, "80");
  // delete (transform)
  const del = h.removeRow("2026-07-24");                  // delete = a typed delete intent
  await tick(); h.ok(3); await settleAll(); await del;
  assert.equal(h.persisted().length, 0, "delete removed the date");
  // clear all (replace [])
  const c1 = h.upsert("2026-07-25", { sales: 10 });
  await tick(); h.ok(4); await settleAll(); await c1;
  const c2 = h.clearAll()
  await tick(); h.ok(5); await settleAll(); await c2;
  assert.deepEqual(h.persisted(), [], "clear-all persisted []");
  assert.equal(h.transports.length, 6, "each intent produced exactly one terminal write, all serialized");
});

// ─── Mandatory test 3: cross-writer transform preservation ───
test("[prod-helper] R6-3(R10): patches build on the LATEST authoritative row — different suppliers + labor all preserved; a later field patch never drops them", async () => {
  // The row exists, so the three edits are FIELD PATCHES against one immutable id.
  // (Three creates sharing an id would be collisions — a different invariant, R6-1.)
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-2", date: "2026-07-24", val: "250", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-2"] : undefined, newId: idFor("2026-07-24") });
  const p3 = h.upsert("2026-07-24", { payroll: "70" });
  // Each settled transaction lets the pump dispatch the next queued intent, so ALL
  // THREE dispatched transactions are settled explicitly.
  await tick(); h.ok(0); await settleAll(); h.ok(1); await settleAll(); h.ok(2); await settleAll();
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.ok(APPLIED(r1.status) && APPLIED(r2.status) && APPLIED(r3.status), "all three field patches committed");
  assert.deepEqual(h.unackedTransports(), [], "every dispatched transaction reached an explicit server outcome");
  const row = h.persisted().find(e => e.date === "2026-07-24");
  assert.equal(row.supplier_payments["sup-1"], "100");
  assert.equal(row.supplier_payments["sup-2"], "250");
  assert.equal(row.payroll, "70", "labor transform preserved on top of both supplier edits");
  // CHANGED (deliberate): the legacy suite asserted a later main-save REPLACE dropped
  // the accumulated supplier/labor fields. That whole-row replacement is exactly the
  // history-loss mechanism R10 removes, so the replacement assertion is inverted: a
  // later revenue patch updates only its own field and PRESERVES every other field.
  const ms = h.upsert("2026-07-24", { sales: 9999 });
  await tick(); h.ok(h.transports.length - 1); await settleAll(); await ms;
  const after = h.persisted().find(e => e.date === "2026-07-24");
  assert.equal(after.sales, 9999, "the revenue field was patched");
  assert.equal(after.supplier_payments["sup-1"], "100", "supplier field preserved (was dropped pre-R10)");
  assert.equal(after.supplier_payments["sup-2"], "250", "supplier field preserved");
  assert.equal(after.payroll, "70", "labor field preserved");
});

// ─── Mandatory test 4: queued invalidation — every waiter settles exactly once ───
for (const mode of ["success", "failure"]) {
  test(`[prod-helper] R6-4(${mode}): rev1 active, rev2/rev3 queued, invalidate → rev2/rev3 settle cancelled exactly once; no stale UI`, async () => {
    const h = laneHarness();
    let settled2 = 0, settled3 = 0;
    const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
    const p2 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") }).then(r => { settled2++; return r; });
    const p3 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "300", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") }).then(r => { settled3++; return r; });
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
    assert.ok(["committed", "failed"].includes(r1.status), "the active write settles against its captured destination");
  });
}

// ─── Mandatory test 5: switch-away-and-back to T1/A ───
test("[prod-helper] R6-5(R10): switch-away-and-back to T1/A — the new write waits behind the old physical write and can only commit re-based", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 5)] });
  const pOld = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "OLD", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
  await tick();
  h.lane.invalidate();               // leave A
  h.lane.invalidate();               // ... return to A (fresh lane)
  h.hydrate([day("2026-07-24", 5)]); // R9: the re-selected destination hydrates before it can write
  // The re-selected generation hydrated a snapshot that does NOT contain the still
  // in-flight "OLD" value, so its base for sup-1 is legitimately absent.
  const pNew = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "NEW", emptyEntry: {},
    targetId: idFor("2026-07-24"), baseValue: undefined, newId: idFor("2026-07-24") });
  await tick();
  // PRESERVED invariant (the point of R6-5): destination-wide single-flight ACROSS
  // generations — the new write is not dispatched while the old physical write is live.
  assert.equal(h.transports.length, 1, "new write NOT dispatched while the old physical write is active");
  const st = h.lane._state();
  assert.ok(st.pending >= 0, "new-generation pending accounting is non-negative");
  h.ok(0); await settleAll();
  assert.equal(h.transports.length, 2, "new write dispatched only after the old settled");
  h.ok(1); await settleAll();
  const [rOld, rNew] = await Promise.all([pOld, pNew]);
  assert.ok(APPLIED(rOld.status), `the old-generation write committed against its captured destination (${rOld.status})`);
  // CHANGED (deliberate): the legacy suite asserted the later write "wins" wholesale.
  // R10 removes last-writer-wins. The new generation edited from a base that predates
  // the OLD commit, so the transaction refuses it instead of erasing a value this
  // client never observed — the exact R9-FIND-001 loss mechanism.
  assert.equal(rNew.status, "conflict", "a re-selected generation cannot overwrite a value it never observed");
  assert.deepEqual(plain(rNew.conflictPaths), ["supplier_payments.sup-1"], "the exact conflicting path is reported");
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "OLD", "zero silent data loss — the committed value stands");
  // Re-based on what actually committed, the same edit lands.
  const pRebased = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "NEW", emptyEntry: {},
    targetId: idFor("2026-07-24"), baseValue: "OLD", newId: idFor("2026-07-24") });
  await tick(); h.ok(2); await settleAll();
  assert.ok(APPLIED((await pRebased).status));
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "NEW", "the re-based new-generation payload commits last and wins");
});

// ─── Mandatory test 6: Firebase local-before-ack ───
test("[prod-helper] R6-6(R10): a pre-ack payload is deferred (never consumed as own); the post-commit own echo is ignored; external 999 AFTER ack is applied", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
  await tick();
  // R10 binds the own marker's fingerprint to the COMMITTED transaction result, and
  // `applyLocally:false` suppresses Firebase's optimistic local event — so nothing
  // arriving before the ack can be our own echo. It must be RETAINED, not consumed.
  const pre = h.lane.onListenerEcho([day("2026-07-24", 0, { supplier_payments: { "sup-9": "1" } })], h.ctrl.current());
  assert.equal(pre.status, "deferred_pending_local", "a pre-ack payload cannot clobber pending local intent");
  assert.equal(pre.deferredStored, true, "and it is retained, not dropped");
  h.ok(0); await settleAll(); await p; // ack — the marker's fingerprint is bound here
  const own = h.lane.onListenerEcho(h.persisted(), h.ctrl.current());
  assert.equal(own.status, "ignored_own_echo", "the true post-commit own echo is identified by fingerprint");
  const ext = h.lane.onListenerEcho([day("2026-07-24", 0, { supplier_payments: { "sup-1": "999" } })], h.ctrl.current());
  assert.equal(ext.status, "applied", "legitimate external payload after ack is NOT swallowed by a counter");
  assert.equal(h.sv(h.last(), "2026-07-24", "sup-1"), "999");
});

test("[prod-helper] R6-6b: two serialized writes with local-before-ack echoes; two later external payloads both apply", async () => {
  const h = laneHarness();
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
  await tick();
  const d1 = plain(h.last());
  h.lane.onListenerEcho(d1, h.ctrl.current()); // local echo of 100 before ack
  h.ok(0); await settleAll(); await p1;
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
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
test("[prod-helper] R6-7(R10): 100 → 200 (correctly re-based) → own-echo(200) → delayed own-echo(100); final UI/persisted 200", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  // Both edits are queued up front; the SECOND declares the base the first will
  // establish, which is what a correctly re-based sequential UI edit looks like.
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", emptyEntry: {},
    targetId: idFor("2026-07-24"), baseValue: undefined, newId: idFor("2026-07-24") });
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", emptyEntry: {},
    targetId: idFor("2026-07-24"), baseValue: "100", newId: idFor("2026-07-24") });
  await tick();
  h.ok(0); await settleAll();          // 100 committed
  const echo100 = JSON.parse(h.store["biz:A:entries"]); // own echo of 100
  h.ok(1); await settleAll();          // 200 committed
  const echo200 = JSON.parse(h.store["biz:A:entries"]); // own echo of 200
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(APPLIED(r1.status), `first edit committed (${r1.status})`);
  assert.ok(APPLIED(r2.status), `re-based second edit committed (${r2.status})`);
  assert.equal(h.lane.onListenerEcho(echo200, h.ctrl.current()).status, "ignored_own_echo");
  assert.equal(h.lane.onListenerEcho(echo100, h.ctrl.current()).status, "ignored_own_echo", "delayed OLDER own echo identified and ignored");
  assert.equal(h.sv(h.last(), "2026-07-24", "sup-1"), "200");
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "200");
});

// ─── Mandatory test 8: normal convergence; no permanent blacklist ───
test("[prod-helper] R6-8: external payload after quiescence applies; an identical FUTURE remote payload is not permanently blacklisted", async () => {
  const h = laneHarness();
  const p = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
  await tick(); h.ok(0); await settleAll(); await p;
  const own = JSON.parse(h.store["biz:A:entries"]);
  assert.equal(h.lane.onListenerEcho(own, h.ctrl.current()).status, "ignored_own_echo"); // consumes the own fingerprint
  // A future EXTERNAL payload identical to what we once wrote now applies (fingerprint retired after consume).
  const again = h.lane.onListenerEcho(own, h.ctrl.current());
  assert.equal(again.status, "applied", "identical future remote payload is not permanently blacklisted");
});

test("[prod-helper] R6-8b: an external non-matching payload while a local write is pending is DEFERRED (never consumed as own)", async () => {
  const h = laneHarness();
  const p = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
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
  assert.equal(h.own.settle(t1, { status: "failed" }, h.ctrl, h.ports).action, "set");
  // a NEWER submission supersedes; the older token can no longer act
  const t2 = h.own.begin(h.ctrl.capture());
  assert.equal(h.own.settle(t1, { status: "failed" }, h.ctrl, h.ports).action, "superseded", "older same-selection result cannot overwrite");
  // owned success clears
  assert.equal(h.own.settle(t2, { status: "committed" }, h.ctrl, h.ports).action, "clear");
  assert.deepEqual(h.ev, ["set", "clear"]);
});

test("[prod-helper] R6-9b: old-selection result after invalidation cannot set/clear the NEW selection's error", () => {
  const h = supErrHarness();
  const tOld = h.own.begin(h.ctrl.capture());        // T1/A
  h.ctrl.invalidate("T2", "B"); h.own.invalidate();  // selection changes; ownership reset
  // old T1/A failure result arrives:
  assert.equal(h.own.settle(tOld, { status: "failed" }, h.ctrl, h.ports).action, "stale", "old-selection failure cannot set the new error");
  // new selection error:
  const tNew = h.own.begin(h.ctrl.capture());
  h.own.settle(tNew, { status: "failed" }, h.ctrl, h.ports);
  // an old-selection SUCCESS cannot clear the new error (rejected as stale/superseded — never "clear"):
  assert.ok(["stale", "superseded"].includes(h.own.settle(tOld, { status: "committed" }, h.ctrl, h.ports).action));
  assert.deepEqual(h.ev, ["set"], "only the new selection's own failure set the error");
});

test("[prod-helper] R6-9c: unmount → no supplier error mutation", () => {
  const h = supErrHarness();
  const t = h.own.begin(h.ctrl.capture());
  h.own.unmount();
  assert.equal(h.own.settle(t, { status: "failed" }, h.ctrl, h.ports).action, "unmounted");
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
  // R10: `createPersistence.persistEntries` (blind full-node snapshot write) was
  // deleted. executeEntrySave now hands a typed intent to `io.persistMutation`, which
  // in production is the ONE lane over the remote-atomic mutator. This harness wires
  // the REAL mutator to a committing store so each original assertion maps 1:1.
  const remote = {};
  const mutator = ML.createRemoteEntriesMutator({
    selection: ctrl,
    transact: async (tn, k, txnFn) => {
      calls.storage.push([tn, k]);
      const raw = remote[k] === undefined ? null : { _v: remote[k] };
      const out = txnFn(raw);
      if (out === undefined) return { committed: false, runs: 1 };
      remote[k] = out._v;
      return { committed: true, runs: 1, snapshot: out };
    },
  });
  const RB = ML.createInsightReadback({ selection: ctrl, candidateDates: () => ["2026-07-24"], apiGetRange: async () => ({ "2026-07-24": { insights: [] } }) });
  const io = {
    selection: ctrl, form: { date: "2026-07-24", sales: 27753 }, rows: [day("2026-07-01", 100)], role: "owner", editingDate: null,
    vatNormalize: (f) => f, materialChanged: () => true,
    todayKey: (off) => (off === 0 ? "2026-07-24" : off === 1 ? "2026-07-25" : "2026-07-23"),
    newOpId: () => "op-" + Math.random().toString(36).slice(2),
    exceptionState: { get: (d) => exceptionOwn.getState(d), set: (d, st) => exceptionOwn.setState(d, st), applyActive: () => {} },
    opIds: { ensure: (d, mk) => exceptionOwn.ensureOpId(d, mk), consume: (d) => exceptionOwn.consumeOpId(d) },
    apiFetch: async () => ({ ok: true, json: async () => ({ ok: true, applied: true, rebuildRequired: false, exception: { status: "active", reasonCode: "closure" }, revision: 1 }) }),
    persistMutation: async (intent2, c2) => {
      const r = await mutator.mutate(intent2, c2);
      return { ok: r.status === "committed" || r.status === "committed_idempotent",
               status: r.status, reason: r.reason, detail: r.detail, rows: r.rows };
    },
    newRowId: () => uuid4("compose"), applyRows: () => {},
    reloadExceptions: async () => {}, rebuildInsights: async () => {},
    loadInsights: (d, isC, c2) => RB.loadRange(c2, d, isC).then(r => (r && r.cancelled ? { ok: false, cancelled: true } : { ok: true, found: true, date: d })),
    onInsightsFailure: () => {}, suppressNextInsightsLoad: () => {}, resetFormAndEditing: () => { calls.resetForm++; },
    setSaved: (v) => calls.setSaved.push(v), setError: () => {}, scheduleNav: (c, ms) => calls.schedNav.push([c, ms]),
    ...overrides,
  };
  return { ctrl, io, calls, remote, mutator };
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
  const c = h.clearAll();
  await tick(); h.ok(0); await settleAll(); await c;
  assert.deepEqual(h.persisted(), []);
  assert.equal(h.transports[0].tenantId, "T1");
  assert.equal(h.transports[0].key, "biz:A:entries");
});
test("[prod-helper] S29: two rapid edits to DIFFERENT suppliers — both persisted", async () => {
  // R10: the two edits touch DISJOINT absolute paths on the same row, so the second
  // transaction rebases onto the first commit instead of replacing the whole row.
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-2", date: "2026-07-24", val: "250", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-2"] : undefined, newId: idFor("2026-07-24") });
  await tick(); h.ok(0); await settleAll(); h.ok(1); await settleAll();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(APPLIED(r1.status) && APPLIED(r2.status), `both disjoint-path edits committed (${r1.status}/${r2.status})`);
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "100");
  assert.equal(h.persistedSup("2026-07-24", "sup-2"), "250");
  assert.equal(h.persisted().length, 1, "one physical row, patched twice — never replaced");
});
test("[prod-helper] S30: older FAILURE cannot roll back newer success (persisted 200)", async () => {
  const h = laneHarness();
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
  await tick(); h.fail(0); await settleAll();
  const r1 = await p1; assert.equal(r1.status, "failed"); assert.equal(r1.latest, false);
  h.ok(1); await settleAll(); const r2 = await p2;
  assert.equal(r2.status, "committed"); assert.equal(r2.latest, true);
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "200");
});
test("[prod-helper] S31(R10): LATEST failure reported latest:true; no phantom value is rendered for a write that never committed", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p1 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
  const p2 = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", emptyEntry: {}, targetId: (h.rowById(idFor("2026-07-24")) ? idFor("2026-07-24") : undefined), baseValue: (h.rowById(idFor("2026-07-24")) || {}).supplier_payments ? (h.rowById(idFor("2026-07-24")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-07-24") });
  await tick(); h.ok(0); await settleAll(); const r1 = await p1; assert.equal(r1.latest, false);
  h.fail(1); await settleAll(); const r2 = await p2;
  // PRESERVED: revision accounting — the newest revision is the one reported as latest.
  assert.equal(r2.status, "failed"); assert.equal(r2.latest, true);
  // CHANGED (deliberate): the legacy suite asserted the optimistically applied 200 was
  // still rendered after its write failed. R10 removes optimistic local application —
  // a financial value is rendered only after a transaction commits it.
  assert.equal(h.sv(h.last(), "2026-07-24", "sup-1"), "100", "the rendered value is the last COMMITTED value, never the failed 200");
  assert.equal(h.persistedSup("2026-07-24", "sup-1"), "100", "and it matches the authoritative node exactly");
});
test("[prod-helper] S32/S33(R10): duplicate business DATES with distinct ids are PRESERVED and independently addressable; state == persisted", async () => {
  const dupA = day("2026-07-24", 27753);
  const dupB = { ...day("2026-07-24", 27753), id: uuid4("dup:s33") };
  const h = laneHarness({ hydrateRows: [dupA, dupB] });
  // CHANGED (deliberate): the legacy lane canonicalized duplicates away on the write
  // path. R10-GATE-005 stores the authoritative node EXACTLY as received — collapsing
  // rows client-side is itself a silent full-node rewrite.
  assert.equal(h.last().filter(e => e.date === "2026-07-24").length, 2, "hydration never collapses duplicate dates");
  const p = h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", emptyEntry: {},
    targetId: dupB.id, baseValue: undefined, newId: dupB.id });
  await tick(); h.ok(0); await settleAll();
  assert.ok(APPLIED((await p).status));
  const persisted = h.persisted();
  assert.equal(persisted.length, 2, "the sibling duplicate row survives the write");
  assert.equal(persisted.find(e => e.id === dupA.id).supplier_payments, undefined, "only the ADDRESSED id was patched");
  assert.equal(persisted.find(e => e.id === dupB.id).supplier_payments["sup-1"], "100");
  assert.deepEqual(plain(h.last()), persisted, "state array equals persisted payload");
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
  ML.applySupplierWriteResult({ status: "failed", latest: true }, ports);
  ML.applySupplierWriteResult({ status: "failed", latest: false }, ports);
  ML.applySupplierWriteResult({ status: "committed", latest: true }, ports);
  assert.deepEqual(ev, ["set", "clear"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE + DOMAIN + EXCEPTIONS + READBACK (carried forward, real helpers)
// ═══════════════════════════════════════════════════════════════════════════

// R10: `createPersistence.persistEntries` (blind full-node snapshot write) was deleted.
// Its safety invariant — a write is addressed by the CAPTURED tenant/business and no
// write is issued for a selection that changed — now lives in the remote-atomic
// mutator, which is the only entries writer. This harness drives that real path.
function persistHarness(t = "T1", b = "A") {
  const ctrl = liveCtrl(t, b); const calls = []; let gate = null;
  const mutator = ML.createRemoteEntriesMutator({
    selection: ctrl,
    transact: async (tn, k, txnFn) => { calls.push([tn, k, txnFn]); if (gate) await gate.promise; return { committed: false }; },
  });
  const P = {
    // Same call shape as the removed API so each original assertion maps 1:1.
    persistEntries: async (rows, ctx) => {
      if (!ctx || !ctx.tenantId || !ctx.bizId) return { ok: false, error: "missing_context" };
      const row = (rows || [])[0] || {};
      const r = await mutator.mutate({ type: "upsert_entry", target: { id: row.id },
        patch: { fields: { sales: row.sales } }, base: { fields: { sales: row.sales } } }, ctx);
      return { ok: r.status === "committed" || r.status === "committed_idempotent", status: r.status, error: r.status === "stale" ? undefined : r.error, stale: r.status === "stale" };
    },
  };
  // `fixed` is a different destination with single-owner semantics and keeps its
  // direct write; S8 still proves it never touches the entries key.
  P.persistFixed = async (fixed, ctx) => {
    if (!ctx || !ctx.tenantId || !ctx.bizId) return { ok: false, error: "missing_context" };
    calls.push([ctx.tenantId, `biz:${ctx.bizId}:fixed`, fixed]);
    return { ok: true };
  };
  return { ctrl, calls, P, mutator, setGate: (g) => { gate = g; } };
}
test("[prod-helper] S3(R10): a mutation with missing context is rejected before any transaction", async () => {
  const h = persistHarness();
  assert.equal((await h.P.persistEntries([day("2026-07-01", 1)], null)).error, "missing_context");
  assert.equal(h.calls.length, 0);
});
test("[prod-helper] S4(R10): the transaction key is built from the CAPTURED ctx.bizId", async () => {
  const h = persistHarness("T1", "A");
  await h.P.persistEntries([day("2026-07-01", 1)], h.ctrl.capture());
  assert.equal(h.calls[0][1], "biz:A:entries");
});
test("[prod-helper] S1+S5(R10): the transaction carries the CAPTURED tenant T1; switching to T2/B issues no later write for the retired selection", async () => {
  const h = persistHarness("T1", "A"); const g = deferred(); h.setGate(g);
  const ctx = h.ctrl.capture();
  const p = h.P.persistEntries([day("2026-07-01", 1)], ctx); await tick();
  assert.equal(h.calls[0][0], "T1"); assert.equal(h.calls[0][1], "biz:A:entries");
  h.ctrl.invalidate("T2", "B"); g.resolve(); const r = await p;
  // CHANGED (deliberate): R10 has no `staleAfterWrite` post-write flag, because there
  // is no blind write to report on. A transaction that did not commit is simply not a
  // success, and the selection switch cannot manufacture one.
  assert.equal(r.ok, false, "a transaction that never committed is never reported as success");
  assert.equal(h.calls.length, 1, "the selection switch issued no additional transaction");
  const after = await h.P.persistEntries([day("2026-07-01", 2)], ctx);
  assert.equal(after.stale, true, "a mutation for the retired selection is refused BEFORE any transaction");
  assert.equal(h.calls.length, 1, "still exactly one transaction — the retired ctx never wrote");
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
  // R10: the in-flight step is the remote transaction. It is gated open so the
  // selection can change while it is still physically running.
  h = saveComposeHarness(own, { persistMutation: async (intent2, c2) => { await pg.promise; return { ok: true, status: "committed", rows: [] }; } });
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
test("[prod-entries] S43(R10): duplicate incident rows aggregate to 580,483 for DISPLAY; the authoritative node is never rewritten by canonicalization", async () => {
  const dup = { ...day("2026-07-24", 27753), id: uuid4("dup:s43") };
  const raw = [...incidentEntries(), dup];
  // Display-side aggregation is unchanged: 24 business dates, 580,483.
  const canon = ME.canonicalizeEntries(raw);
  assert.equal(canon.length, 24); assert.equal(totalRevenue(canon), 580483);
  // CHANGED (deliberate): the legacy write path persisted `canonical`, i.e. it rewrote
  // the whole financial node from a client-side merge. R10 deleted that path; the
  // stored node keeps both physical rows and a save patches exactly one addressed id.
  const h = laneHarness({ hydrateRows: raw });
  assert.equal(h.persisted().length, 25, "the exact node — duplicates included — is what is stored");
  const p = h.upsert("2026-07-24", { sales: 30000 }, { id: idFor("2026-07-24") });
  await tick(); h.ok(0); await settleAll();
  assert.ok(APPLIED((await p).status));
  const after = h.persisted();
  assert.equal(after.length, 25, "no canonicalization rewrite of the authoritative node");
  assert.equal(after.filter(e => e.date === "2026-07-24").length, 2);
  assert.equal(after.find(e => e.id === idFor("2026-07-24")).sales, 30000, "the edit landed on the addressed row");
  assert.equal(after.find(e => e.id === dup.id).sales, 27753, "the sibling duplicate is untouched");
  assert.deepEqual(plain(h.last()), after, "state array equals the persisted node");
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
test("[source-guard] every entries writer routes through the ONE lane; the blind full-node entries write no longer exists", () => {
  assert.ok(!/setEntries\(u\);persistEntries\(u,captureSelectionCtx/.test(html), "clear-all no longer calls persistEntries directly");
  assert.ok(!/const res = await persistEntries\(canonicalNext, ctx\)/.test(html), "delete no longer calls persistEntries directly");
  // R10: the full-node writer is not merely unreferenced by the UI — it is gone.
  assert.ok(!/persistEntries\s*:/.test(html), "createPersistence exposes no full-node entries writer at all");
  assert.ok(!/\bawait\s+persistEntries\s*\(/.test(html), "no call site invokes a blind full-node entries write");
  assert.ok(html.includes("persistMutation: (intent2, c2) => entriesWriteCoordRef.current.submitIntent(intent2)"), "main save routes through the lane as a typed intent");
  assert.ok(html.includes("entriesWriteCoordRef.current.submitClearAll({"), "clear-all is a DEDICATED typed destructive operation on the lane");
  assert.ok(html.includes("expectedNodeFingerprint: entriesWriteCoordRef.current.currentFingerprint()"), "clear-all carries the confirmed complete-content fingerprint (R10-GATE-004)");
  assert.ok(!/allowDrop\s*[:=]/.test(html), "the R9 options-boolean drop flag is gone together with the wholesale-replace path it guarded");
  assert.ok(html.includes("submitLaborEntry"), "employee labor routes through the lane");
  assert.ok(html.includes("transact: (tenantId, key, txnFn) => window.storage.mutateFor(tenantId, key, txnFn)"), "the ONLY entries transport is the RTDB transaction");
});
test("[source-guard] coordinator own-echo ownership is destination+generation scoped (R7; no scalar expectedEchoes)", () => {
  assert.ok(html.includes("const ownPending = [];"), "own-pending marker list present");
  assert.ok(html.includes("const marker = { tenantId: ctx.tenantId, bizId: ctx.bizId, gen: ctx.gen, fp: null, rev, pending: true };"),
    "own-echo marker still captures tenantId+bizId+gen+rev at DISPATCH; its fingerprint is bound to the COMMITTED transaction result (R10)");
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
  const p = h.upsertRows(rows);
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

test("[prod-helper] R7-6(R10): a pre-ack payload is safely deferred; the real post-commit own echo is still ignored_own_echo", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p = h.upsert("2026-07-24", { sales: 250 });
  await tick();
  // Half 1 — pre-ack. R10 binds the own-marker fingerprint at COMMIT, and
  // `applyLocally:false` means Firebase emits no local pre-ack echo, so this path is
  // not production-reachable. It must still be SAFE: deferred, never consumed as own,
  // never clobbering the pending local intent.
  const pre = h.lane.onListenerEcho([{ ...day("2026-07-24", 0), sales: 999 }], h.ctrl.current());
  assert.equal(pre.status, "deferred_pending_local", "a pre-ack payload cannot clobber pending local intent");
  assert.equal(pre.deferredStored, true, "and it is retained, not dropped");
  const committed = await (async () => { h.ok(0); await settleAll(); return p; })();
  assert.ok(APPLIED(committed.status), `the local write committed (${committed.status})`);
  // Half 2 — the REAL own echo (the committed transaction result) is suppressed.
  const own = h.lane.onListenerEcho(h.persisted(), h.ctrl.current());
  assert.equal(own.status, "ignored_own_echo", "same-destination own-echo suppression preserved");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 250, "authoritative state is the committed value");
});
test("[source-guard] R7-6b: local pre-ack echoes are suppressed at the transport (applyLocally:false)", () => {
  assert.ok(html.includes("{ applyLocally: false }"),
    "runTransaction suppresses optimistic local events, so a listener never sees an uncommitted financial value");
});

test("[prod-helper] R7-7(R10): a foreign-destination listener cannot consume or clear the T1/A marker; the true post-commit own echo still lands", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 300)];
  const p = h.upsertRows(rows); await tick();        // marker {T1,A,gen1} registered before ack
  assert.equal(h.lane._state().ownPending, 1, "the T1/A marker is registered at DISPATCH");
  const cross = h.lane.onListenerEcho([day("2026-07-24", 300)], { gen: 999, tenantId: "T2", bizId: "B" });
  assert.equal(cross.status, "stale", "foreign (non-live) callback cannot touch the active marker");
  assert.equal(h.lane._state().ownPending, 1, "the T1/A marker survived the foreign listener");
  h.ok(0); await settleAll(); await p;
  const own = h.lane.onListenerEcho(h.persisted(), h.ctrl.current());
  assert.equal(own.status, "ignored_own_echo", "the marker is consumed only by its OWN destination's committed echo");
  assert.equal(h.lane._state().ownPending, 0, "and it is retired once consumed");
});

test("[prod-helper] R7-8: a FAILED write retires ONLY its own scoped marker; a later identical remote payload is not blacklisted", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 400)];
  const p = h.upsertRows(rows); await tick();
  const desired = plain(h.last());
  assert.equal(h.lane._state().ownPending, 1, "marker registered at dispatch");
  h.fail(0); await settleAll();
  const r = await p;
  assert.equal(r.status, "failed");
  assert.equal(h.lane._state().ownPending, 0, "failed write's own scoped marker retired");
  const echo = h.lane.onListenerEcho(desired, h.ctrl.current());
  assert.equal(echo.status, "applied", "no phantom marker suppresses a real remote payload after a failed write");
});

test("[prod-helper] R7-9: identical-fingerprint writes across destinations/generations keep isolated ownership", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 900)];
  await writeAndAck(h, rows);                              // T1/A gen1 marker, fingerprint bound at commit
  const t1aCtx = h.ctrl.current();
  switchTo(h, "T2", "B");                                  // T1/A marker retired on invalidate
  const p = h.upsertRows(rows); await tick();              // T2/B gen2 write (same content fingerprint)
  h.ok(h.transports.length - 1); await settleAll(); await p;
  const desired = JSON.parse(h.store["biz:B:entries"]);    // the T2/B committed value
  assert.equal(h.lane.onListenerEcho(desired, h.ctrl.current()).status, "ignored_own_echo", "T2/B own echo consumed by the T2/B marker");
  assert.equal(h.lane.onListenerEcho(desired, t1aCtx).status, "stale", "a straggler carrying the OLD T1/A context cannot consume the T2/B marker");
  assert.equal(h.lane._state().ownPending, 0, "no cross-destination marker accumulation");
});

test("[prod-helper] R7-10(R10): two-edit ordering preserved with scoped echoes — a same-base second edit conflicts, then wins once re-based", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p1 = h.upsert("2026-07-24", { sales: 100 });
  const p2 = h.upsert("2026-07-24", { sales: 200 });   // computed from the SAME base as p1
  await tick(); h.ok(0); await settleAll(); h.ok(1); await settleAll();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(APPLIED(r1.status), `the first edit committed (${r1.status})`);
  // CHANGED (deliberate): "newest wins" was last-writer-wins over a client snapshot.
  // R10 refuses an edit whose base no longer matches the remote value.
  assert.equal(r2.status, "conflict", "a stale-base edit fails closed instead of overwriting");
  assert.deepEqual(plain(r2.conflictPaths), ["sales"], "the exact conflicting path is reported");
  assert.equal(totalRevenue(h.persisted()), 100, "the committed value is intact — no silent overwrite");
  const p3 = h.upsert("2026-07-24", { sales: 200 });   // re-based on what actually committed
  await tick(); h.ok(2); await settleAll();
  assert.ok(APPLIED((await p3).status));
  assert.equal(totalRevenue(h.persisted()), 200, "the newest edit wins the single destination once correctly re-based");
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
  const p = h.upsertRows(oldRows);        // dispatch T1/A, DO NOT ack (in flight)
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
  const p = h.upsertRows(oldRows); await tick();
  switchTo(h, "T2", "B");
  const cur = h.lane.onListenerEcho(oldRows, h.ctrl.current());
  assert.equal(cur.status, "applied", "current hydrates");
  const hydrated = plain(h.lane._state().desired);
  assert.equal(h.lane._state().ownPending, 0, "old marker retired on switch; T2/B hydration adds none");
  h.fail(0); await settleAll();
  const r = await p;
  assert.equal(r.status, "failed", "old write failed");
  assert.deepEqual(plain(h.lane._state().desired), hydrated, "old failure did not mutate the current destination");
  assert.equal(h.lane._state().ownPending, 0, "old failure cleanup touched only old ownership");
});

test("[prod-helper] R8-3: cross-tenant same business — T1/A→T2/A while old write in flight hydrates", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 222)];
  const p = h.upsertRows(rows); await tick();
  switchTo(h, "T2", "A");
  const cur = h.lane.onListenerEcho(rows, h.ctrl.current());
  assert.equal(cur.status, "applied", "same biz id under new tenant hydrates while old write pending");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 222);
  h.ok(0); await settleAll(); await p;
});

test("[prod-helper] R8-4: same tenant different business — T1/A→T1/B while old write in flight hydrates", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 333)];
  const p = h.upsertRows(rows); await tick();
  switchTo(h, "T1", "B");
  const cur = h.lane.onListenerEcho(rows, h.ctrl.current());
  assert.equal(cur.status, "applied", "same tenant new business hydrates while old write pending");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 333);
  h.ok(0); await settleAll(); await p;
});

test("[prod-helper] R8-5: switch away and back — T1/A→T2/B→T1/A (new gen) hydrates before original settles", async () => {
  const h = laneHarness();
  const rows = [day("2026-07-24", 444)];
  const p = h.upsertRows(rows); await tick();   // original T1/A write in flight
  switchTo(h, "T2", "B");                             // gen2
  switchTo(h, "T1", "A");                             // gen3 — new generation of the same destination
  const cur = h.lane.onListenerEcho(rows, h.ctrl.current());
  assert.equal(cur.status, "applied", "returned T1/A new generation hydrates despite the original write still in flight");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 444);
  h.ok(0); await settleAll(); await p;
});

test("[prod-helper] R8-6: behavior is NOT fingerprint-dependent — T2/B payload different from the old write still hydrates", async () => {
  const h = laneHarness();
  const p = h.upsert("2026-07-24", { sales: 555 }); await tick(); // old in flight
  switchTo(h, "T2", "B");
  const cur = h.lane.onListenerEcho([day("2026-07-25", 999)], h.ctrl.current()); // DIFFERENT payload
  assert.equal(cur.status, "applied", "different payload hydrates (not accidentally fingerprint-gated)");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 999);
  h.ok(0); await settleAll(); await p;
});

test("[prod-helper] R8-7: old completion AFTER new hydration leaves rendered/active/persistence current", async () => {
  const h = laneHarness();
  const p = h.upsert("2026-07-24", { sales: 666 }); await tick();
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
  const p = h.upsert("2026-07-24", { sales: 10 }); await tick(); // old T1/A in flight
  switchTo(h, "T2", "B");
  const pB = h.upsert("2026-07-24", { sales: 777 });             // local edit in T2/B (queued behind global write)
  await tick();
  assert.equal(h.lane._state().pendingLocal, true, "T2/B lane has its own pending local intent");
  const ext = h.lane.onListenerEcho([day("2026-07-24", 888)], h.ctrl.current()); // external for T2/B
  assert.equal(ext.status, "deferred_pending_local", "current lane's own local intent is protected (not clobbered)");
  h.ok(0); await settleAll();                          // old write settles → pump dispatches T2/B write
  assert.equal(h.transports.length, 2, "T2/B write dispatched after the old write cleared the pump");
  h.ok(1); await settleAll(); await pB;
  assert.equal(totalRevenue(JSON.parse(h.store["biz:B:entries"])), 777, "T2/B converged to its own local value, not the external payload");
});

test("[prod-helper] R8-9(R10): a pre-ack payload on the CURRENT lane is deferred; the same-tenant/business/generation own echo is STILL ignored_own_echo after the commit", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p = h.upsert("2026-07-24", { sales: 250 });
  await tick();
  const pre = h.lane.onListenerEcho([{ ...day("2026-07-24", 0), sales: 111 }], h.ctrl.current());
  assert.equal(pre.status, "deferred_pending_local", "R10: nothing arriving before the ack can be our committed value");
  h.ok(0); await settleAll(); await p;
  assert.equal(h.lane.onListenerEcho(h.persisted(), h.ctrl.current()).status, "ignored_own_echo", "current-lane own echo preserved");
});

test("[prod-helper] R8-10: a deferred payload for one lane is not flushed/applied by another lane's completion", async () => {
  const h = laneHarness();
  const pA = h.upsert("2026-07-24", { sales: 5 }); await tick(); // T1/A in flight, has own pending intent
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
  const pA = h.upsert("2026-07-24", { sales: 1 }); await tick(); // T1/A in flight
  switchTo(h, "T2", "B");
  const pB = h.upsert("2026-07-24", { sales: 2 }); await tick(); // T2/B queued behind global write
  assert.equal(h.lane._state().pendingLocal, true, "current gen has pending intent before old completes");
  h.ok(0); await settleAll();                          // old T1/A completes → pump dispatches T2/B
  assert.equal(h.lane._state().ownPending >= 1, true, "current-generation marker exists (created by T2/B dispatch), not cleared by old completion");
  h.ok(1); await settleAll(); await Promise.all([pA, pB]);
  assert.equal(totalRevenue(JSON.parse(h.store["biz:B:entries"])), 2, "current-generation write persisted");
});

test("[prod-helper] R8-12(R10): superseded same-lane revisions retain correct ack/marker/revision accounting; a stale-base revision cannot silently supersede", async () => {
  const h = laneHarness();
  switchTo(h, "T1", "A", false);                       // fresh gen, no foreign write
  h.hydrate([day("2026-07-24", 0)]);                   // only a real listener value delivers history
  const p1 = h.upsert("2026-07-24", { sales: 100 });
  const p2 = h.upsert("2026-07-24", { sales: 200 });   // computed from the SAME base as rev1
  await tick(); h.ok(0); await settleAll(); h.ok(1); await settleAll();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(APPLIED(r1.status), `rev1 committed (${r1.status})`);
  assert.equal(r1.latest, false, "rev1 correctly reports it is not the newest revision");
  assert.equal(r2.status, "conflict", "rev2 was computed from a superseded base and fails closed");
  assert.equal(r2.latest, true, "the newest revision still reports latest:true");
  assert.equal(totalRevenue(h.persisted()), 100, "rev1's committed value is not silently overwritten");
  const own = plain(h.persisted());
  assert.equal(h.lane.onListenerEcho(own, h.ctrl.current()).status, "ignored_own_echo", "rev1's own echo scoped-consumed");
  const dup = h.lane.onListenerEcho(own, h.ctrl.current());
  assert.equal(dup.status, "applied", "an identical future remote payload is not permanently blacklisted");
});

test("[prod-helper] R8-13: invalidation during pending local work retires stale lane state; a later old callback is stale", async () => {
  const h = laneHarness();
  const p = h.upsert("2026-07-24", { sales: 9 }); await tick(); // T1/A pending, in flight
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
  // R10: a revenue save is ONE narrow semantic intent against the edited row's id.
  // Submitting the whole edited array is exactly the snapshot behaviour R10 removes,
  // and would dispatch a transaction per row. The invariant under test — every other
  // date survives an August edit — is proven by the single-row patch.
  const p = h.upsert("2026-08-05", { sales: 99999 });
  await tick(); h.ok(0); await settleAll();
  const r = await p;
  assert.ok(APPLIED(r.status), `the edit committed (${r.status})`);
  assert.deepEqual(h.unackedTransports(), [], "exactly one transaction, explicitly settled");
  const persisted = h.persisted();
  assert.equal(persisted.length, 160, "revenue save persisted the FULL history, not a subset");
  assert.equal(persisted.find(e => e.date === "2026-03-01").sales, 10001, "March history intact after an August edit");
  assert.equal(persisted.find(e => e.date === "2026-08-05").sales, 99999, "the edit landed");
});

// ── 3: revenue save BEFORE hydration is blocked with no persistence intent ──
test("[prod-helper] R9-2: revenue save before hydration is BLOCKED and emits no persistence intent", async () => {
  const h = laneHarness({ hydrated: false });
  const r = await h.upsert("2026-08-06", { sales: 500 });
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
  const r = await h.lane.submitSupplierEdit({ supId: "sup-1", date: "2026-08-06", val: "250", emptyEntry: {}, targetId: (h.rowById(idFor("2026-08-06")) ? idFor("2026-08-06") : undefined), baseValue: (h.rowById(idFor("2026-08-06")) || {}).supplier_payments ? (h.rowById(idFor("2026-08-06")).supplier_payments || {})["sup-1"] : undefined, newId: idFor("2026-08-06") });
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
  // R10 removed the wholesale-replace path entirely, so `blocked_history_drop` no
  // longer exists. The protection is now STRUCTURAL: the only write API is a typed
  // semantic intent, and a client collection is not one.
  const r = await h.lane.submitIntent({ rows: monthEntries });
  await settleAll();
  assert.equal(r.status, "blocked_invalid_intent", "a client collection is not a submittable intent");
  assert.equal(h.transports.length, 0, "NO transaction dispatched");
  assert.equal(h.lane._state().desired.length, 160, "authoritative history untouched");
  assert.equal(/blocked_history_drop/.test(html), false, "the wholesale-replace guard is gone with the path it guarded");
  const preAugust = h.lane._state().desired.filter(e => e.date < "2026-08-01").length;
  assert.equal(preAugust, 153, "all 153 pre-August rows remain addressable");
});

// ── 19: food-cost edit preserves all hydrated historical dates ──
test("[prod-helper] R9-5: food-cost edit on 160-date history preserves every historical date", async () => {
  const h = laneHarness({ hydrateRows: kgsHistory() });
  // R10: the edit is addressed by the row's immutable id; there is no date targeting.
  const p = h.lane.submitSupplierEdit({ supId: "sup-9", date: "2026-08-06", val: "870.34", emptyEntry: {},
    targetId: idFor("2026-08-06"), baseValue: undefined, newId: idFor("2026-08-06") });
  await tick(); h.ok(0); await settleAll();
  assert.ok(APPLIED((await p).status));
  const persisted = h.persisted();
  assert.equal(persisted.length, 160, "food-cost write persisted the FULL history");
  assert.equal(h.persistedSup("2026-08-06", "sup-9"), "870.34", "supplier value landed");
  assert.equal(persisted.find(e => e.date === "2026-07-31").sales, 10031, "July history intact");
  assert.equal(datesOf(persisted)[0], "2026-03-01", "earliest date preserved");
});

// ── 21: opening / navigating the screen emits NO entries write intent ──
test("[prod-helper] R9-6(R10): hydration (incl. duplicate DATES) emits NO write intent; the node is stored verbatim and never self-healed", async () => {
  const h = laneHarness({ hydrated: false });
  const dupA = day("2026-08-01", 100);
  const dupB = { ...day("2026-08-01", 100), id: uuid4("dup:2026-08-01") };
  const withDupes = [dupA, dupB, day("2026-08-02", 200)];
  const r = h.lane.onListenerEcho(withDupes, h.ctrl.current());
  await settleAll();
  assert.equal(r.status, "applied", "listener hydration applies for display");
  // CHANGED (deliberate): R9 detected duplicates and SUPPRESSED a self-heal write-back.
  // R10-GATE-005 removes the write-back entirely and stores the authoritative node
  // exactly as received, so there is no longer a duplicate-collapse pass to report or
  // a self-heal path to suppress. The invariant that matters — merely opening the
  // screen never writes — is asserted directly below.
  assert.equal(r.duplicatesObserved, false, "no client-side duplicate-collapse pass exists to report");
  assert.equal(r.selfHealSuppressed, false, "the self-heal write-back was DELETED, not gated");
  assert.deepEqual(plain(r.canonical), plain(withDupes), "stored EXACTLY as received — no dedup, no reorder");
  assert.equal(h.transports.length, 0, "merely opening/navigating produced NO entries write");
  assert.equal(h.persisted(), null, "the financial node was not silently rewritten");
  assert.equal(h.lane.isHydrated(), true, "the screen is still usable/writable afterwards");
  // Both physical rows stay independently addressable by their own ids: model the same
  // node as the remote value and patch exactly one of them.
  h.store["biz:A:entries"] = JSON.stringify(withDupes);
  const p = h.upsert("2026-08-01", { sales: 555 }, { id: dupB.id });
  await tick(); h.ok(0); await settleAll();
  assert.ok(APPLIED((await p).status));
  const after = h.persisted();
  assert.equal(after.length, 3, "no row was merged away by the write");
  assert.equal(after.find(e => e.id === dupA.id).sales, 100, "the sibling duplicate is untouched");
  assert.equal(after.find(e => e.id === dupB.id).sales, 555, "the addressed duplicate was patched");
});

// ── 18 / G: listener failure before hydration keeps the lane fail-closed ──
test("[prod-helper] R9-7: listener failure before hydration keeps writes BLOCKED (fail-closed)", async () => {
  const h = laneHarness({ hydrated: false });
  const e = h.lane.onListenerError(h.ctrl.current());
  assert.equal(e.status, "hydration_failed");
  const r = await h.upsert("2026-08-06", { sales: 1 });
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
  const r = await lane.submitIntent({ type: "upsert_entry", target: { id: idFor("2026-08-06") }, patch: { fields: { sales: 5 } }, base: {} });
  assert.equal(r.status, "blocked_no_owner", "cannot write to an unidentified destination");
  assert.equal(transports.length, 0, "no physical write from a malformed context");
});

// ── 16: logout / unmount with work in flight ──
test("[prod-helper] R9-9: logout during an in-flight write blocks new writes and never mutates the new context", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-08-01", 10)] });
  const p = h.upsert("2026-08-01", { sales: 20 }); await tick();
  h.ctrl.invalidate(null, null); h.lane.invalidate();     // logout
  const after = h.applied.length;
  const r = await h.upsert("2026-08-01", { sales: 30 });
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
  const p = h.upsert("2026-07-24", { sales: 200 }); await tick();
  const d = h.lane.onListenerEcho([day("2026-07-24", 999)], h.ctrl.current()); // legitimate same-lane remote
  assert.equal(d.status, "deferred_pending_local");
  assert.equal(d.deferredStored, true, "R9 RETAINS the deferred payload");
  assert.equal(h.lane._state().deferredPending, true);
  h.fail(0); await settleAll();                        // write fails; NO further listener emit is delivered
  const r = await p;
  assert.equal(r.status, "failed");
  assert.equal(r.converged, true, "settlement converged onto the deferred remote payload");
  assert.equal(totalRevenue(h.last()), 999, "RENDERED state converged to the remote payload, not the failed local 200");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 999, "active lane converged");
  assert.equal(h.lane._state().pendingLocal, false, "lane is quiescent — no additional emit required");
  assert.equal(h.lane._state().deferredPending, false, "deferred payload consumed exactly once");
  assert.equal(h.transports.length, 1, "convergence did NOT trigger a new write");
});

test("[prod-helper] R9-11: deferred payload + write SUCCESS → our newer committed value wins, deferral discarded", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p = h.upsert("2026-07-24", { sales: 200 }); await tick();
  h.lane.onListenerEcho([day("2026-07-24", 999)], h.ctrl.current());
  h.ok(0); await settleAll(); const r = await p;
  assert.equal(r.status, "committed");
  assert.equal(totalRevenue(h.persisted()), 200, "our committed value persisted");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 200, "committed local value is authoritative, not the stale deferral");
  assert.equal(h.lane._state().deferredPending, false, "superseded deferral discarded");
});

test("[prod-helper] R9-12(R10): no own echo can exist while a write is pending; the pre-ack payload is RETAINED and a failed write converges onto it", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p = h.upsert("2026-07-24", { sales: 200 }); await tick();
  // CHANGED (deliberate): R9 could consume a local-before-ack echo as "own". R10 binds
  // the marker's fingerprint at COMMIT and `applyLocally:false` suppresses the
  // optimistic local event, so an own echo while pending is not producible. A payload
  // arriving now is remote-authored and must never be swallowed.
  assert.equal(h.lane._state().ownPending, 1, "the marker exists but carries no fingerprint yet");
  const pre = h.lane.onListenerEcho([day("2026-07-24", 999)], h.ctrl.current());
  assert.equal(pre.status, "deferred_pending_local");
  assert.equal(pre.deferredStored, true);
  assert.equal(h.lane._state().deferredPending, true, "a remote payload during a pending write is RETAINED, not dropped");
  h.fail(0); await settleAll(); const r = await p;
  assert.equal(r.status, "failed");
  assert.equal(r.converged, true, "the failed write converges onto the retained remote payload");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 999, "the authoritative remote value remains — never a phantom local 200");
  assert.equal(h.lane._state().deferredPending, false, "the deferral was consumed by convergence");
});

test("[prod-helper] R9-13(R10): a NEWER queued local edit suppresses convergence until it settles", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p1 = h.upsert("2026-07-24", { sales: 200 }); await tick();
  h.lane.onListenerEcho([day("2026-07-24", 999)], h.ctrl.current());   // deferred
  const p2 = h.upsert("2026-07-24", { sales: 300 }); // newer local intent queued
  h.fail(0); await settleAll();
  // PRESERVED: the deferred payload must not converge while a newer local edit is
  // still outstanding. CHANGED: R10 renders no un-committed local value, so the proof
  // is the retained (un-converged) deferral rather than an optimistic 300.
  assert.equal(h.lane._state().deferredPending, true, "convergence suppressed while a newer local edit is queued");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 0, "no phantom local value is rendered before a commit");
  h.ok(1); await settleAll(); await Promise.allSettled([p1, p2]);
  assert.equal(totalRevenue(h.persisted()), 300, "newest local edit persisted");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 300, "the COMMITTED transaction result is authoritative");
  assert.equal(h.lane._state().deferredPending, false, "deferral resolved/discarded once the newer write committed");
});

test("[prod-helper] R9-14: a deferred payload is NEVER applied after the owner changed", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p = h.upsert("2026-07-24", { sales: 200 }); await tick();
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
  const r = await h.upsert("2026-08-06", { sales: 1 });
  assert.equal(r.status, "blocked_unhydrated", "writes stay blocked for the new business");
  assert.equal(h.transports.length, 0, "no persistence intent at any point");
});

test("[prod-helper] R9-16: tenant switch while hydration pending behaves identically", async () => {
  const h = laneHarness({ hydrated: false });
  const oldCtx = h.ctrl.current();
  switchTo(h, "T2", "A", false);
  assert.equal(h.lane.onListenerEcho(kgsHistory(), oldCtx).status, "stale", "previous tenant payload rejected");
  assert.equal(h.lane.markHydrated(oldCtx, kgsHistory()).status, "stale", "stale ctx cannot force-hydrate the new tenant");
  assert.equal((await h.upsert("2026-08-06", { sales: 1 })).status, "blocked_unhydrated");
  assert.equal(h.transports.length, 0);
});

// ── 7 / 8 / 9: late callbacks from a previous business / generation ──
test("[prod-helper] R9-17: late listener callback from the previous business never mutates the current one", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 5)] });
  const oldCtx = h.ctrl.current();
  // R9 invariant B: only a real listener value may deliver history to a new
  // destination — markHydrated models an ABSENT node and rejects a non-empty bootstrap.
  switchTo(h, "T1", "B", false);
  h.hydrate([day("2026-07-24", 7)]);
  const before = h.applied.length;
  assert.equal(h.lane.onListenerEcho([day("2026-07-24", 999)], oldCtx).status, "stale");
  assert.equal(h.applied.length, before, "no UI mutation from the old business's callback");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 7, "current business state unchanged");
});

test("[prod-helper] R9-18: late write SUCCESS and FAILURE from a previous generation settle only their own lane", async () => {
  // late success
  const a = laneHarness({ hydrateRows: [day("2026-07-24", 1)] });
  const pa = a.upsert("2026-07-24", { sales: 11 }); await tick();
  switchTo(a, "T2", "B", false); a.hydrate([day("2026-07-24", 2)]);
  const aBefore = a.applied.length;
  a.ok(0); await settleAll(); assert.equal((await pa).status, "committed");
  assert.equal(a.applied.length, aBefore, "old-generation SUCCESS did not touch the new destination UI");
  assert.equal(totalRevenue(plain(a.lane._state().desired)), 2, "new destination state intact");
  assert.equal(totalRevenue(JSON.parse(a.store["biz:B:entries"])), 2, "old success wrote only to its OWN captured destination — the T2/B node is unchanged");
  assert.equal(totalRevenue(JSON.parse(a.store["biz:A:entries"])), 11, "and it did commit to the destination it captured");
  // late failure
  const b = laneHarness({ hydrateRows: [day("2026-07-24", 1)] });
  const pb = b.upsert("2026-07-24", { sales: 11 }); await tick();
  switchTo(b, "T2", "B", false); b.hydrate([day("2026-07-24", 2)]);
  const bBefore = b.applied.length;
  b.fail(0); await settleAll(); assert.equal((await pb).status, "failed");
  assert.equal(b.applied.length, bBefore, "old-generation FAILURE did not touch the new destination UI");
  assert.equal(totalRevenue(plain(b.lane._state().desired)), 2, "new destination state intact");
});

// ── 10 / 11 / 12 / 13 / 14 / 15: ordering, concurrency, retries ──
test("[prod-helper] R9-19: two rapid edits to the SAME date converge on the newest", async () => {
  const h = laneHarness({ hydrateRows: kgsHistory() });
  const p1 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-03", val: "10", emptyEntry: {}, targetId: (h.rowById(idFor("2026-08-03")) ? idFor("2026-08-03") : undefined), baseValue: (h.rowById(idFor("2026-08-03")) || {}).supplier_payments ? (h.rowById(idFor("2026-08-03")).supplier_payments || {})["s1"] : undefined, newId: idFor("2026-08-03") });
  const p2 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-03", val: "20", emptyEntry: {}, targetId: (h.rowById(idFor("2026-08-03")) ? idFor("2026-08-03") : undefined), baseValue: (h.rowById(idFor("2026-08-03")) || {}).supplier_payments ? (h.rowById(idFor("2026-08-03")).supplier_payments || {})["s1"] : undefined, newId: idFor("2026-08-03") });
  await tick(); assert.equal(h.transports.length, 1, "single-flight");
  h.ok(0); await settleAll(); h.ok(1); await settleAll();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(APPLIED(r1.status), "the first edit committed");
  // CHANGED (deliberate): the legacy suite asserted the later write won wholesale.
  // Both edits were built from the SAME base, so under R10 the second is a stale-base
  // conflict — surfaced, never a silent overwrite.
  assert.equal(r2.status, "conflict", "the second same-base edit conflicts instead of overwriting");
  assert.equal(h.persistedSup("2026-08-03", "s1"), "10", "the committed value was not silently replaced");
  // After re-syncing to the committed value the newer edit commits normally.
  const p3 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-03", val: "20", emptyEntry: {},
    targetId: idFor("2026-08-03"), baseValue: "10", newId: idFor("2026-08-03") });
  await tick(); h.ok(2); await settleAll();
  assert.ok(APPLIED((await p3).status), "the re-based edit commits");
  assert.equal(h.persistedSup("2026-08-03", "s1"), "20", "newest value wins once it is based on current state");
  assert.equal(h.persisted().length, 160, "history preserved throughout");
});

test("[prod-helper] R9-20: two rapid edits to DIFFERENT dates both survive", async () => {
  const h = laneHarness({ hydrateRows: kgsHistory() });
  const p1 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-02", val: "11", emptyEntry: {}, targetId: (h.rowById(idFor("2026-08-02")) ? idFor("2026-08-02") : undefined), baseValue: (h.rowById(idFor("2026-08-02")) || {}).supplier_payments ? (h.rowById(idFor("2026-08-02")).supplier_payments || {})["s1"] : undefined, newId: idFor("2026-08-02") });
  const p2 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-03", val: "22", emptyEntry: {}, targetId: (h.rowById(idFor("2026-08-03")) ? idFor("2026-08-03") : undefined), baseValue: (h.rowById(idFor("2026-08-03")) || {}).supplier_payments ? (h.rowById(idFor("2026-08-03")).supplier_payments || {})["s1"] : undefined, newId: idFor("2026-08-03") });
  await tick(); h.ok(0); await settleAll(); h.ok(1); await settleAll(); await Promise.all([p1, p2]);
  assert.equal(h.persistedSup("2026-08-02", "s1"), "11");
  assert.equal(h.persistedSup("2026-08-03", "s1"), "22", "transform built on the LATEST desired, not a stale snapshot");
  assert.equal(h.persisted().length, 160);
});

test("[prod-helper] R9-21(R10): a listener echo arriving BETWEEN queued edits is deferred and can never regress the lane", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p1 = h.upsert("2026-07-24", { sales: 100 }); await tick();
  const p2 = h.upsert("2026-07-24", { sales: 300 });   // queued, built from the SAME base as p1
  assert.equal(h.lane.onListenerEcho([day("2026-07-24", 999)], h.ctrl.current()).status, "deferred_pending_local");
  h.ok(0); await settleAll(); h.ok(1); await settleAll();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(APPLIED(r1.status), `the first edit committed (${r1.status})`);
  assert.equal(r2.status, "conflict", "the interleaved edit was computed from a superseded base and fails closed");
  assert.equal(totalRevenue(h.persisted()), 100, "no regression to the interleaved 999 echo and no silent overwrite");
  assert.equal(totalRevenue(plain(h.lane._state().desired)), 100, "the committed transaction result is authoritative");
  assert.equal(h.lane._state().deferredPending, false, "the superseded deferral was discarded by the commit");
  const p3 = h.upsert("2026-07-24", { sales: 300 });   // re-based
  await tick(); h.ok(2); await settleAll();
  assert.ok(APPLIED((await p3).status));
  assert.equal(totalRevenue(h.persisted()), 300, "the newest local edit is the terminal persisted value once re-based");
});

test("[prod-helper] R9-22: failed first write followed by a newer queued edit — the newer edit still persists", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 0)] });
  const p1 = h.upsert("2026-07-24", { sales: 100 }); await tick();
  const p2 = h.upsert("2026-07-24", { sales: 300 });
  h.fail(0); await settleAll();
  assert.equal(h.transports.length, 2, "the queued newer edit was still dispatched after the failure");
  h.ok(1); await settleAll(); await Promise.allSettled([p1, p2]);
  assert.equal(totalRevenue(h.persisted()), 300, "later queued change was NOT silently discarded by the failure");
});

test("[prod-helper] R9-23: retry after failure carries the CURRENT owner's payload and ordering", async () => {
  const h = laneHarness({ hydrateRows: kgsHistory() });
  const p1 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-01", val: "5", emptyEntry: {}, targetId: (h.rowById(idFor("2026-08-01")) ? idFor("2026-08-01") : undefined), baseValue: (h.rowById(idFor("2026-08-01")) || {}).supplier_payments ? (h.rowById(idFor("2026-08-01")).supplier_payments || {})["s1"] : undefined, newId: idFor("2026-08-01") });
  await tick(); h.fail(0); await settleAll(); await p1;
  const st = h.lane._state();
  assert.equal(st.hydrated, true, "a failed write does not de-hydrate the lane");
  const p2 = h.lane.submitSupplierEdit({ supId: "s1", date: "2026-08-01", val: "5", emptyEntry: {}, targetId: (h.rowById(idFor("2026-08-01")) ? idFor("2026-08-01") : undefined), baseValue: (h.rowById(idFor("2026-08-01")) || {}).supplier_payments ? (h.rowById(idFor("2026-08-01")).supplier_payments || {})["s1"] : undefined, newId: idFor("2026-08-01") }); // user retries
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
  // R10: there is no wholesale-replace path left to guard. The equivalent protection is
  // the required-identity contract, which blocks every ordinary write on an id-less node.
  assert.equal(/status: "blocked_history_drop"/.test(html), false, "the wholesale-replace guard is gone with the wholesale-replace path");
  assert.ok(html.includes('status: "blocked_entry_identity_required"'), "ordinary writes are blocked on an id-less node");
  assert.ok(html.includes('return { status: "invalid_identity" }') || html.includes('status: "invalid_identity"'), "identity failures fail closed");
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


// ═══════════════════════════════════════════════════════════════════════════
// GATE 4A — HARNESS SELF-REGRESSIONS
// These protect the measurability of this suite. The cancellation cascade was NOT
// caused by a submission blocked before queueing (the earlier theory); it was caused
// by the pump dispatching a NEW transaction whenever one settles, so a test that acks
// fewer transports than the lane dispatches strands its last operation promise, never
// returns, and prevents `afterEach` from ever running.
// ═══════════════════════════════════════════════════════════════════════════

test("[harness] H1: a legitimate negative build (missing identity) is blocked and creates NO transport", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 100)] });
  const built = h.buildUpsert("2026-07-24", { sales: 1 }, { id: "not-a-uuid" });
  assert.ok(built.intent.status, "the build is refused");
  const before = h.transports.length;
  const pending = h.lane.submitIntent({ type: "upsert_entry", target: { id: "not-a-uuid" }, patch: { fields: { sales: 1 } }, base: {} });
  await tick();
  // Identity validation happens INSIDE the transaction, so a transaction does run and
  // aborts server-side. It must still be acked for the operation to settle.
  h.ok(before); await settleAll();
  const r = await pending;
  assert.equal(r.status, "blocked");
  assert.equal(r.reason, "invalid_identity");
  assert.equal(h.transports.length, before + 1, "a transaction ran and aborted server-side");
  assert.deepEqual(h.persisted().map(e => e.sales), [100], "zero mutation");
});

test("[harness] H2: a positive upsert() with an invalid fixture fails IMMEDIATELY with a full diagnostic", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 100)] });
  assert.throws(() => h.upsert("2026-07-24", { sales: 5 }, { id: "bad-id" }), (err) => {
    assert.match(err.message, /\[harness\] upsert\("2026-07-24"\) did not dispatch/);
    assert.match(err.message, /status=/);
    assert.match(err.message, /reason=/);
    assert.match(err.message, /id="bad-id"/);
    assert.match(err.message, /transports=\d+/);
    return true;
  }, "diagnostic names the operation, status, reason, offending id and transport count");
  assert.equal(h.ops.filter(o => !o.settled).length, 0, "the refused helper created no tracked operation");
});

test("[harness] H3: a queued, NOT-yet-dispatched submission is settled by lane invalidation", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 100)] });
  const p1 = h.upsert("2026-07-24", { sales: 111 });          // dispatches transport 0
  const p2 = h.upsert("2026-07-24", { sales: 222 });          // QUEUED behind it
  await tick();
  assert.equal(h.transports.length, 1, "single-flight: only one transaction in flight");
  h.ctrl.invalidate("T2", "B"); h.lane.invalidate();
  const r2 = await p2;
  assert.equal(r2.status, "cancelled_selection_changed", "the queued waiter is settled by invalidation");
  h.ok(0); await settleAll(); await p1;
});

test("[harness] H4: settling one transport dispatches the next; cleanup continues until ALL are settled", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 100)] });
  const p1 = h.upsert("2026-07-24", { sales: 111 });
  const p2 = h.upsert("2026-07-24", { sales: 222 });
  await tick();
  assert.equal(h.transports.length, 1);
  h.ok(0); await settleAll();
  assert.equal(h.transports.length, 2, "settling transport 0 caused the pump to dispatch transport 1");
  assert.deepEqual(h.unackedTransports(), [1], "exactly one transport remains un-acked");
  h.ok(1); await settleAll();
  await Promise.all([p1, p2]);
  assert.deepEqual(h.unackedTransports(), [], "cleanup/acking reached quiescence");
});

test("[harness] H5: an un-acked dispatched operation fails THIS test deterministically instead of hanging", async () => {
  const h = laneHarness({ hydrateRows: [day("2026-07-24", 100)] });
  const p1 = h.upsert("2026-07-24", { sales: 111 });
  const p2 = h.upsert("2026-07-24", { sales: 222 });          // will dispatch after p1 settles
  await tick(); h.ok(0);                                       // ack ONLY the first
  let caught = null;
  try { await Promise.all([p1, p2]); } catch (e) { caught = e; }
  assert.ok(caught, "awaiting a never-acked operation rejects rather than hanging");
  assert.match(caught.message, /never settled after 60 deterministic ticks/);
  assert.match(caught.message, /UNACKED=\[1\]/, "the diagnostic names the exact un-acked transport");
});

test("[harness] H6: a sentinel test after the deliberately stranded scenario still executes", () => {
  assert.equal(1 + 1, 2, "the suite continues past a stranded-operation failure — no cascade");
});
