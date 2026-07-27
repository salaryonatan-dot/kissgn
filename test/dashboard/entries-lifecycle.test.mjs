// P0-DATA-01 + R2 + R3 regression guard: duplicate revenue, entry identity,
// replay safety, and selection-bound async lifecycle.
// Executable tests run the ACTUAL production seams vm-extracted from index.html
// (window.MarjinEntries + window.MarjinSaveLifecycle) with injected deferred
// promises and spies — they prove prohibited callbacks were NOT invoked, not
// merely that final values matched. Source-structure assertions remain only as
// supplementary wiring guards and are marked [source-guard].
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
  const endNeedle = "window.MarjinSaveLifecycle = Object.freeze({ createSelectionController, scheduleSelectionBoundTimeout, loadExceptionsBound, applySupplierPaymentBound, executeEntrySave });";
  const end = html.indexOf(endNeedle, start);
  assert.notEqual(end, -1, "index.html must expose window.MarjinSaveLifecycle for focused tests");
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
const supplierTotal = (list) =>
  list.reduce((a, e) => a + Object.values(e.supplier_payments || {}).reduce((s, v) => s + (Number(v) || 0), 0), 0);
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };
const tick = () => new Promise((r) => setImmediate(r));

// Incident fixture — July 2026, 24 entered days: 22×24,031 + 24,048 + 27,753 = 580,483.
function incidentEntries() {
  const list = [];
  for (let d = 1; d <= 22; d++) list.push(day(`2026-07-${String(d).padStart(2, "0")}`, 24031));
  list.push(day("2026-07-23", 24048));
  list.push(day("2026-07-24", 27753));
  return list;
}

// ── Executable save-lifecycle harness (drives the real executeEntrySave) ─────
function makeSaveHarness(overrides = {}) {
  const ctrl = ML.createSelectionController();
  ctrl.invalidate("T1", "A"); // live context: gen 1, tenant T1, business A
  const seq = [];
  const calls = {
    applyRows: [], setSaved: [], setError: [], resetForm: 0, schedNav: [],
    rebuild: [], loadIns: [], reloadExc: [], suppress: [], excSet: [], excActive: [], opConsumed: [], api: [],
  };
  const excStore = {};
  const opStore = {};
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
    exceptionState: {
      get: (d) => excStore[d],
      set: (d, st) => { calls.excSet.push([d, st]); excStore[d] = st; },
      applyActive: (d, a) => calls.excActive.push([d, a]),
    },
    opIds: {
      ensure: (d, mk) => { if (!opStore[d]) opStore[d] = mk(); return opStore[d]; },
      consume: (d) => { calls.opConsumed.push(d); delete opStore[d]; },
    },
    apiFetch: async (url, opts) => { seq.push("api"); calls.api.push([url, opts && opts.body ? JSON.parse(opts.body) : null]); return { ok: true, json: async () => ({ ok: true, applied: true, rebuildRequired: false, exception: { status: "active", reasonCode: "closure" }, revision: 1 }) }; },
    persistRows: async (rows) => { seq.push("persist"); return { ok: true, canonical: rows }; },
    applyRows: (rows) => { seq.push("applyRows"); calls.applyRows.push(rows); },
    reloadExceptions: async (c) => { calls.reloadExc.push(c); },
    rebuildInsights: async (d, c) => { seq.push("rebuild"); calls.rebuild.push([d, c]); },
    loadInsights: async (d) => { seq.push("loadIns"); calls.loadIns.push(d); return { ok: true, found: true, date: d }; },
    onInsightsFailure: (m) => { calls.insFail = m; },
    suppressNextInsightsLoad: (c) => calls.suppress.push(c),
    resetFormAndEditing: () => { seq.push("resetForm"); calls.resetForm++; },
    setSaved: (v) => calls.setSaved.push(v),
    setError: (m) => calls.setError.push(m),
    scheduleNav: (c, ms) => { seq.push("schedNav"); calls.schedNav.push([c, ms]); },
    ...overrides,
  };
  return { ctrl, io, calls, seq, excStore, opStore };
}
function assertNoNewSelectionMutation(calls, { allowApply = 0 } = {}) {
  assert.equal(calls.applyRows.length, allowApply, "stale save must not apply rows");
  assert.equal(calls.resetForm, 0, "stale save must not reset the form/editing state");
  assert.ok(!calls.setSaved.includes(true), "stale save must not set saved state");
  assert.equal(calls.schedNav.length, 0, "stale save must not schedule navigation");
  assert.equal(calls.suppress.length, 0, "stale save must not touch insight suppression");
}

// ═══ FIXTURE SANITY ══════════════════════════════════════════════════════════

