// P0-DATA-01 R10 — GATE 5 REAL UI CALL-SITE COVERAGE.
//
// Every test drives the ACTUAL production handler text extracted from `index.html`:
//   saveEntry            (revenue create/edit)      index.html const saveEntry = …
//   setSupPayDate        (supplier create/edit)     index.html const setSupPayDate = …
//   submitLaborEntry     (labor create/edit)        index.html const submitLaborEntry = …
//   deleteEntryByDate    (the UI's delete action)   index.html const deleteEntryByDate = …
//   deleteEntryById      (id-addressed delete)      index.html const deleteEntryById = …
//   clear-all onClick    (destructive clear-all)    index.html <button onClick={async ()=>{…}}>
//
// No handler is copied, shimmed, re-implemented or replaced by a test-only outcome
// mapper. The harness supplies only the React closure: state values, spy setters, refs
// holding the REAL production seams (coordinator, mutator, save-UI runner, supplier
// result ownership, exception ownership, selection controller) and the Gate-3-approved
// destination-partitioned remote. If a production outcome branch is deleted or
// inverted, these tests fail — see [fidelity] G5-F1/G5-F2 and the mutation-probe
// results recorded in GATE5_REAL_UI_CALL_SITE_COVERAGE.md.
//
// Run: node --test test/dashboard/entries-ui-call-sites.test.mjs

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ML, plain, tick, settleAll, mkId, entriesKey,
  makeUiEnv, makeRemoteService, drainLiveRigs, SOURCE, LOCATION, CALL_SITES,
} from "../support/ui-call-site-harness.mjs";

afterEach(drainLiveRigs);

// ── Fixtures: duplicate dates, reordered rows, distinct ids, distinct financial
// values and unknown fields, so identity can never be inferred from any of them.
const ID1 = mkId("g5-01"), ID2 = mkId("g5-02"), IDD = mkId("g5-dup");
const HIST = () => [
  { id: ID2, date: "2026-08-02", sales: 202, deliveries: 0, other_income: 0, note_b: "second-in-array" },
  { id: ID1, date: "2026-08-01", sales: 101, deliveries: 7, other_income: 3, legacy_flag: true },
];
const DUPES = () => [
  { id: ID1, date: "2026-08-01", sales: 101, deliveries: 7, other_income: 3, legacy_flag: true },
  { id: IDD, date: "2026-08-01", sales: 999, deliveries: 0, other_income: 0, twin: "yes" },
  { id: ID2, date: "2026-08-02", sales: 202, deliveries: 0, other_income: 0, note_b: "second-in-array" },
];
function env(opts = {}) {
  const e = makeUiEnv(opts);
  e.at(opts.tenantId || "T1", opts.bizId || "A").seed(opts.seed === undefined ? HIST() : opts.seed);
  e.attach(); e.hydrate(); e.reset();
  return e;
}
const rows = (e, t = "T1", b = "A") => plain(e.at(t, b).rows());
const SUCCESS_MARKS = ["setSaved", "setForm", "setEditingId"];
// Forbidden-effect assertion shared by every non-commit outcome.
function assertNoSuccessEffects(e, msg) {
  assert.equal(e.state.saved, false, `${msg}: no success indicator`);
  assert.deepEqual(e.effects("setSaved").filter(v => v === true), [], `${msg}: setSaved(true) never called`);
  assert.deepEqual(e.effects("setForm"), [], `${msg}: the form is never cleared`);
  assert.deepEqual(e.effects("setEditingId"), [], `${msg}: edit mode is never exited`);
  assert.deepEqual(e.effects("setScreen"), [], `${msg}: no navigation implying completion`);
  assert.deepEqual(e.effects("rebuildInsights"), [], `${msg}: no downstream rebuild`);
  assert.equal(e.scheduledNav().length, 0, `${msg}: no navigation scheduled`);
}

// ═══════════════════════════════════════════════════════════════════════════
// FIDELITY — the suite executes the production call sites, not a stand-in
// ═══════════════════════════════════════════════════════════════════════════

test("[fidelity] G5-F1: every handler under test is the extracted production text, located in index.html", () => {
  for (const [key, cs] of Object.entries(CALL_SITES)) {
    assert.ok(SOURCE[key].length > 200 || key === "materialChanged", `${cs.name} extracted`);
    assert.ok(LOCATION[key] > 0, `${cs.name} located in index.html at line ${LOCATION[key]}`);
    cs.markers.forEach(m => assert.ok(SOURCE[key].includes(m), `${cs.name} still contains ${JSON.stringify(m)}`));
  }
  // The clear-all arrow really is the button's onClick handler.
  assert.ok(SOURCE.clearAll.startsWith("async ()=>{"), "the clear-all handler is the JSX arrow itself");
  // No handler was reproduced in this file: the only source of handler logic is index.html.
  assert.equal(SOURCE.revenue.includes("executeEntrySave"), true);
});

