// Financial Core Slice A — contract, property and boundary tests (R1.2 doc 09 G-P1…G-P6,
// G-30, G-31, G-33, G-35, G-36; R1.3 G-07f, G-48, G-50; R1.4 owner-decision contracts).
// Runs against the freshly compiled source AND the committed artifact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bothCores } from "../support/fincore-load.mjs";
import { requireEntriesRows } from "../../lib/analytics/entriesReader.js";

const cores = await bothCores();
const LABOR = (F) => F.policy.laborSource.productLaborSource();
const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Seeded PRNG (mulberry32) — reproducible property tests.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const shuffle = (r, arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const AMOUNTS = ["0", "0.1", "0.2", "100.10", "-40", "999999999999.999", "12", "", "skip", "abc", "1,234", "0.000001", 200.2, 0, -0.5, 7];

function randomRows(r, n) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const date = `2026-09-${String(1 + Math.floor(r() * 10)).padStart(2, "0")}`;
    const sup = {};
    const keys = shuffle(r, ["s1", "s2", "s3"]).slice(0, Math.floor(r() * 3));
    for (const k of keys) sup[k] = pick(r, AMOUNTS);
    const row = { id: UUID(i + 1), date, sales: pick(r, AMOUNTS), deliveries: pick(r, AMOUNTS), payroll: pick(r, AMOUNTS) };
    if (keys.length) row.supplier_payments = sup;
    if (r() < 0.3) row.food_cost = pick(r, AMOUNTS);
    if (r() < 0.3) row.hourly_payroll = { w1: pick(r, AMOUNTS), w2: pick(r, AMOUNTS) };
    rows.push(row);
  }
  return rows;
}

function reportOf(F, rows, asOf = "2026-09-10") {
  const n = F.finance.normalize.normalizeRows(rows, { asOfBusinessDate: asOf });
  const days = F.finance.normalize.groupByDate(n.rows, { from: "2026-09-01", to: asOf });
  const tl = F.metrics.adapters.configCompat.costTimelineFromCurrentConfig({ employees: [{ id: "e", type: "global", monthlySalary: "31000" }], rentType: "pct", rentPct: "7.5" }, [{ id: "f", amount: "3100" }]);
  const r = F.metrics.report.computePeriodReport(days, tl, F.policy.purchaseBasis.productPurchaseBasis(), LABOR(F), { kind: "open_month", month: "2026-09", asOfBusinessDate: asOf }, { quarantine: n.quarantine, flags: n.flags });
  return { report: r, days, text: F.metrics.report.serializeReport(r) };
}

function reorderKeys(r, obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const out = {};
  for (const k of shuffle(r, Object.keys(obj))) out[k] = reorderKeys(r, obj[k]);
  return out;
}

