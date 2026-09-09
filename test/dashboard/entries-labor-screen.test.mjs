// P0-DATA-01 R10 — L-GAP-1 CLOSURE: the RENDERED daily-labor call site.
//
// The Gate 5 problem this file closes: the previous suite exercised
// `submitLaborEntry` directly, while the screen the operator uses calls
// `setDailyLabor`, which discarded the typed result. Every test here starts at the
// RENDERED input's own `onChange` expression — extracted from the `<input>` element in
// index.html by attribute brace-matching — and asserts the full chain:
//
//   rendered input onChange -> setDailyLabor -> submitLaborEntry -> coordinator
//     -> real remote transaction -> typed outcome -> VISIBLE operator state
//
// Nothing in the chain is copied, shimmed or re-implemented: `setDailyLabor` and
// `submitLaborEntry` are the extracted production declarations, the coordinator,
// mutator and selection controller are the real seams, and the only controlled things
// are React state setters (spies) and the remote transport.
//
// Run: node --test test/dashboard/entries-labor-screen.test.mjs

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ML, plain, settleAll, mkId, entriesKey,
  makeUiEnv, drainLiveRigs, SOURCE, LOCATION, CALL_SITES,
} from "../support/ui-call-site-harness.mjs";

afterEach(drainLiveRigs);

const ID1 = mkId("lab-01"), ID2 = mkId("lab-02"), IDD = mkId("lab-dup");
const D1 = "2026-08-01", D2 = "2026-08-02";
const HIST = () => [
  { id: ID2, date: D2, sales: 202, deliveries: 0, other_income: 0, payroll: 50 },
  { id: ID1, date: D1, sales: 101, deliveries: 7, other_income: 3, payroll: 40 },
];
const DUPES = () => [
  { id: ID1, date: D1, sales: 101, deliveries: 7, other_income: 3, payroll: 40 },
  { id: IDD, date: D1, sales: 999, deliveries: 0, other_income: 0, payroll: 41 },
];
const NO_ID = () => [{ date: D1, sales: 101, deliveries: 0, other_income: 0, payroll: 40 }];

function env(opts = {}) {
  const e = makeUiEnv(opts);
  e.at(opts.tenantId || "T1", opts.bizId || "A").seed(opts.seed === undefined ? HIST() : opts.seed);
  e.attach(); e.hydrate(); e.reset();
  return e;
}
const rows = (e, t = "T1", b = "A") => plain(e.at(t, b).rows());
const payrollAt = (rs, date) => { const r = (rs || []).find(x => x && x.date === date); return r ? r.payroll : undefined; };
// What the rendered input shows for a date — production reads it from `entries`
// (`getDailyLabor`), so this is the operator's view of the field.
const rendered = (e, date) => { const r = (e.state.entries || []).find(x => x && x.date === date); return r ? (r.payroll || "") : ""; };
const banner = (e) => e.state.laborSaveError;

// ═══════════════════════════════════════════════════════════════════════════
// FIDELITY — the chain under test is the rendered production chain
// ═══════════════════════════════════════════════════════════════════════════

test("[fidelity] LAB-F1: the handler under test is the RENDERED input's own onChange expression", () => {
  assert.equal(SOURCE.laborOnChange, "e=>setDailyLabor(date,e.target.value)",
    "the daily-labor input must still be wired straight to setDailyLabor");
  assert.ok(LOCATION.laborScreen > 0, `setDailyLabor located in index.html at line ${LOCATION.laborScreen}`);
  CALL_SITES.laborScreen.markers.forEach(m =>
    assert.ok(SOURCE.laborScreen.includes(m), `setDailyLabor still contains ${JSON.stringify(m)}`));
});

test("[fidelity] LAB-F2: setDailyLabor no longer discards the typed result", () => {
  // The exact defect L-GAP-1 named: `await submitLaborEntry(...)` as a statement whose
  // value is thrown away. The production text must bind it.
  assert.ok(/const\s+res\s*=\s*await\s+submitLaborEntry\(date,\s*val\)/.test(SOURCE.laborScreen),
    "setDailyLabor must bind the typed result of submitLaborEntry");
  assert.ok(SOURCE.laborScreen.includes("describeSaveOutcome"),
    "setDailyLabor must map the typed result through the production describer");
  assert.ok(SOURCE.laborScreen.includes("setLaborSaveError"),
    "setDailyLabor must reach an operator-facing state setter");
});