test("[fidelity] G5-F2: the handlers run against the REAL seams, and the deterministic watchdog still reports a stranded UI operation", async () => {
  const e = env();
  assert.equal(typeof e.coordinator.submitIntent, "function");
  assert.equal(typeof e.mutator.mutate, "function");
  const gate = e.at("T1", "A").holdNext("g5-stranded");
  const p = e.clearAllClick();
  await assert.rejects(() => p, /never settled after 60 deterministic ticks[\s\S]*g5-stranded/,
    "an un-released transaction fails ITS OWN test instead of hanging");
  gate.release();
  await settleAll();
});

test("[fidelity] G5-F3: a sentinel UI operation after the deliberately stranded one still executes", async () => {
  const e = env();
  await e.deleteEntryByDate("2026-08-01");
  await settleAll();
  assert.deepEqual(rows(e), [HIST()[0]], "the cancellation cascade cannot recur silently");
});

// ═══════════════════════════════════════════════════════════════════════════
// REVENUE — saveEntry
// ═══════════════════════════════════════════════════════════════════════════

test("[revenue] G5-R01 committed (create): the complete payload and a fresh immutable id are submitted; the form completes", async () => {
  const NEW = mkId("g5-new");
  const e = env({ form: { date: "2026-08-05", sales: 505, deliveries: 1, other_income: 2 }, nextId: () => NEW });
  await e.saveEntry();
  await settleAll();
  assert.equal(e.coordinatorCalls.length, 1, "exactly one coordinator call");
  const c = e.coordinatorCalls[0];
  assert.equal(c.api, "submitIntent");
  assert.equal(c.intent.type, "upsert_entry");
  assert.equal(c.intent.createIfMissing, true);
  assert.deepEqual(c.intent.target, { id: NEW }, "the pre-generated immutable id is the target");
  assert.deepEqual(c.intent.newRow, { date: "2026-08-05", sales: 505, deliveries: 1, other_income: 2, id: NEW },
    "the COMPLETE intended payload is submitted");
  // success effects
  assert.equal(e.state.saved, true, "success acknowledgement");
  assert.equal(e.state.entrySaveError, "", "prior error cleared and none set");
  assert.deepEqual(plain(e.state.form), plain(e.EMPTY_ENTRY), "form reset");
  assert.deepEqual(e.effects("setEditingId"), [null], "edit mode exited");
  assert.equal(e.state.editingDate, null);
  assert.equal(e.scheduledNav().length, 1, "delayed navigation scheduled by the real selection-bound timer");
  assert.deepEqual(rows(e), [...HIST(), { date: "2026-08-05", sales: 505, deliveries: 1, other_income: 2, id: NEW }]);
});

test("[revenue] G5-R02 committed (edit): the ORIGINAL immutable id is retained; unrelated rows untouched", async () => {
  const e = env({ form: { date: "2026-08-01", sales: 111, deliveries: 7, other_income: 3, legacy_flag: true }, editingDate: "2026-08-01" });
  await e.saveEntry();
  await settleAll();
  assert.equal(e.coordinatorCalls.length, 1);
  const c = e.coordinatorCalls[0];
  assert.deepEqual(c.intent.target, { id: ID1 }, "the edit retains the row's original immutable id");
  assert.equal(c.intent.createIfMissing, false, "an edit is never a create");
  assert.deepEqual(c.intent.patch.fields, { sales: 111 }, "only the changed field is patched");
  assert.deepEqual(c.intent.base.fields, { sales: 101 }, "the base is exactly what the user edited from");
  assert.equal(e.state.saved, true);
  assert.deepEqual(rows(e), [HIST()[0], { ...HIST()[1], sales: 111 }], "in place; row order and the other row preserved");
});

test("[revenue] G5-R03 committed (date edit): changing the date does NOT change identity", async () => {
  const e = env({ form: { date: "2026-08-19", sales: 101, deliveries: 7, other_income: 3, legacy_flag: true }, editingDate: "2026-08-01" });
  await e.saveEntry();
  await settleAll();
  const c = e.coordinatorCalls[0];
  assert.deepEqual(c.intent.target, { id: ID1 }, "identity is the id, never the date");
  assert.deepEqual(c.intent.patch.fields, { date: "2026-08-19" });
  assert.deepEqual(c.intent.base.fields, { date: "2026-08-01" });
  assert.deepEqual(rows(e), [HIST()[0], { ...HIST()[1], date: "2026-08-19" }], "the same physical row moved");
});

test("[revenue] G5-R04 committed_idempotent(empty_patch): accepted as success, reason retained, no downstream rebuild", async () => {
  const e = env({ form: { date: "2026-08-01", sales: 101, deliveries: 7, other_income: 3, legacy_flag: true }, editingDate: "2026-08-01" });
  await e.saveEntry();
  await settleAll();
  assert.equal(e.state.saved, true, "an idempotent commit IS a successful committed result");
  assert.equal(e.state.entrySaveError, "", "no collision, conflict or failure message");
  assert.deepEqual(plain(e.state.form), plain(e.EMPTY_ENTRY), "success effects still occur");
  assert.deepEqual(e.effects("rebuildInsights"), [], "nothing material changed, so no rebuild");
  assert.deepEqual(rows(e), HIST(), "node byte-identical");
});

