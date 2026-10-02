// WP-FZ — live producers of the frozen Agent/Daily entry artifacts (09_AGENT_DAILY_HANDOFF.md §1).
// Each producer runs the ACCEPTED code (compiled server sandbox: the real loader over an in-memory
// RTDB, the real builders) over representative fixture states and returns
//   { ids: <frozen contract identifiers, literal>, shapes: <keys and types, never values> }.
// test/finance/fz-shapes.test.mjs compares them with test/finance/goldens/fz-<id>.json.
// Synthetic data only; external fetches are offline; the clock is injected.
import { srv, SB, SE, CI, CM, seed, closure } from "./b2-email-harness.mjs";
import { T, B, entry, uid, env, configWithGlobal, fixedItems, nowMsFor } from "./b1-fixtures.mjs";
import { INV_NOW_MS, SEP_COMPLETED, fullDay, GLOBAL_3000, FIXED_3100, monthDates } from "./financial-invariants.mjs";
import { shapeOf } from "./fz-shape.mjs";

const DB = await srv.import("src/analytics/dailyBuilder.js");
const REG = await srv.import("src/policy/registry.js");
const EVAL = await srv.import("src/policy/evaluate.js");
const MONEY = await srv.import("src/presenters/money.js");
const PCT = await srv.import("src/presenters/percent.js");
const LABELS = await srv.import("src/presenters/labels.js");
const TYPES = await srv.import("src/finance/types.js");
const READER = await srv.import("lib/analytics/entriesReader.js");
const PF = await srv.import("src/policy/productFinance.js");

const plain = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === "bigint" ? x.toString() : x)));
let n = 0;
const id = () => uid(900000 + ++n);
const AUG = monthDates("2026-08", 31);

// ── representative states (doc 09 §2; user brief: incomplete, zero, closed, contradictory) ─────
// Every scenario is a seeded RTDB (entries, config, fixed, structured ledger) + an injected clock.
export const SCENARIOS = Object.freeze([
  { name: "complete", rows: () => [...AUG.map((d) => fullDay(d)), ...SEP_COMPLETED.map((d) => fullDay(d))] },
  { name: "explicit_zero", rows: () => SEP_COMPLETED.map((d) => fullDay(d, { sales: "0", deliveries: "0", other_income: "0", supplier_payments: { s1: "0" }, payroll: "0", other_expense: "0" })), config: configWithGlobal("0"), fixed: fixedItems("0") },
  {
    name: "incomplete",
    rows: () => [
      ...SEP_COMPLETED.slice(0, 10).map((d) => fullDay(d)),
      entry(id(), "2026-09-11", { sales: "900", supplier_payments: { s1: "200" } }),                  // payroll missing
      entry(id(), "2026-09-12", { sales: "abc", deliveries: "50", payroll: "90" }),                    // invalid revenue part
      entry(id(), "2026-09-13", { supplier_payments: { s1: "120" } }),                                 // purchases only
      entry(id(), "2026-09-14", { sales: "800", payroll: "80", hourly_payroll: { e1: "70" } }),        // legacy hourly map (never counted)
      entry(id(), "2026-09-29", { sales: "999" }),                                                     // the current day (never Actual)
      entry(id(), "2026-09-30", { sales: "999" }),                                                     // a future day (quarantined)
    ],
  },
  {
    name: "closed",
    rows: () => SEP_COMPLETED.filter((d) => d !== "2026-09-06" && d !== "2026-09-13").map((d) => fullDay(d)),
    // one envelope carries the full structured metadata the daily doc copies (reason / note / set_at / set_by)
    exceptions: { "2026-09-06": { state: { status: "active", reasonCode: "closure", reasonText: "שיפוץ", revision: 2, updatedAt: 1758000000000, updatedBy: "owner-uid" } }, "2026-09-13": closure(), "2026-09-30": closure() },
  },
  {
    name: "contradictory",
    rows: () => [
      ...SEP_COMPLETED.filter((d) => !["2026-09-06", "2026-09-07", "2026-09-08"].includes(d)).map((d) => fullDay(d)),
      fullDay("2026-09-06"),                                                                           // revenue on a declared closure (CDA-02)
      entry(id(), "2026-09-07", { sales: "1000", supplier_payments: { s1: "300" }, food_cost: "250", payroll: "100" }), // supplier + legacy food
      entry(id(), "2026-09-08", { sales: "500", payroll: "50", is_exception: true }),                  // two rows that disagree on the exception
      entry(id(), "2026-09-08", { sales: "500", payroll: "50", is_exception: false }),
    ],
    exceptions: { "2026-09-06": closure() },
    config: { ...configWithGlobal("3000"), targets: { foodCostPct: "20", laborCostPct: "25" }, targetSales: "40000" },
  },
  { name: "unreadable_inputs", rows: () => SEP_COMPLETED.map((d) => fullDay(d)), raw: { config: { _v: "{bad" }, fixed: { _v: "[bad" } }, exceptions: "not-a-ledger" },
  { name: "goals_set", rows: () => SEP_COMPLETED.map((d) => fullDay(d)), config: { ...configWithGlobal("3000"), targets: { foodCostPct: "20", laborCostPct: "10", salesGrowthPct: "7" } } },
  { name: "first_of_month", rows: () => AUG.map((d) => fullDay(d)), nowMs: nowMsFor("2026-09-01") },
]);

