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

// ─── PR-001: staleness ────────────────────────────────────────────────────────
import { dataAgeDays, byCodePoint } from "../lib/analytics-model.mjs";

test("PR-001: latest exactly 3 days before audit date is NOT stale (may be READY)", () => {
  const r = run({ dailyByBiz: { bizA: series(5, 3) } }); // latest = daysBack(3)
  assert.equal(r.perBusiness.bizA.dataAgeDays, 3);
  assert.equal(r.perBusiness.bizA.category, "READY");
  assert.equal(r.categories.STALE_DATA, 0);
});

test("PR-001: latest 4 days before audit date is STALE_DATA, never READY", () => {
  const r = run({ dailyByBiz: { bizA: series(5, 4) } }); // latest = daysBack(4)
  assert.equal(r.perBusiness.bizA.dataAgeDays, 4);
  assert.equal(r.perBusiness.bizA.category, "STALE_DATA");
  assert.equal(r.categories.READY, 0);
  assert.equal(r.categories.STALE_DATA, 1);
  assert.deepEqual(r.perBusiness.bizA.stale, { latestValidBusinessDate: daysBack(4), auditDate: TODAY, dataAgeDays: 4, maxDataAgeDays: 3 });
});

test("PR-001: known eight-day stale pattern is STALE_DATA", () => {
  const r = run({ dailyByBiz: { bizA: series(6, 8) } }); // latest = daysBack(8)
  assert.equal(r.perBusiness.bizA.dataAgeDays, 8);
  assert.equal(r.perBusiness.bizA.category, "STALE_DATA");
});

test("PR-001: maxDataAgeDays is configurable (8-day data READY under threshold 10)", () => {
  const stale = run({ dailyByBiz: { bizA: series(6, 8) } });                    // default 3
  assert.equal(stale.perBusiness.bizA.category, "STALE_DATA");
  const ok = run({ dailyByBiz: { bizA: series(6, 8) }, maxDataAgeDays: 10 });   // custom 10
  assert.equal(ok.perBusiness.bizA.category, "READY");
  assert.equal(ok.perBusiness.bizA.maxDataAgeDays, 10);
});

test("PR-001: STALE_DATA suppresses forecast and alerts", () => {
  const r = run({ dailyByBiz: { bizA: series(6, 8) } });
  const b = r.perBusiness.bizA;
  assert.equal(b.forecastSuppressed, true);
  assert.equal(b.alertsSuppressed, true);
  assert.equal(b.forecastActive, false);
  assert.equal(b.alertsActive, false);
  assert.match(b.forecast, /suppressed/i);
});

test("PR-001: data-age uses normalized calendar dates, not local clock/timezone", () => {
  // Deterministic across month/year boundaries, independent of process TZ.
  assert.equal(dataAgeDays("2026-06-30", "2026-07-01"), 1);
  assert.equal(dataAgeDays("2025-12-31", "2026-01-01"), 1);
  assert.equal(dataAgeDays("2026-07-01", "2026-07-01"), 0);
  assert.equal(dataAgeDays("2024-02-28", "2024-03-01"), 2); // 2024 leap
  // classifyAnalytics uses the injected today, not Date.now:
  const r = classifyAnalytics({ appBusinessRaw: REG, dailyByBiz: { bizA: series(5, 4) }, today: "2026-07-15", forecastMin: 5, salt: "t" });
  assert.equal(r.perBusiness.bizA.dataAgeDays, 4);
  assert.equal(r.perBusiness.bizA.auditDate, "2026-07-15");
});

// ─── PR-002: unknown-analytics vs empty non-registry namespace semantics ───────
test("PR-002: non-registry namespace with ZERO date keys is NOT unknown-analytics", () => {
  const r = run({ dailyByBiz: { bizA: series(5, 1) }, dataKeyBizIds: ["bizEmptyNS"] });
  assert.equal(r.unknownAnalyticsBusinessCount, 0);
  assert.equal(r.emptyNonRegistryBizNamespaceCount, 1);
  assert.equal(r.emptyNonRegistryBizNamespaceRefs.length, 1);
  assert.match(r.emptyNonRegistryBizNamespaceRefs[0], /^biz_[0-9a-f]{12}$/);
});

test("PR-002: non-registry namespace WITH valid analytics keys is unknown-analytics", () => {
  const r = run({ dailyByBiz: { bizA: series(5, 1), bizGhost: series(5, 1) } });
  assert.equal(r.unknownAnalyticsBusinessCount, 1);
  assert.equal(r.emptyNonRegistryBizNamespaceCount, 0);
  assert.equal(r.perBusiness.bizGhost.inRegistry, false);
});

test("PR-002: mixed valid / malformed / empty namespaces -> correct counts", () => {
  const malformedDocs = { [daysBack(1)]: { revenue: { total: "bad" } } };
  const r = run({
    appBusinessRaw: { _v: JSON.stringify([{ id: "bizA", name: "A" }]) },
    dailyByBiz: { bizA: series(5, 1), bizGhostValid: series(5, 1), bizGhostMalformed: malformedDocs },
    dataKeyBizIds: ["bizEmptyNS"],
  });
  // valid analytics non-registry: bizGhostValid + bizGhostMalformed both HAVE analytics date keys
  assert.equal(r.unknownAnalyticsBusinessCount, 2);
  assert.equal(r.emptyNonRegistryBizNamespaceCount, 1); // bizEmptyNS only
});

test("PR-002/PR-005: reported alias lists are deterministically code-point sorted", () => {
  const r = run({ dailyByBiz: { bizA: series(5, 1), zzz: series(5, 1), aaa: series(5, 1), mmm: series(5, 1) } });
  const refs = r.unknownAnalyticsBusinessRefs;
  assert.deepEqual(refs, [...refs].sort(byCodePoint));
  assert.equal(refs.length, 3);
});

// ─── PR-005: identical input, different insertion order -> byte-equal output ───
test("PR-005: identical snapshots (different key order) produce byte-equal model output", () => {
  const mk = (order) => {
    const docs = {}; for (const d of order) docs[d] = good(1000, 300, 200);
    return classifyAnalytics({
      appBusinessRaw: { _v: JSON.stringify([{ id: "bizA", name: "A" }, { id: "bizB", name: "B" }]) },
      dailyByBiz: { bizB: series(5, 1), bizA: docs }, dataKeyBizIds: ["bizB", "bizA"], today: TODAY, forecastMin: 5, salt: "t",
    });
  };
  const forward = [daysBack(1), daysBack(2), daysBack(3), daysBack(4), daysBack(5)];
  const shuffled = [daysBack(3), daysBack(5), daysBack(1), daysBack(4), daysBack(2)];
  const a = mk(forward), b = mk(shuffled);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b)); // byte-equal serialization
  // perBusiness keys are in sorted order
  assert.deepEqual(Object.keys(a.perBusiness), ["bizA", "bizB"]);
});