test("incident fixture arithmetic is exact", () => {
  const list = incidentEntries();
  assert.equal(list.length, 24);
  assert.equal(totalRevenue(list), 580483);
  assert.equal(580483 + 27753, 608236);
});

// ═══ EXECUTABLE RACE TESTS — save lifecycle (scenarios 1-6, 9-13, 20-23) ═════

test("R3-20: invalidate advances the generation synchronously; same biz id under a new tenant is a different context", () => {
  const ctrl = ML.createSelectionController();
  ctrl.invalidate("T1", "A");
  const ctx = ctrl.capture();
  assert.ok(ctrl.isLive(ctx));
  const next = ctrl.invalidate("T2", "A"); // scenario 5: same business-id string, tenant T2
  assert.equal(next.gen, ctx.gen + 1, "generation must advance immediately");
  assert.ok(!ctrl.isLive(ctx), "old context is stale the moment invalidate returns");
  assert.ok(ctrl.isLive(ctrl.capture()));
});

test("R3-1: business A→B after persist resolves but before rebuild — no rebuild, no state, no reset (scenarios 1, 12, 13)", async () => {
  const h = makeSaveHarness({
    persistRows: async (rows) => { h.ctrl.invalidate("T1", "B"); return { ok: true, canonical: rows }; },
  });
  const out = await ML.executeEntrySave(h.io);
  assert.equal(out.status, "stale");
  assert.equal(h.calls.rebuild.length, 0, "stale save must not send a rebuild request");
  assert.equal(h.calls.loadIns.length, 0, "stale save must not send an insight read");
  assertNoNewSelectionMutation(h.calls);
});

test("R3-2: business switch while the insights rebuild is pending — readback never sent, nothing mutated after", async () => {
  const gate = deferred();
  const h = makeSaveHarness({
    rebuildInsights: async (d, c) => { h.calls.rebuild.push([d, c]); await gate.promise; },
  });
  const run = ML.executeEntrySave(h.io);
  await tick(); await tick(); await tick(); await tick();
  assert.equal(h.calls.applyRows.length, 1, "rows applied once while still live");
  h.ctrl.invalidate("T1", "B"); // switch while rebuild pending
  gate.resolve();
  const out = await run;
  assert.equal(out.status, "stale");
  assert.equal(h.calls.loadIns.length, 0, "insight readback must not be sent for a stale save");
  assert.equal(h.calls.resetForm, 0);
  assert.ok(!h.calls.setSaved.includes(true));
  assert.equal(h.calls.schedNav.length, 0);
});

test("R3-3: business switch while dashboard-insight readback is pending — no failure handling, no reset, no nav", async () => {
  const gate = deferred();
  const h = makeSaveHarness({
    loadInsights: async (d) => { h.calls.loadIns.push(d); await gate.promise; return { ok: false }; },
  });
  const run = ML.executeEntrySave(h.io);
  await tick(); await tick(); await tick(); await tick(); await tick();
  h.ctrl.invalidate("T1", "B");
  gate.resolve();
  const out = await run;
  assert.equal(out.status, "stale");
  assert.equal(h.calls.insFail, undefined, "stale readback must not trigger insight-failure state");
  assert.equal(h.calls.suppress.length, 0);
  assert.equal(h.calls.resetForm, 0);
  assert.equal(h.calls.schedNav.length, 0);
});

test("R3-4: logout T1 → initialize T2 → old T1 save resolves — terminated silently (scenarios 4, 12)", async () => {
  const gate = deferred();
  const h = makeSaveHarness({
    persistRows: async (rows) => { await gate.promise; return { ok: true, canonical: rows }; },
  });
  const run = ML.executeEntrySave(h.io);
  await tick(); await tick();
  h.ctrl.invalidate(null, null);   // logout begins
  h.ctrl.invalidate("T2", "A");    // another authenticated tenant initialized (same biz id string)
  gate.resolve();
  const out = await run;
  assert.equal(out.status, "stale");
  assertNoNewSelectionMutation(h.calls);
  assert.equal(h.calls.setError.length, 0, "stale save must not write error state into the new selection");
});

test("R3-9: stale structured exception set/clear response cannot update exception state or continue to persist (scenarios 9, 11)", async () => {
  const gate = deferred();
  const h = makeSaveHarness({
    apiFetch: async (url, opts) => { h.calls.api.push([url, JSON.parse(opts.body)]); await gate.promise; return { ok: true, json: async () => ({ ok: true, applied: true, rebuildRequired: true, exception: { status: "active" }, revision: 2 }) }; },
  });
  h.io.form = { date: "2026-07-24", sales: 27753, is_exception: true, exception_reason: "closure" };
  const run = ML.executeEntrySave(h.io);
  await tick();
  h.ctrl.invalidate("T1", "B");
  gate.resolve();
  const out = await run;
  assert.equal(out.status, "stale");
  assert.equal(h.calls.excSet.length, 0, "stale set/clear response must not mutate the exception state ref");
  assert.equal(h.calls.excActive.length, 0, "stale set/clear response must not mutate exception React state");
  assert.equal(h.seq.filter((s) => s === "persist").length, 0, "stale save must not continue to persist");
  assertNoNewSelectionMutation(h.calls);
});

