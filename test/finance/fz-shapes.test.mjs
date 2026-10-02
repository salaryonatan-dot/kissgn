// WP-FZ — shape-freeze goldens of the Agent/Daily entry artifacts (09_AGENT_DAILY_HANDOFF.md §1–§2;
// agent-daily-1-0-readiness 10 §Entry gate item 3). Tests only: no runtime file is changed.
//
// For FZ-01…FZ-08, FZ-14 and FZ-15 the live outputs of the ACCEPTED code (test/support/
// fz-producers.mjs, over representative complete / explicit-zero / incomplete / closed /
// contradictory / unreadable / goals / first-of-month states) must have exactly the keys and
// types recorded in test/finance/goldens/fz-<id>.json, and the contract identifiers recorded
// there. FZ-09/10 (C1), FZ-11 (C2) and FZ-12/13 (F1) are owned by those slices.
// A golden change is a versioned contract change, reviewed separately (§2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { shapeOf, shapeDiff } from "../support/fz-shape.mjs";
import { PRODUCERS, OWNERS, scenarios, MONEY, PCT } from "../support/fz-producers.mjs";

const IDS = ["FZ-01", "FZ-02", "FZ-03", "FZ-04", "FZ-05", "FZ-06", "FZ-07", "FZ-08", "FZ-14", "FZ-15"];
const GOLDEN = (id) => JSON.parse(readFileSync(join(REPO, "test/finance/goldens", "fz-" + id.slice(3) + ".json"), "utf8"));
const LIVE = {};
for (const id of IDS) LIVE[id] = await PRODUCERS[id]();
const A = await scenarios();
const byName = Object.fromEntries(A.map((a) => [a.name, a]));
const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() : x)));

test("FZ-00 the freeze list in scope is exactly FZ-01…08, 14, 15; each has one golden with its owner slice", () => {
  assert.deepEqual(Object.keys(PRODUCERS).sort(), IDS);
  const files = readdirSync(join(REPO, "test/finance/goldens")).filter((f) => /^fz-\d\d\.json$/.test(f));
  for (const id of IDS) assert.ok(files.includes("fz-" + id.slice(3) + ".json"), id + " golden exists");
  for (const id of IDS) { const g = GOLDEN(id); assert.equal(g.id, id); assert.equal(g.owner, OWNERS[id]); assert.ok(g.ids && g.shapes); }
});

for (const id of IDS) {
  test(`${id} live shapes and contract identifiers equal the golden`, () => {
    const g = GOLDEN(id), live = LIVE[id];
    assert.deepEqual(live.ids, g.ids, id + " identifiers");
    assert.deepEqual(Object.keys(live.shapes).sort(), Object.keys(g.shapes).sort(), id + " shape sections");
    for (const k of Object.keys(g.shapes)) assert.deepEqual(shapeDiff(g.shapes[k], live.shapes[k]), [], `${id} shape ${k}`);
  });
}

// ── negative controls: a mutated live shape (added, removed or retyped key) fails ────────────────
function firstObjectPath(s, path = []) {
  if (s && typeof s === "object" && !Array.isArray(s) && !("$oneOf" in s)) {
    const keys = Object.keys(s);
    if (keys.length) return { obj: s, path };
  }
  return null;
}
test("FZ-NC1 every golden detects an added, a removed and a retyped key in each of its shape sections", () => {
  for (const id of IDS) {
    const g = GOLDEN(id);
    for (const [sec, frozen] of Object.entries(g.shapes)) {
      const target = firstObjectPath(frozen);
      if (!target) continue; // a primitive section (e.g. a presenter returns "string") is covered by FZ-NC2
      const k = Object.keys(target.obj)[0];
      const added = { ...frozen, zz_new_field: "number" };
      const removed = { ...frozen }; delete removed[k];
      const retyped = { ...frozen, [k]: JSON.stringify(frozen[k]) === '"boolean"' ? "string" : "boolean" };
      for (const [label, s] of [["added", added], ["removed", removed], ["retyped", retyped]]) assert.notDeepEqual(shapeDiff(frozen, s), [], `${id}.${sec} ${label}`);
    }
  }
});
test("FZ-NC2 mutated LIVE outputs fail: a daily metric with an extra key, a doc without had_entry, a retyped snapshot field, a presenter returning a number", () => {
  const days = A.flatMap((a) => a.series.days).map(plain);
  const g1 = GOLDEN("FZ-01").shapes.day;
  assert.deepEqual(shapeDiff(g1, shapeOf(days)), []);
  assert.notDeepEqual(shapeDiff(g1, shapeOf(days.map((d, i) => (i === 0 ? { ...d, extra: 1 } : d)))), [], "added key");
  assert.notDeepEqual(shapeDiff(g1, shapeOf(days.map((d) => { const c = { ...d }; delete c.laborCostComplete; return c; }))), [], "removed key");
  assert.notDeepEqual(shapeDiff(g1, shapeOf(days.map((d, i) => (i === 0 ? { ...d, foodCostPct: "33" } : d)))), [], "retyped key");
  const docs = A.flatMap((a) => a.docs).map(plain);
  const g3 = GOLDEN("FZ-03").shapes.revenue;
  assert.notDeepEqual(shapeDiff(g3, shapeOf(docs.map((d) => { const r = { ...d.revenue }; delete r.had_entry; return r; }))), [], "had_entry removed");
  assert.notDeepEqual(shapeDiff(g3, shapeOf(docs.map((d) => ({ ...d.revenue, total: d.revenue.total === undefined ? 0 : d.revenue.total })))), [], "legacy total written when incomplete (optional → required)");
  const g6 = GOLDEN("FZ-06").shapes.snapshot;
  assert.notDeepEqual(shapeDiff(g6, shapeOf(A.map((a) => ({ ...plain(a.snapshot), totalSales: "1" })))), [], "retyped snapshot field");
  const g14 = GOLDEN("FZ-14").shapes.formatShekel;
  assert.notDeepEqual(shapeDiff(g14, shapeOf([1])), [], "presenter retyped");
});

