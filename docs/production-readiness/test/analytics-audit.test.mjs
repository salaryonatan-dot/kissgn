// Deterministic synthetic tests for the pure analytics model. No Firebase, no network.
// Injected "today" makes future-date exclusion deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAnalytics, finiteMetric, isRealDateKey, validDailyDoc } from "../lib/analytics-model.mjs";

const TODAY = "2026-07-15";
const REG = { _v: JSON.stringify([{ id: "bizA", name: "A" }]) };
const good = (t, p, f) => ({ revenue: { total: t, payroll: p, food_cost: f } });

function daysBack(n) { const d = new Date(Date.UTC(2026, 6, 15)); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); }
function series(n, from = 0) { const o = {}; for (let i = from; i < from + n; i++) o[daysBack(i)] = good(1000 + i, 300, 200); return o; }

function run(over) {
  return classifyAnalytics({ appBusinessRaw: REG, dailyByBiz: {}, legacyPresent: false, today: TODAY, forecastMin: 5, salt: "t", ...over });
}

test("1. 90 valid historical days -> READY, latest valid date is most recent past", () => {
  const r = run({ dailyByBiz: { bizA: series(90, 1) } });
  assert.equal(r.perBusiness.bizA.category, "READY");
  assert.equal(r.perBusiness.bizA.valid, 90);
  assert.equal(r.perBusiness.bizA.latestValidBusinessDate, daysBack(1));
});

test("2. exactly forecast minimum (5) -> READY", () => {
  const r = run({ dailyByBiz: { bizA: series(5, 1) } });
  assert.equal(r.perBusiness.bizA.category, "READY");
});

test("3. below threshold (4) -> INSUFFICIENT_HISTORY (forecast safe null)", () => {
  const r = run({ dailyByBiz: { bizA: series(4, 1) } });
  assert.equal(r.perBusiness.bizA.category, "INSUFFICIENT_HISTORY");
  assert.match(r.perBusiness.bizA.forecast, /insufficient/);
});

test("4. zero-valued but valid metrics count as valid", () => {
  const docs = {}; for (let i = 1; i <= 5; i++) docs[daysBack(i)] = good(0, 0, 0);
  const r = run({ dailyByBiz: { bizA: docs } });
  assert.equal(r.perBusiness.bizA.valid, 5);
  assert.equal(r.perBusiness.bizA.category, "READY");
});

test("5. missing metric -> MISSING_METRIC (missing is not zero)", () => {
  const docs = { [daysBack(1)]: { revenue: { total: 100, payroll: 50 } } }; // no food_cost
  const r = run({ dailyByBiz: { bizA: docs } });
  assert.equal(r.perBusiness.bizA.category, "MISSING_METRIC");
  assert.equal(r.perBusiness.bizA.valid, 0);
});

test("6. malformed string/null/non-finite -> MALFORMED_DATA, skipped", () => {
  const docs = {
    [daysBack(1)]: { revenue: { total: "abc", payroll: 1, food_cost: 1 } },
    [daysBack(2)]: { revenue: { total: null, payroll: 1, food_cost: 1 } },
    [daysBack(3)]: { revenue: { total: Infinity, payroll: 1, food_cost: 1 } },
  };
  const r = run({ dailyByBiz: { bizA: docs } });
  assert.equal(r.perBusiness.bizA.valid, 0);
  assert.equal(r.perBusiness.bizA.category, "MALFORMED_DATA");
});

test("7. invalid calendar dates excluded + reported", () => {
  const docs = { "2026-13-99": good(1, 1, 1), "not-a-date": good(1, 1, 1), [daysBack(1)]: good(1, 1, 1) };
  const r = run({ dailyByBiz: { bizA: docs } });
  assert.equal(r.perBusiness.bizA.invalidDate, 2);
  assert.equal(r.perBusiness.bizA.valid, 1);
});