test("R3-10: exception failure reload is bound to the ORIGINAL context; after logout/login nothing is reloaded (scenarios 10, 11)", async () => {
  // live failure first: reload happens WITH the captured context
  const h1 = makeSaveHarness({
    apiFetch: async () => { throw new Error("network"); },
  });
  h1.io.form = { date: "2026-07-24", sales: 1, is_exception: true, exception_reason: "closure" };
  const ctxBefore = h1.ctrl.capture();
  const out1 = await ML.executeEntrySave(h1.io);
  assert.equal(out1.status, "error");
  assert.equal(h1.calls.reloadExc.length, 1);
  assert.deepEqual(h1.calls.reloadExc[0], ctxBefore, "failure reload must use the captured context, never a later global");
  // stale failure: nothing at all
  const gate = deferred();
  const h2 = makeSaveHarness({
    apiFetch: async () => { await gate.promise; throw new Error("network"); },
  });
  h2.io.form = { date: "2026-07-24", sales: 1, is_exception: true, exception_reason: "closure" };
  const run2 = ML.executeEntrySave(h2.io);
  await tick();
  h2.ctrl.invalidate(null, null); h2.ctrl.invalidate("T2", "A");
  gate.reject(new Error("network"));
  const out2 = await run2.catch(() => ({ status: "threw" }));
  assert.equal(out2.status, "stale");
  assert.equal(h2.calls.reloadExc.length, 0, "stale failure must not reload exceptions");
  assert.equal(h2.calls.setError.length, 0, "stale failure must not set error state");
});

test("R3-21: same-context save succeeds exactly once with the reviewed order and the EXACT persisted array (scenarios 19, 21)", async () => {
  let persisted = null;
  const h = makeSaveHarness({
    persistRows: async (rows) => { h.seq.push("persist"); persisted = rows; return { ok: true, canonical: rows }; },
  });
  const out = await ML.executeEntrySave(h.io);
  assert.equal(out.status, "saved");
  assert.equal(h.calls.applyRows.length, 1);
  assert.ok(Object.is(h.calls.applyRows[0], persisted), "React state must receive the exact canonical array that was persisted");
  assert.deepEqual(h.seq.filter((s) => ["persist", "applyRows", "rebuild", "loadIns", "resetForm", "schedNav"].includes(s)),
    ["persist", "applyRows", "rebuild", "loadIns", "resetForm", "schedNav"], "reviewed save order preserved");
  assert.ok(h.calls.setSaved.includes(true));
  assert.equal(h.calls.schedNav[0][1], 1200);
  assert.equal(totalRevenue(h.calls.applyRows[0]), 100 + 27753);
});

test("R3-23: incident — a stale replay of ₪27,753 cannot move the canonical ₪580,483 (scenario 23)", async () => {
  const rows = incidentEntries();
  const gate = deferred();
  const h = makeSaveHarness({
    persistRows: async (r) => { await gate.promise; return { ok: true, canonical: r }; },
  });
  h.io.rows = rows;
  h.io.form = { date: "2026-07-24", sales: 27753 };
  const run = ML.executeEntrySave(h.io);
  await tick(); await tick();
  h.ctrl.invalidate("T1", "B");
  gate.resolve();
  const out = await run;
  assert.equal(out.status, "stale");
  assert.equal(h.calls.applyRows.length, 0, "no state applied for the stale save");
  assert.equal(totalRevenue(rows), 580483, "canonical incident total untouched");
  // live path: replay keeps exactly 580,483 (one 07-24 row)
  const h2 = makeSaveHarness();
  h2.io.rows = incidentEntries();
  h2.io.form = { date: "2026-07-24", sales: 27753 };
  const out2 = await ML.executeEntrySave(h2.io);
  assert.equal(out2.status, "saved");
  assert.equal(totalRevenue(h2.calls.applyRows[0]), 580483);
  assert.notEqual(totalRevenue(h2.calls.applyRows[0]), 608236);
});

