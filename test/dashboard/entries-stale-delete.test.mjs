// P0-DATA-01 R10.1 — Codex blocking finding 1: a stale delete could erase concurrent
// changes to fields the delete call site did not declare.
//
// The superseded contract evaluated the stale-delete guard over the paths the caller
// listed in `intent.base` — in practice `sales`, `deliveries`, `other_income`. A second
// writer could commit `supplier_payments` (or any field added later) to the same row,
// and the delete still matched its declared base, committed, and took the concurrent
// change with it while reporting success.
//
// The contract is now the COMPLETE canonical target row (R10.1-GATE-017), so it cannot
// go stale when a field is added to the schema. These tests drive the ACTUAL runtime
// transaction path — the rendered delete call sites extracted from index.html, the real
// coordinator, the real mutator and the Gate-3-approved remote — not a helper in
// isolation. The same scenarios are also run against a real RTDB emulator in
// `test/emulator/entries-remote-atomic-emulator.mjs` (EMU-F-*).
//
// Run: node --test test/dashboard/entries-stale-delete.test.mjs

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ML, plain, settleAll, mkId, makeUiEnv, drainLiveRigs,
} from "../support/ui-call-site-harness.mjs";

afterEach(drainLiveRigs);

const IDT = mkId("sd-target"), IDO = mkId("sd-other"), IDD = mkId("sd-dup");
const D1 = "2026-08-01", D2 = "2026-08-02";

// A row in the FULL production shape: every EMPTY_ENTRY field populated, plus an
// unknown field, so "every supported mutable field" is a real enumeration and not a
// hand-picked subset.
const TARGET = () => ({
  id: IDT, date: D1,
  sales: 101, deliveries: 7, food_cost: 33, payroll: 40, other_expense: 5, other_income: 3,
  supplier_payments: { sup1: 60, sup2: 12 },
  hourly_payroll: { shift_am: 90 },
  weather_impact: "גשם", security_event: false, includeVat: false, notes: "בסיס",
  is_exception: false, exception_reason: "", exception_note: "",
  unknown_future_field: "v1",
});
const OTHER = () => ({ id: IDO, date: D2, sales: 202, deliveries: 0, other_income: 0, supplier_payments: {} });
const SIBLING = () => ({ id: IDD, date: D1, sales: 999, deliveries: 0, other_income: 0, twin: "yes" });

function env(seed, opts = {}) {
  const e = makeUiEnv({ confirm: true, ...opts });
  e.at("T1", "A").seed(seed);
  e.attach(); e.hydrate(); e.reset();
  return e;
}
const rows = (e) => plain(e.at("T1", "A").rows());
const ids = (rs) => Array.from(rs || [], (r) => r.id);
const byId = (rs, id) => (rs || []).find((r) => r.id === id) || null;
// A second writer commits to the stored node without this client seeing the echo —
// exactly the schedule Codex reproduced.
const concurrentlyReplace = (e, next) => {
  const d = e.destination();
  e.remote.atKey(d.tenantId, d.key).setRowsDirect(next);
};

// Every field the current entry schema supports, with a value different from TARGET().
const MUTABLE_FIELDS = {
  date: "2026-08-09",
  sales: 999,
  deliveries: 111,
  food_cost: 77,
  payroll: 88,
  other_expense: 6,
  other_income: 4,
  weather_impact: "שרב",
  security_event: true,
  includeVat: true,
  notes: "שונה",
  is_exception: true,
  exception_reason: "אירוע",
  exception_note: "הערה",
  unknown_future_field: "v2",          // a field no call site ever listed
  brand_new_field: "added later",      // a field that did not exist when the guard was written
};

// ═══════════════════════════════════════════════════════════════════════════
// FIDELITY
// ═══════════════════════════════════════════════════════════════════════════

test("[fidelity] SD-F1: the delete precondition is the complete canonical row, not a field list", () => {
  const intent = ML.buildEntryDeleteIntent(TARGET(), {});
  assert.equal(intent.type, "delete_entry");
  // plain() normalises across the vm realm the production code is loaded in.
  assert.deepEqual(plain(intent.target), { id: IDT }, "identity is the immutable id only");
  assert.deepEqual(plain(intent.base.row), JSON.parse(ML.stableStringify(TARGET())),
    "the whole row is the base");
  assert.equal(intent.base.fields, undefined, "no hand-maintained field list remains");
  // Nothing is excluded: every persisted field is client-authored and semantic.
  assert.deepEqual(Object.keys(plain(intent.base.row)).sort(), Object.keys(TARGET()).sort());
});

test("[fidelity] SD-F2: a delete that carries no complete base row is refused, not run with a partial guard", () => {
  const out = ML.applyEntryIntent([TARGET()], { type: "delete_entry", target: { id: IDT },
    base: { fields: { sales: 101 } } });
  assert.equal(out.ok, false);
  assert.equal(out.status, "precondition_missing");
  assert.equal(out.reason, "delete_base_row_required");
});

