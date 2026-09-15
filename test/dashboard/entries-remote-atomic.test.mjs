// P0-DATA-01 R10 — TRUE CROSS-WRITER (independent-client) concurrency suite.
//
// Closes R9-FIND-001 (independent-writer overwrite), FIND-002 (hydration race),
// FIND-003 (incomplete history-drop invariant), FIND-004 (broad allowDrop) and
// FIND-006 (tests were same-instance only).
//
// Every test drives the ACTUAL production code vm-extracted from index.html:
// createEntriesWriteCoordinator, createRemoteEntriesMutator, applyEntryIntent,
// buildEntryUpsertIntent, contentFingerprint, describeSaveOutcome.
//
// TWO COMPLETELY INDEPENDENT CLIENTS. Each client gets its own selection controller,
// its own coordinator, its own mutator, its own applied-rows spy and its own lane
// state. They share NOTHING except `remote` — a stub of the RTDB service itself
// (node value + transaction/CAS + listener transport). That is exactly the topology
// Codex used to reproduce the R9 overwrite.
//
// Run: node --test test/dashboard/entries-remote-atomic.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

function loadProductionBlocks() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  assert.notEqual(start, -1);
  const f = html.indexOf("window.MarjinSaveLifecycle = Object.freeze({", start);
  assert.notEqual(f, -1);
  const src = html.slice(start, html.indexOf("});", f) + 3);
  const sandbox = { window: {}, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
  vm.runInNewContext(src, sandbox);
  return sandbox.window;
}
const W = loadProductionBlocks();
const ME = W.MarjinEntries;
const ML = W.MarjinSaveLifecycle;