test("R3-6: old delayed navigation timer cannot fire into a new selection (scenario 6)", () => {
  const ctrl = ML.createSelectionController();
  ctrl.invalidate("T1", "A");
  const ctx = ctrl.capture();
  const timerBox = { current: null };
  let fired = 0; let stored = null; let cleared = [];
  const setT = (fn) => { stored = fn; return 7; };
  const clearT = (id) => cleared.push(id);
  ML.scheduleSelectionBoundTimeout(ctrl, ctx, timerBox, () => { fired++; }, 1200, setT, clearT);
  assert.equal(timerBox.current, 7);
  ctrl.invalidate("T1", "B"); // selection switched before the timer fires
  stored();                    // timer fires late
  assert.equal(fired, 0, "old timer must not navigate the new selection");
  assert.equal(timerBox.current, null);
  // live timer still works, and re-scheduling clears the previous timer
  const ctx2 = ctrl.capture();
  ML.scheduleSelectionBoundTimeout(ctrl, ctx2, timerBox, () => { fired++; }, 1200, setT, clearT);
  ML.scheduleSelectionBoundTimeout(ctrl, ctx2, timerBox, () => { fired++; }, 1200, setT, clearT);
  assert.deepEqual(cleared, [7], "re-scheduling clears the pending timer");
  stored();
  assert.equal(fired, 1);
});

// ═══ EXECUTABLE RACE TESTS — exception list lifecycle (scenarios 7, 8, 11) ═══

test("R3-7/8: old exception-list response after business OR tenant switch never overwrites the current selection", async () => {
  for (const nextSel of [["T1", "B"], ["T2", "A"]]) {
    const ctrl = ML.createSelectionController();
    ctrl.invalidate("T1", "A");
    const ctx = ctrl.capture();
    const gate = deferred();
    const applied = [];
    const io = {
      selection: ctrl,
      todayKey: (off) => (off === 1 ? "2026-07-25" : "2026-04-20"),
      apiFetch: async (url) => { io.url = url; await gate.promise; return { ok: true, json: async () => ({ ok: true, exceptions: { "2026-07-10": { source: "structured", status: "active", revision: 1 } } }) }; },
      applyState: (stateMap, boolMap) => applied.push([stateMap, boolMap]),
    };
    const run = ML.loadExceptionsBound(io, ctx);
    await tick();
    assert.ok(io.url.includes("tenantId=T1") && io.url.includes("bizId=A"), "request built only from the captured ctx");
    ctrl.invalidate(nextSel[0], nextSel[1]);
    gate.resolve();
    const out = await run;
    assert.equal(out.status, "stale");
    assert.equal(applied.length, 0, `stale list response must not apply state (switched to ${nextSel.join("/")})`);
  }
});

test("R3: live exception-list response applies exactly once with the parsed shape", async () => {
  const ctrl = ML.createSelectionController();
  ctrl.invalidate("T1", "A");
  const applied = [];
  const io = {
    selection: ctrl,
    todayKey: () => "2026-07-25",
    apiFetch: async () => ({ ok: true, json: async () => ({ ok: true, exceptions: { "2026-07-10": { source: "legacy", status: "active" } } }) }),
    applyState: (stateMap, boolMap) => applied.push([plain(stateMap), plain(boolMap)]),
  };
  const out = await ML.loadExceptionsBound(io, ctrl.capture());
  assert.equal(out.status, "applied");
  assert.deepEqual(applied, [[{ "2026-07-10": { source: "legacy", status: "active", revision: 0, reasonCode: "", reasonText: "" } }, { "2026-07-10": true }]]);
});

// ═══ EXECUTABLE TESTS — supplier-grid writer (scenarios 14-19) ═══════════════

function makeSupplierHarness(rows, overrides = {}) {
  const ctrl = ML.createSelectionController();
  ctrl.invalidate("T1", "A");
  const applied = [];
  const io = {
    selection: ctrl,
    applyRows: (r) => applied.push(r),
    persistRows: async (r) => ({ ok: true, canonical: r }),
    ...overrides,
  };
  return { ctrl, io, applied, args: { supId: "s9", date: "2026-07-24", val: "77", rows, fixed: null, emptyEntry: { date: "", sales: 0 } } };
}

test("R3-14: supplier update starting from DUPLICATE local state exposes only one canonical row and never sums", async () => {
  const dup = [day("2026-07-24", 27753, { supplier_payments: { s1: 100 } }), day("2026-07-24", 27753, { supplier_payments: { s1: 100 } })];
  const h = makeSupplierHarness(dup);
  const out = await ML.applySupplierPaymentBound(h.io, h.args);
  assert.equal(out.status, "applied");
  for (const arr of h.applied) {
    assert.equal(arr.filter((e) => e.date === "2026-07-24").length, 1, "every applied array is canonical");
  }
  const final = h.applied[h.applied.length - 1];
  assert.equal(final[0].supplier_payments.s1, 100, "duplicate rows never sum s1");
  assert.equal(final[0].supplier_payments.s9, "77");
  assert.equal(totalRevenue(final), 27753);
});