test("[revenue] G5-R05 committed_idempotent(already_applied): another writer already set the value — success, no conflict message", async () => {
  const e = env({ form: { date: "2026-08-01", sales: 111, deliveries: 7, other_income: 3, legacy_flag: true }, editingDate: "2026-08-01" });
  e.at("T1", "A").setRowsDirect([HIST()[0], { ...HIST()[1], sales: 111 }]);   // remote already at the desired value
  await e.saveEntry();
  await settleAll();
  assert.equal(e.state.saved, true);
  assert.equal(e.state.entrySaveError, "");
  assert.deepEqual(rows(e), [HIST()[0], { ...HIST()[1], sales: 111 }]);
});

test("[revenue] G5-R06 committed_idempotent(already_created): an identical replayed create adds no second row", async () => {
  const FIXED = mkId("g5-replay");
  const shared = makeRemoteService();
  const a = makeUiEnv({ remote: shared, form: { date: "2026-08-05", sales: 505 }, nextId: () => FIXED });
  a.at("T1", "A").seed(HIST()); a.attach(); a.hydrate(); a.reset();
  await a.saveEntry(); await settleAll();
  const b = makeUiEnv({ remote: shared, form: { date: "2026-08-05", sales: 505 }, nextId: () => FIXED });
  b.attach(); b.hydrate(); b.reset();
  await b.saveEntry(); await settleAll();
  assert.equal(b.state.saved, true, "the replay is accepted as a successful committed result");
  assert.equal(b.state.entrySaveError, "");
  assert.deepEqual(rows(b), [...HIST(), { date: "2026-08-05", sales: 505, id: FIXED }], "exactly one physical row for the id");
});

test("[revenue] G5-R07 conflict: exact conflictPaths surfaced, the user's values preserved, zero mutation", async () => {
  const e = env({ form: { date: "2026-08-01", sales: 111, deliveries: 7, other_income: 3, legacy_flag: true }, editingDate: "2026-08-01" });
  e.at("T1", "A").setRowsDirect([HIST()[0], { ...HIST()[1], sales: 999 }]);
  await e.saveEntry();
  await settleAll();
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome("conflict", false), "the production conflict message is shown");
  assert.ok(e.state.entrySaveError.includes("רענן"), "and it is actionable");
  assertNoSuccessEffects(e, "conflict");
  assert.deepEqual(plain(e.state.form), { date: "2026-08-01", sales: 111, deliveries: 7, other_income: 3, legacy_flag: true },
    "every entered value is preserved");
  assert.deepEqual(rows(e), [HIST()[0], { ...HIST()[1], sales: 999 }], "zero mutation");
  assert.equal(e.coordinatorCalls.length, 1, "no silent second attempt");
});

test("[revenue] G5-R08 id_collision: presented as its own distinct outcome, never as generic failure or success", async () => {
  const FIXED = mkId("g5-collide");
  const e = env({ form: { date: "2026-08-05", sales: 505 }, nextId: () => FIXED,
                  seed: [...HIST(), { id: FIXED, date: "2026-08-05", sales: 1, deliveries: 0, other_income: 0 }] });
  await e.saveEntry();
  await settleAll();
  const expected = ML.describeSaveOutcome({ status: "blocked", reason: "invalid_identity", detail: "id_collision" }, false);
  assert.equal(e.state.entrySaveError, expected, "the create-ID-collision message reaches the operator");
  assert.notEqual(e.state.entrySaveError, ML.describeSaveOutcome("blocked", false), "not the catch-all blocked text");
  assert.notEqual(e.state.entrySaveError, ML.describeSaveOutcome("invalid_identity", false), "nor the generic identity text");
  assertNoSuccessEffects(e, "id_collision");
  assert.deepEqual(rows(e), [...HIST(), { id: FIXED, date: "2026-08-05", sales: 1, deliveries: 0, other_income: 0 }], "zero mutation");
});

test("[revenue] G5-R09 stale (selection changed mid-flight): silent, no success, form preserved, no cross-destination write", async () => {
  const e = env({ form: { date: "2026-08-05", sales: 505 } });
  const gate = e.at("T1", "A").holdNext("g5-r09");
  const p = e.saveEntry();
  await tick();
  e.switchTo("T2", "B");
  gate.release();
  await p; await settleAll();
  assert.equal(e.state.entrySaveError, "", "stale is SILENT — production defines no message here");
  assertNoSuccessEffects(e, "stale");
  assert.deepEqual(plain(e.state.form), { date: "2026-08-05", sales: 505 }, "the form is untouched");
  assert.deepEqual(e.effects("setEntries"), [], "the newly selected destination's UI state was not overwritten");
  assert.equal(e.at("T2", "B").rows(), null, "the newly selected destination was never written");
});

test("[revenue] G5-R10 invalid_date: refused before any coordinator call, values preserved", async () => {
  const e = env({ form: { date: "", sales: 1 } });
  await e.saveEntry();
  await settleAll();
  assert.equal(e.state.entrySaveError, "תאריך לא תקין.");
  assert.equal(e.coordinatorCalls.length, 0, "NO coordinator call");
  assertNoSuccessEffects(e, "invalid_date");
  assert.deepEqual(plain(e.state.form), { date: "", sales: 1 });
  assert.deepEqual(rows(e), HIST(), "zero mutation");
});

