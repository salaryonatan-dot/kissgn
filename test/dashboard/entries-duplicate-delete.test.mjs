// P0-DATA-01 R10 — D-GAP-1 CLOSURE: preserved duplicate rows are visible and
// individually removable from the RENDERED dashboard.
//
// R10 deliberately preserves duplicate-date rows (they are distinct records and
// collapsing them client-side is itself a silent full-node rewrite). Until now the
// dashboard kept only the FIRST row per business date, so a preserved duplicate was
// neither visible nor reachable: `deleteEntryById` existed and was correct, but no
// element invoked it, and the wired date-addressed delete refuses ambiguous dates.
//
// These tests drive the ACTUAL rendered button — its `onClick` expression extracted
// from the `<button data-testid="dup-delete">` element in index.html — plus the
// production `dupExtras` collection that decides which rows the card lists.
//
// Run: node --test test/dashboard/entries-duplicate-delete.test.mjs

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  ML, plain, settleAll, mkId, html,
  makeUiEnv, drainLiveRigs, SOURCE,
} from "../support/ui-call-site-harness.mjs";

afterEach(drainLiveRigs);

const IDH = mkId("dup-head"), IDX = mkId("dup-extra"), IDX2 = mkId("dup-extra-2"), IDO = mkId("dup-other");
const D1 = "2026-08-01", D2 = "2026-08-02";
const HEAD = () => ({ id: IDH, date: D1, sales: 101, deliveries: 7, other_income: 3, payroll: 40 });
const EXTRA = () => ({ id: IDX, date: D1, sales: 999, deliveries: 0, other_income: 0, payroll: 41, twin: "yes" });
const EXTRA2 = () => ({ id: IDX2, date: D1, sales: 888, deliveries: 0, other_income: 0, payroll: 42 });
const OTHER = () => ({ id: IDO, date: D2, sales: 202, deliveries: 0, other_income: 0, payroll: 50 });

function env(seed, opts = {}) {
  const e = makeUiEnv(opts);
  e.at(opts.tenantId || "T1", opts.bizId || "A").seed(seed);
  e.attach(); e.hydrate(); e.reset();
  return e;
}
const rows = (e, t = "T1", b = "A") => plain(e.at(t, b).rows());
// Array.from keeps the result in THIS realm — vm-produced arrays are not deepStrictEqual-comparable.
const ids = (rs) => Array.from(rs || [], (r) => r.id);

// ── The production duplicate-collection block, extracted and executed ─────────
// Sliced from index.html between its own anchors, so this file never restates the
// rule that decides which rows the day card lists.
const DUP_SRC = (() => {
  const a = html.indexOf("const dupExtras = new Map();");
  assert.notEqual(a, -1, "index.html must contain the dupExtras collection");
  const endMarker = "dupExtras.set(e.date, list);";
  const b = html.indexOf(endMarker, a);
  assert.notEqual(b, -1, "dupExtras collection must terminate");
  return html.slice(a, html.indexOf("});", b) + 3);
})();
function collectDupExtras(entries, monthPrefix) {
  const entriesByDate = new Map();
  entries.forEach((e, i) => {
    if (e?.date && e.date.startsWith(monthPrefix) && !entriesByDate.has(e.date)) {
      entriesByDate.set(e.date, { ...e, _idx: i, __missing: false });
    }
  });
  const sandbox = { Map, Number, Object, Array, JSON, entries, monthPrefix, entriesByDate, __OUT: null };
  vm.runInNewContext(`${DUP_SRC}\n;__OUT = dupExtras;`, sandbox);
  return sandbox.__OUT;
}

// ═══════════════════════════════════════════════════════════════════════════
// FIDELITY
// ═══════════════════════════════════════════════════════════════════════════

test("[fidelity] DG-F1: the button under test is the rendered production onClick, id-addressed and confirmed", () => {
  assert.ok(SOURCE.dupDeleteOnClick.includes("deleteEntryById(dup.id)"),
    "the duplicate delete must address the row by its immutable id");
  assert.ok(SOURCE.dupDeleteOnClick.includes("window.confirm("),
    "the duplicate delete must require an explicit operator confirmation");
  assert.ok(!/_idx|\[\s*\d+\s*\]|indexOf|splice/.test(SOURCE.dupDeleteOnClick),
    "the duplicate delete must never be positional");
  assert.ok(!SOURCE.dupDeleteOnClick.includes("deleteEntryByDate"),
    "the duplicate delete must not fall back to the date-addressed delete");
});

test("[fidelity] DG-F2: the production collection lists exactly the rows beyond the first, in entries order", () => {
  const entries = [HEAD(), EXTRA(), OTHER(), EXTRA2()];
  const m = collectDupExtras(entries, "2026-08");
  assert.deepEqual(ids(m.get(D1)), [IDX, IDX2], "both extras for the date, in order");
  assert.equal(m.get(D2), undefined, "a date with a single row has no extras");
  assert.equal(m.size, 1, "no other date is listed");
});

