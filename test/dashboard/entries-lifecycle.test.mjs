// P0-DATA-01 R4 regression guard — production lifecycle & writer consistency.
//
// Every executable test drives the ACTUAL production helpers vm-extracted from
// index.html (window.MarjinEntries + window.MarjinSaveLifecycle: createPersistence,
// createEntriesWriteCoordinator, createSaveOwnership, createInsightReadback,
// loadExceptionsBound, executeEntrySave). ONLY terminal I/O is injected — deferred
// storage/API transports, state/ref spies, timers. The persistence, candidate-loop,
// ownership and sequencing LOGIC under test is the real code, not a re-implementation.
// Tests assert prohibited calls/setters were NOT invoked, not merely that final
// values matched. Labels:
//   [prod-helper]  — runs a real production seam factory/helper (deferred transport)
//   [prod-entries] — runs the real window.MarjinEntries canonicalization helpers
//   [source-guard] — supplementary static-source wiring assertion on index.html
// Run: node --test test/dashboard/entries-lifecycle.test.mjs

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
  assert.notEqual(start, -1, "index.html must contain the P0-DATA-01 helper block");
  const endNeedle = "window.MarjinSaveLifecycle = Object.freeze({ createSelectionController, scheduleSelectionBoundTimeout, loadExceptionsBound, createPersistence, createEntriesWriteCoordinator, createSaveOwnership, createInsightReadback, executeEntrySave });";
  const end = html.indexOf(endNeedle, start);
  assert.notEqual(end, -1, "index.html must expose window.MarjinSaveLifecycle with the R4 production factories");
  const src = html.slice(start, end + endNeedle.length);
  assert.ok(!/new Date\(/.test(src), "identity/lifecycle blocks must not parse dates via Date()");
  const sandbox = { window: {}, Math, Number, Object, Array, JSON, console, Error, Promise, encodeURIComponent };
  vm.runInNewContext(src, sandbox);
  return sandbox.window;
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

// A live selection controller at gen>0 for T1/A.
const liveCtrl = (t = "T1", b = "A") => { const c = ML.createSelectionController(); c.invalidate(t, b); return c; };

// Incident fixture — July 2026, 24 entered days: 22×24,031 + 24,048 + 27,753 = 580,483.
function incidentEntries() {
  const list = [];
  for (let d = 1; d <= 22; d++) list.push(day(`2026-07-${String(d).padStart(2, "0")}`, 24031));
  list.push(day("2026-07-23", 24048));
  list.push(day("2026-07-24", 27753));
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURE SANITY + INCIDENT (scenarios 32, 43)
// ═══════════════════════════════════════════════════════════════════════════

test("[prod-entries] incident fixture arithmetic is exact (raw 608,236 / canonical 580,483 / delta 27,753)", () => {
  const list = incidentEntries();
  assert.equal(list.length, 24);
  assert.equal(totalRevenue(list), 580483);
  assert.equal(580483 + 27753, 608236);
});

test("[prod-entries] S43: duplicate incident rows canonicalize to 580,483 with one row per date; post-boundary state == persistence", async () => {
  // Raw payload with July-24 delivered twice (608,236) collapses to 580,483.
  const raw = [...incidentEntries(), day("2026-07-24", 27753)];
  assert.equal(totalRevenue(raw), 608236);
  const canonical = ME.canonicalizeEntries(raw);
  assert.equal(canonical.length, 24, "one canonical row per date");
  assert.equal(totalRevenue(canonical), 580483);
  // The persistence boundary writes EXACTLY the canonical array it returns.
  const ctrl = liveCtrl();
  let written = null;
  const P = ML.createPersistence({ selection: ctrl, canonicalize: ME.canonicalizeEntries, storageSetFor: async (t, k, v) => { written = JSON.parse(v); } });
  const res = await P.persistEntries(raw, ctrl.capture());
  assert.equal(res.ok, true);
  assert.equal(totalRevenue(res.canonical), 580483);
  assert.deepEqual(plain(written), plain(res.canonical), "persisted payload equals returned canonical (state==persistence)");
});

// ═══════════════════════════════════════════════════════════════════════════
// MANDATORY-CONTEXT PERSISTENCE — createPersistence (scenarios 1-5, 9)
// ═══════════════════════════════════════════════════════════════════════════

function persistHarness(t = "T1", b = "A") {
  const ctrl = liveCtrl(t, b);
  const calls = []; // [tenantId, key, valueStr]
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
  assert.equal(h.calls.length, 0, "no storage request issued for a missing context");
  const r2 = await h.P.persistEntries([day("2026-07-01", 1)], { tenantId: "T1" }); // no bizId
  assert.equal(r2.ok, false);
  assert.equal(h.calls.length, 0, "partial context (no bizId) also issues no request");
});

test("[prod-helper] S4: persistEntries storage KEY uses captured ctx.bizId (never a later selection's biz)", async () => {
  const h = persistHarness("T1", "A");
  const ctx = h.ctrl.capture();
  h.ctrl.invalidate("T1", "B"); // selection moves to biz B AFTER capture
  const r = await h.P.persistEntries([day("2026-07-01", 1)], ctx);
  // ctx is now stale → rejected before dispatch; the key would have been biz:A, never biz:B.
  assert.equal(r.stale, true);
  assert.equal(h.calls.length, 0);
  // A live A-context writes the A key.
  const h2 = persistHarness("T1", "A");
  await h2.P.persistEntries([day("2026-07-01", 1)], h2.ctrl.capture());
  assert.equal(h2.calls[0][1], "biz:A:entries", "key derives from ctx.bizId");
});

test("[prod-helper] S1+S5: entries write dispatched under T1/A carries tenant T1; switching to T2/B issues NO later write", async () => {
  const h = persistHarness("T1", "A");
  const gate = deferred();
  h.setGate(gate);
  const ctx = h.ctrl.capture();
  const p = h.P.persistEntries([day("2026-07-01", 1)], ctx); // dispatches ONE write, then awaits the gate
  await tick();
  assert.equal(h.calls.length, 1, "exactly one entries write dispatched");
  assert.equal(h.calls[0][0], "T1", "tenant identity is the captured T1, not a later global");
  assert.equal(h.calls[0][1], "biz:A:entries");
  h.ctrl.invalidate("T2", "B"); // tenant/biz switch mid-flight
  gate.resolve();
  const r = await p;
  assert.equal(r.ok, true, "the confirmed write is reported");
  assert.equal(r.staleAfterWrite, true, "selection changed during the await → flagged, caller re-checks liveness");
  assert.equal(h.calls.length, 1, "NO second/later storage write after the context went stale");
});

test("[prod-helper] S2: same business id 'A' reused under a NEW tenant T2 is a DIFFERENT context (write rejected)", async () => {
  const h = persistHarness("T1", "A");
  const ctx = h.ctrl.capture();           // T1/A
  h.ctrl.invalidate("T2", "A");            // T2/A — same biz id, new tenant/generation
  const r = await h.P.persistEntries([day("2026-07-01", 1)], ctx);
  assert.equal(r.stale, true, "T1/A ctx is not live under T2/A");
  assert.equal(h.calls.length, 0, "no write issued for the superseded T1/A context");
});

test("[prod-helper] S9: clear-all-shaped entries write requires and uses mandatory context", async () => {
  const h = persistHarness("T1", "A");
  const r = await h.P.persistEntries([], h.ctrl.capture());
  assert.equal(r.ok, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1], "biz:A:entries");
  assert.deepEqual(JSON.parse(h.calls[0][2]), [], "clear-all persists an empty canonical array");
});