test("8. future dates excluded from valid + counts + latest date (no false READY)", () => {
  const docs = {};
  for (let i = 1; i <= 10; i++) { const d = new Date(Date.UTC(2026, 6, 15)); d.setUTCDate(d.getUTCDate() + i); docs[d.toISOString().slice(0, 10)] = good(999, 1, 1); }
  const r = run({ dailyByBiz: { bizA: docs } });
  assert.equal(r.perBusiness.bizA.valid, 0);
  assert.equal(r.perBusiness.bizA.futureDated, 10);
  assert.equal(r.perBusiness.bizA.latestValidBusinessDate, null);
  assert.notEqual(r.perBusiness.bizA.category, "READY");
});

test("8b. mix of valid past + future: future ignored, past drives classification", () => {
  const docs = series(6, 1);
  const fut = new Date(Date.UTC(2026, 6, 20)).toISOString().slice(0, 10); docs[fut] = good(9, 9, 9);
  const r = run({ dailyByBiz: { bizA: docs } });
  assert.equal(r.perBusiness.bizA.valid, 6);
  assert.equal(r.perBusiness.bizA.futureDated, 1);
  assert.equal(r.perBusiness.bizA.category, "READY");
  assert.equal(r.perBusiness.bizA.latestValidBusinessDate, daysBack(1));
});

test("9. active registry business with NO analytics -> NO_DATA (never omitted)", () => {
  const r = run({ appBusinessRaw: { _v: JSON.stringify([{ id: "bizA", name: "A" }, { id: "bizB", name: "B" }]) }, dailyByBiz: { bizA: series(5, 1) } });
  assert.ok(r.perBusiness.bizB);
  assert.equal(r.perBusiness.bizB.category, "NO_DATA");
});

test("10. legacy-only business -> LEGACY_ONLY", () => {
  const r = run({ appBusinessRaw: { _v: JSON.stringify([{ id: "bizA", name: "A" }]) }, dailyByBiz: {}, legacyPresent: true });
  assert.equal(r.perBusiness.bizA.category, "LEGACY_ONLY");
});

test("11. unknown analytics business (not in registry) surfaced separately", () => {
  const r = run({ appBusinessRaw: { _v: JSON.stringify([{ id: "bizA", name: "A" }]) }, dailyByBiz: { bizA: series(5, 1), bizGhost: series(5, 1) } });
  assert.equal(r.perBusiness.bizGhost.inRegistry, false);
  assert.equal(r.unknownAnalyticsBusinessCount, 1);
  assert.ok(r.perBusiness.bizA.inRegistry);
});

test("11b. malformed business registry surfaced", () => {
  const r = run({ appBusinessRaw: { _v: "not json" }, dailyByBiz: { bizA: series(5, 1) } });
  assert.equal(r.registryMalformed, true);
  assert.equal(r.needsAttention, true);
});

test("12. latest valid date correctness (ignores future + malformed newest)", () => {
  const docs = series(5, 3); // days back 3..7
  docs["2026-07-14"] = { revenue: { total: "bad" } };  // newest-ish but malformed -> excluded
  const fut = new Date(Date.UTC(2026, 6, 30)).toISOString().slice(0, 10); docs[fut] = good(9, 9, 9);
  const r = run({ dailyByBiz: { bizA: docs } });
  assert.equal(r.perBusiness.bizA.latestValidBusinessDate, daysBack(3));
});

test("helpers: finiteMetric / isRealDateKey / validDailyDoc", () => {
  assert.equal(finiteMetric(0), 0);
  assert.equal(finiteMetric("0"), 0);
  assert.equal(finiteMetric(""), undefined);
  assert.equal(finiteMetric("x"), undefined);
  assert.equal(finiteMetric(NaN), undefined);
  assert.equal(isRealDateKey("2026-02-29"), false); // 2026 not leap
  assert.equal(isRealDateKey("2024-02-29"), true);
  assert.equal(isRealDateKey("2026-13-01"), false);
  assert.equal(validDailyDoc(good(1, 2, 3)).valid, true);
  assert.equal(validDailyDoc({ revenue: [1] }).valid, false);
});