// ═══════════════════════════════════════════════════════════════════════════
// SUCCESS
// ═══════════════════════════════════════════════════════════════════════════

test("LAB-S1: a valid keystroke commits through the rendered path and shows no error", async () => {
  const e = env();
  await e.laborInputChange(D1, "77");
  await settleAll();
  const submitted = e.coordinatorCalls.filter(c => c.api === "submitIntent");
  assert.equal(submitted.length, 1, "exactly one intent reaches the lane");
  assert.equal(submitted[0].intent.type, "upsert_entry");
  assert.equal(submitted[0].intent.target.id, ID1, "addressed by the row's immutable id, never by position");
  assert.equal(submitted[0].intent.patch.fields.payroll, "77", "the input's value is what is submitted");
  assert.equal(payrollAt(rows(e), D1), "77", "committed to the remote node");
  assert.equal(payrollAt(rows(e), D2), 50, "the other date is untouched");
  assert.equal(banner(e), "", "no error banner on success");
});

test("LAB-S2: a successful keystroke CLEARS a banner left by an earlier failure", async () => {
  const e = env();
  const d = e.destination();
  e.remote.atKey(d.tenantId, d.key).failNextTransports(1);
  await e.laborInputChange(D1, "66");
  await settleAll();
  assert.notEqual(banner(e), "", "precondition: the failure left a banner");
  await e.laborInputChange(D1, "88");
  await settleAll();
  assert.equal(banner(e), "", "a commit clears the banner");
  assert.equal(payrollAt(rows(e), D1), "88");
});

test("LAB-S3: creating labor for a date with no row yet commits a new id-bearing row", async () => {
  const e = env();
  await e.laborInputChange("2026-08-09", "120");
  await settleAll();
  const rs = rows(e);
  const created = rs.find(r => r.date === "2026-08-09");
  assert.ok(created, "the new date exists");
  assert.ok(ML.isValidEntryId(created.id), "the created row carries a canonical id");
  assert.equal(created.payroll, "120");
  assert.equal(banner(e), "", "no error banner");
});

// ═══════════════════════════════════════════════════════════════════════════
// NON-COMMIT OUTCOMES — each must be VISIBLE and must not look like success
// ═══════════════════════════════════════════════════════════════════════════

test("LAB-N1 duplicate date: refused with the specific duplicate message, nothing submitted", async () => {
  const e = env({ seed: DUPES() });
  const before = rows(e);
  await e.laborInputChange(D1, "99");
  await settleAll();
  assert.equal(banner(e), "קיימות מספר רשומות לתאריך זה — בחר את הרשומה לעריכה.",
    "the operator is told which condition blocked the save");
  assert.deepEqual(e.coordinatorCalls, [], "an ambiguous date never reaches the write lane");
  assert.deepEqual(rows(e), before, "the remote node is untouched");
  assert.equal(rendered(e, D1), 40, "the field still shows the stored value — no false success");
});

test("LAB-N2 identity required: a legacy id-less row is refused with the identity message", async () => {
  const e = env({ seed: NO_ID() });
  const before = rows(e);
  await e.laborInputChange(D1, "99");
  await settleAll();
  assert.equal(banner(e), ML.describeSaveOutcome("blocked_entry_identity_required", false));
  assert.deepEqual(e.coordinatorCalls, [], "no write is attempted for an id-less row");
  assert.deepEqual(rows(e), before, "the remote node is untouched");
});

test("LAB-N3 invalid date: refused before any write, with the date-specific message", async () => {
  const e = env();
  const before = rows(e);
  // Reachability note: the daily grid always supplies a well-formed date string, so
  // `invalid_date` is only reachable when the bound date is empty. The rendered
  // production onChange is still what is executed here.
  await e.laborInputChange("", "99");
  await settleAll();
  assert.equal(banner(e), "התאריך אינו תקין — לא בוצע שינוי.");
  assert.deepEqual(e.coordinatorCalls, [], "an empty date never reaches the lane");
  assert.deepEqual(rows(e), before, "the remote node is untouched");
});

test("LAB-N4 conflict: an edit based on a superseded value is refused and the stored value survives", async () => {
  const e = env();
  const d = e.destination();
  // Another writer changes the SAME field between hydration and this keystroke, without
  // this client seeing the echo — the operator is typing over a superseded value.
  e.remote.atKey(d.tenantId, d.key).setRowsDirect(HIST().map(r => r.id === ID1 ? { ...r, payroll: 555 } : r));
  await e.laborInputChange(D1, "99");
  await settleAll();
  assert.equal(banner(e), ML.describeSaveOutcome("conflict", false), "the conflict is shown to the operator");
  assert.equal(payrollAt(rows(e), D1), 555, "the other writer's committed value survives byte-intact");
  assert.notEqual(banner(e), "", "a conflict is never silent");
});