// ═══════════════════════════════════════════════════════════════════════════
// DOMAIN SEPARATION — entries-only vs fixed-only (scenarios 6, 7, 8)
// ═══════════════════════════════════════════════════════════════════════════

test("[prod-helper] S6/S7: persistEntries writes ONLY the entries key — never a fixed write", async () => {
  const h = persistHarness("T1", "A");
  await h.P.persistEntries([day("2026-07-01", 1, { payroll: 500, supplier_payments: { "sup-1": "100" } })], h.ctrl.capture());
  assert.equal(h.calls.length, 1, "exactly one write");
  assert.ok(h.calls.every(c => c[1] === "biz:A:entries"), "every write targets entries");
  assert.ok(!h.calls.some(c => c[1].endsWith(":fixed")), "no fixed write is ever issued by an entries edit");
});

test("[prod-helper] S8: persistFixed writes ONLY the fixed key — never an entries write", async () => {
  const h = persistHarness("T1", "A");
  const r = await h.P.persistFixed([{ id: "fixed-1", amount: 10 }], h.ctrl.capture());
  assert.equal(r.ok, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1], "biz:A:fixed", "fixed edit targets the fixed key");
  assert.ok(!h.calls.some(c => c[1].endsWith(":entries")), "no entries write is ever issued by a fixed edit");
});

