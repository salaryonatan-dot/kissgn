// P0-DATA-01 R10 — SHARED TRUE-CROSS-WRITER HARNESS (test-only).
//
// Used by the Gate 3 matrices:
//   test/dashboard/entries-topology-sentinel.test.mjs
//   test/dashboard/entries-concurrency-matrix.test.mjs
//   test/dashboard/entries-clear-all-matrix.test.mjs
//
// TOPOLOGY (corrected — see the "destination partitioning" note below).
// The remote is a DESTINATION-PARTITIONED service, not a single node. A destination
// is the exact pair the production transport addresses:
//
//     [ tenantId , key ]      where key === `biz:${bizId}:entries`
//
// Identity is a NESTED MAP — Map<tenantId, Map<key, destination>>. No delimiter
// concatenation is used anywhere, so `("T1", "biz:A:b")` and `("T1:biz", "A:b")`
// cannot alias, and neither can `("T1","biz:A:entries")` and `("T2","biz:A:entries")`.
//
// Each destination owns, independently:
//   node value · version · listeners · transaction/CAS attempts · transport-rejection
//   state · retry limit · interleaving hooks · in-flight holds · transaction log.
//
// A transaction CAPTURES (tenantId, key) at dispatch and continues to read, write,
// version and notify ONLY that destination — including after a selection, business,
// tenant or generation change. An aborted, rejected or exhausted transaction leaves
// every destination byte-intact.
//
// WHY THIS MATTERS: the previous harness kept one global `state.node` and one global
// `state.version`, and `transact(tenantId, key, txnFn)` recorded `key` but read and
// wrote that single node. Destination-transition cells could therefore only assert
// local lane state (`desired === null`, `isHydrated() === false`) and could NOT prove
// that a late write went to its captured RTDB destination and left the newly selected
// one untouched. `entries-topology-sentinel.test.mjs` fails against that former
// topology by construction.
//
// TWO OR MORE COMPLETELY INDEPENDENT CLIENTS. Each gets its own selection controller,
// coordinator, mutator, applied-rows spy and lane state. They share NOTHING except the
// remote service. Every helper under test is the ACTUAL production code vm-extracted
// from index.html; only terminal I/O is injected.
//
// This module is TEST-ONLY: pure harness, no runtime import, no CLI, no credentials.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const html = readFileSync(join(ROOT, "index.html"), "utf8");

function loadProductionBlocks() {
  const start = html.indexOf("// ── P0-DATA-01: canonical daily-entries identity & upsert helpers");
  assert.notEqual(start, -1, "index.html must contain the P0-DATA-01 helper block");
  const f = html.indexOf("window.MarjinSaveLifecycle = Object.freeze({", start);
  assert.notEqual(f, -1, "index.html must expose window.MarjinSaveLifecycle");
  const src = html.slice(start, html.indexOf("});", f) + 3);
  const sandbox = { window: {}, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent, setImmediate };
  vm.runInNewContext(src, sandbox);
  return sandbox.window;
}
const W = loadProductionBlocks();
export const ME = W.MarjinEntries;
export const ML = W.MarjinSaveLifecycle;

export const plain = (x) => JSON.parse(JSON.stringify(x));
export const tick = () => new Promise((r) => setImmediate(r));
export const settleAll = async () => { for (let i = 0; i < 8; i++) await tick(); };

// The production entries key for a business. Nothing else in the harness constructs it.
export const entriesKey = (bizId) => `biz:${bizId}:entries`;

