// WP-C1 — browser financial surfaces: the window.MarjinC1 view models of index.html, evaluated
// in a node vm over the generated fincore/v1 bundle (the two artefacts the page loads).
//  • parity: the browser report/projection equal the SERVER canonical report/projection for the
//    same raw RTDB nodes (compiled server modules, test/support/b2-email-harness.mjs);
//  • closed / missing / operating-zero days, contradictions, partial and invalid states;
//  • closure-history loading (bounded chunks, structured-only, all-or-nothing);
//  • settings envelopes (absent / present / unreadable, never defaults);
//  • module readiness (version check) and the guarded "unavailable" state;
//  • VD-50 isolated; D-15 today context outside Actual; labor placement; supplier sources.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { loadFinance, loadSeam, seamSource } from "../support/c1-seam.mjs";
import { seed, coreOf, closure } from "../support/b2-email-harness.mjs";
import { INV_AS_OF, INV_NOW_MS, SEP_COMPLETED, fullDay, GLOBAL_3000, FIXED_3100 } from "../support/financial-invariants.mjs";
import { env } from "../support/b1-fixtures.mjs";
import { buildEffectiveRecord } from "../../lib/entryExceptions.js";

const F = await loadFinance();
const C = loadSeam();
const HTML = readFileSync(join(REPO, "index.html"), "utf8");

// ── builders: the browser inputs from the SAME raw nodes the server reads ──
/** The list-entry-exceptions effective records for structured envelopes (the repository's own builder). */
const apiRecords = (envelopes) => Object.fromEntries(Object.entries(envelopes || {}).map(([d, e]) => [d, buildEffectiveRecord(d, e, null)]));
function browserSrc({ rows, config = GLOBAL_3000, fixed = FIXED_3100, exceptions = {}, raw = {}, asOf = INV_AS_OF, ledgerState } = {}) {
  const cfgRaw = raw.config !== undefined ? raw.config : env(config);
  const fixRaw = raw.fixed !== undefined ? raw.fixed : fixed === null ? null : env(fixed);
  const states = C.structuredStates(apiRecords(exceptions));
  return {
    rows, asOf, rowsReady: true,
    config: cfgRaw === null ? { state: "absent" } : C.nodeState(F, cfgRaw, "object"),
    fixed: fixRaw === null ? { state: "absent" } : C.nodeState(F, fixRaw, "array"),
    ledger: ledgerState || { state: Object.keys(states).length ? "present" : "absent", states, from: "2000-01-01", to: "2100-12-31" },
  };
}
const strip = (x) => JSON.parse(JSON.stringify(x));
const month = INV_AS_OF.slice(0, 7);

// ═══ parity with the server canonical path ═══════════════════════════════════════════════
test("C1-P01 parity: the browser month report and projection equal the server canonical report and projection (complete month, closure, missing day, duplicate row, today row)", async () => {
  const rows = SEP_COMPLETED.filter((d) => d !== "2026-09-04" && d !== "2026-09-07").map((d) => fullDay(d));
  rows.push(fullDay("2026-09-09", { sales: "250", payroll: "15", supplier_payments: {} }));           // duplicate date: folded
  rows.push(fullDay(INV_AS_OF, { sales: "777" }));                                                    // the current day: context only
  const exceptions = { "2026-09-07": closure() };
  seed({ rows, exceptions });
  const server = await coreOf(INV_NOW_MS);
  const src = browserSrc({ rows, exceptions });
  const dv = C.dashboard(F, src, { nowMs: INV_NOW_MS, lastYearSales: null });
  assert.equal(dv.status, "ready", JSON.stringify(dv).slice(0, 300));
  assert.deepEqual(strip(dv.report), strip(server.report), "report: browser == server");
  const { provenance, ...serverProjection } = strip(server.projection);
  assert.equal(provenance.product, "MARJIN_PRODUCT/2");
  assert.deepEqual(strip(dv.projection), serverProjection, "projection: browser == server (the server adds only its provenance block)");
  assert.equal(dv.formulaIds.forecast, "REV_FORECAST/v2");
});