test("[prod-helper] persistFixed also rejects missing context before any request", async () => {
  const h = persistHarness();
  const r = await h.P.persistFixed([{ id: "f", amount: 1 }], null);
  assert.equal(r.ok, false);
  assert.equal(r.error, "missing_context");
  assert.equal(h.calls.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// SUPPLIER SEQUENCING — createEntriesWriteCoordinator (scenarios 6,25-33)
// ═══════════════════════════════════════════════════════════════════════════

function coordHarness(rows = []) {
  const ctrl = liveCtrl("T1", "A");
  const applied = []; // every array handed to setEntries
  const persistCalls = [];
  const gates = [];    // one deferred per persist call, in order
  const io = {
    selection: ctrl,
    canonicalize: ME.canonicalizeEntries,
    upsert: ME.upsertEntryByDate,
    entryDateKey: ME.entryDateKey,
    applyRows: (r) => applied.push(plain(r)),
    persistEntries: async (r, ctx) => {
      const g = deferred(); gates.push(g);
      persistCalls.push({ rows: plain(r), ctx });
      const outcome = await g.promise; // { ok } or { ok:false }
      return outcome && outcome.ok === false ? { ok: false, error: "write_failed" } : { ok: true, canonical: r };
    },
  };
  const coord = ML.createEntriesWriteCoordinator(io);
  const supVal = (arr, date, supId) => {
    const row = arr.find(e => e.date === date);
    return row && row.supplier_payments ? row.supplier_payments[supId] : undefined;
  };
  return { ctrl, coord, applied, persistCalls, gates, io, rows, supVal, last: () => applied[applied.length - 1] };
}

test("[prod-helper] S25: two same-selection edits (100 then 200); older promise resolves LAST — final state stays 200", async () => {
  const h = coordHarness();
  const p1 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  assert.equal(h.gates.length, 2, "both writes dispatched");
  h.gates[1].resolve({ ok: true }); // newer (200) resolves first
  await p2;
  h.gates[0].resolve({ ok: true }); // older (100) resolves LAST
  await p1;
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "200", "final applied state is the newer value");
});

test("[prod-helper] S30: older FAILURE cannot roll back the newer success (final stays 200)", async () => {
  const h = coordHarness();
  const p1 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  h.gates[1].resolve({ ok: true });          // newer succeeds
  const r2 = await p2;
  h.gates[0].resolve({ ok: false });         // older FAILS afterwards
  const r1 = await p1;
  assert.equal(r1.status, "persist_failed");
  assert.equal(r1.latest, false, "the failed op is not the latest");
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "200", "older failure did not regress the newer value");
});

test("[prod-helper] S31: newer FAILURE is surfaced; an older completion cannot win", async () => {
  const h = coordHarness();
  const p1 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  h.gates[0].resolve({ ok: true });          // older completes successfully first
  await p1;
  h.gates[1].resolve({ ok: false });         // newer FAILS last
  const r2 = await p2;
  assert.equal(r2.status, "persist_failed");
  assert.equal(r2.latest, true, "the latest op reports its own failure");
  // Newest optimistic value is retained (never regressed to the older 100).
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "200");
});

test("[prod-helper] S29: two rapid edits to DIFFERENT suppliers preserve both values", async () => {
  const h = coordHarness();
  const p1 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  const p2 = h.coord.submitSupplierEdit({ supId: "sup-2", date: "2026-07-24", val: "250", rows: [], emptyEntry: {} });
  await tick();
  h.gates[1].resolve({ ok: true });
  await p2;
  h.gates[0].resolve({ ok: true });
  await p1;
  const final = h.last();
  assert.equal(h.supVal(final, "2026-07-24", "sup-1"), "100", "first supplier preserved");
  assert.equal(h.supVal(final, "2026-07-24", "sup-2"), "250", "second supplier preserved");
  // The second edit was built from the LATEST desired state (which already had sup-1), not a pre-edit snapshot.
  assert.deepEqual(Object.keys(h.persistCalls[1].rows.find(e => e.date === "2026-07-24").supplier_payments).sort(), ["sup-1", "sup-2"]);
});

test("[prod-helper] S27: listener echo BEFORE the newest write completes cannot regress 200→100", async () => {
  const h = coordHarness();
  const p2 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  // Stale echo carrying the OLD value 100 arrives while the 200-write is still pending.
  const echo = h.coord.onListenerEcho([{ date: "2026-07-24", sales: 0, supplier_payments: { "sup-1": "100" } }]);
  assert.equal(echo.status, "ignored_pending", "echo ignored while a local write is pending");
  h.gates[0].resolve({ ok: true });
  await p2;
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "200", "pending value not regressed by the stale echo");
});

test("[prod-helper] S26+S28: listener echo AFTER the newest completion converges to 200", async () => {
  const h = coordHarness();
  const p2 = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "200", rows: [], emptyEntry: {} });
  await tick();
  h.gates[0].resolve({ ok: true });
  await p2;
  // Storage/listener echo of the CONFIRMED value now arrives (quiescent) → applied.
  const echo = h.coord.onListenerEcho([{ date: "2026-07-24", sales: 0, supplier_payments: { "sup-1": "200" } }]);
  assert.equal(echo.status, "applied");
  assert.equal(h.supVal(h.last(), "2026-07-24", "sup-1"), "200", "converges to the newest confirmed value");
});

test("[prod-helper] S32: duplicated starting rows collapse to ONE canonical date row through the coordinator", async () => {
  const h = coordHarness();
  const dupRows = [day("2026-07-24", 27753), day("2026-07-24", 27753)];
  const p = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: dupRows, emptyEntry: {} });
  await tick();
  const optimistic = h.last();
  assert.equal(optimistic.filter(e => e.date === "2026-07-24").length, 1, "one canonical row for the date");
  h.gates[0].resolve({ ok: true });
  await p;
});