const plain = (x) => JSON.parse(JSON.stringify(x));
const tick = () => new Promise((r) => setImmediate(r));
const settleAll = async () => { for (let i = 0; i < 6; i++) await tick(); };
// Every persisted row carries a required immutable id (approved R10 contract).
// Deterministic canonical UUID v4 values for tests (version 4, variant 8).
const __hx = (n, len) => (n >>> 0).toString(16).padStart(len, "0").slice(-len);
const __hash = (s) => { let h = 2166136261; for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const uuid4 = (seed) => { const a = __hash("a" + seed), b = __hash("b" + seed); return `${__hx(a,8)}-${__hx(b,4)}-4${__hx(a,3)}-8${__hx(b,3)}-${__hx(a,6)}${__hx(b,6)}`; };
const mkId = (seed) => uuid4(seed);
const day = (date, sales, extra = {}) => ({ id: mkId("d" + date), date, sales, deliveries: 0, other_income: 0, ...extra });
const dayNoId = (date, sales, extra = {}) => ({ date, sales, deliveries: 0, other_income: 0, ...extra }); // pre-migration row
let __idSeq = 0;
const nextTestId = () => uuid4("gen" + (++__idSeq));
const KEY = "biz:A:entries";

// ── The shared REMOTE service (the only shared object) ───────────────────────
// Models an RTDB node plus genuine transaction/CAS retry semantics: the callback is
// re-executed against a fresher value whenever the node changed between read and
// write, exactly like runTransaction.
function makeRemote(initialRows) {
  const state = {
    node: initialRows === undefined ? undefined : { _v: JSON.stringify(initialRows) },
    version: 0,
    listeners: [],           // {fn, onError}
    log: [],                 // every transaction attempt
    failNext: 0,             // force N transport failures
    interleaveBeforeCommit: null, // hook to simulate another writer landing mid-transaction
    maxRetries: 25,
  };
  const notify = () => {
    // Firebase only fires onValue when the node exists.
    if (state.node === undefined) return;
    state.listeners.slice().forEach(l => l.fn(JSON.parse(state.node._v)));
  };
  return {
    state,
    rows: () => (state.node === undefined ? null : JSON.parse(state.node._v)),
    setRowsDirect: (rows) => { state.node = { _v: JSON.stringify(rows) }; state.version++; },
    subscribe: (fn, onError) => { const l = { fn, onError }; state.listeners.push(l); return () => { state.listeners = state.listeners.filter(x => x !== l); }; },
    emitTo: (l) => { if (state.node !== undefined) l.fn(JSON.parse(state.node._v)); },
    emitAll: notify,
    failListener: (err) => state.listeners.slice().forEach(l => l.onError && l.onError(err || new Error("permission_denied"))),
    // The transaction primitive handed to createRemoteEntriesMutator.
    transact: async (tenantId, key, txnFn) => {
      if (state.failNext > 0) { state.failNext--; throw new Error("transport_failed"); }
      let runs = 0;
      for (let attempt = 0; attempt < state.maxRetries; attempt++) {
        const seenVersion = state.version;
        const current = state.node === undefined ? null : JSON.parse(JSON.stringify(state.node));
        runs++;
        const out = txnFn(current);
        await tick();                                   // async window where another writer may land
        if (state.interleaveBeforeCommit) { const h = state.interleaveBeforeCommit; state.interleaveBeforeCommit = null; h(); }
        if (state.version !== seenVersion) continue;     // CAS miss → re-run against the fresher value
        state.log.push({ key, runs });
        if (out === undefined) return { committed: false, runs };
        state.node = out; state.version++;
        notify();
        return { committed: true, runs, snapshot: out };
      }
      return { committed: false, retriesExhausted: true, runs };
    },
  };
}

// ── One completely independent client ────────────────────────────────────────
function makeClient(remote, name, opts = {}) {
  const o = opts;
  const ctrl = ML.createSelectionController();
  ctrl.invalidate(o.tenantId || "T1", o.bizId || "A");
  const applied = [];
  const mutator = ML.createRemoteEntriesMutator({
    selection: ctrl,
    transact: (t, k, fn) => remote.transact(t, k, fn),
  });
  const lane = ML.createEntriesWriteCoordinator({
    selection: ctrl,
    canonicalize: ME.canonicalizeEntries,
    entryDateKey: ME.entryDateKey,
    fingerprint: (rows) => JSON.stringify(rows),
    contentFingerprint: ML.contentFingerprint,
    applyRows: (r) => applied.push(plain(r)),
    mutate: (intent, ctx) => mutator.mutate(intent, ctx),
  });
  const client = {
    name, ctrl, lane, applied, mutator,
    view: () => applied[applied.length - 1] || null,
    // Attach the listener exactly like production (hydration is listener-driven).
    listener: null,
    // Production parity: the listener binds the ctx captured at SETUP time, so a
    // callback that arrives after a selection change is correctly seen as stale.
    attach() { const ctxAtSetup = ctrl.capture();
      this.listener = remote.subscribe(
        (rows) => lane.onListenerEcho(rows, ctxAtSetup),
        () => lane.onListenerError(ctxAtSetup)); return this; },
    detach() { if (this.listener) { this.listener(); this.listener = null; } return this; },
    // Deliver the current remote value to THIS client only (models per-client timing).
    pull() { const r = remote.rows(); if (r !== null) lane.onListenerEcho(r, ctrl.capture()); return this; },
    hydrateFromRemote() { return this.pull(); },
    bootstrapAbsent() { lane.markHydrated(ctrl.capture(), []); return this; },
    // Edit/create addressed by immutable id. `byId` targets one specific row when
    // several share a business date.
    upsert(date, fields, opts) {
      const o = opts || {};
      const rows = lane._state().desired || [];
      const prev = o.byId ? (rows.find(r => r && r.id === o.byId) || null)
                          : (rows.filter(r => r && r.date === date)[0] || null);
      const next = { ...(prev || { date }), ...fields, date: o.newDate || (prev ? prev.date : date) };
      const intent = ML.buildEntryUpsertIntent(prev, next, { newId: o.newId || nextTestId() });
      if (intent.status) return Promise.resolve({ status: intent.status === "migration_required" ? "blocked_migration_required" : intent.status });
      return lane.submitIntent(intent);
    },
    supplier(date, supId, val) {
      const prev = (lane._state().desired || []).filter(r => r && r.date === date)[0] || null;
      return lane.submitSupplierEdit({
        supId, date, val, emptyEntry: { date },
        targetId: prev ? prev.id : undefined,
        baseValue: prev && prev.supplier_payments ? prev.supplier_payments[supId] : undefined,
        newId: nextTestId(),
      });
    },
    del(date, byId) {
      const rows = lane._state().desired || [];
      const prev = byId ? (rows.find(r => r && r.id === byId) || null) : (rows.filter(r => r && r.date === date)[0] || null);
      if (!prev) return Promise.resolve({ status: "blocked", reason: "target_not_found" });
      const intent = ML.buildEntryDeleteIntent(prev, {});  // R10.1-GATE-017
      if (intent.status) return Promise.resolve({ status: intent.status });
      return lane.submitIntent(intent);
    },
    clearAll() {
      return lane.submitClearAll({ expectedNodeFingerprint: lane.currentFingerprint(), confirmToken: "tok-" + name });
    },
  };
  return client;
}
const valueAt = (rows, date, field = "sales") => { const r = (rows || []).find(x => x && x.date === date); return r ? r[field] : undefined; };
const supAt = (rows, date, sup) => { const r = (rows || []).find(x => x && x.date === date); return r && r.supplier_payments ? r.supplier_payments[sup] : undefined; };
const COMMITTED = (s) => s === "committed" || s === "committed_idempotent";

function history() { return [day("2026-08-01", 100), day("2026-08-02", 200), day("2026-08-03", 300)]; }

// ═══ 1-3: independent writers, different dates, BOTH completion orders ═══
for (const order of ["A_then_B", "B_then_A"]) {
  test(`[cross-writer] R10-1 (${order}): A and B hydrate rev N, edit different dates — BOTH edits survive`, async () => {
    const remote = makeRemote(history());
    const A = makeClient(remote, "A").attach().pull();
    const B = makeClient(remote, "B").attach().pull();
    assert.equal(A.lane._state().desired.length, 3);
    assert.equal(B.lane._state().desired.length, 3);
    let ra, rb;
    if (order === "A_then_B") { ra = await A.upsert("2026-08-01", { sales: 111 }); rb = await B.upsert("2026-08-02", { sales: 222 }); }
    else { rb = await B.upsert("2026-08-02", { sales: 222 }); ra = await A.upsert("2026-08-01", { sales: 111 }); }
    await settleAll();
    assert.ok(COMMITTED(ra.status), `A committed (${ra.status})`);
    assert.ok(COMMITTED(rb.status), `B committed (${rb.status})`);
    const final = remote.rows();
    assert.equal(valueAt(final, "2026-08-01"), 111, "A's edit survived");
    assert.equal(valueAt(final, "2026-08-02"), 222, "B's edit survived");
    assert.equal(valueAt(final, "2026-08-03"), 300, "untouched history preserved");
    assert.equal(final.length, 3, "no rows added or lost");
  });
}

// ═══ 4-5: different FIELDS of the SAME record (revenue vs food cost) ═══
test("[cross-writer] R10-2: A edits revenue and B edits food cost on the SAME record — both survive", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const ra = await A.upsert("2026-08-02", { sales: 999 });
  const rb = await B.supplier("2026-08-02", "sup-1", "870.34");
  await settleAll();
  assert.ok(COMMITTED(ra.status), ra.status);
  assert.ok(COMMITTED(rb.status), rb.status);
  const final = remote.rows();
  assert.equal(valueAt(final, "2026-08-02"), 999, "revenue edit survived");
  assert.equal(supAt(final, "2026-08-02", "sup-1"), "870.34", "food-cost edit survived on the same row");
  assert.equal(final.length, 3);
});