// Deterministic canonical lowercase UUID v4 fixtures (version nibble 4, variant 8).
// The seed→uuid mapping is a TEST convention only; runtime never derives identity.
const __hx = (n, len) => (n >>> 0).toString(16).padStart(len, "0").slice(-len);
const __hash = (s) => { let h = 2166136261; const t = String(s); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const uuid4 = (seed) => { const a = __hash("a" + seed), b = __hash("b" + seed); return `${__hx(a,8)}-${__hx(b,4)}-4${__hx(a,3)}-8${__hx(b,3)}-${__hx(a,6)}${__hx(b,6)}`; };
export const mkId = (seed) => uuid4(seed);
export const day = (date, sales, extra = {}) => ({ id: mkId("d" + date), date, sales, deliveries: 0, other_income: 0, ...extra });
export const dayNoId = (date, sales, extra = {}) => ({ date, sales, deliveries: 0, other_income: 0, ...extra });
let __idSeq = 0;
export const nextTestId = () => uuid4("gen" + (++__idSeq));
export const COMMITTED = (s) => s === "committed" || s === "committed_idempotent";
export const valueAt = (rows, date, field = "sales") => { const r = (rows || []).find(x => x && x.date === date); return r ? r[field] : undefined; };
export const rowById = (rows, id) => (rows || []).find(x => x && x.id === id) || null;
export const supAt = (rows, date, sup) => { const r = (rows || []).find(x => x && x.date === date); return r && r.supplier_payments ? r.supplier_payments[sup] : undefined; };

// ── OPERATION / TRANSPORT ACCOUNTING ─────────────────────────────────────────
// Every service registers itself so that, when a test ends, anything it left held open
// is released. A test that leaves an operation unsettled fails deterministically with
// the exact outstanding-hold list instead of hanging or cancelling the whole file.
const __liveRigs = [];
export async function drainLiveRigs() {
  while (__liveRigs.length) {
    const rig = __liveRigs.pop();
    for (let round = 0; round < 25; round++) {
      if (!rig.__releaseAll()) break;
      await tick(); await tick();
    }
  }
}

// ── The shared REMOTE SERVICE, partitioned by [tenantId, key] ────────────────
function newDestination(tenantId, key) {
  return {
    tenantId, key,
    node: undefined,               // undefined === the node does not exist
    version: 0,
    listeners: [],                 // {fn, onError}
    log: [],                       // {tenantId, key, runs, committed}
    failNext: 0,                   // force N transport rejections at THIS destination
    interleaveBeforeCommit: null,  // one-shot: another writer lands mid-transaction
    interleaveEvery: null,         // persistent: a writer lands on EVERY attempt
    maxRetries: 25,
    holds: [],                     // open gates: {label, release, released, taken}
    inFlight: 0,
  };
}

export function makeRemoteService() {
  // Map<tenantId, Map<key, destination>> — collision-safe, no delimiter encoding.
  const byTenant = new Map();
  const destFor = (tenantId, key) => {
    let m = byTenant.get(tenantId);
    if (!m) { m = new Map(); byTenant.set(tenantId, m); }
    let d = m.get(key);
    if (!d) { d = newDestination(tenantId, key); m.set(key, d); }
    return d;
  };
  const allDests = () => { const out = []; byTenant.forEach(m => m.forEach(d => out.push(d))); return out; };

  const notify = (d) => {
    if (d.node === undefined) return;                 // Firebase only fires when the node exists
    d.listeners.slice().forEach(l => l.fn(JSON.parse(d.node._v)));
  };

  // A destination HANDLE. Every remote operation goes through one of these, so no
  // helper can silently act on a "current" or global node.
  const handle = (tenantId, key) => {
    const d = destFor(tenantId, key);
    return {
      tenantId, key, raw: d,
      rows: () => (d.node === undefined ? null : JSON.parse(d.node._v)),
      version: () => d.version,
      exists: () => d.node !== undefined,
      seed: (rows) => { d.node = rows === undefined ? undefined : { _v: JSON.stringify(rows) }; return handle(tenantId, key); },
      setRowsDirect: (rows) => { d.node = { _v: JSON.stringify(rows) }; d.version++; },
      setRawNode: (raw) => { d.node = raw; d.version++; },      // for malformed-node fixtures
      removeNode: () => { d.node = undefined; d.version++; },
      subscribe: (fn, onError) => { const l = { fn, onError }; d.listeners.push(l); return () => { d.listeners = d.listeners.filter(x => x !== l); }; },
      listenerCount: () => d.listeners.length,
      emitAll: () => notify(d),
      failListener: (err) => d.listeners.slice().forEach(l => l.onError && l.onError(err || new Error("permission_denied"))),
      failNextTransports: (n) => { d.failNext = n; },
      setMaxRetries: (n) => { d.maxRetries = n; },
      interleave: (fn) => { d.interleaveBeforeCommit = fn; },
      interleaveOnEveryAttempt: (fn) => { d.interleaveEvery = fn; },
      log: () => d.log.slice(),
      // Hold the NEXT transaction at THIS destination open just before its CAS check.
      holdNext: (label) => {
        let release;
        const promise = new Promise((r) => { release = r; });
        const gate = { label: label || `hold@${tenantId}/${key}#${d.holds.length}`, promise, released: false,
                       release: () => { if (!gate.released) { gate.released = true; release(); } } };
        d.holds.push(gate);
        return gate;
      },
      outstandingHolds: () => d.holds.filter(g => !g.released).map(g => g.label),
    };
  };

  const service = {
    at: (tenantId, bizId) => handle(tenantId, entriesKey(bizId)),
    atKey: (tenantId, key) => handle(tenantId, key),
    destinations: () => allDests().map(d => ({ tenantId: d.tenantId, key: d.key })),
    allLogs: () => allDests().flatMap(d => d.log.slice()),
    outstandingHolds: () => allDests().flatMap(d => d.holds.filter(g => !g.released).map(g => `${d.tenantId}|${d.key}:${g.label}`)),
    inFlight: () => allDests().reduce((a, d) => a + d.inFlight, 0),
    // A whole-service snapshot for cross-destination byte-intactness assertions.
    // Returned as a LIST of {tenantId,key,rows}, never a concatenated key map.
    snapshot: () => allDests()
      .map(d => ({ tenantId: d.tenantId, key: d.key, rows: d.node === undefined ? null : JSON.parse(d.node._v) }))
      .sort((a, b) => (a.tenantId + " " + a.key < b.tenantId + " " + b.key ? -1 : 1)),
    __releaseAll: () => { let any = false; allDests().forEach(d => d.holds.forEach(g => { if (!g.released) { any = true; g.release(); } })); return any; },

    // The transaction primitive handed to createRemoteEntriesMutator.
    // (tenantId, key) are CAPTURED here and never re-read from any client state.
    transact: async (tenantId, key, txnFn) => {
      const d = destFor(tenantId, key);
      if (d.failNext > 0) { d.failNext--; throw new Error("transport_failed"); }
      const gate = d.holds.find(g => !g.released && !g.taken);
      if (gate) gate.taken = true;
      d.inFlight++;
      try {
        let runs = 0;
        for (let attempt = 0; attempt < d.maxRetries; attempt++) {
          const seenVersion = d.version;
          const current = d.node === undefined ? null : JSON.parse(JSON.stringify(d.node));
          runs++;
          const out = txnFn(current);
          await tick();                                   // async window where another writer may land
          if (gate && !gate.released) await gate.promise; // physically in flight until released
          if (d.interleaveBeforeCommit) { const h = d.interleaveBeforeCommit; d.interleaveBeforeCommit = null; h(); }
          if (d.interleaveEvery) d.interleaveEvery(attempt);
          if (d.version !== seenVersion) continue;         // CAS miss → re-run against the fresher value
          d.log.push({ tenantId, key, runs, committed: out !== undefined });
          if (out === undefined) return { committed: false, runs };
          d.node = out; d.version++;
          notify(d);
          return { committed: true, runs, snapshot: out };
        }
        return { committed: false, retriesExhausted: true, runs };
      } finally { d.inFlight--; }
    },
  };
  __liveRigs.push(service);
  return service;
}

// Convenience wrapper for single-destination fixtures. The fixture DECLARES its
// destination explicitly — `makeRemote(rows)` declares (T1, biz:A:entries), which is
// the default selection every client in these suites starts from. The delegating
// accessors below are bound to that declared destination; they are not "global".
// Multi-destination fixtures use `makeRemoteService()` / `remote.at(...)` directly.
export function makeRemote(initialRows, opts) {
  const o = opts || {};
  const tenantId = o.tenantId || "T1";
  const bizId = o.bizId || "A";
  const service = makeRemoteService();
  const home = service.at(tenantId, bizId);
  home.seed(initialRows);
  return {
    ...service,
    home, homeTenantId: tenantId, homeBizId: bizId, homeKey: entriesKey(bizId),
    // Declared-destination delegates (identical semantics, explicit binding).
    get state() { return home.raw; },
    rows: () => home.rows(),
    version: () => home.version(),
    setRowsDirect: (rows) => home.setRowsDirect(rows),
    setRawNode: (raw) => home.setRawNode(raw),
    removeNode: () => home.removeNode(),
    subscribe: (fn, onError) => home.subscribe(fn, onError),
    emitAll: () => home.emitAll(),
    failListener: (err) => home.failListener(err),
    failNextTransports: (n) => home.failNextTransports(n),
    setMaxRetries: (n) => home.setMaxRetries(n),
    interleave: (fn) => home.interleave(fn),
    interleaveOnEveryAttempt: (fn) => home.interleaveOnEveryAttempt(fn),
    holdNext: (label) => home.holdNext(label),
    log: () => home.log(),
  };
}

// ── One completely independent client ────────────────────────────────────────
export function makeClient(remote, name, opts = {}) {
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

  // DETERMINISTIC WATCHDOG. An operation that never settles fails THIS test with the
  // exact outstanding-hold list rather than hanging. No timers, no sleeps, no
  // automatic acknowledgement of unknown transports, no swallowed rejections.
  const guard = (p, label) => {
    const rec = { settled: false };
    p.then(() => { rec.settled = true; }, () => { rec.settled = true; });
    const watchdog = (async () => {
      for (let i = 0; i < 60; i++) { await tick(); if (rec.settled) break; }
      if (rec.settled) return new Promise(() => {});      // settled: never win the race
      throw new Error(`[harness] ${name}.${label} never settled after 60 deterministic ticks. `
        + `inFlight=${remote.inFlight()}, HELD=[${remote.outstandingHolds().join(",")}]. `
        + `Release the held transaction, or assert the blocked result instead of awaiting it.`);
    })();
    return Promise.race([p, watchdog]);
  };

  // The destination this client's CURRENT selection addresses — the same derivation
  // production uses when it subscribes and when the mutator builds its key.
  const destOf = (ctx) => { const c = ctx || ctrl.current(); return { tenantId: c.tenantId, key: entriesKey(c.bizId) }; };

  const client = {
    name, ctrl, lane, applied, mutator, remote,
    view: () => applied[applied.length - 1] || null,
    listener: null,
    listenerDest: null,
    destination: () => destOf(),
    // Production parity: the listener is registered on the destination captured at
    // SETUP time and binds that ctx, so a callback arriving after a selection change
    // is correctly seen as stale AND is physically routed from the old destination.
    attach() {
      const ctxAtSetup = ctrl.capture();
      const d = destOf(ctxAtSetup);
      this.listenerDest = d;
      this.listener = remote.atKey(d.tenantId, d.key).subscribe(
        (rows) => lane.onListenerEcho(rows, ctxAtSetup),
        () => lane.onListenerError(ctxAtSetup));
      this.listenerCtx = ctxAtSetup;
      return this;
    },
    detach() { if (this.listener) { this.listener(); this.listener = null; this.listenerDest = null; } return this; },
    // Deliver THIS client's own destination's current value to it (per-client timing).
    pull() {
      const d = destOf();
      const r = remote.atKey(d.tenantId, d.key).rows();
      if (r !== null) lane.onListenerEcho(r, ctrl.capture());
      return this;
    },
    pullRows(rows) { lane.onListenerEcho(rows, ctrl.capture()); return this; },
    bootstrapAbsent() { lane.markHydrated(ctrl.capture(), []); return this; },
    // Selection change exactly as production performs it: invalidate the controller,
    // retire the lane, drop the old listener and (optionally) subscribe to the NEW
    // destination. The in-flight write keeps its captured destination.
    switchTo(tenantId, bizId, opts2) {
      const o2 = opts2 || {};
      if (o2.keepListener !== true) this.detach();
      ctrl.invalidate(tenantId, bizId);
      lane.invalidate();
      if (o2.attach !== false) this.attach();
      return this;
    },
    desired: () => lane._state().desired,
    fingerprint: () => lane.currentFingerprint(),
    upsert(date, fields, opts2) {
      const o2 = opts2 || {};
      const rows = lane._state().desired || [];
      const prev = o2.byId ? (rows.find(r => r && r.id === o2.byId) || null)
                           : (rows.filter(r => r && r.date === date)[0] || null);
      const next = { ...(prev || { date }), ...fields, date: o2.newDate || (prev ? prev.date : date) };
      const intent = ML.buildEntryUpsertIntent(prev, next, { newId: o2.newId || nextTestId() });
      if (intent.status) return Promise.resolve({ status: intent.status, buildBlocked: true });
      return guard(lane.submitIntent(intent), `upsert(${date}${o2.newDate ? "→" + o2.newDate : ""})`);
    },
    // Build (but do not submit) the intent an edit WOULD produce, so a test can replay
    // the SAME semantic operation later — a retry is the same intent, not a fresh one
    // recomputed against changed state.
    buildUpsert(date, fields, opts2) {
      const o2 = opts2 || {};
      const rows = lane._state().desired || [];
      const prev = o2.byId ? (rows.find(r => r && r.id === o2.byId) || null)
                           : (rows.filter(r => r && r.date === date)[0] || null);
      const next = { ...(prev || { date }), ...fields, date: o2.newDate || (prev ? prev.date : date) };
      return ML.buildEntryUpsertIntent(prev, next, { newId: o2.newId || nextTestId() });
    },
    // A raw create with an explicitly chosen id and content (for collision / semantic
    // retry schedules). No lookup, no lane state — exactly what a fresh client does.
    create(row) {
      const intent = ML.buildEntryUpsertIntent(null, { ...row }, { newId: row.id });
      if (intent.status) return Promise.resolve({ status: intent.status, buildBlocked: true });
      return guard(lane.submitIntent(intent), `create(${row.id})`);
    },
    supplier(date, supId, val, opts2) {
      const o2 = opts2 || {};
      const prev = o2.byId ? ((lane._state().desired || []).find(r => r && r.id === o2.byId) || null)
                           : ((lane._state().desired || []).filter(r => r && r.date === date)[0] || null);
      return guard(lane.submitSupplierEdit({
        supId, date, val, emptyEntry: { date },
        targetId: prev ? prev.id : undefined,
        baseValue: prev && prev.supplier_payments ? prev.supplier_payments[supId] : undefined,
        newId: o2.newId || nextTestId(),
      }), `supplier(${date}/${supId})`);
    },
    // Delete addressed by id, built by the PRODUCTION builder, so the whole canonical
    // target row is the precondition (R10.1-GATE-017). `legacyBaseFields` exists only
    // so a negative control can still submit the superseded partial-base shape and
    // demonstrate what it failed to protect; nothing else uses it.
    del(date, opts2) {
      const o2 = opts2 || {};
      const rows = lane._state().desired || [];
      const prev = o2.byId ? (rows.find(r => r && r.id === o2.byId) || null)
                           : (rows.filter(r => r && r.date === date)[0] || null);
      if (!prev) return Promise.resolve({ status: "blocked", reason: "target_not_found" });
      if (o2.legacyBaseFields) {
        return guard(lane.submitIntent({ type: "delete_entry", target: { id: prev.id },
          base: { fields: o2.legacyBaseFields(prev) } }), `del-legacy(${prev.id})`);
      }
      const intent = ML.buildEntryDeleteIntent(prev, {});
      if (intent.status) return Promise.resolve({ status: intent.status });
      return guard(lane.submitIntent(intent), `del(${prev.id})`);
    },
    clearAll(opts2) {
      const o2 = opts2 || {};
      return guard(lane.submitClearAll({
        expectedNodeFingerprint: "expectedNodeFingerprint" in o2 ? o2.expectedNodeFingerprint : lane.currentFingerprint(),
        confirmToken: "confirmToken" in o2 ? o2.confirmToken : "tok-" + name,
      }), "clearAll");
    },
    submit(intent) { return guard(lane.submitIntent(intent), "submit(" + (intent && intent.type) + ")"); },
  };
  return client;
}