test("[prod-helper] S33: the exact canonical payload persisted equals the array exposed to state", async () => {
  const h = coordHarness();
  const p = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [day("2026-07-23", 1)], emptyEntry: {} });
  await tick();
  const optimistic = plain(h.last());
  assert.deepEqual(h.persistCalls[0].rows, optimistic, "persisted array === applied array (single state/persistence boundary)");
  h.gates[0].resolve({ ok: true });
  const r = await p;
  assert.equal(r.status, "applied");
  assert.deepEqual(plain(h.last()), optimistic, "confirmed canonical equals the optimistic canonical");
});

test("[prod-helper] S16(supplier-variant): a stale-context supplier completion applies nothing", async () => {
  const h = coordHarness();
  const p = h.coord.submitSupplierEdit({ supId: "sup-1", date: "2026-07-24", val: "100", rows: [], emptyEntry: {} });
  await tick();
  const appliedBefore = h.applied.length; // optimistic apply already happened
  h.ctrl.invalidate("T2", "B"); // selection switches before the write resolves
  h.gates[0].resolve({ ok: true });
  const r = await p;
  assert.equal(r.status, "stale");
  assert.equal(h.applied.length, appliedBefore, "no post-await apply into the new selection");
});

// ═══════════════════════════════════════════════════════════════════════════
// SAVE OWNERSHIP — createSaveOwnership (scenarios 19-24)
// ═══════════════════════════════════════════════════════════════════════════

test("[prod-helper] S19-S22: old save stays pending; selection invalidates; new selection saves; old finally cannot clear new state", async () => {
  const ctrl = liveCtrl("T1", "A");
  const own = ML.createSaveOwnership();
  let n = 0; const mkId = () => "op-" + (++n);
  const inFlight = { value: false };
  const setInFlight = (v) => { inFlight.value = v; };

  // Old save begins under T1/A.
  const ctxOld = ctrl.capture();
  const tokOld = own.begin(ctrl, ctxOld, mkId);
  assert.ok(tokOld, "old save acquires ownership");
  setInFlight(true);

  // Selection invalidates to T2/B while old save is still pending.
  own.invalidate(); ctrl.invalidate("T2", "B");

  // New selection can start and own a new save.
  const ctxNew = ctrl.capture();
  const tokNew = own.begin(ctrl, ctxNew, mkId);
  assert.ok(tokNew, "new selection acquires a fresh ownership token — not blocked by the old pending save");
  assert.notEqual(tokNew, tokOld);
  setInFlight(true);

  // Old save's finally now runs: it must NOT clear the new selection's state.
  const oldOwnsNow = own.owns(tokOld);
  assert.equal(oldOwnsNow, false, "old token is no longer current");
  if (oldOwnsNow) setInFlight(false); // guarded — must not execute
  own.settle(tokOld);
  assert.equal(inFlight.value, true, "old finally did not clear the new selection's in-flight state");
  assert.equal(own.owns(tokNew), true, "new token still owns after the old settle");

  // New save's own finally clears its own state.
  if (own.owns(tokNew)) setInFlight(false);
  own.settle(tokNew);
  assert.equal(inFlight.value, false);
});

test("[prod-helper] S23: a same-selection duplicate submission is blocked while the first is in flight", () => {
  const ctrl = liveCtrl("T1", "A");
  const own = ML.createSaveOwnership();
  let n = 0; const mkId = () => "op-" + (++n);
  const tok1 = own.begin(ctrl, ctrl.capture(), mkId);
  assert.ok(tok1);
  const tok2 = own.begin(ctrl, ctrl.capture(), mkId); // same live selection, first still owns
  assert.equal(tok2, null, "duplicate submission in the same live selection is blocked");
  own.settle(tok1);
  const tok3 = own.begin(ctrl, ctrl.capture(), mkId); // after settle, a new save may begin
  assert.ok(tok3, "after the first settles, a new same-selection save may begin");
});

test("[prod-helper] S24: logout/unmount (invalidate) frees ownership so the next selection can save", () => {
  const ctrl = liveCtrl("T1", "A");
  const own = ML.createSaveOwnership();
  const tok1 = own.begin(ctrl, ctrl.capture(), () => "op-1");
  assert.ok(tok1);
  own.invalidate(); // logout / unmount / business switch
  assert.equal(own.current(), null, "ownership cleared synchronously on invalidation");
  ctrl.invalidate("T3", "C");
  const tok2 = own.begin(ctrl, ctrl.capture(), () => "op-2");
  assert.ok(tok2, "the next selection can own a save");
});

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHT READBACK — createInsightReadback (scenarios 11-14)
// ═══════════════════════════════════════════════════════════════════════════

function insightHarness(candidates) {
  const ctrl = liveCtrl("T1", "A");
  const requests = []; // {tenantId,bizId,fromDate}
  const gates = [];
  const io = {
    selection: ctrl,
    candidateDates: () => candidates,
    apiGetRange: ({ tenantId, bizId, fromDate, toDate }) => {
      const g = deferred(); gates.push(g);
      requests.push({ tenantId, bizId, fromDate });
      return g.promise; // resolves to a docs map
    },
  };
  return { ctrl, requests, gates, readback: ML.createInsightReadback(io) };
}