test("R3-15/16: new supplier on an existing date preserves the rest of the record; absent date creates one row", async () => {
  const rows = [day("2026-07-24", 27753, { supplier_payments: { s1: 50 }, payroll: 500, food_cost: 9 })];
  const h = makeSupplierHarness(rows);
  const out = await ML.applySupplierPaymentBound(h.io, h.args);
  assert.equal(out.status, "applied");
  const final = h.applied[h.applied.length - 1];
  assert.equal(final.length, 1);
  assert.deepEqual(plain(final[0].supplier_payments), { s1: 50, s9: "77" });
  assert.equal(final[0].payroll, 500, "rest of the daily record preserved");
  assert.equal(final[0].sales, 27753);
  // absent date
  const h2 = makeSupplierHarness([day("2026-07-01", 5)]);
  await ML.applySupplierPaymentBound(h2.io, h2.args);
  const final2 = h2.applied[h2.applied.length - 1];
  assert.deepEqual(plain(final2).map((e) => e.date), ["2026-07-01", "2026-07-24"]);
});

test("R3-17: persistence failure restores the previous canonical state — no unpersisted replacement remains", async () => {
  const rows = [day("2026-07-24", 27753, { supplier_payments: { s1: 50 } })];
  const h = makeSupplierHarness(rows, { persistRows: async () => ({ ok: false }) });
  const out = await ML.applySupplierPaymentBound(h.io, h.args);
  assert.equal(out.status, "persist_failed");
  assert.equal(h.applied.length, 2, "optimistic canonical apply + revert");
  assert.deepEqual(plain(h.applied[1]), plain(ME.canonicalizeEntries(rows)), "state reverted to the previous canonical array");
  assert.equal(h.applied[1][0].supplier_payments.s9, undefined, "failed value not left in state");
});

test("R3-19: the EXACT canonical array persisted is the array applied to state; stale supplier persist applies nothing further", async () => {
  let persisted = null;
  const rows = [day("2026-07-24", 1)];
  const h = makeSupplierHarness(rows, { persistRows: async (r) => { persisted = r; return { ok: true, canonical: r }; } });
  const out = await ML.applySupplierPaymentBound(h.io, h.args);
  assert.equal(out.status, "applied");
  assert.ok(Object.is(h.applied[h.applied.length - 1], persisted), "state === persisted canonical array");
  // stale: selection switches during persist
  const gate = deferred();
  const h2 = makeSupplierHarness([day("2026-07-24", 1)], { persistRows: async (r) => { await gate.promise; return { ok: true, canonical: r }; } });
  const run2 = ML.applySupplierPaymentBound(h2.io, h2.args);
  await tick();
  h2.ctrl.invalidate("T2", "A");
  gate.resolve();
  const out2 = await run2;
  assert.equal(out2.status, "stale");
  assert.equal(h2.applied.length, 1, "only the optimistic canonical apply happened before the switch; nothing after");
});

test("R3-18: listener echo ordering — canonical hydration after supplier persist reproduces the same state (scenario 18)", async () => {
  const rows = [day("2026-07-24", 27753, { supplier_payments: { s1: 50 } })];
  const h = makeSupplierHarness(rows);
  await ML.applySupplierPaymentBound(h.io, h.args);
  const applied = h.applied[h.applied.length - 1];
  const echo = ME.canonicalizeEntries(plain(applied)); // listener wholesale replacement of the persisted blob
  assert.deepEqual(plain(echo), plain(applied), "echo cannot reintroduce a raw/divergent array after canonical state");
});

// ═══ BEHAVIORAL TESTS — date identity & replay (R2, preserved) ═══════════════

test("A1/A2: new-entry and edit saves replace by date; MTD stays exact", () => {
  const a1 = ME.upsertEntryByDate(incidentEntries(), day("2026-07-24", 27753), null);
  assert.equal(a1.length, 24);
  assert.equal(totalRevenue(a1), 580483);
  const a2 = ME.upsertEntryByDate(incidentEntries(), day("2026-07-24", 30000), "2026-07-24");
  assert.equal(totalRevenue(a2), 580483 - 27753 + 30000);
});

test("A5/A6/A8: hydration/reorder/removal cannot redirect an edit — no unrelated day is ever removed", () => {
  const hydrated = ME.canonicalizeEntries([day("2026-07-01", 100), day("2026-07-24", 27753), day("2026-06-30", 50)]);
  const after = ME.upsertEntryByDate(hydrated, day("2026-07-25", 27753), "2026-07-24");
  assert.deepEqual(plain(after).map((e) => e.date), ["2026-06-30", "2026-07-01", "2026-07-25"]);
  const gone = ME.upsertEntryByDate(ME.canonicalizeEntries([day("2026-07-01", 100), day("2026-07-30", 9)]), day("2026-07-25", 27753), "2026-07-24");
  assert.deepEqual(plain(gone).map((e) => e.date), ["2026-07-01", "2026-07-25", "2026-07-30"]);
});