test("[fidelity] SD-F3: an id-less row cannot produce a delete intent at all", () => {
  const { id, ...noId } = TARGET();
  assert.equal(ML.buildEntryDeleteIntent(noId, {}).status, "entry_identity_required");
});

// ═══════════════════════════════════════════════════════════════════════════
// A — the exact scenario Codex reproduced
// ═══════════════════════════════════════════════════════════════════════════

test("SD-A: stale delete vs a concurrent supplier_payments change — the delete aborts and the change survives", async () => {
  const e = env([TARGET(), OTHER()]);
  const changed = { ...TARGET(), supplier_payments: { sup1: 60, sup2: 12, sup3: 500 } };
  concurrentlyReplace(e, [changed, OTHER()]);
  await e.deleteEntryByDate(D1);           // the rendered delete the UI invokes
  await settleAll();
  const rs = rows(e);
  assert.deepEqual(ids(rs), [IDT, IDO], "the row is still there");
  assert.deepEqual(byId(rs, IDT).supplier_payments, { sup1: 60, sup2: 12, sup3: 500 },
    "the concurrent supplier payment survives");
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome("conflict", false),
    "and the operator is told, through the existing typed UI path");
});

test("SD-A2: the same scenario through the id-addressed delete", async () => {
  const e = env([TARGET(), OTHER()]);
  concurrentlyReplace(e, [{ ...TARGET(), supplier_payments: { sup1: 61 } }, OTHER()]);
  await e.deleteEntryById(IDT);
  await settleAll();
  assert.deepEqual(ids(rows(e)), [IDT, IDO], "the row survives");
  assert.deepEqual(byId(rows(e), IDT).supplier_payments, { sup1: 61 }, "the concurrent change survives");
  assert.notEqual(e.state.entrySaveError, "", "the refusal is visible");
});

test("SD-A3: the conflict names the concurrent path precisely", async () => {
  const e = env([TARGET()]);
  concurrentlyReplace(e, [{ ...TARGET(), supplier_payments: { sup1: 60, sup2: 12, sup3: 500 } }]);
  const intent = ML.buildEntryDeleteIntent(TARGET(), {});
  const res = await e.coordinator.submitIntent(intent);
  await settleAll();
  assert.equal(res.status, "conflict");
  assert.deepEqual(plain(res.conflictPaths), ["supplier_payments.sup3"],
    "map fields are named key-by-key, like every other conflict in the lane");
});

// ═══════════════════════════════════════════════════════════════════════════
// B — EVERY currently supported mutable field, including ones no list mentions
// ═══════════════════════════════════════════════════════════════════════════

for (const [field, value] of Object.entries(MUTABLE_FIELDS)) {
  test(`SD-B[${field}]: stale delete vs a concurrent change to \`${field}\` — aborts`, async () => {
    const e = env([TARGET(), OTHER()]);
    concurrentlyReplace(e, [{ ...TARGET(), [field]: value }, OTHER()]);
    await e.deleteEntryById(IDT);
    await settleAll();
    assert.ok(byId(rows(e), IDT), `the row must survive a concurrent \`${field}\` change`);
    assert.equal(byId(rows(e), IDT)[field], value, "the concurrent value survives");
    assert.equal(e.state.entrySaveError, ML.describeSaveOutcome("conflict", false));
  });
}

test("SD-B-map: a concurrent hourly_payroll change also aborts the delete", async () => {
  const e = env([TARGET()]);
  concurrentlyReplace(e, [{ ...TARGET(), hourly_payroll: { shift_am: 90, shift_pm: 120 } }]);
  await e.deleteEntryById(IDT);
  await settleAll();
  assert.ok(byId(rows(e), IDT), "the row survives");
  assert.deepEqual(byId(rows(e), IDT).hourly_payroll, { shift_am: 90, shift_pm: 120 });
});

test("SD-B-removed: a concurrently REMOVED field also aborts the delete", async () => {
  const e = env([TARGET()]);
  const { notes, ...withoutNotes } = TARGET();
  concurrentlyReplace(e, [withoutNotes]);
  await e.deleteEntryById(IDT);
  await settleAll();
  assert.ok(byId(rows(e), IDT), "the row survives a field REMOVAL too, not only a value change");
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome("conflict", false));
});

// ═══════════════════════════════════════════════════════════════════════════
// C / D / E — the delete must still work, and must not become over-strict
// ═══════════════════════════════════════════════════════════════════════════

test("SD-C: an unchanged row is deleted normally", async () => {
  const e = env([TARGET(), OTHER()]);
  await e.deleteEntryByDate(D1);
  await settleAll();
  assert.deepEqual(ids(rows(e)), [IDO], "exactly the target is removed");
  assert.equal(e.state.entrySaveError, "", "no error on a legitimate delete");
});