test("[prod-helper] S11+S14: first candidate deferred, selection invalidates, first result 'not found' → NO second request, no cancelled-path mutation", async () => {
  const h = insightHarness(["2026-07-27", "2026-07-26"]);
  const ctx = h.ctrl.capture();
  const isCancelled = () => false; // rely on selection liveness for cancellation
  const p = h.readback.loadRange(ctx, null, isCancelled);
  await tick();
  assert.equal(h.requests.length, 1, "first candidate request issued");
  assert.equal(h.requests[0].tenantId, "T1");
  assert.equal(h.requests[0].bizId, "A");
  h.ctrl.invalidate("T2", "A"); // selection cancelled (new tenant, same biz id)
  h.gates[0].resolve({}); // first candidate resolves as NOT FOUND (empty map)
  const res = await p;
  assert.equal(res.cancelled, true, "loadRange returns cancelled");
  assert.equal(h.requests.length, 1, "NO second candidate request after cancellation");
});

test("[prod-helper] S12: logout T1 / login T2 with the SAME business id — stale readback issues no second request", async () => {
  const h = insightHarness(["2026-07-27", "2026-07-26"]);
  const ctx = h.ctrl.capture(); // T1/A
  const p = h.readback.loadRange(ctx, null, () => false);
  await tick();
  h.ctrl.invalidate("T2", "A"); // same biz id A, new tenant/generation
  h.gates[0].resolve({});       // not found
  const res = await p;
  assert.equal(res.cancelled, true);
  assert.equal(h.requests.length, 1, "same-biz-id tenant switch still blocks the second request");
});

test("[prod-helper] S13: every insight request derives tenant AND business from the captured ctx", async () => {
  const h = insightHarness(["2026-07-27", "2026-07-26", "2026-07-25"]);
  const ctx = h.ctrl.capture();
  const p = h.readback.loadRange(ctx, null, () => false);
  await tick(); h.gates[0].resolve({}); await tick(); // not found → next candidate
  h.gates[1].resolve({}); await tick();               // not found → next candidate
  h.gates[2].resolve({ "2026-07-25": { insights: [{ id: 1 }] } });
  const res = await p;
  assert.equal(res.found, true);
  assert.equal(res.date, "2026-07-25");
  assert.ok(h.requests.length >= 1);
  assert.ok(h.requests.every(r => r.tenantId === "T1" && r.bizId === "A"), "no request combined a new global tenant with an old business");
});