for (const [label, F] of cores) {
  test(`G-P1 [${label}] report bytes are invariant under row order, map-key order and V2 key order`, () => {
    const r = prng(1227);
    for (let t = 0; t < 2500; t += 1) { // 2500 datasets × 4 permutations = 10,000 (R1.2 G-P1 target)
      const rows = randomRows(r, 12);
      const base = reportOf(F, rows).text;
      for (let k = 0; k < 4; k += 1) {
        const perm = shuffle(r, rows).map((row) => reorderKeys(r, row));
        assert.equal(reportOf(F, perm).text, base);
      }
      const v2 = { schemaVersion: 2, generation: 1, rows: {} };
      for (const row of shuffle(r, rows)) v2.rows[row.id] = { ...row, _gen: 1 };
      assert.equal(reportOf(F, requireEntriesRows(v2)).text, base, "V2 node decode");
    }
  });

  test(`G-P2 [${label}] splitting a day's amounts across same-date rows preserves day totals`, () => {
    const one = [{ id: UUID(1), date: "2026-09-03", sales: "1000.55", supplier_payments: { s1: "300.25" }, payroll: "120" }];
    const split = [
      { id: UUID(2), date: "2026-09-03", sales: "1000", supplier_payments: { s1: "300" }, payroll: "100" },
      { id: UUID(3), date: "2026-09-03", sales: "0.55", supplier_payments: { s1: "0.25" }, payroll: "20" },
    ];
    const a = reportOf(F, one).report.actual, b = reportOf(F, split).report.actual;
    for (const k of ["revenue", "purchases", "directLabor"]) assert.equal(a[k].value, b[k].value, k);
    assert.deepEqual(a.operatingProfit, b.operatingProfit);
  });

  test(`G-P3 [${label}] canonical amount serialization round-trips exactly`, () => {
    const D = F.finance.decimal;
    const r = prng(7);
    for (let i = 0; i < 2000; i += 1) {
      const n = BigInt(Math.floor((r() - 0.5) * 1e15)) * (r() < 0.5 ? 1n : 12345678901234567n);
      const d = BigInt(1 + Math.floor(r() * 1000));
      const x = D.rat(n, d);
      const s = D.serializeRat(x);
      assert.ok(D.isCanonicalAmountString(s), s);
      const y = D.parseAmountString(s);
      assert.equal(y.n, x.n);
      assert.equal(y.d, x.d);
      assert.notEqual(s, "-0");
    }
    assert.equal(D.serializeRat(D.rat(-0n, 5n)), "0");
    assert.equal(D.serializeRat(D.rat(1n, 3n)), "1/3");
    assert.equal(D.serializeRat(D.rat(3n, 8n)), "0.375");
    assert.throws(() => D.parseAmountString("2/4"));
    assert.throws(() => D.parseAmountString("1.50"));
    assert.throws(() => D.parseAmountString("1e3"));
  });

  test(`G-P4 [${label}] accrual is additive over sub-windows`, () => {
    const T = F.metrics.costTimeline, D = F.finance.decimal, B = F.finance.businessDate;
    const tl = { vatBasis: "net_of_vat", timelineSource: "persisted", versions: [
      { versionId: "a", effectiveFrom: "2026-09-01", recordedAt: 1, basis: "recorded", salaried: [{ employeeKey: "e", kind: "authoritative_employer_cost", monthlyAmount: "31000", sourceSystem: "attendance_workforce", ingestionMethod: "manual" }], fixedItems: [{ itemKey: "f", monthlyAmount: "777.77" }], rent: { mode: "fixed", monthlyAmount: "9999" }, royalty: { mode: "none" } },
      { versionId: "b", effectiveFrom: "2026-09-13", recordedAt: 2, basis: "recorded", salaried: [{ employeeKey: "e", kind: "authoritative_employer_cost", monthlyAmount: "45123.5", sourceSystem: "attendance_workforce", ingestionMethod: "manual" }], fixedItems: [], rent: { mode: "none" }, royalty: { mode: "none" } },
    ] };
    const all = B.datesInRange("2026-09-01", "2026-09-30");
    const whole = T.accrueWindow(tl, all, new Map());
    const a = T.accrueWindow(tl, all.slice(0, 11), new Map());
    const b = T.accrueWindow(tl, all.slice(11), new Map());
    assert.equal(D.serializeRat(whole.total), D.serializeRat(D.ratAdd(a.total, b.total)));
  });

  test(`G-P5/G-50 [${label}] purchase amounts are identical under every accepted basis input`, () => {
    const r = prng(99);
    const policies = [
      F.policy.purchaseBasis.productPurchaseBasis(),
      { mode: "product_policy", policy: { policyId: "alt", segments: [{ from: "0000-01-01", kind: "net_of_vat", origin: "owner_decision", versionId: "a" }, { from: "2026-09-05", kind: "net_of_vat", origin: "attested_retroactive", versionId: "b" }] } },
    ];
    for (let t = 0; t < 50; t += 1) {
      const rows = randomRows(r, 10);
      const n = F.finance.normalize.normalizeRows(rows, { asOfBusinessDate: "2026-09-10" });
      const days = F.finance.normalize.groupByDate(n.rows, { from: "2026-09-01", to: "2026-09-10" });
      const tl = F.metrics.adapters.configCompat.costTimelineFromCurrentConfig({}, []);
      const outs = policies.map((p) => F.metrics.report.computePeriodReport(days, tl, p, LABOR(F), { kind: "open_month", month: "2026-09", asOfBusinessDate: "2026-09-10" }).actual.purchases);
      assert.equal(outs[0].value, outs[1].value);
      assert.deepEqual(outs[0].bySource, outs[1].bySource);
    }
  });

  test(`G-P6 [${label}] goal comparisons are exact at the boundary (no pre-rounding)`, () => {
    const mk = (purch) => {
      const rows = [{ id: UUID(1), date: "2026-09-01", sales: "100000", supplier_payments: { s1: purch } }];
      return reportOf(F, rows, "2026-09-01").report;
    };
    const policy = F.policy.registry.resolvePolicy({ targets: { foodCostPct: "33" } });
    const state = (p) => F.policy.evaluate.evaluatePolicy(mk(p), policy).comparisons[0].state;
    assert.equal(state("33000"), "at_or_below_goal");
    assert.equal(state("33000.000001"), "above_goal");
    assert.equal(state("32999.999999"), "at_or_below_goal");
    assert.equal(state("33049"), "above_goal", "33.049% is above 33 even though it would display as 33.0%");
  });

  test(`G-30 [${label}] Israel business date across midnight and DST transitions`, () => {
    const d = F.finance.businessDate.israelBusinessDate;
    assert.equal(d(Date.UTC(2026, 8, 17, 21, 30)), "2026-09-18");
    assert.equal(d(Date.UTC(2026, 8, 17, 20, 59, 59)), "2026-09-17");
    assert.equal(d(Date.UTC(2026, 2, 26, 22, 30)), "2026-03-27");
    assert.equal(d(Date.UTC(2026, 9, 24, 21, 30)), "2026-10-25");
    assert.equal(d(Date.UTC(2026, 9, 25, 21, 30)), "2026-10-25");
    assert.equal(d(Date.UTC(2026, 9, 25, 22, 30)), "2026-10-26");
    assert.equal(F.finance.businessDate.dowOf("2027-01-01"), 5);
    assert.equal(F.finance.businessDate.dowOf("2026-09-28"), 1);
    assert.throws(() => d(Number.NaN));
  });

  test(`G-31/G-07f [${label}] legacy _v with "0" strings and V2 rows with numeric 0 give identical outputs`, () => {
    const legacyRows = [
      { id: UUID(1), date: "2026-09-01", sales: "0", payroll: "0", supplier_payments: { s1: "0" } },
      { id: UUID(2), date: "2026-09-02", sales: "1500.5", supplier_payments: { s1: "300" } },
    ];
    const v2Rows = { schemaVersion: 2, generation: 3, rows: {
      [UUID(2)]: { id: UUID(2), date: "2026-09-02", sales: 1500.5, supplier_payments: { s1: 300 }, _gen: 3 },
      [UUID(1)]: { id: UUID(1), date: "2026-09-01", sales: 0, payroll: 0, supplier_payments: { s1: 0 }, _gen: 3 },
    } };
    const a = reportOf(F, requireEntriesRows({ _v: JSON.stringify(legacyRows) }), "2026-09-02");
    const b = reportOf(F, requireEntriesRows(v2Rows), "2026-09-02");
    assert.equal(a.text, b.text);
    assert.equal(a.report.coverage.revenue.presentDays, 2);
  });

  test(`G-33 [${label}] goals resolve from config.targets.*; compatibility defaults are never owner-approved`, () => {
    const R = F.policy.registry;
    const p = R.resolvePolicy({ targets: { foodCostPct: "30" }, foodCostPct: 99 });
    assert.deepEqual({ ...p.values["goal.foodCostPct"], origin: undefined }, { value: "30", source: "business_config", ownerApproved: false, origin: undefined });
    assert.equal(p.values["goal.laborCostPct"].source, "compatibility_product_default");
    for (const v of Object.values(R.COMPATIBILITY_PRODUCT_DEFAULTS)) assert.equal(v.ownerApproved, false);
    assert.equal(R.resolvePolicy({ foodCostPct: 12 }).values["goal.foodCostPct"].value, "33", "top-level keys are not the wizard's storage");
  });

  test(`G-35 [${label}] forecast input adapter feeds the REV_FORECAST engine from canonical days`, () => {
    const rows = [];
    for (let d = 1; d <= 28; d += 1) rows.push({ id: UUID(d), date: `2026-08-${String(d).padStart(2, "0")}`, sales: d === 10 ? "0" : "1000" });
    const n = F.finance.normalize.normalizeRows(rows, { asOfBusinessDate: "2026-08-29" });
    const days = F.finance.normalize.groupByDate(n.rows, { from: "2026-08-01", to: "2026-08-29" });
    const fdays = days.map(F.metrics.adapters.legacyNumber.toForecastDay).filter(Boolean);
    assert.equal(fdays.length, 28);
    assert.deepEqual(fdays.find((x) => x.date === "2026-08-10"), { date: "2026-08-10", total: 0, had_entry: true, has_sales: false, is_exception: false });
    assert.equal(fdays.find((x) => x.date === "2026-08-29"), undefined, "missing day omitted, never zero");
    assert.equal(F.forecast.REV_FORECAST_FORMULA_ID, "REV_FORECAST/v1");
  });

  test(`G-36 [${label}] 31 days x 5 rows x 20 suppliers stays within budget`, () => {
    const rows = [];
    let k = 0;
    for (let d = 1; d <= 31; d += 1) for (let j = 0; j < 5; j += 1) {
      const sup = {};
      for (let s = 0; s < 20; s += 1) sup["s" + s] = String(100 + s) + ".25";
      rows.push({ id: UUID(++k), date: `2026-10-${String(d).padStart(2, "0")}`, sales: "1234.56", supplier_payments: sup, payroll: "300" });
    }
    const t0 = performance.now();
    const n = F.finance.normalize.normalizeRows(rows, { asOfBusinessDate: "2026-11-01" });
    const days = F.finance.normalize.groupByDate(n.rows, { from: "2026-10-01", to: "2026-10-31" });
    const r = F.metrics.report.computePeriodReport(days, F.metrics.adapters.configCompat.costTimelineFromCurrentConfig({}, []), F.policy.purchaseBasis.productPurchaseBasis(), LABOR(F), { kind: "closed_month", month: "2026-10", asOfBusinessDate: "2026-11-01" });
    const ms = performance.now() - t0;
    assert.equal(r.actual.revenue.value, "191356.8");
    assert.ok(ms < 500, `took ${ms}ms (budget 500ms; plan target 50ms, measured ~7-14ms)`);
  });

  test(`G-48/TI-16 [${label}] purchase basis is a required argument and non-net kinds are refused`, () => {
    const days = F.finance.normalize.groupByDate([], { from: "2026-09-01", to: "2026-09-01" });
    const tl = F.metrics.adapters.configCompat.costTimelineFromCurrentConfig({}, []);
    const w = { kind: "open_month", month: "2026-09", asOfBusinessDate: "2026-09-01" };
    const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
    assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, w)), "labor_source_required");
    assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, undefined, LABOR(F), w)), "purchase_basis_required");
    assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, null, LABOR(F), w)), "purchase_basis_required");
    assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, { mode: "compatibility" }, LABOR(F), w)), "purchase_basis_mode_unsupported");
    for (const kind of ["as_entered_unknown", "declared_gross", "unknown_legacy", "unresolved"]) {
      assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, { mode: "product_policy", policy: { policyId: "x", segments: [{ from: "0000-01-01", kind, origin: "owner_decision", versionId: "v" }] } }, LABOR(F), w)), "purchase_basis_not_supported", kind);
    }
  });

  test(`BD-3 [${label}] projection is a separate object and never changes Actual`, () => {
    const rows = [{ id: UUID(1), date: "2026-09-01", sales: "1000", supplier_payments: { s1: "300" }, payroll: "200" }];
    const { report, text } = reportOf(F, rows, "2026-09-01");
    const tl = F.metrics.adapters.configCompat.costTimelineFromCurrentConfig({ employees: [{ id: "e", type: "global", monthlySalary: "30000" }] }, []);
    const p = F.metrics.projected.applyProjection(report, { formulaId: "REV_FORECAST/v1", month: "2026-09", projectedRevenue: 30000 }, tl);
    assert.equal(p.kind, "projected");
    assert.equal(p.revenue, "30000");
    assert.equal(p.purchases, "9000");
    assert.equal(p.directLabor, "6000");
    assert.equal(p.salaried, null, "gross salary is never projected as labor (scope all_staff)");
    assert.equal(p.operatingProfit, "15000");
    assert.equal(F.metrics.report.serializeReport(report), text, "Actual untouched");
    assert.equal(report.actual.revenue.value, "1000");
    assert.ok(!("projected" in report) && !("forecast" in report.actual));
    assert.throws(() => F.metrics.projected.applyProjection(report, { formulaId: "x", month: "2026-10", projectedRevenue: 1 }, tl));
  });

  test(`self-review [${label}] projection subtracts other expense and reuses the report formulas`, () => {
    const rows = [{ id: UUID(1), date: "2026-09-01", sales: "1000", supplier_payments: { s1: "300" }, payroll: "200", other_expense: "400" }];
    const n = F.finance.normalize.normalizeRows(rows, { asOfBusinessDate: "2026-09-01" });
    const days = F.finance.normalize.groupByDate(n.rows, { from: "2026-09-01", to: "2026-09-01" });
    const tl = F.metrics.adapters.configCompat.costTimelineFromCurrentConfig({}, []);
    const report = F.metrics.report.computePeriodReport(days, tl, F.policy.purchaseBasis.productPurchaseBasis(), LABOR(F), { kind: "open_month", month: "2026-09", asOfBusinessDate: "2026-09-01" });
    assert.deepEqual(report.actual.operatingProfit, { state: "complete", value: "100", issues: [] });
    const p = F.metrics.projected.applyProjection(report, { formulaId: "REV_FORECAST/v1", month: "2026-09", projectedRevenue: "30000" }, tl);
    assert.equal(p.otherExpense, "12000");
    assert.equal(p.operatingProfit, "3000");
  });

  test(`TI-18 [${label}] an incomplete Actual projects no cost and no profit`, () => {
    const rows = [{ id: UUID(1), date: "2026-09-01", sales: "1000", payroll: "200" }]; // purchases not recorded
    const n = F.finance.normalize.normalizeRows(rows, { asOfBusinessDate: "2026-09-01" });
    const days = F.finance.normalize.groupByDate(n.rows, { from: "2026-09-01", to: "2026-09-01" });
    const tl = F.metrics.adapters.configCompat.costTimelineFromCurrentConfig({}, []);
    const report = F.metrics.report.computePeriodReport(days, tl, F.policy.purchaseBasis.productPurchaseBasis(), LABOR(F), { kind: "open_month", month: "2026-09", asOfBusinessDate: "2026-09-01" });
    assert.equal(report.actual.operatingProfit.state, "incomplete_components");
    assert.equal(report.actual.operatingProfit.value, null);
    const p = F.metrics.projected.applyProjection(report, { formulaId: "REV_FORECAST/v1", month: "2026-09", projectedRevenue: "30000" }, tl);
    assert.equal(p.operatingProfit, null);
    assert.equal(p.purchases, null);
    assert.equal(p.directLabor, null);
    assert.ok(p.warnings.includes("actual_components_incomplete"));
    assert.equal(F.presenters.money.formatTypedAmount(report.actual.operatingProfit), "—");
    assert.equal(F.presenters.money.formatTypedAmount({ state: "complete", value: "-100.5" }), "₪-101");
    const ev = F.policy.evaluate.evaluatePolicy(report, F.policy.registry.resolvePolicy({}));
    assert.equal(ev.comparisons.find((c) => c.metric === "laborEmployerCostPct").state, "at_or_below_goal", "labor complete: 200/1000 = 20% vs compat 27");
  });

  test(`self-review [${label}] duplicate day objects are a contract error; missing-labor goal is not evaluable`, () => {
    const n = F.finance.normalize.normalizeRows([{ id: UUID(1), date: "2026-09-01", sales: "1000", food_cost: "300" }], { asOfBusinessDate: "2026-09-01" });
    const days = F.finance.normalize.groupByDate(n.rows, { from: "2026-09-01", to: "2026-09-01" });
    const tl = F.metrics.adapters.configCompat.costTimelineFromCurrentConfig({}, []);
    const pb = F.policy.purchaseBasis.productPurchaseBasis();
    const w = { kind: "open_month", month: "2026-09", asOfBusinessDate: "2026-09-01" };
    assert.throws(() => F.metrics.report.computePeriodReport([...days, ...days], tl, pb, LABOR(F), w), (e) => e.code === "duplicate_day");
    const ev = F.policy.evaluate.evaluatePolicy(F.metrics.report.computePeriodReport(days, tl, pb, LABOR(F), w), F.policy.registry.resolvePolicy({}));
    assert.equal(ev.comparisons.find((c) => c.metric === "laborEmployerCostPct").state, "not_evaluable");
  });

  test(`TI-18 [${label}] goals are not evaluated on incomplete components`, () => {
    const rows = [
      { id: UUID(1), date: "2026-09-01", sales: "1000", supplier_payments: { s1: "300" }, payroll: "200" },
      { id: UUID(2), date: "2026-09-02", sales: "1000", payroll: "200" }, // purchases missing on 09-02
    ];
    const n = F.finance.normalize.normalizeRows(rows, { asOfBusinessDate: "2026-09-02" });
    const days = F.finance.normalize.groupByDate(n.rows, { from: "2026-09-01", to: "2026-09-02" });
    const tl = F.metrics.adapters.configCompat.costTimelineFromCurrentConfig({}, []);
    const r = F.metrics.report.computePeriodReport(days, tl, F.policy.purchaseBasis.productPurchaseBasis(), LABOR(F), { kind: "open_month", month: "2026-09", asOfBusinessDate: "2026-09-02" });
    const ev = F.policy.evaluate.evaluatePolicy(r, F.policy.registry.resolvePolicy({}));
    assert.equal(ev.comparisons.find((c) => c.metric === "purchasesPct").state, "not_evaluable", "purchases incomplete ⇒ no goal verdict");
    assert.equal(ev.comparisons.find((c) => c.metric === "laborEmployerCostPct").state, "at_or_below_goal", "labor and revenue complete ⇒ evaluated (20% vs 27)");
  });

  test(`labor contract [${label}] entered attendance employer cost is the labor truth; provenance kept; source may change without changing meaning`, () => {
    const rows = [{ id: UUID(1), date: "2026-09-01", sales: "1000", supplier_payments: { s1: "0" }, payroll: "123.45", hourly_payroll: { w1: "10" } }];
    const n = F.finance.normalize.normalizeRows(rows, { asOfBusinessDate: "2026-09-01" });
    const days = F.finance.normalize.groupByDate(n.rows, { from: "2026-09-01", to: "2026-09-01" });
    const tl = F.metrics.adapters.configCompat.costTimelineFromCurrentConfig({ employees: [{ id: "g", type: "global", monthlySalary: "30000" }] }, []);
    const pb = F.policy.purchaseBasis.productPurchaseBasis();
    const w = { kind: "open_month", month: "2026-09", asOfBusinessDate: "2026-09-01" };
    const manual = F.metrics.report.computePeriodReport(days, tl, pb, LABOR(F), w);
    assert.deepEqual(
      { meaning: manual.actual.labor.source.meaning, sourceSystem: manual.actual.labor.source.sourceSystem, ingestionMethod: manual.actual.labor.source.ingestionMethod, scope: manual.actual.labor.source.scope },
      { meaning: "authoritative_employer_cost", sourceSystem: "attendance_workforce", ingestionMethod: "manual", scope: "all_staff" });
    assert.deepEqual(manual.actual.labor.employerCost, { state: "complete", value: "133.45", issues: [] }, "no gross salary added, no uplift");
    assert.equal(manual.actual.labor.salariedEmployerCost, null);
    assert.equal(manual.actual.labor.grossSalaryDatumPresent, true);
    assert.ok(manual.flags.some((f) => f.code === "gross_salary_not_labor_cost" && f.key === "g"));
    assert.deepEqual(manual.actual.operatingProfit, { state: "complete", value: "866.55", issues: [] });
    const future = { ...LABOR(F), policyId: "LABOR_SRC/marjin-workforce", sourceSystem: "marjin_workforce", ingestionMethod: "integration" };
    const integrated = F.metrics.report.computePeriodReport(days, tl, pb, future, w);
    assert.equal(integrated.actual.labor.employerCost.value, manual.actual.labor.employerCost.value, "same meaning whatever the transport");
    assert.equal(integrated.actual.operatingProfit.value, manual.actual.operatingProfit.value);
    const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
    assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, pb, { ...LABOR(F), meaning: "gross_salary" }, w)), "labor_source_not_employer_cost");
    assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, pb, { ...LABOR(F), meaning: "net_salary" }, w)), "labor_source_not_employer_cost");
    assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, pb, { ...LABOR(F), ingestionMethod: "estimate" }, w)), "labor_source_malformed");
    assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, pb, null, w)), "labor_source_required");
    assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, pb, { ...LABOR(F), fields: ["monthlySalary"] }, w)), "labor_source_malformed", "gross salary field cannot be declared as labor");
    assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, pb, { ...LABOR(F), fields: [] }, w)), "labor_source_malformed");
    const dm = F.metrics.adapters.legacyNumber.toDailyMetric(days[0], F.finance.purchaseBasis.resolvePurchaseBasis([], pb), LABOR(F));
    assert.deepEqual([dm.laborCost, dm.laborMeaning, dm.laborSourceSystem, dm.laborIngestionMethod], [133.45, "authoritative_employer_cost", "attendance_workforce", "manual"]);
  });

  test(`window contract [${label}] closed/open month misuse is a contract error`, () => {
    const days = F.finance.normalize.groupByDate([], { from: "2026-09-01", to: "2026-09-30" });
    const tl = F.metrics.adapters.configCompat.costTimelineFromCurrentConfig({}, []);
    const pb = F.policy.purchaseBasis.productPurchaseBasis();
    const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
    assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, pb, LABOR(F), { kind: "closed_month", month: "2026-09", asOfBusinessDate: "2026-09-15" })), "closed_month_not_closed");
    assert.equal(code(() => F.metrics.report.computePeriodReport(days, tl, pb, LABOR(F), { kind: "open_month", month: "2026-08", asOfBusinessDate: "2026-09-15" })), "open_month_already_closed");
    assert.equal(code(() => F.metrics.report.computePeriodReport(days.slice(0, 3), tl, pb, LABOR(F), { kind: "open_month", month: "2026-09", asOfBusinessDate: "2026-09-15" })), "window_days_incomplete");
  });

  test(`decimal [${label}] exact arithmetic and half-away-from-zero rounding`, () => {
    const D = F.finance.decimal;
    const s = (x) => D.decToString(x);
    assert.equal(s(D.decAdd(D.decFromPlainString("0.1"), D.decFromPlainString("0.2"))), "0.3");
    assert.equal(s(D.decFromNumber(1e21)), "1000000000000000000000");
    assert.equal(s(D.decFromNumber(1.5e-7)), "0.00000015");
    assert.equal(s(D.decFromNumber(-0)), "0");
    const r = (n, d, k) => s(D.roundHalfAwayFromZero(D.rat(n, d), k));
    assert.equal(r(5n, 2n, 0), "3");
    assert.equal(r(-5n, 2n, 0), "-3");
    assert.equal(r(-2n, 5n, 0), "0");
    assert.equal(r(1n, 20n, 1), "0.1");
    assert.equal(r(-1n, 20n, 1), "-0.1");
  });
}