test("LAB-N5 transport failure: a rejected write is surfaced and nothing is committed", async () => {
  const e = env();
  const d = e.destination();
  const before = rows(e);
  e.remote.atKey(d.tenantId, d.key).failNextTransports(1);
  await e.laborInputChange(D1, "99");
  await settleAll();
  assert.notEqual(banner(e), "", "a failed write must be visible");
  assert.equal(banner(e), ML.describeSaveOutcome("failed", false));
  assert.deepEqual(rows(e), before, "nothing was committed");
  assert.equal(rendered(e, D1), 40, "the field still shows the stored value — no false success");
});

test("LAB-N6 retry exhaustion: an operation that can never win CAS is surfaced, not silently dropped", async () => {
  const e = env();
  const d = e.destination();
  const dest = e.remote.atKey(d.tenantId, d.key);
  dest.setMaxRetries(2);
  // Every attempt is invalidated by a competing writer, so the transaction can never
  // commit — the exhaustion path the operator must not be left guessing about.
  let n = 0;
  dest.interleaveOnEveryAttempt(() => {
    n++;
    dest.setRowsDirect(HIST().map(r => r.id === ID1 ? { ...r, sales: 1000 + n } : r));
  });
  await e.laborInputChange(D1, "99");
  await settleAll();
  assert.ok(n >= 2, `the competing writer ran on every attempt (${n})`);
  assert.notEqual(banner(e), "", "exhaustion must be visible to the operator");
  assert.notEqual(payrollAt(rows(e), D1), "99", "the edit was not committed");
});

test("LAB-N7 selection changed under a queued write: stale is returned, and is neither an error nor a success", async () => {
  const e = env();
  const d = e.destination();
  const dest = e.remote.atKey(d.tenantId, d.key);
  // Hold the first keystroke's transaction open, queue a second keystroke behind it,
  // then switch business before the queue is pumped.
  const gate = dest.holdNext("labor-inflight");
  const p1 = e.laborInputChange(D1, "66");
  await settleAll();
  const p2 = e.laborInputChange(D1, "99");
  await settleAll();
  e.switchTo("T1", "B");
  gate.release();
  const [, r2] = [await p1, await p2];
  await settleAll();
  assert.ok(r2 && /^(stale|cancelled)/.test(String(r2.status)),
    `the superseded keystroke must come back typed as stale/cancelled, got ${JSON.stringify(r2 && r2.status)}`);
  assert.deepEqual(e.effects("setLaborSaveError").filter(x => x !== ""), [],
    "a selection change is never reported to the operator as an error");
  assert.notEqual(payrollAt(rows(e), D1), "99", "the superseded keystroke was not committed");
});

test("LAB-N8: the wrapper PROPAGATES the typed outcome to its caller for every class of result", async () => {
  const e = env({ seed: DUPES() });
  const dup = await e.setDailyLabor(D1, "99");
  assert.equal(dup.status, "blocked");
  assert.equal(dup.reason, "ambiguous_date_requires_id", "the typed reason survives the wrapper");
  const e2 = env();
  const ok = await e2.setDailyLabor(D1, "77");
  assert.ok(ok && (ok.status === "committed" || ok.status === "committed_idempotent"),
    `a commit is returned typed, got ${JSON.stringify(ok && ok.status)}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// NEGATIVE CONTROL — this suite can actually detect the L-GAP-1 regression
// ═══════════════════════════════════════════════════════════════════════════

test("[negative-control] LAB-X1: the pre-fix setDailyLabor (result discarded) fails these assertions", async () => {
  const e = env({ seed: DUPES() });
  // The EXACT pre-fix body, kept here only as a control: if the production wrapper ever
  // reverts to discarding the result, LAB-N1/N2/N3/N5 stop being able to see it — this
  // test proves they can.
  const preFix = async (date, val) => { await e.__raw.submitLaborEntry(date, val); };
  await preFix(D1, "99");
  await settleAll();
  assert.equal(banner(e), "", "the pre-fix wrapper produces NO operator-visible state — the defect L-GAP-1 described");
  assert.deepEqual(e.effects("setLaborSaveError"), [], "and never reaches a state setter");
});