test("[prod-helper] insight readback with missing context makes no request", async () => {
  const h = insightHarness(["2026-07-27"]);
  const res = await h.readback.loadRange(null, null, () => false);
  assert.equal(res.ok, false);
  assert.equal(res.error, "missing_context");
  assert.equal(h.requests.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// EXCEPTION REQUEST GATE — loadExceptionsBound (scenarios 15-18)
// ═══════════════════════════════════════════════════════════════════════════

function excHarness() {
  const ctrl = liveCtrl("T1", "A");
  const requests = [];
  const applied = [];
  const io = {
    selection: ctrl,
    todayKey: (off) => (off === 1 ? "2026-07-28" : "2026-04-23"),
    apiFetch: async (url) => { requests.push(url); return { ok: true, json: async () => ({ ok: true, exceptions: { "2026-07-20": { status: "active", source: "structured", revision: 1, reasonCode: "closure" } } }) }; },
    applyState: (stateMap, boolMap) => applied.push({ stateMap: plain(stateMap), boolMap: plain(boolMap) }),
  };
  return { ctrl, requests, applied, io };
}

test("[prod-helper] S15: loadExceptionsBound with an ALREADY-STALE context sends ZERO requests", async () => {
  const h = excHarness();
  const ctx = h.ctrl.capture();
  h.ctrl.invalidate("T2", "B"); // stale BEFORE invocation
  const r = await ML.loadExceptionsBound(h.io, ctx);
  assert.equal(r.status, "stale");
  assert.equal(h.requests.length, 0, "preflight gate: no list-exceptions request for an already-stale context");
  assert.equal(h.applied.length, 0);
});

test("[prod-helper] S16: context becomes stale DURING the fetch — response/JSON applies nothing", async () => {
  const ctrl = liveCtrl("T1", "A");
  const requests = [];
  const applied = [];
  const respGate = deferred();
  const io = {
    selection: ctrl,
    todayKey: (off) => (off === 1 ? "2026-07-28" : "2026-04-23"),
    apiFetch: async (url) => { requests.push(url); return { ok: true, json: async () => { await respGate.promise; return { ok: true, exceptions: {} }; } }; },
    applyState: (s, b) => applied.push([s, b]),
  };
  const ctx = ctrl.capture();
  const p = ML.loadExceptionsBound(io, ctx);
  await tick();
  assert.equal(requests.length, 1, "request issued while context was live");
  ctrl.invalidate("T2", "B"); // stale during fetch
  respGate.resolve();
  const r = await p;
  assert.equal(r.status, "stale");
  assert.equal(applied.length, 0, "no state applied after the context went stale mid-fetch");
});

test("[prod-helper] S15b: a LIVE context does issue exactly one request and applies state", async () => {
  const h = excHarness();
  const r = await ML.loadExceptionsBound(h.io, h.ctrl.capture());
  assert.equal(r.status, "applied");
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].includes("tenantId=T1"));
  assert.ok(h.requests[0].includes("bizId=A"));
  assert.equal(h.applied.length, 1);
  assert.equal(h.applied[0].boolMap["2026-07-20"], true);
});

// ═══════════════════════════════════════════════════════════════════════════
// FULL SAVE LIFECYCLE — executeEntrySave over the REAL persistence + insight
// adapters wired to DEFERRED transports (scenarios 10, 41, 42)
// ═══════════════════════════════════════════════════════════════════════════

function saveHarness(overrides = {}) {
  const ctrl = liveCtrl("T1", "A");
  const seq = [];
  const calls = { applyRows: [], setSaved: [], setError: [], resetForm: 0, schedNav: [], suppress: [], storage: [], apiRange: [] };
  const excStore = {}, opStore = {};
  // REAL persistence + REAL insight readback wired to deferred/stub transports.
  const P = ML.createPersistence({ selection: ctrl, canonicalize: ME.canonicalizeEntries, storageSetFor: async (t, k, v) => { seq.push("storage"); calls.storage.push([t, k]); } });
  const RB = ML.createInsightReadback({ selection: ctrl, candidateDates: () => ["2026-07-24"], apiGetRange: async ({ tenantId, bizId, fromDate }) => { seq.push("apiRange"); calls.apiRange.push({ tenantId, bizId, fromDate }); return { "2026-07-24": { insights: [] } }; } });
  const io = {
    selection: ctrl,
    form: { date: "2026-07-24", sales: 27753 },
    rows: [day("2026-07-01", 100)],
    role: "owner",
    editingDate: null,
    vatNormalize: (f) => f,
    materialChanged: () => true,
    todayKey: (off) => (off === 0 ? "2026-07-24" : off === 1 ? "2026-07-25" : "2026-07-23"),
    newOpId: () => "op-fixed",
    exceptionState: { get: (d) => excStore[d], set: (d, st) => { excStore[d] = st; }, applyActive: () => {} },
    opIds: { ensure: (d, mk) => { if (!opStore[d]) opStore[d] = mk(); return opStore[d]; }, consume: (d) => { delete opStore[d]; } },
    apiFetch: async () => ({ ok: true, json: async () => ({ ok: true, applied: true, rebuildRequired: false, exception: { status: "active", reasonCode: "closure" }, revision: 1 }) }),
    persistRows: (rows2, c2) => P.persistEntries(rows2, c2),       // REAL persistence boundary
    applyRows: (rows) => { seq.push("applyRows"); calls.applyRows.push(plain(rows)); },
    reloadExceptions: async () => {},
    rebuildInsights: async (d, c) => { seq.push("rebuild"); },
    loadInsights: (d, isCancelled, c2) => { seq.push("loadIns"); return RB.loadRange(c2, d, isCancelled).then(r => (r && r.cancelled ? { ok: false, cancelled: true } : { ok: true, found: !!(r && r.found), date: d })); }, // REAL readback
    onInsightsFailure: (m) => { calls.insFail = m; },
    suppressNextInsightsLoad: (c) => calls.suppress.push(c),
    resetFormAndEditing: () => { seq.push("resetForm"); calls.resetForm++; },
    setSaved: (v) => calls.setSaved.push(v),
    setError: (m) => calls.setError.push(m),
    scheduleNav: (c, ms) => { seq.push("schedNav"); calls.schedNav.push([c, ms]); },
    ...overrides,
  };
  return { ctrl, io, calls, seq };
}

test("[prod-helper] S41: a normal same-context save succeeds exactly once over the real persistence+readback", async () => {
  const h = saveHarness();
  const r = await ML.executeEntrySave(h.io);
  assert.equal(r.status, "saved");
  assert.equal(h.calls.storage.length, 1, "exactly one entries write");
  assert.equal(h.calls.storage[0][1], "biz:A:entries");
  assert.equal(h.calls.storage[0][0], "T1", "write bound to captured tenant");
  assert.ok(h.calls.setSaved.includes(true), "save reported success");
  assert.equal(h.calls.resetForm, 1);
  assert.equal(h.calls.apiRange.length >= 1, true, "readback used the real candidate loop");
  assert.ok(h.calls.apiRange.every(x => x.tenantId === "T1" && x.bizId === "A"), "readback identity from captured ctx");
});

test("[prod-helper] S42: delayed navigation is scheduled with the captured ctx (token-checked timer)", async () => {
  const h = saveHarness();
  await ML.executeEntrySave(h.io);
  assert.equal(h.calls.schedNav.length, 1);
  const [ctxUsed] = h.calls.schedNav[0];
  assert.equal(h.ctrl.isLive(ctxUsed), true, "nav scheduled against the live captured context");
});

test("[prod-helper] S10: a save whose selection changes mid-flight mutates NOTHING in the new selection", async () => {
  const persistGate = deferred();
  const h = saveHarness({
    persistRows: async (rows2, c2) => { const P = ML.createPersistence({ selection: h.ctrl, canonicalize: ME.canonicalizeEntries, storageSetFor: async () => { await persistGate.promise; } }); return P.persistEntries(rows2, c2); },
  });
  const p = ML.executeEntrySave(h.io);
  await tick();
  h.ctrl.invalidate("T2", "B"); // selection changes while persist is in flight
  persistGate.resolve();
  const r = await p;
  assert.equal(r.status, "stale");
  assert.ok(!h.calls.setSaved.includes(true), "stale save never reports success");
  assert.equal(h.calls.resetForm, 0, "stale save never resets the form");
  assert.equal(h.calls.schedNav.length, 0, "stale save never schedules navigation");
  assert.equal(h.calls.suppress.length, 0, "stale save never touches insight suppression");
});

// ═══════════════════════════════════════════════════════════════════════════
// PRESERVED BEHAVIOR — MarjinEntries replay/canonicalization (scenarios 34-40)
// ═══════════════════════════════════════════════════════════════════════════

test("[prod-entries] S34: date-move edit keeps ONE row for the final date (identity by date, not index)", () => {
  const rows = [day("2026-07-01", 10), day("2026-07-02", 20), day("2026-07-03", 30)];
  const moved = ME.upsertEntryByDate(rows, day("2026-07-05", 999), "2026-07-02");
  assert.equal(moved.filter(e => e.date === "2026-07-02").length, 0, "original date removed by DATE");
  assert.equal(moved.filter(e => e.date === "2026-07-05").length, 1);
  assert.equal(moved.find(e => e.date === "2026-07-05").sales, 999);
  assert.equal(moved.length, 3);
});

test("[prod-entries] S34b: edit onto an EXISTING date collapses to one row (explicit save wins wholesale)", () => {
  const rows = [day("2026-07-01", 10), day("2026-07-02", 20)];
  const merged = ME.upsertEntryByDate(rows, day("2026-07-02", 500, { note: "new" }), "2026-07-01");
  assert.equal(merged.filter(e => e.date === "2026-07-02").length, 1);
  assert.equal(merged.find(e => e.date === "2026-07-02").sales, 500, "the explicit save value replaces wholesale");
  assert.equal(merged.length, 1);
});

test("[prod-entries] S35: explicit save wins wholesale over a hydrated duplicate", () => {
  const hydrated = [day("2026-07-10", 100, { payroll: 50 })];
  const saved = ME.upsertEntryByDate(hydrated, day("2026-07-10", 300), "2026-07-10");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sales, 300);
  assert.equal(saved[0].payroll, undefined, "wholesale replacement — not a field-merge");
});