test("C1-P02 parity of settings states: an unreadable config (direct object) and an unreadable fixed node give the SAME report as the server (never defaults)", async () => {
  const rows = SEP_COMPLETED.map((d) => fullDay(d));
  for (const raw of [{ config: { businessName: "direct object, not an envelope", employees: [] } }, { fixed: { _v: "{not json" } }, { config: null }, { fixed: null }]) {
    seed({ rows, raw });
    const server = await coreOf(INV_NOW_MS);
    const src = browserSrc({ rows, raw });
    const r = C.monthReport(F, src, month);
    assert.equal(r.status, "ready");
    assert.deepEqual(strip(r.report), strip(server.report), JSON.stringify(raw));
  }
});

// ═══ module readiness ══════════════════════════════════════════════════════════════════
test("C1-M01 bundle check: the approved identifiers pass; another product / forecast id or a malformed object is refused", () => {
  assert.deepEqual(strip(C.checkBundle(F)), { ok: true });
  assert.equal(C.checkBundle({ ...F, versions: { ...F.versions, product: "MARJIN_PRODUCT/1" } }).reason, "fincore_version_mismatch");
  assert.equal(C.checkBundle({ ...F, versions: { ...F.versions, forecast: "REV_FORECAST/v1" } }).reason, "fincore_version_mismatch");
  assert.equal(C.checkBundle(null).reason, "fincore_shape");
  assert.equal(C.checkBundle({ versions: F.versions }).reason, "fincore_shape");
});

