import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCommitted, loadCompiled } from "../support/fincore-load.mjs";
import { seed, coreOf, SB } from "../support/b2-email-harness.mjs";
import { T, B } from "../support/b1-fixtures.mjs";
import { SEP_COMPLETED, fullDay, INV_NOW_MS } from "../support/financial-invariants.mjs";
import { reviewFor } from "../support/f1-history-fixtures.mjs";

const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const now = Date.parse("2026-10-02T09:00:00Z");
const first = {
  versionId: a, schema: "MARJIN_COSTV/1", effectiveFrom: "2026-10-02", recordedAt: now,
  recordedBy: "owner", basis: "recorded", predecessorVersionId: "none",
  globalEmployeesCount: 0, fixedItemsCount: 0, rent: { mode: "none" }, royalty: { mode: "none" },
};
const second = {
  ...first, versionId: b, predecessorVersionId: a, recordedAt: now + 1,
  fixedItemsCount: 1, fixedItems: [{ itemKey: "rent", monthlyAmount: "1000" }],
};
// F1 R1: MARJIN_COSTH/2 — every version carries a resolved (cleared) authorization review.
const history = (versions = { [a]: first, [b]: second }, head = { revision: 2, headVersionId: b }) => ({ head, versions, review: reviewFor(versions) });
const read = (codec, value) => codec.decodeHistory({ exists: value !== null, value });

test("F1-01 generated browser and fresh server core decode one coherent history identically", async () => {
  const server = await loadCompiled(), browser = await loadCommitted();
  assert.equal(browser.versions.costHistory, "MARJIN_COSTH/2");
  for (const value of [null, history(), history({ [a]: first }, { revision: 1, headVersionId: a }),
    history({ [a]: first, [b]: { ...second, predecessorVersionId: "none" } }),
    history({ [a]: first, [b]: { ...second, fixedItemsCount: 0 } }),
    history({ [a]: first, [b]: { ...second, recordedAt: now } })]) {
    const actual = read(browser.costHistory.codec, value);
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(read(server.costHistory.codec, value))));
  }
});

test("F1-02 absent, failure, strict counts and predecessor chain retain distinct states", async () => {
  const F = await loadCommitted(), c = F.costHistory.codec;
  assert.equal(read(c, null).state, "absent");
  assert.equal(c.decodeHistory({ failed: new Error("denied") }).reason, "read_failed");
  const valid = read(c, history());
  assert.equal(valid.state, "present");
  assert.equal(valid.versions.length, 2);
  assert.deepEqual(valid.versions[0].globalEmployees, []);
  assert.equal(valid.activationDate, "2026-10-02");
  assert.equal(read(c, history({ [a]: first, [b]: { ...second, fixedItemsCount: 0 } })).reason, "record_invalid");
  assert.equal(read(c, history({ [a]: first, [b]: { ...second, predecessorVersionId: "none" } })).reason, "chain_disconnected");
  assert.equal(read(c, history({ [a]: first, [b]: { ...second, recordedAt: now } })).reason, "chain_not_monotonic");
});

test("F1-03 real canonical server loader uses one cost_history node and withholds malformed cost outputs", async () => {
  const db = seed({ rows: SEP_COMPLETED.map((d) => fullDay(d)) });
  const path = `tenants/${T}/biz:${B}:cost_history`;
  const september = { ...first, effectiveFrom: "2026-09-01", recordedAt: Date.parse("2026-09-01T09:00:00Z"),
    globalEmployeesCount: 1, globalEmployees: [{ employeeKey: "g1", monthlyEmployerCost: "3000" }] };
  db.seed(path, history({ [a]: september }, { revision: 1, headVersionId: a }));
  const valid = await coreOf(INV_NOW_MS);
  assert.equal(valid.inputs.costHistoryState, "present");
  assert.equal(valid.report.timelineSource, "persisted");
  assert.deepEqual(valid.report.costVersionsApplied, [a]);
  db.seed(path, history({ [a]: { ...september, fixedItemsCount: 2 } }, { revision: 1, headVersionId: a }));
  const bad = await coreOf(INV_NOW_MS);
  assert.equal(bad.inputs.costHistoryState, "unreadable");
  assert.ok(bad.inputs.inputIssues.includes("cost_history_unreadable"));
  assert.equal(bad.report.timelineSource, "unavailable");
  assert.equal(bad.report.actual.labor.employerCost.value, null);
  assert.equal(bad.report.actual.operatingProfit.value, null);
  assert.ok(bad.report.actual.revenue.value !== null, "revenue remains visible");
});

test("F1-AT15 two effective versions reach the real B2 snapshot path", async () => {
  const db = seed({ rows: SEP_COMPLETED.map((d) => fullDay(d)) });
  const path = `tenants/${T}/biz:${B}:cost_history`;
  const v1 = { ...first, effectiveFrom: "2026-09-01", recordedAt: Date.parse("2026-09-01T09:00:00Z"),
    fixedItemsCount: 1, fixedItems: [{ itemKey: "f", monthlyAmount: "1000" }] };
  const v2 = { ...v1, versionId: b, predecessorVersionId: a, effectiveFrom: "2026-09-15",
    recordedAt: Date.parse("2026-09-15T09:00:00Z"), fixedItems: [{ itemKey: "f", monthlyAmount: "2000" }] };
  db.seed(path, history({ [a]: v1, [b]: v2 }));
  const snap = await SB.buildSnapshotForBiz(T, B, { nowMs: INV_NOW_MS });
  const { report } = await coreOf(INV_NOW_MS);
  assert.deepEqual(report.costVersionsApplied, [a, b]);
  assert.equal(snap.fixedRegular, Number(report.actual.fixedAccrual.regular));
  assert.equal(snap.financials.provenance?.versions?.fin || report.versions.fin, "MARJIN_FIN/3");
});

test("F1-AT14 reachable zero-eligible segment remains typed unavailable for a completed closure", async () => {
  const F = await loadCommitted();
  const v1 = { ...first, effectiveFrom: "2026-09-01", recordedAt: Date.parse("2026-09-01T09:00:00Z"),
    fixedItemsCount: 1, fixedItems: [{ itemKey: "f", monthlyAmount: "3000" }] };
  const v2 = { ...v1, versionId: b, predecessorVersionId: a, effectiveFrom: "2026-09-02", recordedAt: Date.parse("2026-09-02T09:00:00Z") };
  const decision = read(F.costHistory.codec, history({ [a]: v1, [b]: v2 }));
  const timeline = F.product.productTimeline({ rows: [], config: { state: "absent" }, fixed: { state: "absent" },
    costHistory: decision, asOfBusinessDate: "2026-09-03" });
  const placement = F.metrics.costTimeline.dayPlacement(timeline, "2026-09-01", { asOfBusinessDate: "2026-09-03", closedDates: ["2026-09-01"] });
  assert.equal(placement.state, "no_eligible_allocation_days");
});