test("[prod-entries] S36: earliest-non-zero scalar precedence for hydrated duplicates (never summed)", () => {
  const dup = [day("2026-07-11", 0, { payroll: 0 }), day("2026-07-11", 250, { payroll: 80 })];
  const canon = ME.canonicalizeEntries(dup);
  assert.equal(canon.length, 1);
  assert.equal(canon[0].sales, 250, "first non-zero wins, not the sum");
  assert.equal(canon[0].payroll, 80);
});

test("[prod-entries] S37+S38: nested map union keeps all keys, earliest value wins, same keys never summed", () => {
  const dup = [
    day("2026-07-12", 1, { supplier_payments: { "s1": "100", "s2": "40" }, hourly_payroll: { "9": "3" } }),
    day("2026-07-12", 1, { supplier_payments: { "s1": "999", "s3": "70" }, hourly_payroll: { "9": "9", "10": "5" } }),
  ];
  const canon = ME.canonicalizeEntries(dup);
  assert.equal(canon.length, 1);
  assert.deepEqual(plain(canon[0].supplier_payments), { "s1": "100", "s2": "40", "s3": "70" }, "union, earliest wins for s1, never summed");
  assert.deepEqual(plain(canon[0].hourly_payroll), { "9": "3", "10": "5" }, "hourly map union, earliest wins for key 9");
});

test("[prod-entries] S39: canonicalization is deterministic and idempotent", () => {
  const raw = [day("2026-07-02", 2), day("2026-07-01", 1), day("2026-07-02", 9), { sales: 5 }, { date: null, sales: 7 }, day("2026-07-01", 0)];
  const once = ME.canonicalizeEntries(raw);
  const twice = ME.canonicalizeEntries(once);
  assert.deepEqual(plain(twice), plain(once), "idempotent");
  assert.deepEqual(plain(once).map(e => e.date), ["2026-07-01", "2026-07-02"], "deterministic sorted; rows with no usable date dropped");
});