test("SD-D: a same-date sibling is never touched — identity stays the immutable id", async () => {
  const e = env([TARGET(), SIBLING(), OTHER()]);
  await e.deleteEntryById(IDT);
  await settleAll();
  const rs = rows(e);
  assert.deepEqual(ids(rs), [IDD, IDO], "only the addressed row is gone");
  assert.deepEqual(byId(rs, IDD), SIBLING(), "the twin sharing the business date is byte-intact");
});

test("SD-D2: a concurrent change to the same-date SIBLING does not block the target's delete", async () => {
  const e = env([TARGET(), SIBLING()]);
  concurrentlyReplace(e, [TARGET(), { ...SIBLING(), sales: 1234 }]);
  await e.deleteEntryById(IDT);
  await settleAll();
  const rs = rows(e);
  assert.deepEqual(ids(rs), [IDD], "the target was deleted");
  assert.equal(byId(rs, IDD).sales, 1234, "and the sibling's concurrent change is intact");
  assert.equal(e.state.entrySaveError, "", "no false stale from a different row sharing the date");
});

test("SD-E: a concurrent update to an UNRELATED row does not make a valid delete stale", async () => {
  const e = env([TARGET(), OTHER()]);
  concurrentlyReplace(e, [TARGET(), { ...OTHER(), sales: 777, supplier_payments: { s9: 9 } }]);
  await e.deleteEntryByDate(D1);
  await settleAll();
  const rs = rows(e);
  assert.deepEqual(ids(rs), [IDO], "the delete committed");
  assert.equal(byId(rs, IDO).sales, 777, "the unrelated row's concurrent change is intact");
  assert.equal(e.state.entrySaveError, "", "no false stale rejection");
});

test("SD-E2: a concurrently ADDED unrelated row does not make a valid delete stale", async () => {
  const e = env([TARGET(), OTHER()]);
  concurrentlyReplace(e, [TARGET(), OTHER(), { id: mkId("sd-new"), date: "2026-08-03", sales: 1, deliveries: 0, other_income: 0 }]);
  await e.deleteEntryByDate(D1);
  await settleAll();
  assert.equal(rows(e).length, 2, "the target is gone and the newly added row remains");
  assert.equal(byId(rows(e), IDT), null);
  assert.equal(e.state.entrySaveError, "");
});

test("SD-E3: row ORDER changing around the target does not make a valid delete stale", async () => {
  const e = env([TARGET(), OTHER()]);
  concurrentlyReplace(e, [OTHER(), TARGET()]);
  await e.deleteEntryByDate(D1);
  await settleAll();
  assert.deepEqual(ids(rows(e)), [IDO], "identity is the id, not the position");
  assert.equal(e.state.entrySaveError, "");
});

// ═══════════════════════════════════════════════════════════════════════════
// F — negative control: the superseded partial base does NOT protect
// ═══════════════════════════════════════════════════════════════════════════

test("[negative-control] SD-F: the superseded partial-field base commits the very delete that loses the supplier change", async () => {
  const e = env([TARGET(), OTHER()]);
  const changed = { ...TARGET(), supplier_payments: { sup1: 60, sup2: 12, sup3: 500 } };
  concurrentlyReplace(e, [changed, OTHER()]);
  // The EXACT intent shape the reviewed candidate submitted, kept here only as a
  // control. Under the current transformation it is refused outright, so the control
  // asserts the transformation's own verdict on it rather than re-enabling it.
  const legacy = { type: "delete_entry", target: { id: IDT },
    base: { fields: { sales: TARGET().sales, deliveries: TARGET().deliveries, other_income: TARGET().other_income } } };
  const offline = ML.applyEntryIntent([changed, OTHER()], legacy);
  assert.equal(offline.ok, false, "the partial-base delete no longer reaches a commit");
  assert.equal(offline.status, "precondition_missing");

  // And the historical behaviour it replaced: evaluated over declared paths only, the
  // partial base still MATCHED, which is why the row — and the concurrent supplier
  // payment with it — used to be removed.
  const declaredPathsStillMatch = ["sales", "deliveries", "other_income"]
    .every((f) => changed[f] === TARGET()[f]);
  assert.equal(declaredPathsStillMatch, true,
    "the declared paths were unchanged, so the superseded guard saw nothing wrong");
  assert.notDeepEqual(changed.supplier_payments, TARGET().supplier_payments,
    "while the row had in fact changed — the loss the complete-row base now prevents");

  // The production path, on the same state, refuses.
  const res = await e.coordinator.submitIntent(ML.buildEntryDeleteIntent(TARGET(), {}));
  assert.equal(res.status, "conflict");
  assert.ok(byId(rows(e), IDT), "the row is still there");
});