test("A4/A9: date-collision edits leave exactly one row for the final date; explicit save wins wholesale", () => {
  const after = ME.upsertEntryByDate([day("2026-07-20", 1000, { food_cost: 111 }), day("2026-07-24", 27753)], day("2026-07-24", 5000, { food_cost: 999 }), "2026-07-20");
  assert.equal(after.length, 1);
  assert.deepEqual(plain(after[0]), plain(day("2026-07-24", 5000, { food_cost: 999 })));
  const both = ME.upsertEntryByDate(ME.canonicalizeEntries([day("2026-07-01", 100), day("2026-07-24", 27753), day("2026-07-25", 500)]), day("2026-07-25", 27753), "2026-07-24");
  assert.deepEqual(plain(both).map((e) => `${e.date}:${e.sales}`), ["2026-07-01:100", "2026-07-25:27753"]);
});

test("A-legacy-index: a numeric third argument is ignored — positional deletion is impossible", () => {
  const after = ME.upsertEntryByDate(ME.canonicalizeEntries([day("2026-07-01", 100), day("2026-07-24", 27753)]), day("2026-07-25", 1), 0);
  assert.ok(after.some((e) => e.date === "2026-07-01"));
  assert.equal(after.length, 3);
});

test("A11/A12: distinct dates with equal revenue stay separate — no UTC merge", () => {
  const canon = ME.canonicalizeEntries([day("2026-07-24", 27753), day("2026-07-25", 27753)]);
  assert.equal(canon.length, 2);
  assert.equal(totalRevenue(canon), 55506);
});

const fullRecord = () => ({
  date: "2026-07-24", sales: 27753, deliveries: 100, other_income: 50,
  supplier_payments: { supplierA: 100 }, food_cost: 0,
  payroll: 500, hourly_payroll: { empA: 200 }, other_expense: 30, note: "x",
});

test("B13-17/B22: identical full-record replay doubles NOTHING; canonicalize(x+x)===canonicalize(x)", () => {
  const rec = fullRecord();
  const canon = ME.canonicalizeEntries([rec, plain(rec)]);
  assert.equal(canon.length, 1);
  assert.equal(canon[0].sales, 27753);
  assert.equal(canon[0].supplier_payments.supplierA, 100);
  assert.equal(canon[0].payroll, 500);
  assert.equal(canon[0].hourly_payroll.empA, 200);
  assert.deepEqual(plain(canon), plain(ME.canonicalizeEntries([rec])));
  assert.deepEqual(plain(ME.canonicalizeEntries(plain(canon))), plain(canon));
});

test("B18-21: map union earliest-wins; property order and metadata differences never cause addition", () => {
  const union = ME.canonicalizeEntries([day("2026-07-24", 27753, { supplier_payments: { supplierA: 100 } }), day("2026-07-24", 0, { supplier_payments: { supplierB: 40 } })]);
  assert.deepEqual(plain(union[0].supplier_payments), { supplierA: 100, supplierB: 40 });
  const conflict = ME.canonicalizeEntries([day("2026-07-24", 27753, { supplier_payments: { supplierA: 100 } }), day("2026-07-24", 0, { supplier_payments: { supplierA: 70 } })]);
  assert.equal(conflict[0].supplier_payments.supplierA, 100);
  const rec = fullRecord();
  const reordered = { note: "x", hourly_payroll: { empA: 200 }, payroll: 500, other_expense: 30, food_cost: 0, supplier_payments: { supplierA: 100 }, other_income: 50, deliveries: 100, sales: 27753, date: "2026-07-24" };
  const withMeta = { ...plain(rec), _idx: 7, __key: "z" };
  for (const pair of [[rec, reordered], [rec, withMeta]]) {
    const c = ME.canonicalizeEntries(plain(pair));
    assert.equal(c[0].sales, 27753);
    assert.equal(c[0].supplier_payments.supplierA, 100);
    assert.equal(c[0].payroll, 500);
  }
});

test("C24-26: ₪580,483 stable; ₪608,236 unreachable via replay, doubled payload or full doubling", () => {
  const correct = incidentEntries();
  for (const attempt of [
    ME.upsertEntryByDate(correct, day("2026-07-24", 27753), null),
    ME.canonicalizeEntries([...correct, day("2026-07-24", 27753)]),
    ME.canonicalizeEntries([...correct, ...plain(correct)]),
  ]) {
    assert.equal(totalRevenue(attempt), 580483);
    assert.notEqual(totalRevenue(attempt), 608236);
  }
});