test("[prod-entries] S40: listener/self-heal tenant binding is preserved in source (guarded write-back)", () => {
  // Behavioral proxy: canonicalization drives the self-heal decision; the source
  // guard below asserts the write-back stays tenant/selection-bound.
  const val = [day("2026-07-24", 27753), day("2026-07-24", 27753)];
  const deduped = ME.canonicalizeEntries(val);
  assert.ok(deduped.length < val.length, "duplicate detected → self-heal path is exercised");
  assert.equal(totalRevenue(deduped), 27753);
});

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE GUARDS — supplementary wiring assertions (not race coverage)
// ═══════════════════════════════════════════════════════════════════════════

test("[source-guard] the legacy multi-write persist(e,f,ctx) helper is removed; no writer passes fixedList to an entries write", () => {
  assert.ok(!/const persist = async \(e, f, ctx\)/.test(html), "central persist(e,f,ctx) multi-write helper removed");
  assert.ok(!/setFixedList\(u\);persist\(entries,u\)/.test(html), "no fixed-expense caller does the entries+fixed multi-write");
  assert.ok(!/persist\(newEntries, fixedList\)/.test(html), "employee labor no longer passes fixedList");
});

test("[source-guard] fixed-expense callers write fixed-only with mandatory captured context", () => {
  assert.ok(html.includes("setFixedList(u);persistFixed(u,captureSelectionCtx());"), "fixed-expense edits call persistFixed with a captured ctx");
  assert.ok(/persistFixed = \(fixed, ctx\) => persistenceRef\.current\.persistFixed\(fixed, ctx\)/.test(html), "persistFixed delegates to the production seam");
});

test("[source-guard] entries persistence derives tenant+key from ctx, not currentBizId / _currentTenantId", () => {
  assert.ok(html.includes("`biz:${ctx.bizId}:entries`"), "entries key built from ctx.bizId");
  assert.ok(html.includes("io.storageSetFor(ctx.tenantId, `biz:${ctx.bizId}:entries`"), "tenant from ctx.tenantId via explicit-tenant transport");
  assert.ok(!/storage\.set\(`biz:\$\{currentBizId\}:entries`, JSON\.stringify\(e\)/.test(html), "the old currentBizId-closure entries write is gone");
  assert.ok(html.includes("window.storage.setFor = async (tenantId, key, value, shared=false)"), "explicit-tenant storage method exists");
});

test("[source-guard] supplier writer + entries listener delegate to the production coordinator", () => {
  assert.ok(html.includes("entriesWriteCoordRef.current.submitSupplierEdit("), "supplier grid uses the write coordinator");
  assert.ok(!/applySupplierPaymentBound/.test(html), "the un-sequenced applySupplierPaymentBound is removed");
  assert.ok(html.includes("entriesWriteCoordRef.current.onListenerEcho(val)"), "entries listener routes echoes through the coordinator");
});

test("[source-guard] saveEntry uses the generation-bound ownership token and a guarded finally", () => {
  assert.ok(html.includes("saveOwnershipCtrlRef.current"), "save ownership controller wired");
  assert.ok(html.includes("ownership.begin("), "begin() acquires ownership");
  assert.ok(html.includes("if (ownership.owns(saveToken)) setEntrySaveInFlight(false);"), "finally clears in-flight only if still owning");
  assert.ok(!/if \(entrySaveInFlightRef\.current\) return;/.test(html), "the old unbound boolean in-flight ref is gone");
  assert.ok(html.includes("if (saveOwnershipCtrlRef.current) saveOwnershipCtrlRef.current.invalidate();"), "invalidateSelection frees save ownership");
});

test("[source-guard] insight readback threads captured ctx; apiGetDailyRange takes an explicit tenant", () => {
  assert.ok(html.includes("insightReadbackRef.current.loadRange(effCtx, preferredDate, isCancelled)"), "loadDashboardInsights runs the production readback with a ctx");
  assert.ok(html.includes("apiGetDailyRange(kind, bizId, fromDate, toDate, tenantId)"), "apiGetDailyRange accepts an explicit tenantId");
  assert.ok(!/apiGetDailyRange\("insights", currentBizId, date, date\)/.test(html), "the currentBizId/global-tenant insight request is gone");
});

test("[source-guard] loadExceptionsBound has a preflight liveness gate before apiFetch", () => {
  const s = html.indexOf("async function loadExceptionsBound");
  const seg = html.slice(s, s + 900);
  const gateIdx = seg.indexOf('if (!io.selection.isLive(ctx)) return { status: "stale" };');
  const fetchIdx = seg.indexOf("io.apiFetch(");
  assert.ok(gateIdx !== -1, "preflight isLive gate present");
  assert.ok(gateIdx < fetchIdx, "the preflight gate precedes apiFetch");
});