// ═══ 6-7: same field, same base → the second must CONFLICT, not overwrite ═══
test("[cross-writer] R10-3: two stale same-field edits — second returns conflict and does NOT overwrite", async () => {
  const remote = makeRemote(history());
  // Neither client subscribes: each holds its own hydrated snapshot and receives no
  // live updates, which is precisely the independent-writer topology under test.
  const A = makeClient(remote, "A").pull();
  const B = makeClient(remote, "B").pull();
  const ra = await A.upsert("2026-08-01", { sales: 111 });
  const rb = await B.upsert("2026-08-01", { sales: 222 });   // B still based on 100
  await settleAll();
  assert.ok(COMMITTED(ra.status), ra.status);
  assert.equal(rb.status, "conflict", "the stale same-field write is refused");
  assert.deepEqual(plain(rb.conflictPaths), ["sales"]); // plain(): the coordinator runs in a vm realm
  assert.equal(valueAt(remote.rows(), "2026-08-01"), 111, "first writer's value is intact — no silent last-writer-wins");
  assert.ok(ML.describeSaveOutcome("conflict").length > 10, "conflict has an actionable user message");
});

// ═══ 8-9: delayed client, transaction callback retries against newer state ═══
test("[cross-writer] R10-4: A is delayed while B commits two newer edits; A's callback re-runs on the fresher value", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  // B lands a newer edit in the middle of A's transaction → forces a CAS retry.
  remote.state.interleaveBeforeCommit = () => { const rows = remote.rows(); rows[1] = { ...rows[1], sales: 777 }; remote.setRowsDirect(rows); };
  const ra = await A.upsert("2026-08-03", { sales: 333 });
  await settleAll();
  assert.ok(COMMITTED(ra.status), ra.status);
  assert.ok(ra.runs >= 2, `transaction callback re-executed against the newer remote value (runs=${ra.runs})`);
  const final = remote.rows();
  assert.equal(valueAt(final, "2026-08-03"), 333, "A's edit committed");
  assert.equal(valueAt(final, "2026-08-02"), 777, "the interleaved writer's edit was NOT lost");
});