test("C27/C28 + D29-33: one 07-24 point; supplier totals / food% / labor / profit inputs unchanged under replay", () => {
  const state = ME.upsertEntryByDate(incidentEntries(), day("2026-07-24", 27753), null);
  const monthEntries = state.filter((e) => e.date && e.date.startsWith("2026-07-"));
  assert.equal(monthEntries.filter((e) => e.date === "2026-07-24").length, 1);
  assert.equal(monthEntries.length, 24);
  const base = [
    day("2026-07-01", 10000, { supplier_payments: { a: 1000, b: 500 }, payroll: 800, hourly_payroll: { e1: 200 } }),
    day("2026-07-24", 27753, { supplier_payments: { supplierA: 100 }, payroll: 500 }),
  ];
  const metrics = (rows) => {
    const revenue = totalRevenue(rows);
    const food = supplierTotal(rows);
    const labor = rows.reduce((a, e) => a + (Number(e.payroll) || 0) + Object.values(e.hourly_payroll || {}).reduce((s, v) => s + (Number(v) || 0), 0), 0);
    return { revenue, food, foodPct: (food / revenue) * 100, labor, contribution: revenue - food - labor };
  };
  assert.deepEqual(metrics(ME.canonicalizeEntries([...plain(base), ...plain(base)])), metrics(ME.canonicalizeEntries(plain(base))));
});

test("G: undated rows dropped; trimmed dates collide; upsert replay and save→hydration round-trips are idempotent", () => {
  assert.deepEqual(plain(ME.upsertEntryByDate([day("2026-07-24", 1)], { date: "", sales: 9 }, null)), [day("2026-07-24", 1)]);
  const trimmed = ME.canonicalizeEntries([day(" 2026-07-24", 100), day("2026-07-24", 0, { food_cost: 5 })]);
  assert.equal(trimmed.length, 1);
  assert.equal(trimmed[0].sales, 100);
  const once = ME.upsertEntryByDate(incidentEntries(), day("2026-07-24", 27753), null);
  assert.deepEqual(plain(ME.upsertEntryByDate(once, day("2026-07-24", 27753), null)), plain(once));
  assert.deepEqual(plain(ME.canonicalizeEntries(plain(once))), plain(once));
});

// ═══ [source-guard] wiring assertions (supplementary — NOT race coverage) ════

function saveEntrySlice() {
  const start = html.indexOf("const saveEntry = async");
  const end = html.indexOf("const deleteEntryByDate", start);
  assert.ok(start !== -1 && end !== -1);
  return html.slice(start, end);
}

test("[source-guard] saveEntry delegates to the production seam with the real selection controller", () => {
  const src = saveEntrySlice();
  assert.ok(src.includes("window.MarjinSaveLifecycle.executeEntrySave({"));
  assert.ok(src.includes("selection: selectionCtrlRef.current"));
  assert.ok(src.includes("entrySaveInFlightRef.current"), "double-submit guard must remain");
  assert.ok(!src.includes("[...entries,"), "no raw append remains in the save path");
  assert.ok(!html.includes("const saveRevenueStep"), "dead index-keyed wizard writer must not exist");
});

test("[source-guard] synchronous invalidation is wired to every selection transition", () => {
  const wrapper = html.slice(html.indexOf("const setCurrentBizId = id =>"), html.indexOf("const setCurrentBizId = id =>") + 700);
  assert.ok(wrapper.includes("invalidateSelection(window._currentTenantId == null ? null : window._currentTenantId, id == null ? null : id);"), "business wrapper invalidates BEFORE state updates");
  assert.ok(html.includes('invalidateSelection(window._currentTenantId == null ? null : window._currentTenantId, "demo_biz");'), "raw demo setter invalidates");
  assert.ok(html.includes("invalidateSelection(null, null); // R3: tenant reset/logout invalidates the selection synchronously"));
  assert.ok(html.includes("invalidateSelection(tid, null); // R3: tenant initialized"));
  assert.ok(html.includes("invalidateSelection(tenantId, null); // R3: tenant (re)initialized synchronously"));
  assert.ok(html.includes("invalidateSelection(user._tenantId, null); // R3: another authenticated tenant initialized"));
  assert.ok(html.includes("useEffect(() => () => { invalidateSelection(null, null); }, []);"), "unmount invalidates");
  const inv = html.slice(html.indexOf("const invalidateSelection = (tenantId, bizId) => {"), html.indexOf("const invalidateSelection = (tenantId, bizId) => {") + 800);
  assert.ok(inv.includes("entryExceptionOpIdRef.current = {};"), "exception op-ids cleared on invalidation");
  assert.ok(inv.includes("suppressNextDashboardInsightsLoadForBizRef.current = null;"), "insight suppression cleared on invalidation");
  assert.ok(inv.includes("clearTimeout(saveNavTimerRef.current)"), "pending navigation timer cancelled on invalidation");
  assert.ok(inv.includes("editingDateRef.current = null;"), "edit identity cleared on invalidation");
});