// ── semantics of the current contracts over the representative states (values not frozen) ───────
test("FZ-01 semantics: present completed days only; ratios null unless their denominator is a complete non-zero revenue", () => {
  for (const a of A) {
    const asOf = a.inputs.asOfBusinessDate;
    for (const d of a.series.days) {
      assert.ok(d.date < asOf, `${a.name} ${d.date}: completed (≤ D-1)`);
      assert.equal(d.presence.day, "present", `${a.name} ${d.date}: present days only`);
      for (const r of ["foodCostPct", "laborPct"]) assert.ok(d[r] === null || typeof d[r] === "number", r);
      if (d.partial.revenue || d.presence.revenue !== "present" || d.revenue === 0) { assert.equal(d.foodCostPct, null, `${a.name} ${d.date}`); assert.equal(d.laborPct, null, `${a.name} ${d.date}`); }
    }
  }
  const closed = byName.closed.series.days.map((d) => d.date);
  assert.ok(!closed.includes("2026-09-06") && !closed.includes("2026-09-13"), "declared closures without entries are not present days");
  assert.ok(byName.explicit_zero.series.days.length >= 28, "explicit zeros are present days");
  assert.ok(byName.incomplete.series.missingDates.includes("2026-09-20"), "missing completed dates are listed, not zero days");
});

test("FZ-03 semantics: legacy numeric fields only when complete; had_entry = presence; outside-Actual docs carry no figure", () => {
  for (const d of A.flatMap((a) => a.docs).map(plain)) {
    const f = d.fin, r = d.revenue;
    if (!f.inActual) { assert.deepEqual(Object.keys(r).sort(), ["had_entry", "has_sales"], d.date + " outside Actual"); assert.ok(["current_day", "future_date"].includes(f.outsideActualReason)); continue; }
    assert.equal(r.had_entry, f.presence.day === "present", d.date);
    if (f.revenue.state !== "present") assert.equal(r.total, undefined, `${d.date}: no legacy total for ${f.revenue.state}`);
    for (const v of Object.values(r)) assert.notEqual(v, null, "never null in the persisted doc");
    if (f.legacyHourlyPayroll) assert.equal(f.legacyHourlyPayroll.counted, false, "hourly_payroll never counted");
  }
  const closedConflict = byName.contradictory.docs.map(plain).find((d) => d.date === "2026-09-06");
  assert.equal(closedConflict.fin.revenue.state, "closed_day_has_recorded_values");
  assert.equal(closedConflict.revenue.total, undefined, "a closure contradiction has no legacy revenue");
});

test("FZ-05 semantics: the live forecast engine is REV_FORECAST/v2 (doc 09 names v1 — recorded discrepancy FZ-D1); an unreadable ledger yields no projection", () => {
  for (const p of A.flatMap((a) => a.projections)) assert.equal(p.forecast.formulaId, "REV_FORECAST/v2");
  const u = byName.unreadable_inputs.projections[0];
  assert.equal(u.projection, null); assert.equal(u.forecast.projectedRevenue, null); assert.ok(u.forecast.warnings.includes("exception_ledger_unreadable"));
});