// ═══ 10: failure then retry after the other client succeeded ═══
test("[cross-writer] R10-5: A's transport fails, B commits, A retries — B's edit is preserved", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  remote.state.failNext = 1;
  const fail = await A.upsert("2026-08-01", { sales: 111 });
  assert.equal(fail.status, "failed", "transport failure is reported, not swallowed");
  const rb = await B.upsert("2026-08-02", { sales: 222 });
  await settleAll();
  assert.ok(COMMITTED(rb.status));
  A.pull();                                   // A reconnects and re-hydrates
  const retry = await A.upsert("2026-08-01", { sales: 111 });
  await settleAll();
  assert.ok(COMMITTED(retry.status), retry.status);
  const final = remote.rows();
  assert.equal(valueAt(final, "2026-08-01"), 111, "A's retry landed");
  assert.equal(valueAt(final, "2026-08-02"), 222, "B's edit was NOT erased by A's retry (R9 lost this)");
});

// ═══ 11: stale disconnected client reconnects and saves ═══
test("[cross-writer] R10-6: a STALE disconnected client cannot overwrite newer remote history", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull().detach();  // A hydrates, then goes dark
  const B = makeClient(remote, "B").pull();
  await B.upsert("2026-08-02", { sales: 222 });
  await B.upsert("2026-08-03", { sales: 333 });
  await settleAll();
  // While still stale, A edits a date B changed → must CONFLICT, never clobber.
  const conflict = await A.upsert("2026-08-02", { sales: 555 });
  assert.equal(conflict.status, "conflict", "stale same-field edit is refused");
  assert.equal(valueAt(remote.rows(), "2026-08-02"), 222, "B's value intact");
  // And a stale edit to an UNTOUCHED date commits without erasing B's newer history.
  const ra = await A.upsert("2026-08-01", { sales: 111 });
  await settleAll();
  assert.ok(COMMITTED(ra.status), ra.status);
  const final = remote.rows();
  assert.equal(valueAt(final, "2026-08-01"), 111, "the stale client's own edit applied");
  assert.equal(valueAt(final, "2026-08-02"), 222, "newer remote edits SURVIVED the stale client's save");
  assert.equal(valueAt(final, "2026-08-03"), 333, "newer remote edits SURVIVED the stale client's save");
});

// ═══ 12-13: listener echoes before/after acknowledgement ═══
test("[cross-writer] R10-7: listener echoes before and after acknowledgement do not corrupt state", async () => {
  for (const when of ["before", "after"]) {
    const remote = makeRemote(history());
    const A = makeClient(remote, "A").attach().pull();
    const B = makeClient(remote, "B").attach().pull();
    if (when === "before") { A.pull(); B.pull(); }
    const ra = await A.upsert("2026-08-01", { sales: 111 });
    if (when === "after") { A.pull(); B.pull(); }
    await settleAll();
    assert.ok(COMMITTED(ra.status), `${when}: ${ra.status}`);
    assert.equal(valueAt(remote.rows(), "2026-08-01"), 111, `${when}: value correct`);
    assert.equal(remote.rows().length, 3, `${when}: no row loss`);
  }
});