test("C1-M02 the page bootstrap imports the generated bundle, checks identity + versions, and publishes ready|failed; there is no fallback engine", () => {
  const i = HTML.indexOf("// ── C1 fincore bootstrap ──");
  const block = HTML.slice(i, HTML.indexOf("</script>", i));
  assert.match(block, /await import\("\/fincore\/v1\/browser\/marjinFinanceGlobal\.js"\)/);
  assert.match(block, /api !== window\.MarjinFinance/);
  assert.match(block, /v\.product !== "MARJIN_PRODUCT\/2"/);
  assert.match(block, /v\.forecast !== "REV_FORECAST\/v2"/);
  assert.match(block, /state: "failed"/);
  assert.doesNotMatch(HTML, /function calcMetrics\b|function buildChart\b|window\.calcMetrics\s*=|window\.buildChart\s*=/, "legacy page formulas removed (U-09 / C1-T16)");
  assert.doesNotMatch(HTML, /calcMetrics\(|buildChart\(/, "no remaining call");
});

// ═══ inputs: settings, entries, ledger ═══════════════════════════════════════════════════
test("C1-I01 nodeState: an envelope is present, a direct object is unreadable, a broken envelope is unreadable; a failed read is unreadable (never absent)", () => {
  assert.equal(C.nodeState(F, env({ a: 1 }), "object").state, "present");
  assert.equal(C.nodeState(F, { a: 1 }, "object").state, "unreadable");
  assert.equal(C.nodeState(F, { _v: "{x" }, "object").state, "unreadable");
  assert.equal(C.nodeState(F, env([1]), "object").state, "unreadable");
  assert.equal(C.READ_FAILED.state, "unreadable");
});

test("C1-I02 inputsFor: no calculation before entries / settings / ledger are loaded, or when the ledger does not cover the calculation window", () => {
  const base = browserSrc({ rows: [fullDay("2026-09-01")] });
  assert.equal(C.inputsFor(F, { ...base, rowsReady: false }, null).status, "loading");
  assert.equal(C.inputsFor(F, { ...base, config: { state: "loading" } }, null).status, "loading");
  assert.equal(C.inputsFor(F, { ...base, ledger: { state: "loading" } }, null).status, "loading");
  assert.equal(C.inputsFor(F, { ...base, ledger: { state: "unreadable" } }, null).status, "unavailable");
  const narrow = { ...base, ledger: { state: "absent", states: {}, from: "2026-09-15", to: "2026-09-30" } };
  assert.equal(C.inputsFor(F, narrow, { from: "2026-09-01", to: "2026-09-30" }).reason, "ledger_range");
  assert.equal(C.monthReport(F, narrow, month).status, "loading", "a partially loaded history is never used");
  const ok = C.inputsFor(F, base, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(ok.status, "ready");
  assert.equal(ok.inputs.exceptionLedgerState, "absent");
  assert.ok(!("exceptionsByDate" in ok.inputs) || Object.keys(ok.inputs.exceptionsByDate).length === 0);
});

test("C1-L01 ledger chunks: consecutive, ≤ 366 days, exactly cover the window (API limit 400)", () => {
  for (const [from, to] of [["2024-01-01", "2026-10-31"], ["2026-10-01", "2026-10-31"], ["2025-10-01", "2026-10-01"]]) {
    const ch = C.ledgerChunks(F, from, to);
    assert.equal(ch[0].from, from); assert.equal(ch.at(-1).to, to);
    for (let i = 0; i < ch.length; i++) {
      assert.ok(F.finance.businessDate.datesInRange(ch[i].from, ch[i].to).length <= 366);
      if (i) assert.equal(F.finance.businessDate.addDays(ch[i - 1].to, 1), ch[i].from);
    }
  }
});

test("C1-L02 loadLedger: structured records only (legacy / ambiguous dropped), reason kept only while active, all chunks or nothing; the response must answer the chunk's range", async () => {
  const records = {
    "2026-09-07": { source: "structured", status: "active", reasonCode: "closure" },
    "2026-09-08": { source: "structured", status: "cleared", reasonCode: "closure" },
    "2026-09-09": { source: "legacy", status: "active", reasonCode: "closure" },
    "2026-09-10": { source: "legacy_ambiguous", status: "normal" },
  };
  // the list-entry-exceptions API echoes fromDate / toDate and returns only records inside them
  const body = (f, t) => ({ ok: true, fromDate: f, toDate: t, exceptions: Object.fromEntries(Object.entries(records).filter(([d]) => d >= f && d <= t)) });
  const calls = [];
  const ok = await C.loadLedger(F, { fetchChunk: async (f, t) => { calls.push([f, t]); return body(f, t); } }, "2025-09-01", "2026-09-30");
  assert.equal(ok.state, "present");
  assert.deepEqual(strip(ok.states), { "2026-09-07": { status: "active", reasonCode: "closure" }, "2026-09-08": { status: "cleared", reasonCode: null } });
  assert.equal(calls.length, 2);
  let n = 0;
  const oneFails = await C.loadLedger(F, { fetchChunk: async (f, t) => { if (n++ === 1) throw new Error("http_error"); return body(f, t); } }, "2025-09-01", "2026-09-30");
  assert.equal(oneFails.state, "unreadable");
  const malformed = await C.loadLedger(F, { fetchChunk: async () => ({ ok: true }) }, "2026-09-01", "2026-09-30");
  assert.equal(malformed.state, "unreadable");
  const outside = await C.loadLedger(F, { fetchChunk: async (f, t) => ({ ...body(f, t), exceptions: { ...body(f, t).exceptions, "2027-01-01": records["2026-09-07"] } }) }, "2026-09-01", "2026-09-30");
  assert.equal(outside.state, "unreadable", "a record outside the requested chunk is a contract violation (C1 R1)");
  const stale = await C.loadLedger(F, { fetchChunk: async (f, t) => body(f, t), isLive: () => false }, "2026-09-01", "2026-09-30");
  assert.equal(stale.state, "stale");
  const none = await C.loadLedger(F, { fetchChunk: async (f, t) => ({ ok: true, fromDate: f, toDate: t, exceptions: {} }) }, "2026-09-01", "2026-09-30");
  assert.equal(none.state, "absent");
});

test("C1-L03 the boolean merged exception map is never the core input: a legacy-only active exception is not a closure unless the core's own legacy rule applies", () => {
  const rows = [fullDay("2026-09-01"), fullDay("2026-09-02", { sales: "0", deliveries: "0", other_income: "0", is_exception: true, exception_reason: "closure" })];
  const src = browserSrc({ rows });
  src.ledger = { state: "absent", states: C.structuredStates({ "2026-09-02": { source: "legacy", status: "active", reasonCode: "closure" } }), from: "2026-01-01", to: "2026-12-31" };
  const r = C.monthReport(F, src, month).report;
  assert.deepEqual(r.operatingCalendar.closedDates, ["2026-09-02"], "closure from the core's narrow legacy fallback on the ROW (one row, is_exception + closure)");
  const p = HTML.slice(HTML.indexOf("// ── C1: Financial Core inputs"), HTML.indexOf("const israelDateKey = (offsetDays=0) => {"));
  assert.doesNotMatch(p, /exceptionsByDate:\s*entryExceptions|entryExceptions\[/, "the page never passes the merged boolean map to the core");
});

// ═══ closed / missing / zero / contradiction ═══════════════════════════════════════════════
test("C1-D01 a structured closure is a known zero (not missing); a missing day is named in the red disclosure; an operating ₪0 day is present", () => {
  const rows = SEP_COMPLETED.filter((d) => d !== "2026-09-04" && d !== "2026-09-07").map((d) => fullDay(d));
  rows[0] = fullDay("2026-09-01", { sales: "0", deliveries: "0", other_income: "0" });               // operating zero-revenue day
  const src = browserSrc({ rows, exceptions: { "2026-09-07": closure() } });
  const dv = C.dashboard(F, src, { nowMs: INV_NOW_MS, lastYearSales: null });
  assert.ok(dv.disclosure.warning.includes("חסרות הכנסות בימים: 04.09"));
  assert.ok(!dv.disclosure.warning.includes("07.09"), "the closure is not missing");
  assert.equal(dv.disclosure.closures, "יום סגור (הכנסה 0, לא חסר): 07.09");
  assert.ok(dv.revenue.text.endsWith("· חלקי"), "partial marker");
  const h = C.history(F, src, month);
  const st = (d) => h.days.find((x) => x.date === d);
  assert.equal(st("2026-09-07").status, "closed"); assert.equal(st("2026-09-07").revenueText, "₪0");
  assert.equal(st("2026-09-04").status, "missing"); assert.equal(st("2026-09-04").revenueText, "—");
  assert.equal(st("2026-09-01").status, "complete"); assert.equal(st("2026-09-01").revenueText, "₪0");
});

test("C1-D02 a closure that carries recorded revenue is a contradiction: disclosed, invalid in history, revenue never complete", () => {
  const rows = SEP_COMPLETED.map((d) => fullDay(d));
  const src = browserSrc({ rows, exceptions: { "2026-09-07": closure() } });
  const dv = C.dashboard(F, src, { nowMs: INV_NOW_MS, lastYearSales: null });
  assert.deepEqual(dv.disclosure.contradictions, ["2026-09-07"]);
  assert.ok(dv.disclosure.warning.includes("סומנו כסגורים אך נרשמו בהם הכנסות: 07.09"));
  assert.equal(dv.revenue.complete, false);
  assert.equal(C.history(F, src, month).days.find((x) => x.date === "2026-09-07").status, "contradiction");
  assert.equal(dv.projectedProfit.text, "—", "no projection from an incomplete Actual");
});

test("C1-D03 typed partial states: a missing day makes labor, profit, percentages and projection '—' (never a partial subtotal)", () => {
  const rows = SEP_COMPLETED.filter((d) => d !== "2026-09-04").map((d) => fullDay(d));
  const dv = C.dashboard(F, browserSrc({ rows }), { nowMs: INV_NOW_MS, lastYearSales: null });
  assert.equal(dv.labor.text, "—"); assert.equal(dv.laborPct.text, "—"); assert.equal(dv.purchasesPct.text, "—");
  assert.equal(dv.projectedProfit.text, "—"); assert.equal(dv.projectedLabor, "—");
  assert.equal(dv.purchasesPct.band, "none", "no colour on a non-value");
  const p = C.pnl(F, browserSrc({ rows }), month, null);
  assert.equal(p.rows.net.text, "—"); assert.equal(p.netPct.text, "—");
});

test("C1-D04 complete month: every displayed figure is a formatted core field (labor = full employer cost incl. the global placement; fixed accrual; v2 forecast; projected profit)", () => {
  const rows = SEP_COMPLETED.map((d) => fullDay(d));
  const dv = C.dashboard(F, browserSrc({ rows }), { nowMs: INV_NOW_MS, lastYearSales: null });
  const A = dv.report.actual, P = dv.projection.projection, M = F.presenters.money;
  assert.equal(dv.revenue.text, M.formatShekel(A.revenue.value));
  assert.equal(dv.labor.text, M.formatTypedAmount(A.labor.employerCost));
  assert.equal(dv.laborPct.text, F.presenters.percent.formatPercent(A.labor.employerCostPct));
  assert.equal(dv.purchasesPct.text, F.presenters.percent.formatPercent(A.purchasesPct));
  assert.equal(dv.forecast.text, M.formatShekel(dv.projection.forecast.projectedRevenue));
  assert.equal(dv.projectedProfit.text, M.formatShekel(P.operatingProfit));
  assert.equal(dv.labor.state, "complete");
  assert.ok(F.metrics.adapters.legacyNumber.amountToNumber(A.labor.employerCost.value) > 28 * 100, "global employer cost is included");
});

// ═══ VD-50, today context, VAT basis ════════════════════════════════════════════════════
test("C1-V01 VD-50 (P&L 'רווח גולמי') is isolated: always '—', no formula, whatever the data", () => {
  for (const rows of [SEP_COMPLETED.map((d) => fullDay(d)), []]) {
    const p = C.pnl(F, browserSrc({ rows }), month, null);
    assert.deepEqual(strip(p.gross), { status: "VD50_PENDING", value: null, text: "—" });
  }
  const seam = seamSource(HTML);
  const fn = seam.slice(seam.indexOf("function pnlGrossLineVD50"), seam.indexOf("function pnl(F"));
  assert.doesNotMatch(fn, /contributionOf|ratSub|sumAmounts|revenue|purchases/, "no gross-profit formula is computed");
});

test("C1-T01 today (D-15) is context only: today's recorded revenue is shown separately and never enters Actual MTD; the report ends at D-1", () => {
  const rows = [...SEP_COMPLETED.map((d) => fullDay(d)), fullDay(INV_AS_OF, { sales: "777", deliveries: "23" })];
  const dv = C.dashboard(F, browserSrc({ rows }), { nowMs: INV_NOW_MS, lastYearSales: null });
  const without = C.dashboard(F, browserSrc({ rows: rows.slice(0, -1) }), { nowMs: INV_NOW_MS, lastYearSales: null });
  assert.equal(dv.revenue.text, without.revenue.text, "today's row does not change MTD");
  assert.equal(dv.report.window.completedThrough, "2026-09-28");
  assert.equal(dv.today.revenueText, "₪800");
  assert.equal(dv.today.label, F.presenters.labels.LABELS.presence.currentDay);
  const future = C.dashboard(F, browserSrc({ rows: [...rows, fullDay("2026-09-30", { sales: "999" })] }), { nowMs: INV_NOW_MS, lastYearSales: null });
  assert.equal(future.revenue.text, dv.revenue.text, "a future row is quarantined");
  assert.equal(future.quarantine.futureRows, 1);
});

test("C1-T02 the entry revenue preview folds the page's net-of-VAT fields through the core (no VAT arithmetic in the seam)", () => {
  const pv = C.entryRevenuePreview(F, { sales: 847, deliveries: 85, other_income: "" }, "2026-09-10");
  assert.equal(pv.text, "₪932");
  assert.equal(C.entryRevenuePreview(F, { sales: "x" }, "2026-09-10").presence, "invalid");
  assert.doesNotMatch(seamSource(HTML), /1\.18|VAT_RATE|grossToNet/, "the seam never applies VAT");
});

// ═══ labor placement / employees / entry ═══════════════════════════════════════════════
test("C1-E01 the monthly employer cost per date is the core's closure-aware placement: a completed closure carries 0, other dates the month spread; future dates are expected", () => {
  const rows = SEP_COMPLETED.map((d) => d === "2026-09-07" ? fullDay(d, { sales: "0", deliveries: "0", other_income: "0", supplier_payments: {}, payroll: "0" }) : fullDay(d));
  const src = browserSrc({ rows, exceptions: { "2026-09-07": closure() } });
  const e = C.employees(F, src, month);
  const day = (d) => e.days.find((x) => x.date === d);
  const tl = F.product.productTimeline(C.inputsFor(F, src, null).inputs);
  const expect = (d) => F.metrics.costTimeline.dayPlacement(tl, d, { asOfBusinessDate: INV_AS_OF, closedDates: ["2026-09-07"] });
  assert.equal(day("2026-09-07").placement.text, "₪0", "completed closure: no global cost");
  assert.equal(day("2026-09-08").placement.global, F.finance.decimal.serializeRat(expect("2026-09-08").global));
  assert.equal(day("2026-09-30").expected, true);
  assert.equal(e.monthTotal.text, F.presenters.money.formatTypedAmount(e.report.actual.labor.employerCost));
  const el = C.entryLabor(F, src, "2026-09-08", "150");
  assert.equal(el.status, "ready");
  assert.equal(el.totalText, F.presenters.money.formatShekel(F.finance.decimal.serializeRat(F.finance.decimal.ratAdd(expect("2026-09-08").global, F.finance.decimal.ratFromInt(150)))));
});

test("C1-E02 an invalid global amount is never ₪0: placement and labor are '—'", () => {
  const rows = SEP_COMPLETED.map((d) => fullDay(d));
  const src = browserSrc({ rows, config: { businessName: "x", employees: [{ id: "g1", type: "global", monthlySalary: "abc" }] } });
  assert.equal(C.entryLabor(F, src, "2026-09-08", "100").totalText, "—");
  assert.equal(C.employees(F, src, month).monthTotal.text, "—");
});

// ═══ suppliers / reminders / insights ═══════════════════════════════════════════════════
test("C1-S01 supplier month: totals by source include deleted suppliers and legacy food_cost rows; shares over complete revenue; top supplier", () => {
  const rows = SEP_COMPLETED.map((d, i) => i === 0 ? fullDay(d, { supplier_payments: {}, food_cost: "500" }) : fullDay(d, { supplier_payments: { s1: "300", s9: "10" } }));
  const sv = C.suppliers(F, browserSrc({ rows }), month, [{ id: "s1", name: "ירקות" }]);
  assert.deepEqual(sv.rows.map((r) => r.key), ["legacy_food_cost", "supplier:s1", "supplier:s9"]);
  assert.equal(sv.bySupplierId.s1.name, "ירקות");
  assert.equal(sv.top.key, "supplier:s1");
  assert.equal(sv.total.text, F.presenters.money.formatShekel(sv.report.actual.purchases.value));
});

test("C1-S02 supplier reminder presence (VD-39): a recorded 0 or 'skip' is entered; empty / absent is not", () => {
  for (const v of ["0", 0, "skip", "120"]) assert.equal(C.supplierCellEntered(F, v), true, String(v));
  for (const v of ["", undefined, null]) assert.equal(C.supplierCellEntered(F, v), false, String(v));
});

test("C1-S03 impact statistics exclude closures, missing and partial days", () => {
  const rows = SEP_COMPLETED.map((d) => fullDay(d));
  rows[2] = { ...rows[2], weather_impact: "גשם" };
  rows[6] = fullDay("2026-09-07", { sales: "0", deliveries: "0", other_income: "0", weather_impact: "גשם" });
  const s = C.impactStats(F, browserSrc({ rows, exceptions: { "2026-09-07": closure() } }), rows);
  assert.equal(s.impactDays, 1, "the closed rainy day is not a sample");
  assert.equal(s.normalDays, 26);
});

test("C1-I03 insights: only documents recording a revenue total count; absent totals render '—'", () => {
  const docs = [{ revenue: { total: 1000 } }, { revenue: { had_entry: true } }, { revenue: { total: 0 } }, {}];
  assert.deepEqual(strip(C.insightsStats(F, docs)), { status: "ready", revenueDays: 2, avgText: "₪500" });
  assert.equal(C.insightMoney(F, docs[1]), "—");
  assert.equal(C.insightMoney(F, docs[2]), "₪0");
});

// ═══ failure isolation ═══════════════════════════════════════════════════════════════════
test("C1-F01 a core refusal (duplicate row ids) is an explicit unavailable view model — no numbers, no fallback", () => {
  const rows = [fullDay("2026-09-01"), { ...fullDay("2026-09-02"), id: fullDay("2026-09-01").id }];
  rows[1].id = rows[0].id;
  const dv = C.dashboard(F, browserSrc({ rows }), { nowMs: INV_NOW_MS, lastYearSales: null });
  assert.equal(dv.status, "unavailable");
  assert.ok(!("revenue" in dv));
});

test("C1-F02 the seam carries no page finance formula: no binary money arithmetic, no VAT, no clock read; it is frozen and vm-isolated", () => {
  const seam = seamSource(HTML);
  for (const re of [/parseFloat|toFixed|Date\.now|new Date\(/, /\bNumber\(e\.|Number\(r\./, /\.reduce\(/]) assert.doesNotMatch(seam, re, String(re));
  assert.ok(Object.isFrozen(C));
});