test("[revenue] G5-R11 entry_identity_required: the typed builder refusal is surfaced and NOTHING is submitted", async () => {
  // R10-GATE-012 regression. A legacy row without an immutable id cannot be addressed.
  // The builder returns the typed refusal `entry_identity_required`; the save must
  // surface that precise condition and must not hand a non-intent to the lane.
  const e = env({ seed: [{ date: "2026-08-01", sales: 101 }],
                  form: { date: "2026-08-01", sales: 111 }, editingDate: "2026-08-01" });
  await e.saveEntry();
  await settleAll();
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome("blocked_entry_identity_required", false),
    "the operator is told records still lack a permanent id — not a generic failure");
  assert.equal(e.coordinatorCalls.length, 0, "a typed builder refusal is never submitted as an intent");
  assertNoSuccessEffects(e, "entry_identity_required");
  assert.deepEqual(plain(e.state.form), { date: "2026-08-01", sales: 111 }, "values preserved");
  assert.deepEqual(rows(e), [{ date: "2026-08-01", sales: 101 }], "zero mutation and no identity adoption");
});

test("[revenue] G5-R12 blocked_unhydrated: refused with an actionable message, values preserved", async () => {
  const e = makeUiEnv({ form: { date: "2026-08-05", sales: 505 } });
  e.at("T1", "A").seed(HIST()); e.attach(); e.reset();       // attached but never hydrated
  await e.saveEntry();
  await settleAll();
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome("blocked_unhydrated", false));
  assertNoSuccessEffects(e, "blocked_unhydrated");
  assert.deepEqual(rows(e), HIST(), "zero mutation");
});

test("[revenue] G5-R13 transport rejection: mapped failure message, values preserved, one call only", async () => {
  const e = env({ form: { date: "2026-08-05", sales: 505 } });
  e.at("T1", "A").failNextTransports(1);
  await e.saveEntry();
  await settleAll();
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome({ status: "failed" }, false));
  assertNoSuccessEffects(e, "rejection");
  assert.deepEqual(plain(e.state.form), { date: "2026-08-05", sales: 505 });
  assert.equal(e.coordinatorCalls.length, 1, "production performs no silent retry");
  assert.deepEqual(rows(e), HIST(), "zero mutation");
});

test("[revenue] G5-R14 retry exhaustion: fails closed with no success and no mutation", async () => {
  const e = env({ form: { date: "2026-08-01", sales: 111, deliveries: 7, other_income: 3, legacy_flag: true }, editingDate: "2026-08-01" });
  e.at("T1", "A").setMaxRetries(3);
  e.at("T1", "A").interleaveOnEveryAttempt(() => e.at("T1", "A").setRowsDirect(HIST()));
  await e.saveEntry();
  await settleAll();
  e.at("T1", "A").interleaveOnEveryAttempt(null);
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome({ status: "failed" }, false));
  assertNoSuccessEffects(e, "exhaustion");
  assert.deepEqual(rows(e), HIST(), "zero mutation");
});

test("[revenue] G5-R15 duplicate dates and reordered rows cannot redirect the mutation", async () => {
  const e = env({ seed: DUPES(), form: { date: "2026-08-01", sales: 111, deliveries: 7, other_income: 3, legacy_flag: true },
                  editingDate: "2026-08-01" });
  await e.saveEntry();
  await settleAll();
  const c = e.coordinatorCalls[0];
  assert.deepEqual(c.intent.target, { id: ID1 }, "the FIRST matching row's own id, never a position or a fingerprint");
  assert.deepEqual(rows(e), [{ ...DUPES()[0], sales: 111 }, DUPES()[1], DUPES()[2]],
    "the duplicate-date twin and every other row are untouched");
});

// ═══════════════════════════════════════════════════════════════════════════
// SUPPLIER — setSupPayDate
// ═══════════════════════════════════════════════════════════════════════════

test("[supplier] G5-S01 committed (edit): the row's own id and exact base value are submitted; the error surface clears", async () => {
  const e = env();
  e.state.supplierWriteError = "previous failure";
  await e.setSupPayDate("sup-1", "2026-08-01", "50");
  await settleAll();
  assert.equal(e.coordinatorCalls.length, 1);
  const a = e.coordinatorCalls[0].args;
  assert.equal(e.coordinatorCalls[0].api, "submitSupplierEdit");
  assert.equal(a.targetId, ID1, "the existing row's immutable id");
  assert.equal(a.baseValue, undefined, "the exact base the user edited from");
  assert.equal(a.supId, "sup-1"); assert.equal(a.val, "50"); assert.equal(a.date, "2026-08-01");
  assert.equal(e.state.supplierWriteError, "", "an accepted commit clears the error surface");
  assert.deepEqual(rows(e), [HIST()[0], { ...HIST()[1], supplier_payments: { "sup-1": "50" } }]);
});