async function scenario(s) {
  seed({ rows: s.rows(), config: s.config, fixed: s.fixed, raw: s.raw || {}, exceptions: s.exceptions });
  const nowMs = s.nowMs || INV_NOW_MS;
  const inputs = await CI.loadCanonicalInputs(globalThis.__DB, T, B, { site: "fz", nowMs, need: { config: true, fixed: true, exceptions: true } });
  return { s, nowMs, inputs };
}
const SEPT = { from: "2026-09-01", to: "2026-09-30" };
const cache = new Map();
async function all() {
  if (cache.has("all")) return cache.get("all");
  const out = [];
  for (const s of SCENARIOS) {
    const x = await scenario(s);
    const { inputs, nowMs } = x;
    const asOf = inputs.asOfBusinessDate;
    const series = CM.canonicalDailySeries(inputs, { from: "2026-08-01", to: asOf });
    const dayRecords = monthDates("2026-09", 30).map((d) => CM.canonicalDayRecord(inputs, d));
    const encoded = dayRecords.map((r) => CM.toAnalyticsFinancials(r));
    const docs = [];
    for (const d of ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-20", asOf, "2026-09-30"]) docs.push(await DB.buildAnalyticsForBiz(T, B, d, { nowMs }));
    const open = CM.canonicalMonthReport(inputs, { kind: "open_month", month: asOf.slice(0, 7) });
    const closed = CM.canonicalMonthReport(inputs, { kind: "closed_month", month: "2026-08" });
    const projections = [CM.canonicalMonthProjection(inputs, open.report, { nowMs })];
    if (closed.report.window.state === "actual") projections.push(CM.canonicalMonthProjection(inputs, closed.report, { nowMs }));
    const snapshot = await SB.buildSnapshotForBiz(T, B, { nowMs });
    const configRaw = inputs.config.state === "present" ? inputs.config.value : null;
    const policy = REG.resolvePolicy(configRaw);
    const evaluations = [EVAL.evaluatePolicy(open.report, policy), EVAL.evaluatePolicy(closed.report, policy)];
    out.push({ name: s.name, inputs, series, dayRecords, encoded, docs, reports: [open, closed], projections, snapshot, policy, evaluations });
  }
  cache.set("all", out);
  return out;
}

// ── FZ producers ────────────────────────────────────────────────────────────────────────────────
const uniq = (xs) => [...new Set(xs)].sort();

/** FZ-01 CanonicalDailyMetric (B1): present completed days only, + partial + fin. */
async function fz01() {
  const A = await all();
  const days = A.flatMap((a) => a.series.days).map(plain);
  return {
    ids: { artifact: "CanonicalDailyMetric", producer: "canonicalDailySeries(inputs, range).days" },
    shapes: { day: shapeOf(days), series: shapeOf(A.map((a) => plain({ ...a.series, days: [], provenance: {} }))) },
  };
}

/** FZ-02 ServerProvenance (B1): the provenance every server output carries. */
async function fz02() {
  const A = await all();
  const p = A.map((a) => plain(a.series.provenance));
  const p0 = p[0];
  return {
    ids: {
      api: p0.api, product: p0.product, fin: p0.fin, norm: p0.norm, dec: p0.dec, labor: p0.labor, pb: p0.pb, pbPolicy: p0.pbPolicy, laborSource: p0.laborSource, windowRule: p0.windowRule,
      observed: { timelineSource: uniq(p.map((x) => x.timelineSource)), configurationBasis: uniq(p.flatMap((x) => x.configurationBasis)), configState: uniq(p.map((x) => x.configState)), fixedState: uniq(p.map((x) => x.fixedState)), exceptionsState: uniq(p.map((x) => x.exceptionsState)), operatingCalendar: uniq(p.map((x) => x.operatingCalendar)) },
    },
    shapes: { provenance: shapeOf(p) },
  };
}

/** FZ-03 analytics doc encoding + fin block (B1 doc 05 §6): the persisted daily doc. */
async function fz03() {
  const A = await all();
  const docs = A.flatMap((a) => a.docs).map(plain);
  const enc = A.flatMap((a) => a.encoded).map(plain);
  return {
    ids: { docKeys: uniq(docs.flatMap((d) => Object.keys(d))), docVersion: uniq(docs.map((d) => d.meta.version)), finV: uniq(enc.map((e) => e.fin.v)), outsideActualReason: uniq(enc.map((e) => e.fin.outsideActualReason).filter(Boolean)), revenueStates: uniq(enc.map((e) => e.fin.revenue && e.fin.revenue.state).filter(Boolean)) },
    shapes: {
      revenue: shapeOf(docs.map((d) => d.revenue)),
      fin: shapeOf(docs.map((d) => d.fin)),
      exceptionFields: shapeOf(docs.map((d) => ({ is_exception: d.is_exception, exception: d.exception }))),
      encoderOutput: shapeOf(enc),
    },
  };
}

/** FZ-04 FinancialReport MARJIN_FIN/2 via canonicalMonthReport (open and closed month). */
async function fz04() {
  const A = await all();
  const rs = A.flatMap((a) => a.reports).map(plain);
  return {
    ids: { fin: uniq(rs.map((r) => r.report.versions.fin)), windowStates: uniq(rs.map((r) => r.report.window.state)) },
    shapes: { result: shapeOf(rs.map((r) => ({ ...r, report: {} }))), report: shapeOf(rs.map((r) => r.report)) },
  };
}

/** FZ-05 canonicalMonthProjection result (B2). */
async function fz05() {
  const A = await all();
  const ps = A.flatMap((a) => a.projections).map(plain);
  return {
    ids: { forecastFormulaId: uniq(ps.map((p) => p.forecast.formulaId)), projectionFormulaIds: uniq(ps.filter((p) => p.projection).map((p) => JSON.stringify(p.projection.formulaIds))).map((x) => JSON.parse(x)), forecastStates: uniq(ps.map((p) => p.forecast.state)) },
    shapes: { result: shapeOf(ps) },
  };
}

/** FZ-06 SnapshotData v2 (typed). */
async function fz06() {
  const A = await all();
  const ss = A.map((a) => plain(a.snapshot));
  return {
    ids: { version: uniq(ss.map((s) => s.financials.version)), presentation: uniq(ss.map((s) => s.presentation)) },
    shapes: { snapshot: shapeOf(ss) },
  };
}

/** FZ-07 kpiShares (B2): shares via ratioOfTotals only. */
async function fz07() {
  const A = await all();
  const shares = A.map((a) => plain(SE.kpiShares(a.snapshot.financials.amounts)));
  return {
    ids: { keys: Object.keys(shares[0]).sort(), unavailableReasons: uniq(shares.flatMap((s) => Object.values(s).filter((r) => r.state !== "value").map((r) => r.reason))) },
    shapes: { shares: shapeOf(shares) },
  };
}

/** FZ-08 policy evaluation use: resolvePolicy(config) precedence config.targets.* > compat; evaluatePolicy states. */
async function fz08() {
  const A = await all();
  const pol = A.map((a) => plain(a.policy));
  const ev = A.flatMap((a) => a.evaluations).map(plain);
  return {
    ids: { policyVersion: REG.POLICY_VERSION, keys: Object.keys(REG.COMPATIBILITY_PRODUCT_DEFAULTS).sort(), sources: uniq(pol.flatMap((p) => Object.values(p.values).map((v) => v.source))), comparisonStates: uniq(ev.flatMap((e) => e.comparisons.map((c) => c.state))), metrics: uniq(ev.flatMap((e) => e.comparisons.map((c) => c.metric))) },
    shapes: { resolved: shapeOf(pol), evaluation: shapeOf(ev) },
  };
}

/** FZ-14 presenters (Slice A): formatShekel, formatPercent, formatTypedAmount, NOT_AVAILABLE. */
async function fz14() {
  const inputs = { shekel: [null, "0", "1234.5", "-10"], percent: [null, "0", "33.3333", { state: "value", value: "12.5" }, { state: "no_denominator" }], typed: [{ state: "complete", value: "10" }, { state: "partial", value: "10" }, { state: "unavailable", value: null }] };
  return {
    ids: { NOT_AVAILABLE: MONEY.NOT_AVAILABLE, money: Object.keys(MONEY).sort(), percent: Object.keys(PCT).sort(), labels: Object.keys(LABELS).sort(), labelKeys: Object.keys(LABELS.LABELS).sort() },
    shapes: {
      formatShekel: shapeOf(inputs.shekel.map((x) => MONEY.formatShekel(x))),
      formatPercent: shapeOf(inputs.percent.map((x) => PCT.formatPercent(x))),
      formatTypedAmount: shapeOf(inputs.typed.map((x) => MONEY.formatTypedAmount(x))),
    },
  };
}

/** FZ-15 error taxonomy (B1): EntriesStorageError, FinanceContractError(code), isCanonicalFinanceError, input issues. */
function errorView(e) {
  const props = Object.fromEntries(Object.getOwnPropertyNames(e).filter((k) => k !== "stack").map((k) => [k, e[k]]));
  return { class: e.constructor.name, name: e.name, isError: e instanceof Error, isCanonicalFinanceError: CM.isCanonicalFinanceError(e), isEntriesReadError: READER.isEntriesReadError(e), props };
}
async function caught(fn) { try { await fn(); } catch (e) { return e; } throw new Error("expected a throw"); }
async function fz15() {
  const base = (await scenario(SCENARIOS[0])).inputs;
  const fce = [
    await caught(() => CM.canonicalDailySeries({ ...base, rows: [entry(uid(1), "2026-09-01", { sales: "1" }), entry(uid(1), "2026-09-02", { sales: "1" })] }, SEPT)),
    await caught(() => CM.canonicalMonthReport({ ...base, exceptionsState: "not_loaded" }, { kind: "open_month", month: "2026-09" })),
  ];
  seed({ rows: [], raw: { entries: { _v: "{bad" } } });
  const ese = [await caught(() => CI.loadCanonicalInputs(globalThis.__DB, T, B, { site: "fz", nowMs: INV_NOW_MS, need: { config: false, fixed: false, exceptions: false } }))];
  const A = await all();
  const views = [...fce, ...ese].map(errorView).map(plain);
  return {
    ids: {
      classes: uniq(views.map((v) => v.class)),
      financeContractErrorCodes: uniq(fce.map((e) => e.code)),
      entriesStorageStatus: uniq(ese.map((e) => e.status)),
      inputIssues: uniq(A.flatMap((a) => a.inputs.inputIssues)),
      classification: views.map((v) => [v.class, v.isCanonicalFinanceError, v.isEntriesReadError]).sort(),
      nonErrorIsCanonical: CM.isCanonicalFinanceError(new Error("x")) || CM.isCanonicalFinanceError(null) || CM.isCanonicalFinanceError({ name: "Other" }),
      typesExport: typeof TYPES.FinanceContractError,
    },
    shapes: {
      financeContractError: shapeOf(views.filter((v) => v.class === "FinanceContractError")),
      entriesStorageError: shapeOf(views.filter((v) => v.class === "EntriesStorageError")),
      unreadableEnvelopes: shapeOf(A.map((a) => plain({ config: a.inputs.config, fixed: a.inputs.fixed, configState: a.inputs.configState, fixedState: a.inputs.fixedState, exceptionsState: a.inputs.exceptionsState, inputIssues: a.inputs.inputIssues }))),
    },
  };
}

export const PRODUCERS = Object.freeze({ "FZ-01": fz01, "FZ-02": fz02, "FZ-03": fz03, "FZ-04": fz04, "FZ-05": fz05, "FZ-06": fz06, "FZ-07": fz07, "FZ-08": fz08, "FZ-14": fz14, "FZ-15": fz15 });
export const OWNERS = Object.freeze({ "FZ-01": "B1", "FZ-02": "B1", "FZ-03": "B1", "FZ-04": "Slice A / B1", "FZ-05": "B2", "FZ-06": "B2", "FZ-07": "B2", "FZ-08": "B2/C1 (read)", "FZ-14": "Slice A", "FZ-15": "B1" });
/** Raw scenario outputs, for the semantic assertions of the test (not frozen as values). */
export const scenarios = all;
export { PF, MONEY, PCT };