test("[fidelity] DG-F3: rows outside the displayed month are never listed", () => {
  const m = collectDupExtras([HEAD(), EXTRA(), { id: mkId("old"), date: "2026-07-01", sales: 1 }], "2026-08");
  assert.deepEqual(ids(m.get(D1)), [IDX]);
  assert.equal(m.size, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// BEHAVIOUR — the rendered click
// ═══════════════════════════════════════════════════════════════════════════

test("DG-1: confirming removes EXACTLY the duplicate row, by id; the first row for that date survives", async () => {
  const e = env([HEAD(), EXTRA(), OTHER()], { confirm: true });
  await e.dupDeleteClick(EXTRA(), HEAD());
  await settleAll();
  const rs = rows(e);
  assert.deepEqual(ids(rs), [IDH, IDO], "only the duplicate is gone");
  assert.deepEqual(rs.find(r => r.id === IDH), HEAD(), "the first row for that date is byte-intact");
  assert.deepEqual(rs.find(r => r.id === IDO), OTHER(), "the other date is untouched");
  assert.equal(e.state.entrySaveError, "", "a successful delete reports no error");
});

test("DG-2: declining the confirmation submits nothing and changes nothing", async () => {
  const e = env([HEAD(), EXTRA(), OTHER()], { confirm: false });
  const before = rows(e);
  await e.dupDeleteClick(EXTRA(), HEAD());
  await settleAll();
  assert.deepEqual(e.coordinatorCalls, [], "a declined confirmation never reaches the write lane");
  assert.deepEqual(rows(e), before, "the node is untouched");
});

test("DG-3: one click removes one row — three rows on a date do not become zero", async () => {
  const e = env([HEAD(), EXTRA(), EXTRA2(), OTHER()], { confirm: true });
  await e.dupDeleteClick(EXTRA(), HEAD());
  await settleAll();
  assert.deepEqual(ids(rows(e)), [IDH, IDX2, IDO], "exactly one row removed, no bulk deletion");
  const submitted = e.coordinatorCalls.filter(c => c.api === "submitIntent");
  assert.equal(submitted.length, 1, "exactly one intent");
  assert.equal(submitted[0].intent.type, "delete_entry");
  assert.equal(submitted[0].intent.target.id, IDX, "addressed by the clicked row's id");
});

test("DG-4: the delete is not date-addressed — the twin sharing the date is never taken with it", async () => {
  const e = env([HEAD(), EXTRA()], { confirm: true });
  await e.dupDeleteClick(EXTRA(), HEAD());
  await settleAll();
  const rs = rows(e);
  assert.equal(rs.length, 1, "one row remains");
  assert.equal(rs[0].id, IDH, "and it is the one that was not clicked");
  assert.equal(rs[0].date, D1, "the business date itself still exists");
});

test("DG-5: a legacy duplicate with no valid id is refused with the identity message, nothing submitted", async () => {
  const legacy = { date: D1, sales: 555, deliveries: 0, other_income: 0 };
  const e = env([HEAD(), legacy], { confirm: true });
  const before = rows(e);
  await e.dupDeleteClick(legacy, HEAD());
  await settleAll();
  assert.equal(e.state.entrySaveError, ML.describeSaveOutcome("blocked_entry_identity_required", false));
  assert.deepEqual(e.coordinatorCalls, [], "no write is attempted for an id-less row");
  assert.deepEqual(rows(e), before, "the node is untouched");
});

test("DG-6: destination scoping is preserved — an identical id in another business is untouched", async () => {
  const e = makeUiEnv({ confirm: true });
  // The SAME row ids exist in a second business. Only the selected destination may change.
  e.at("T1", "A").seed([HEAD(), EXTRA(), OTHER()]);
  e.at("T1", "B").seed([HEAD(), EXTRA()]);
  e.attach(); e.hydrate(); e.reset();
  const otherBefore = plain(e.at("T1", "B").rows());
  await e.dupDeleteClick(EXTRA(), HEAD());
  await settleAll();
  assert.deepEqual(ids(rows(e)), [IDH, IDO], "the duplicate is removed in the selected business");
  assert.deepEqual(plain(e.at("T1", "B").rows()), otherBefore,
    "the other business keeps its row with the identical id");
  const d = e.destination();
  assert.equal(d.key, "biz:A:entries", "the write was addressed to the selected destination only");
});

test("[negative-control] DG-X1: a positional delete of the same click would remove the wrong row", async () => {
  // Control: the rows are ordered head-first, so an index-addressed delete of "the row
  // for this date" removes IDH, not IDX. The production click removes IDX (DG-1), which
  // is only possible because it is addressed by id.
  const e = env([HEAD(), EXTRA()], { confirm: true });
  const positional = (e.state.entries || []).filter(r => r.date === D1)[0];
  assert.equal(positional.id, IDH, "the positional target is the WRONG row");
  await e.dupDeleteClick(EXTRA(), HEAD());
  await settleAll();
  assert.ok(rows(e).some(r => r.id === IDH), "the positional target survived — the click was id-addressed");
});