test("[source-guard] persist returns the canonical array and honors the caller context; canonicalization precedes the write", () => {
  const start = html.indexOf("const persist = async (e, f, ctx)");
  assert.notEqual(start, -1);
  const slice = html.slice(start, start + 1800);
  assert.ok(slice.includes("if (ctx && !isSelectionLive(ctx)) return { ok:false, stale:true };"));
  const canonIdx = slice.indexOf("e = window.MarjinEntries.canonicalizeEntries(e);");
  const writeIdx = slice.indexOf("JSON.stringify(e), true");
  assert.ok(canonIdx !== -1 && writeIdx !== -1 && canonIdx < writeIdx);
  assert.ok(slice.includes("return { ok:true, canonical: e };"));
  assert.ok(html.includes("const persistEntries = persist;"));
});

test("[source-guard] exception lifecycle wiring: effect ctx, cleared state on switch, seam-bound loader", () => {
  assert.ok(html.includes("loadEntryExceptions(ctxAtSetup);"), "effect passes its selection context");
  assert.ok(html.includes("const ctxAtSetup = captureSelectionCtx();"));
  const eff = html.slice(html.indexOf("// useEffect 2: business-specific data -- live listeners"), html.indexOf("// useEffect 2: business-specific data -- live listeners") + 2400);
  assert.ok(eff.includes("setEntryExceptions({});"), "exception React state cleared on switch");
  assert.ok(eff.includes("entryExceptionStateRef.current = {};"), "exception state ref cleared on switch");
  const loader = html.slice(html.indexOf("const loadEntryExceptions = async (ctx)"), html.indexOf("const loadEntryExceptions = async (ctx)") + 900);
  assert.ok(loader.includes("window.MarjinSaveLifecycle.loadExceptionsBound"));
  assert.ok(!loader.includes("window._currentTenantId"), "loader never reads the live global tenant");
});

test("[source-guard] rebuild request uses only the captured context; listener/self-heal tenant binding preserved", () => {
  const rb = html.slice(html.indexOf("const rebuildInsightsAfterEntrySave = async (date, ctx)"), html.indexOf("const rebuildInsightsAfterEntrySave = async (date, ctx)") + 900);
  assert.notEqual(rb.indexOf("tenantId: ctx.tenantId"), -1);
  assert.notEqual(rb.indexOf("bizId: ctx.bizId"), -1);
  assert.ok(!rb.includes("window._currentTenantId,"), "rebuild body never uses the live global tenant");
  assert.ok(html.includes("deduped.length < val.length && live && window._currentTenantId === tenantAtSetup"), "R2 self-heal binding preserved");
  assert.ok(html.includes("if(!live) return; // R2: queued callback from an unsubscribed/old selection — ignore"));
  assert.ok(html.includes("return () => { live = false; unsubs.forEach(u => typeof u===\"function\" && u());"));
});

test("[source-guard] supplier grid and delete/labor writers run the canonical selection-bound paths", () => {
  assert.ok(html.includes("window.MarjinSaveLifecycle.applySupplierPaymentBound({"));
  assert.ok(!/entries\.map\(e=>e\.date===date\?updated:e\)/.test(html), "raw supplier map is gone");
  const del = html.slice(html.indexOf("const deleteEntryByDate = async (date)"), html.indexOf("const deleteEntryByDate = async (date)") + 900);
  assert.ok(del.includes("captureSelectionCtx()") && del.includes("canonicalizeEntries") && del.includes("persistEntries(canonicalNext, null, ctx)"));
  assert.ok(del.includes("setEntries(prevCanonical)"), "delete reverts on persistence failure");
  assert.ok(html.includes("onClick={()=>deleteEntryByDate(e.date)}"));
  const labor = html.slice(html.indexOf("const setDailyLabor = async (date, val)"), html.indexOf("const setDailyLabor = async (date, val)") + 700);
  assert.ok(labor.includes("upsertEntryByDate"), "employee daily-labor writer uses the date-keyed upsert");
  assert.ok(html.includes('const u=[];setEntries(u);persist(u,null);'), "clear-all unchanged (trivially canonical)");
  assert.ok(html.includes("setEntries(window.MarjinEntries.canonicalizeEntries(demoEntries));"), "demo hydration canonicalized");
});

test("[source-guard] chart and MTD still consume the same effective entries collection; lastyear guard is ctx-bound", () => {
  assert.ok(html.includes("const monthEntries = entries.filter(e => e.date && e.date.startsWith(monthPrefix));"));
  assert.ok(html.includes("calcMetrics(monthEntries"));
  assert.ok(html.includes("buildChart(monthEntries)"));
  assert.ok(html.includes("if (!isSelectionLive(ctxAtSetup) || !live) return;"));
});