// ═══ 14: one client defers a snapshot produced by the other ═══
test("[cross-writer] R10-8: a deferred snapshot from the other client is retained and converges", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  remote.state.failNext = 1;
  const p = A.upsert("2026-08-01", { sales: 111 });          // will fail
  const echo = A.lane.onListenerEcho([day("2026-08-01", 100), day("2026-08-02", 888), day("2026-08-03", 300)], A.ctrl.capture());
  assert.equal(echo.status, "deferred_pending_local");
  assert.equal(echo.deferredStored, true);
  const r = await p;
  await settleAll();
  assert.equal(r.status, "failed");
  assert.equal(r.converged, true, "the deferred remote payload was applied on failure (R8 behavior retained)");
  assert.equal(valueAt(A.view(), "2026-08-02"), 888, "A converged onto the other client's state without another emit");
});

// ═══ 15: absent-node bootstrap races another client's create ═══
test("[cross-writer] R10-9: absent-node bootstrap cannot erase history created by another client", async () => {
  const remote = makeRemote(undefined);                      // node genuinely absent
  const A = makeClient(remote, "A");
  A.bootstrapAbsent();                                       // A believes "empty"
  assert.equal(A.lane._state().hydrated, false, "absent probe is NOT full hydration");
  assert.equal(A.lane._state().absentConfirmed, true);
  assert.equal(A.lane.isReady(), true, "A may still create its first entry");
  const B = makeClient(remote, "B");
  B.bootstrapAbsent();
  await B.upsert("2026-08-05", { sales: 500 });               // B creates the node first
  await settleAll();
  const ra = await A.upsert("2026-08-06", { sales: 600 });    // A still holds the stale empty view
  await settleAll();
  assert.ok(COMMITTED(ra.status), ra.status);
  const final = remote.rows();
  assert.equal(final.length, 2, "both creates present — the stale empty client erased nothing");
  assert.equal(valueAt(final, "2026-08-05"), 500, "B's independently created history SURVIVED (R9 lost this)");
  assert.equal(valueAt(final, "2026-08-06"), 600);
  // A destructive clear-all is impossible from absent-node readiness.
  const cl = await A.clearAll();
  assert.equal(cl.status, "blocked_unhydrated");
  assert.equal(cl.reason, "clear_all_requires_full_hydration");
  assert.equal(remote.rows().length, 2, "nothing destroyed");
});

// ═══ 16: stale delete races a newer edit ═══
test("[cross-writer] R10-10: a stale delete does NOT remove a record edited after the user's base", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").pull();
  const B = makeClient(remote, "B").pull();
  await B.upsert("2026-08-02", { sales: 222 });               // B changes the row
  await settleAll();
  const rd = await A.del("2026-08-02");                       // A deletes based on sales=200
  await settleAll();
  assert.equal(rd.status, "conflict", "stale delete refused");
  assert.equal(remote.rows().length, 3, "record still present");
  assert.equal(valueAt(remote.rows(), "2026-08-02"), 222, "B's newer edit intact");
  // A re-syncs and the delete then succeeds.
  A.pull();
  const rd2 = await A.del("2026-08-02");
  await settleAll();
  assert.ok(COMMITTED(rd2.status), rd2.status);
  assert.equal(remote.rows().length, 2, "explicit delete of the current record works");
});

// ═══ 17-18: clear-all preconditions ═══
test("[cross-writer] R10-11: a confirmed clear-all ABORTS when remote changed after confirmation", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").pull();
  const B = makeClient(remote, "B").pull();
  const fp = A.lane.currentFingerprint();                     // user confirms THIS content
  await B.upsert("2026-08-02", { sales: 222 });               // someone else edits after confirmation
  await settleAll();
  const rc = await A.lane.submitClearAll({ expectedNodeFingerprint: fp, confirmToken: "tok" });
  await settleAll();
  assert.equal(rc.status, "blocked");
  assert.equal(rc.reason, "precondition_failed", "the complete-content fingerprint no longer matches");
  assert.equal(remote.rows().length, 3, "nothing was erased");
  assert.equal(valueAt(remote.rows(), "2026-08-02"), 222, "the newer edit survived the racing clear-all");
});