test("[supplier] G5-S02 committed (create): a pre-generated immutable id is supplied for a date with no row", async () => {
  const NEW = mkId("g5-sup-new");
  const e = env({ nextId: () => NEW });
  await e.setSupPayDate("sup-9", "2026-08-07", "70");
  await settleAll();
  const a = e.coordinatorCalls[0].args;
  assert.equal(a.targetId, undefined, "no existing row to target");
  assert.equal(a.newId, NEW, "a fresh immutable id is pre-generated before submission");
  assert.equal(rows(e).length, 3);
  assert.deepEqual(rows(e)[2].supplier_payments, { "sup-9": "70" });
  assert.equal(rows(e)[2].id, NEW);
});

test("[supplier] G5-S03 committed_idempotent: accepted as success and the error surface is cleared", async () => {
  const e = env();
  e.state.supplierWriteError = "previous failure";
  e.at("T1", "A").setRowsDirect([HIST()[0], { ...HIST()[1], supplier_payments: { "sup-1": "50" } }]);
  await e.setSupPayDate("sup-1", "2026-08-01", "50");
  await settleAll();
  assert.equal(e.state.supplierWriteError, "", "idempotent success clears the error, it does not set one");
  assert.deepEqual(rows(e), [HIST()[0], { ...HIST()[1], supplier_payments: { "sup-1": "50" } }]);
});

test("[supplier] G5-S04 conflict: the production conflict message is surfaced and nothing is mutated", async () => {
  const e = env();
  e.at("T1", "A").setRowsDirect([HIST()[0], { ...HIST()[1], supplier_payments: { "sup-1": "77" } }]);
  await e.setSupPayDate("sup-1", "2026-08-01", "50");
  await settleAll();
  assert.equal(e.state.supplierWriteError, ML.describeSaveOutcome("conflict", false));
  assert.deepEqual(e.effects("applyRows"), [], "no local mutation on conflict");
  assert.deepEqual(rows(e), [HIST()[0], { ...HIST()[1], supplier_payments: { "sup-1": "77" } }]);
});

test("[supplier] G5-S05 transport rejection: mapped failure surfaced, zero mutation, one call only", async () => {
  const e = env();
  e.at("T1", "A").failNextTransports(1);
  await e.setSupPayDate("sup-1", "2026-08-01", "50");
  await settleAll();
  assert.equal(e.state.supplierWriteError, ML.describeSaveOutcome({ status: "failed", error: "transport_failed" }, false));
  assert.equal(e.coordinatorCalls.length, 1);
  assert.deepEqual(rows(e), HIST(), "zero mutation");
});

test("[supplier] G5-S06 stale (selection changed mid-flight): silent, and the new selection's surface is untouched", async () => {
  const e = env();
  const gate = e.at("T1", "A").holdNext("g5-s06");
  const p = e.setSupPayDate("sup-1", "2026-08-01", "50");
  await tick();
  e.switchTo("T2", "B");
  gate.release();
  await p; await settleAll();
  assert.deepEqual(e.effects("setSupplierWriteError"), [], "an old-selection result never touches the current error surface");
  assert.equal(e.state.supplierWriteError, "", "silence is not success — but it is also not an error");
  assert.equal(e.at("T2", "B").rows(), null, "no cross-destination write");
});

test("[supplier] G5-S07 duplicate dates: the FIRST matching row's own id is targeted, the twin is untouched", async () => {
  const e = env({ seed: DUPES() });
  await e.setSupPayDate("sup-1", "2026-08-01", "50");
  await settleAll();
  assert.equal(e.coordinatorCalls[0].args.targetId, ID1);
  assert.deepEqual(rows(e), [{ ...DUPES()[0], supplier_payments: { "sup-1": "50" } }, DUPES()[1], DUPES()[2]]);
});

// ═══════════════════════════════════════════════════════════════════════════
// LABOR — submitLaborEntry
// ═══════════════════════════════════════════════════════════════════════════

test("[labor] G5-L01 committed (edit): payroll patched on the row's own id, other fields preserved", async () => {
  const e = env();
  const r = await e.submitLaborEntry("2026-08-01", "80");
  await settleAll();
  assert.equal(r.status, "committed");
  const c = e.coordinatorCalls[0];
  assert.deepEqual(c.intent.target, { id: ID1 });
  assert.equal(c.intent.createIfMissing, false);
  assert.deepEqual(c.intent.patch.fields, { payroll: "80" });
  assert.deepEqual(rows(e), [HIST()[0], { ...HIST()[1], payroll: "80" }]);
});

test("[labor] G5-L02 committed (create): a fresh immutable id and the complete new row are submitted", async () => {
  const NEW = mkId("g5-lab-new");
  const e = env({ nextId: () => NEW });
  const r = await e.submitLaborEntry("2026-08-08", "90");
  await settleAll();
  assert.equal(r.status, "committed");
  const c = e.coordinatorCalls[0];
  assert.deepEqual(c.intent.target, { id: NEW });
  assert.equal(c.intent.createIfMissing, true);
  assert.equal(c.intent.newRow.id, NEW);
  assert.equal(c.intent.newRow.date, "2026-08-08");
  assert.equal(c.intent.newRow.payroll, "90");
  assert.equal(rows(e).length, 3);
});