test("FZ-06/07 semantics: unavailable amounts are null legacy numbers (never 0); shares only from two complete values; zero revenue ⇒ no share", () => {
  for (const a of A) {
    const s = a.snapshot, am = s.financials.amounts;
    // SnapshotData: "legacy names; null = unavailable (incomplete / invalid / missing), never 0"
    if (am.revenue.state !== "complete") assert.equal(s.totalSales, null, `${a.name}: revenue ${am.revenue.state}`);
    for (const [k, r] of Object.entries(a.snapshot.financials.ratios)) if (r.state === "value") assert.equal(typeof r.exact, "string", `${a.name} ${k}`);
  }
  const z = byName.explicit_zero.snapshot.financials.ratios;
  assert.equal(z.revenueShare.state, "unavailable", "zero revenue ⇒ no 100% share (B2-R02)");
  const fm = byName.first_of_month.snapshot;
  assert.equal(fm.presentation, "no_completed_days");
});

test("FZ-08 semantics: config.targets.* take precedence over the compatibility defaults; nothing is owner-approved", () => {
  const g = byName.goals_set.policy.values, c = byName.complete.policy.values;
  assert.equal(g["goal.foodCostPct"].source, "business_config"); assert.equal(g["goal.foodCostPct"].value, "20");
  assert.equal(c["goal.foodCostPct"].source, "compatibility_product_default");
  for (const a of A) for (const v of Object.values(a.policy.values)) assert.equal(v.ownerApproved, false);
  assert.ok(byName.goals_set.evaluations[0].comparisons.some((x) => x.state === "above_goal"));
  assert.ok(byName.incomplete.evaluations[0].comparisons.every((x) => x.state === "not_evaluable"), "incomplete components ⇒ not evaluable");
});

test("FZ-14 semantics: NOT_AVAILABLE is \"—\" and every presenter renders an absent / non-complete value as it", () => {
  assert.equal(MONEY.NOT_AVAILABLE, "—");
  assert.equal(MONEY.formatShekel(null), "—");
  assert.equal(PCT.formatPercent(null), "—");
  assert.equal(PCT.formatPercent({ state: "no_denominator" }), "—");
  for (const st of ["partial", "unavailable", "incomplete_components"]) assert.equal(MONEY.formatTypedAmount({ state: st, value: st === "partial" ? "10" : null }), "—", st);
  assert.notEqual(MONEY.formatShekel("0"), "—", "an explicit zero is a value");
});

test("FZ-15 semantics: FinanceContractError is canonical, EntriesStorageError is a read error, unreadable envelopes are input issues (never {} / [])", () => {
  const ids = LIVE["FZ-15"].ids;
  assert.deepEqual(ids.classification, [["EntriesStorageError", false, true], ["FinanceContractError", true, false], ["FinanceContractError", true, false]]);
  assert.equal(ids.nonErrorIsCanonical, false);
  const u = byName.unreadable_inputs.inputs;
  assert.deepEqual([...u.inputIssues].sort(), ["config_unreadable", "exceptions_unreadable", "fixed_unreadable"]);
  assert.ok(!("value" in u.config) && !("value" in u.fixed), "an unreadable envelope is never defaulted");
  assert.deepEqual([...byName.complete.inputs.inputIssues], []);
});

// The current report already carries Slice A's `costVersionsApplied` and ServerProvenance its
// `timelineSource` / `configurationBasis` (today only compat values are observed). Those are the
// post-F1 COMPATIBILITY GATES (FZ handoff §4): F1 must state their new values in a reviewed,
// versioned golden change. Nothing F1-specific is frozen or invented here.
test("FZ-F1 boundary: no golden carries an F1 record field or identifier; the post-F1 gate fields are the existing ones", () => {
  for (const id of IDS) assert.doesNotMatch(JSON.stringify(GOLDEN(id)), /cost_versions|MARJIN_COSTV|MARJIN_COSTH|costTimelineFromVersions|predecessorVersionId|recordedAt|effectiveFrom/, id);
  assert.deepEqual(GOLDEN("FZ-02").ids.observed.timelineSource, ["compat_current_config"], "today: compat only (F1 adds persisted history — a gate, not frozen here)");
  assert.ok("costVersionsApplied" in GOLDEN("FZ-04").shapes.report.actual || JSON.stringify(GOLDEN("FZ-04").shapes.report).includes('"costVersionsApplied"'), "the existing Slice A field is frozen as it is today");
});