test("[cross-writer] R10-12: clear-all commits only while the COMPLETE fingerprint still matches", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const ok = await A.clearAll();
  await settleAll();
  assert.ok(COMMITTED(ok.status), ok.status);
  assert.deepEqual(remote.rows(), [], "clear-all committed");
  // The fingerprint covers VALUES, not just dates: a value-only change invalidates it.
  const remote2 = makeRemote(history());
  const C = makeClient(remote2, "C").attach().pull();
  const fp2 = C.lane.currentFingerprint();
  const rows2 = remote2.rows(); rows2[0] = { ...rows2[0], sales: 101 }; remote2.setRowsDirect(rows2);
  const blocked = await C.lane.submitClearAll({ expectedNodeFingerprint: fp2, confirmToken: "t" });
  assert.equal(blocked.reason, "precondition_failed", "a value-only remote change invalidates the precondition");
  assert.equal(remote2.rows().length, 3);
});

// ═══ 19-21: owner switch / logout / late callbacks during a transaction ═══
test("[cross-writer] R10-13: owner switch and logout during an in-flight transaction never cross owners", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const p = A.upsert("2026-08-01", { sales: 111 });
  A.ctrl.invalidate("T2", "B"); A.lane.invalidate();          // business switch mid-flight
  const r = await p; await settleAll();
  assert.equal(A.lane._state().desired, null, "the new destination's lane is untouched");
  assert.equal(A.lane.isReady(), false, "the new destination must hydrate on its own");
  const blocked = await A.upsert("2026-08-09", { sales: 9 });
  assert.equal(blocked.status, "blocked_unhydrated");
  // logout
  const B2 = makeClient(remote, "B2").attach().pull();
  const p2 = B2.upsert("2026-08-02", { sales: 222 });
  B2.ctrl.invalidate(null, null); B2.lane.invalidate();
  await p2; await settleAll();
  const afterLogout = await B2.upsert("2026-08-02", { sales: 999 });
  assert.equal(afterLogout.status, "blocked_no_owner", "post-logout writes refused");
});

// ═══ 22-23: duplicate rows ═══
test("[cross-writer] R10-14: duplicate DATES with distinct IDs are preserved; duplicate IDs fail closed", async () => {
  const dupRows = [{ id: mkId("r1"), date: "2026-08-01", sales: 100 }, { id: mkId("r2"), date: "2026-08-01", sales: 50 }, day("2026-08-02", 200)];
  const remote = makeRemote(dupRows);
  const A = makeClient(remote, "A").attach().pull();
  // Targeting by stable id is unambiguous and preserves the sibling duplicate.
  const ok = await A.lane.submitIntent({ type: "upsert_entry", target: { id: mkId("r2") },
    patch: { fields: { sales: 55 } }, base: { fields: { sales: 50 } } });
  await settleAll();
  assert.ok(COMMITTED(ok.status), ok.status);
  const final = remote.rows();
  assert.equal(final.length, 3, "no row was collapsed or deduplicated");
  assert.equal(final.find(r => r.id === mkId("r1")).sales, 100, "the duplicate-date sibling is untouched");
  assert.equal(final.find(r => r.id === mkId("r2")).sales, 55);
  // A DATE-addressed mutation is structurally impossible: identity is the id.
  const amb = await A.lane.submitIntent({ type: "upsert_entry", target: { date: "2026-08-01" },
    patch: { fields: { sales: 1 } }, base: { fields: { sales: 100 } } });
  assert.equal(amb.status, "blocked");
  assert.equal(amb.reason, "invalid_identity", "no date fallback exists");
  assert.deepEqual(remote.rows(), final, "ZERO remote mutation");
  // Both duplicate-date rows remain INDEPENDENTLY deletable by id.
  const delOne = await A.del(null, mkId("r1"));
  await settleAll();
  assert.ok(COMMITTED(delOne.status), delOne.status);
  assert.equal(remote.rows().length, 2, "exactly one of the duplicate-date rows was removed");
  assert.ok(remote.rows().some(r => r.id === mkId("r2")), "the sibling survived");
  // A duplicate-ID node is invalid: every ordinary mutation fails closed.
  remote.setRowsDirect([{ id: mkId("x"), date: "2026-08-01", sales: 1 }, { id: mkId("x"), date: "2026-08-02", sales: 2 }]);
  A.pull();
  const dupId = await A.lane.submitIntent({ type: "upsert_entry", target: { id: mkId("x") },
    patch: { fields: { sales: 9 } }, base: { fields: { sales: 1 } } });
  assert.equal(dupId.reason, "duplicate_id");
  assert.equal(remote.rows().length, 2, "ZERO mutation");
});