test("[labor] G5-L03 ambiguous duplicate date: refused BEFORE any coordinator call — never resolved by date", async () => {
  const e = env({ seed: DUPES() });
  const r = await e.submitLaborEntry("2026-08-01", "80");
  await settleAll();
  assert.deepEqual(plain(r), { status: "blocked", reason: "ambiguous_date_requires_id" });
  assert.equal(e.coordinatorCalls.length, 0, "NO coordinator call");
  assert.deepEqual(rows(e), DUPES(), "zero mutation");
});

test("[labor] G5-L04 id-less row: refused with the identity-required status, nothing submitted", async () => {
  const e = env({ seed: [{ date: "2026-08-01", sales: 101 }] });
  const r = await e.submitLaborEntry("2026-08-01", "80");
  await settleAll();
  assert.deepEqual(plain(r), { status: "blocked_entry_identity_required" });
  assert.equal(e.coordinatorCalls.length, 0);
  assert.deepEqual(rows(e), [{ date: "2026-08-01", sales: 101 }], "no identity adoption");
});

test("[labor] G5-L05 invalid date: refused before any coordinator call", async () => {
  const e = env();
  const r = await e.submitLaborEntry("", "80");
  assert.deepEqual(plain(r), { status: "invalid_date" });
  assert.equal(e.coordinatorCalls.length, 0);
});

test("[labor] G5-L06 conflict and rejection: fail closed with zero mutation, and the caller receives the typed result", async () => {
  const e = env();
  e.at("T1", "A").setRowsDirect([HIST()[0], { ...HIST()[1], payroll: "55" }]);
  const conflict = await e.submitLaborEntry("2026-08-01", "80");
  await settleAll();
  assert.equal(conflict.status, "conflict");
  assert.deepEqual(plain(conflict.conflictPaths), ["payroll"], "the exact conflicting path is returned to the caller");
  assert.deepEqual(rows(e), [HIST()[0], { ...HIST()[1], payroll: "55" }], "zero mutation");
  const e2 = env();
  e2.at("T1", "A").failNextTransports(1);
  const rejected = await e2.submitLaborEntry("2026-08-01", "80");
  await settleAll();
  assert.equal(rejected.status, "failed");
  assert.deepEqual(rows(e2), HIST(), "zero mutation");
  // DOCUMENTED GAP (Gate 5 finding L-GAP-1): the employees screen's `setDailyLabor`
  // discards this typed result and the screen has no error surface, so a failed labor
  // write is not visible to the operator. Asserted so the gap is pinned and cannot
  // regress further, and recorded in GATE5_REAL_UI_CALL_SITE_COVERAGE.md for decision.
  assert.deepEqual(e2.effects("setEntrySaveError"), [], "no labor error surface exists today");
  assert.deepEqual(e2.effects("setSupplierWriteError"), [], "and the supplier surface is correctly not reused");
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE — deleteEntryByDate (the UI's delete action) and deleteEntryById
// ═══════════════════════════════════════════════════════════════════════════

test("[delete] G5-D01 committed: the target is the immutable ID, exactly one call, the row is removed", async () => {
  const e = env();
  await e.deleteEntryByDate("2026-08-01");
  await settleAll();
  assert.equal(e.coordinatorCalls.length, 1, "exactly one intended coordinator call");
  const c = e.coordinatorCalls[0];
  assert.equal(c.intent.type, "delete_entry");
  assert.deepEqual(c.intent.target, { id: ID1 }, "the immutable id — never a date, index or fingerprint");
  assert.deepEqual(c.intent.base.fields, { sales: 101, deliveries: 7, other_income: 3 },
    "the user's base is declared so a stale delete cannot remove an edited record");
  assert.deepEqual(rows(e), [HIST()[0]], "exactly the surviving row");
  assert.equal(e.state.entrySaveError, "", "no error on success");
});

test("[delete] G5-D02 duplicate dates: refused before any coordinator call — the wrong entry can never be removed", async () => {
  const e = env({ seed: DUPES() });
  await e.deleteEntryByDate("2026-08-01");
  await settleAll();
  assert.equal(e.state.entrySaveError, "קיימות מספר רשומות לתאריך זה — בחר את הרשומה למחיקה.");
  assert.equal(e.coordinatorCalls.length, 0, "NO coordinator call");
  assert.deepEqual(rows(e), DUPES(), "zero mutation — no optimistic deletion");
});

test("[delete] G5-D03 id-less row: identity-required message, nothing submitted, no local removal", async () => {
  const e = env({ seed: [{ date: "2026-08-01", sales: 101 }] });
  await e.deleteEntryByDate("2026-08-01");
  await settleAll();
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome("blocked_entry_identity_required", false));
  assert.equal(e.coordinatorCalls.length, 0);
  assert.deepEqual(rows(e), [{ date: "2026-08-01", sales: 101 }]);
});

test("[delete] G5-D04 reorder between render and confirmation cannot redirect the deletion", async () => {
  // The handler resolves the id from the CURRENT rows and submits that id. Reordering
  // the remote node afterwards cannot move the deletion to a different record.
  const e = env();
  const gate = e.at("T1", "A").holdNext("g5-d04");
  const p = e.deleteEntryByDate("2026-08-01");
  await tick();
  e.at("T1", "A").setRowsDirect([HIST()[1], HIST()[0]]);      // same rows, reordered
  gate.release();
  await p; await settleAll();
  assert.deepEqual(e.coordinatorCalls[0].intent.target, { id: ID1 });
  assert.deepEqual(rows(e), [HIST()[0]], "the addressed record was removed, not the one that moved into its position");
});

test("[delete] G5-D05 stale delete (the record changed after the user's view): conflict, row preserved, no success", async () => {
  const e = env();
  e.at("T1", "A").setRowsDirect([HIST()[0], { ...HIST()[1], sales: 999 }]);
  await e.deleteEntryByDate("2026-08-01");
  await settleAll();
  assert.deepEqual(rows(e), [HIST()[0], { ...HIST()[1], sales: 999 }], "the record survives the stale delete");
  assert.deepEqual(e.effects("applyRows"), [], "no optimistic local deletion");
});

test("[delete] G5-D06 transport rejection: the failure is SURFACED to the operator and the row is not removed", async () => {
  // R10-GATE-013 regression. `deleteEntryByDate` is the delete wired to the UI
  // (index.html `onClick={()=>deleteEntryByDate(e.date)}`) and its own comment states
  // "Surface, do not silently ignore."
  const e = env();
  e.at("T1", "A").failNextTransports(1);
  await e.deleteEntryByDate("2026-08-01");
  await settleAll();
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome({ status: "failed", error: "transport_failed" }, false),
    "a failed delete is surfaced through the production mapper, not only to the console");
  assert.deepEqual(rows(e), HIST(), "the row is not removed locally or remotely");
  assert.deepEqual(e.effects("applyRows"), [], "no optimistic deletion");
  assert.equal(e.coordinatorCalls.length, 1, "no silent retry");
});

test("[delete] G5-D07 deleteEntryById: id-addressed deletion removes exactly the addressed duplicate", async () => {
  const e = env({ seed: DUPES() });
  await e.deleteEntryById(IDD);
  await settleAll();
  assert.deepEqual(e.coordinatorCalls[0].intent.target, { id: IDD });
  assert.deepEqual(rows(e), [DUPES()[0], DUPES()[2]], "only the addressed twin was removed");
});

test("[delete] G5-D08 deleteEntryById invalid identity and failure mapping", async () => {
  const e = env();
  await e.deleteEntryById("2026-08-01");                       // a date is not an identity
  await settleAll();
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome("blocked_entry_identity_required", false));
  assert.equal(e.coordinatorCalls.length, 0);
  const e2 = env();
  e2.at("T1", "A").failNextTransports(1);
  await e2.deleteEntryById(ID1);
  await settleAll();
  assert.equal(e2.state.entrySaveError, ML.describeSaveOutcome({ status: "failed", error: "transport_failed" }, false));
  assert.deepEqual(rows(e2), HIST(), "zero mutation");
});