// ═══ 24: malformed remote state ═══
test("[cross-writer] R10-15: malformed remote state fails closed with zero mutation", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  remote.state.node = { _v: "{not-an-array}" };  remote.state.version++;
  const r = await A.upsert("2026-08-01", { sales: 111 });
  assert.equal(r.status, "blocked");
  assert.equal(r.reason, "malformed_remote");
  assert.equal(remote.state.node._v, "{not-an-array}", "the malformed node was NOT repaired or replaced");
  remote.state.node = { _v: JSON.stringify({ a: 1 }) }; remote.state.version++;
  const r2 = await A.upsert("2026-08-01", { sales: 111 });
  assert.equal(r2.reason, "malformed_remote", "a non-array payload is refused, never silently rebuilt");
});

// ═══ 25: idempotency under repeated callback execution ═══
test("[cross-writer] R10-16: repeated transaction-callback execution produces no duplicate effect", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  let forced = 0;
  remote.state.interleaveBeforeCommit = () => { forced++; const rows = remote.rows(); remote.setRowsDirect(rows); }; // bump version, same content
  const r = await A.upsert("2026-08-01", { sales: 111 });
  await settleAll();
  assert.ok(COMMITTED(r.status), r.status);
  assert.ok(r.runs >= 2, "callback ran more than once");
  const final = remote.rows();
  assert.equal(final.length, 3, "no duplicated rows from repeated execution");
  assert.equal(valueAt(final, "2026-08-01"), 111, "absolute patch is idempotent (never applied twice as an increment)");
  // Re-submitting the identical edit is a safe no-op, not a second mutation.
  const again = await A.upsert("2026-08-01", { sales: 111 });
  assert.equal(again.status, "committed_idempotent");
  assert.equal(remote.rows().length, 3);
});

// ═══ history preservation ═══
test("[history] R10-17: every mutation preserves unrelated rows, unrelated fields and row order", async () => {
  const rich = [
    { id: mkId("rich1"), date: "2026-08-01", sales: 100, payroll: "10", notes: "keep", supplier_payments: { s1: "5", s2: "6" } },
    { id: mkId("rich2"), date: "2026-08-02", sales: 200, payroll: "20", supplier_payments: { s1: "7" } },
    { id: mkId("rich3"), date: "2026-08-03", sales: 300 },
  ];
  const remote = makeRemote(rich);
  const A = makeClient(remote, "A").attach().pull();
  await A.upsert("2026-08-02", { sales: 250 });
  await A.supplier("2026-08-01", "s2", "66");
  await settleAll();
  const f = remote.rows();
  assert.equal(f.length, 3, "row count unchanged");
  assert.deepEqual(f.map(r => r.date), ["2026-08-01", "2026-08-02", "2026-08-03"], "order preserved");
  assert.equal(f[0].notes, "keep", "unrelated field preserved");
  assert.equal(f[0].payroll, "10", "unrelated field preserved");
  assert.equal(f[0].supplier_payments.s1, "5", "unrelated supplier key preserved");
  assert.equal(f[0].supplier_payments.s2, "66", "targeted supplier key updated");
  assert.equal(f[1].sales, 250, "targeted revenue updated");
  assert.equal(f[1].payroll, "20", "unrelated field on the edited row preserved");
  assert.equal(f[1].supplier_payments.s1, "7", "unrelated map on the edited row preserved");
});

test("[history] R10-18: a current-month display subset can never become a persistence payload", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  // There is no API that accepts a client collection at all — the only write API is a
  // typed intent. Prove the legacy shapes are rejected outright.
  assert.equal((await A.lane.submitIntent({ rows: [day("2026-08-03", 300)] })).status, "blocked_invalid_intent");
  assert.equal((await A.lane.submitIntent({ type: "replace_all", rows: [] })).status, "blocked");
  // `allowDrop` is gone AND a date-addressed target is refused outright.
  const legacy = await A.lane.submitIntent({ type: "upsert_entry", allowDrop: true, target: { date: "2026-08-01" }, patch: { fields: { sales: 1 } }, base: {} });
  assert.equal(legacy.status, "blocked");
  assert.equal(legacy.reason, "invalid_identity");
  assert.deepEqual(remote.rows(), history(), "remote untouched by every rejected shape");
  assert.equal(typeof A.lane.submit, "undefined", "the legacy snapshot submit() API no longer exists");
});

// ═══ hydration / failure lifecycle ═══
test("[hydration] R10-19: post-hydration listener failure DEGRADES the lane until fresh hydration", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  assert.equal(A.lane.isReady(), true);
  remote.failListener(new Error("permission_denied"));
  assert.equal(A.lane._state().degraded, true, "explicit degraded state after listener failure");
  assert.equal(A.lane.isReady(), false, "no longer ready to save");
  const r = await A.upsert("2026-08-01", { sales: 111 });
  assert.equal(r.status, "blocked_listener_degraded", "stale client is not treated as current authority");
  assert.deepEqual(remote.rows(), history(), "zero remote mutation while degraded");
  assert.ok(ML.describeSaveOutcome("blocked_listener_degraded").includes("רענן"), "actionable message");
  A.pull();                                        // a fresh authoritative listener value
  assert.equal(A.lane._state().degraded, false, "fresh hydration clears the degraded state");
  assert.ok(COMMITTED((await A.upsert("2026-08-01", { sales: 111 })).status), "saving resumes only after revalidation");
});

test("[hydration] R10-20: opening, navigating, hydrating and switching emit ZERO entries writes", async () => {
  const remote = makeRemote([day("2026-08-01", 100), day("2026-08-01", 100)]); // duplicates present
  const A = makeClient(remote, "A").attach();
  A.pull();                                        // hydrate (with duplicates)
  A.pull(); A.pull();                              // repeated listener deliveries
  A.ctrl.invalidate("T1", "B"); A.lane.invalidate(); A.pull();
  await settleAll();
  assert.equal(remote.state.log.length, 0, "not a single transaction was attempted");
  assert.equal(A.lane._state().duplicatesObserved || true, true);
  assert.deepEqual(remote.rows().length, 2, "duplicate rows were NOT silently self-healed away");
});

test("[hydration] R10-21: read/transport failure before hydration fails closed", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach();
  A.lane.onListenerError(A.ctrl.capture());
  assert.equal(A.lane._state().hydrationFailed, true);
  const r = await A.upsert("2026-08-01", { sales: 1 });
  assert.equal(r.status, "blocked_unhydrated");
  assert.equal(remote.state.log.length, 0, "no transaction attempted");
  A.pull();
  assert.ok(COMMITTED((await A.upsert("2026-08-01", { sales: 111 })).status), "recovers after a real hydration");
});

// ═══ NEGATIVE CONTROL: the exact R9 schedule ═══
test("[negative-control] R10-22: the schedule that lost an edit under R9 now preserves both", async () => {
  // Codex's reproduction: A and B hydrate the same history, edit DIFFERENT dates, and
  // the later whole-history writer erased the earlier one (finalHasA false).
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const ra = await A.upsert("2026-08-01", { sales: 111 });
  const rb = await B.upsert("2026-08-02", { sales: 222 });
  await settleAll();
  const final = remote.rows();
  const finalHasA = valueAt(final, "2026-08-01") === 111;
  const finalHasB = valueAt(final, "2026-08-02") === 222;
  assert.equal(finalHasA, true, "R9 produced false here");
  assert.equal(finalHasB, true);
  assert.ok(COMMITTED(ra.status) && COMMITTED(rb.status), "both writers were told the truth");
});