test("[negative-control] G5-D09: a handler that deleted by DATE or POSITION would be caught", async () => {
  // Two rows share 2026-08-01 and the array order puts the twin first in DUPES().
  // A date- or index-addressed delete would remove a different record than the id
  // resolved from the user's view; G5-D02/G5-D07 pin the id-addressed behaviour.
  const e = env({ seed: DUPES() });
  await e.deleteEntryById(IDD);
  await settleAll();
  const after = rows(e);
  assert.equal(after.length, 2);
  assert.ok(after.some(r => r.id === ID1), "the sibling with the SAME DATE survives — a date-keyed delete would have removed it");
  assert.ok(!after.some(r => r.id === IDD), "exactly the addressed id was removed");
  assert.notDeepEqual(after, [DUPES()[1], DUPES()[2]], "a position-keyed delete (index 0) would have produced this instead");
});

// ═══════════════════════════════════════════════════════════════════════════
// CLEAR-ALL — the destructive confirmation flow
// ═══════════════════════════════════════════════════════════════════════════

test("[clear-all] G5-C01 declined confirmation: nothing is submitted at all", async () => {
  const e = env({ confirm: false });
  await e.clearAllClick();
  await settleAll();
  assert.deepEqual(e.effects("confirm"), ["למחוק את כל הרשומות?"], "the operator was asked");
  assert.equal(e.coordinatorCalls.length, 0, "NO coordinator call");
  assert.deepEqual(rows(e), HIST(), "zero mutation");
});

test("[clear-all] G5-C02 committed: the confirmed fingerprint and a confirm token are passed to the real clear-all API", async () => {
  const TOK = mkId("g5-tok");
  const e = env({ nextId: () => TOK });
  const confirmedFingerprint = e.coordinator.currentFingerprint();
  await e.clearAllClick();
  await settleAll();
  assert.equal(e.coordinatorCalls.length, 1);
  assert.equal(e.coordinatorCalls[0].api, "submitClearAll", "the DEDICATED destructive operation, not an ordinary submission");
  assert.deepEqual(e.coordinatorCalls[0].args, { expectedNodeFingerprint: confirmedFingerprint, confirmToken: TOK });
  assert.deepEqual(rows(e), [], "exactly empty");
  assert.deepEqual(plain(e.state.entries), [], "the UI converged on the committed empty node");
  assert.equal(e.state.entrySaveError, "", "no error on a genuine completion");
});

test("[clear-all] G5-C03 committed_idempotent(already_empty): treated as completion, no failure message", async () => {
  const e = env({ seed: [] });
  await e.clearAllClick();
  await settleAll();
  assert.equal(e.state.entrySaveError, "", "an idempotent clear is a successful committed result");
  assert.deepEqual(rows(e), []);
});

test("[clear-all] G5-C04 precondition_failed: a dedicated message, no completion, zero mutation", async () => {
  const e = env();
  e.at("T1", "A").interleave(() => e.at("T1", "A").setRowsDirect([...HIST(), { id: mkId("g5-late"), date: "2026-08-09", sales: 9 }]));
  await e.clearAllClick();
  await settleAll();
  assert.equal(e.state.entrySaveError, "הנתונים השתנו מאז האישור — המחיקה בוטלה ולא בוצע שינוי.",
    "the clear-all specific precondition message, not the generic blocked text");
  assert.deepEqual(rows(e), [...HIST(), { id: mkId("g5-late"), date: "2026-08-09", sales: 9 }], "the concurrent write survives");
  assert.deepEqual(e.effects("applyRows"), [], "no optimistic local removal");
});

test("[clear-all] G5-C05 blocked_unhydrated / precondition_missing: refused with an actionable message", async () => {
  const e = makeUiEnv({});
  e.at("T1", "A").seed(HIST()); e.attach(); e.reset();         // attached but never hydrated
  await e.clearAllClick();
  await settleAll();
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome("blocked_unhydrated", false));
  assert.deepEqual(rows(e), HIST(), "zero mutation");
});

test("[clear-all] G5-C06 duplicate-id node: identity failure surfaced, nothing cleared", async () => {
  const dup = mkId("g5-cdup");
  const seed = [{ id: dup, date: "2026-08-01", sales: 1 }, { id: dup, date: "2026-08-02", sales: 2 }];
  const e = env({ seed });
  await e.clearAllClick();
  await settleAll();
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome({ status: "blocked", reason: "duplicate_id" }, false));
  assert.deepEqual(rows(e), seed, "zero mutation");
});

test("[clear-all] G5-C07 transport rejection and retry exhaustion never report success", async () => {
  const e = env();
  e.at("T1", "A").failNextTransports(1);
  await e.clearAllClick();
  await settleAll();
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome({ status: "failed", error: "transport_failed" }, false));
  assert.deepEqual(rows(e), HIST(), "zero mutation — the entries are not optimistically removed");
  assert.deepEqual(e.effects("applyRows"), [], "no local clear");
  const e2 = env();
  e2.at("T1", "A").setMaxRetries(3);
  e2.at("T1", "A").interleaveOnEveryAttempt(() => e2.at("T1", "A").setRowsDirect(HIST()));
  await e2.clearAllClick();
  await settleAll();
  e2.at("T1", "A").interleaveOnEveryAttempt(null);
  assert.equal(e2.state.entrySaveError, ML.describeSaveOutcome({ status: "failed" }, false));
  assert.deepEqual(rows(e2), HIST(), "no partial clear reported as complete");
});

test("[clear-all] G5-C08 destination change mid-flight: only the confirmed destination is cleared and the confirmation is not reusable", async () => {
  const e = env();
  e.at("T1", "B").seed([{ id: mkId("g5-b1"), date: "2026-08-03", sales: 303 }]);
  const confirmed = e.coordinator.currentFingerprint();
  const gate = e.at("T1", "A").holdNext("g5-c08");
  const p = e.clearAllClick();
  await tick();
  e.switchTo("T1", "B");
  gate.release();
  await p; await settleAll();
  assert.deepEqual(rows(e, "T1", "A"), [], "the CONFIRMED destination was cleared");
  assert.deepEqual(rows(e, "T1", "B"), [{ id: mkId("g5-b1"), date: "2026-08-03", sales: 303 }],
    "the newly selected destination is byte-intact and was NOT marked cleared");
  assert.deepEqual(e.effects("setEntries"), [], "no old result hydrated the new lane");
  assert.equal(e.coordinator.isHydrated(), false, "the new lane must hydrate for itself");
  // The old confirmation cannot be reused against the new destination.
  e.hydrate(); e.reset();
  const reuse = await e.coordinator.submitClearAll({ expectedNodeFingerprint: confirmed, confirmToken: mkId("g5-reuse") });
  await settleAll();
  assert.equal(reuse.status, "blocked");
  assert.equal(reuse.reason, "precondition_failed", "a confirmation taken at one destination never describes another");
  assert.deepEqual(rows(e, "T1", "B"), [{ id: mkId("g5-b1"), date: "2026-08-03", sales: 303 }]);
});

test("[clear-all] G5-C09 a single click issues exactly one destructive submission", async () => {
  const e = env();
  await e.clearAllClick();
  await settleAll();
  assert.equal(e.coordinatorCalls.filter(c => c.api === "submitClearAll").length, 1,
    "no second action is silently issued by cleanup or rerendering");
  assert.deepEqual(e.effects("confirm").length, 1, "and the operator is asked exactly once");
});
