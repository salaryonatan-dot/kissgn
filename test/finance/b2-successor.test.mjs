// Financial Core B2 successor (on the approved CD-M1 core 6d54e367): the closed-days contract
// through the morning snapshot and e-mail, the findings B2-R01…R03 of the checkpoint review, the
// partial-numerator presentation obligation (CD-M1 R2 ruling), and the B2 adversarial scenarios
// B2-AT04…AT24 that need closure / timing / completeness inputs. Values are compared with the
// canonical server API for the same seeded storage (the oracle) and with hand oracles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { snapOf, mail, closure, coreOf, seed, SB, SE, CM, textOf } from "../support/b2-email-harness.mjs";
import { INVARIANTS, completeSeptember, fullDay, GLOBAL_3000 } from "../support/financial-invariants.mjs";
import { nowMsFor, stableJson, badValues, entry, T, B } from "../support/b1-fixtures.mjs";

const REPO = join(import.meta.dirname, "..", "..");
const without = (rows, ...dates) => rows.filter((r) => !dates.includes(r.date));
const actualOf = (s) => stableJson({ a: s.financials.amounts, r: s.financials.ratios, c: s.financials.coverage, ca: s.financials.costAllocation });

// ── Completed closures (CD-AT05/07, B2-AT14, B2-G10/G14) ─────────────────────
test("B2S-01 a COMPLETED closure: known zero revenue (not missing), monthly costs on the 27 eligible days exactly as the core, calendar progress unchanged", async () => {
  const s = await snapOf({ rows: without(completeSeptember(), "2026-09-06"), exceptions: { "2026-09-06": closure() } });
  const { report } = await coreOf();
  const f = s.financials, a = report.actual;
  assert.deepEqual([f.amounts.revenue.exact, f.amounts.revenue.state], ["27000", "complete"], "the closed day adds a known 0, the month stays complete");
  assert.deepEqual([f.coverage.closedDays, f.coverage.revenue.missing], [["2026-09-06"], []], "closed ≠ missing");
  assert.deepEqual(f.costAllocation, { allocationEligibleDays: 27, completedClosureDates: ["2026-09-06"], dayPlacement: "available", placementUnavailableDates: [] });
  assert.deepEqual([f.amounts.globalEmployerCost.exact, f.amounts.fixedRegular.exact, f.amounts.operatingProfit.exact], [a.labor.globalEmployerCost.value, a.fixedAccrual.regular, a.operatingProfit.value], "every figure is the core value");
  assert.deepEqual([f.amounts.globalEmployerCost.exact, f.amounts.fixedRegular.exact], ["81000/29", "83700/29"], "hand oracle: entitlement placed on 29 eligible month dates, 27 of them in the window");
  assert.notEqual(f.amounts.globalEmployerCost.exact, "2800", "not the calendar-day accrual");
  assert.deepEqual([f.window.recognizedDays, f.window.daysLeft, f.window.progressPct], [28, 2, "280/3"], "CDA-20: calendar measures, not closure-adjusted");
});

// ── Future closure recorded before the date completes (B2-AT19, CD-AT08/28) ──
test("B2S-02 a FUTURE closure: projected revenue falls at once; Actual, the cost denominator and calendar progress are byte-identical", async () => {
  const plain = await snapOf({ rows: completeSeptember() });
  const withFuture = await snapOf({ rows: completeSeptember(), exceptions: { "2026-09-30": closure() } });
  assert.equal(actualOf(withFuture), actualOf(plain), "Actual / coverage / allocation unchanged");
  assert.equal(stableJson(withFuture.financials.window), stableJson(plain.financials.window), "daysPassed / daysLeft / progress unchanged (CD-AT28)");
  assert.equal([withFuture.daysPassed, withFuture.daysLeft].join(), [plain.daysPassed, plain.daysLeft].join());
  assert.deepEqual([plain.financials.projection.revenue.exact, withFuture.financials.projection.revenue.exact], ["30000", "29000"], "09-30 receives no forecast revenue");
  assert.deepEqual(withFuture.financials.projection.futureClosureDates, ["2026-09-30"]);
  assert.ok(withFuture.financials.projection.warnings.includes("declared_closures_receive_no_forecast"));
  const { text } = await mail({ rows: completeSeptember(), exceptions: { "2026-09-30": closure() } });
  assert.match(text, /ימים סגורים מתוכננים: 30\.09 — ללא תחזית הכנסות/);
});

// ── Advance only the clock until that closure completes (B2-AT20, CD-AT09) ───
test("B2S-03 advance ONLY the clock past a declared closure: Actual gains its zero once, costs redistribute, entitlement unchanged, nothing subtracted twice", async () => {
  const rows = without(completeSeptember(), "2026-09-28");
  const exceptions = { "2026-09-28": closure() };
  const before = await snapOf({ rows, exceptions }, nowMsFor("2026-09-28"));
  const after = await snapOf({ rows, exceptions }, nowMsFor("2026-09-29"));
  assert.deepEqual([before.financials.amounts.revenue.exact, after.financials.amounts.revenue.exact], ["27000", "27000"], "the closure adds a known 0 exactly once");
  assert.deepEqual([before.financials.costAllocation.completedClosureDates, after.financials.costAllocation.completedClosureDates], [[], ["2026-09-28"]]);
  assert.deepEqual([before.financials.costAllocation.allocationEligibleDays, after.financials.costAllocation.allocationEligibleDays], [27, 27]);
  // entitlement: 3000 / month; before, 27 of 30 eligible dates (closure still ahead) ⇒ 2700; after, 27 of 29 ⇒ 81000/29
  assert.deepEqual([before.financials.amounts.globalEmployerCost.exact, after.financials.amounts.globalEmployerCost.exact], ["2700", "81000/29"]);
  assert.deepEqual([before.financials.projection.futureClosureDates, after.financials.projection.futureClosureDates], [["2026-09-28"], []]);
  assert.deepEqual([before.financials.window.recognizedDays, after.financials.window.recognizedDays], [27, 28], "calendar days advance with the clock only");
});

// ── B2-R02 / B2-AT24: explicit zero revenue ───────────────────────────────────
test("B2S-04 B2-R02 every completed operating day entered as revenue 0: revenue ₪0 (complete), its share '—' through the core zero-denominator rule, never 100%", async () => {
  const { snapshot, text } = await mail({ rows: completeSeptember({ sales: "0" }) });
  const f = snapshot.financials;
  assert.deepEqual([f.amounts.revenue.exact, f.amounts.revenue.state], ["0", "complete"]);
  assert.deepEqual([f.ratios.revenueShare.state, f.ratios.revenueShare.reason], ["unavailable", "zero_denominator"]);
  assert.match(text, /הכנסות ₪0 — קניות/, "the revenue row shows ₪0 and '—'");
  assert.doesNotMatch(text, /100\.0%/);
  const normal = await snapOf({ rows: completeSeptember() });
  assert.deepEqual([normal.financials.ratios.revenueShare.exact, normal.financials.ratios.revenueShare.state], ["100", "value"], "non-zero revenue: revenue ÷ revenue through the same core rule");
  const src = readFileSync(join(REPO, "src/snapshot/snapshotEmail.ts"), "utf8");
  assert.doesNotMatch(src, /exact: "100"/, "no hand-made 100 % share survives");
});

// ── CDA-18 / B2-AT04 / B2-G21: missing completed revenue ─────────────────────
test("B2S-05 missing revenue on two completed dates with other activity: exact dates in TEXT directly below MTD revenue; revenue and forecast partial; dependent values '—'", async () => {
  const rows = completeSeptember().map((r) => (r.date === "2026-09-08" || r.date === "2026-09-15" ? { ...r, sales: undefined, deliveries: undefined, other_income: undefined } : r));
  const { snapshot, html, text } = await mail({ rows });
  const f = snapshot.financials;
  assert.deepEqual([f.amounts.revenue.state, f.coverage.revenue.missing], ["partial", ["2026-09-08", "2026-09-15"]]);
  assert.deepEqual([f.projection.state, f.projection.revenue.state, f.projection.missingRevenueDates], ["partial", "partial", ["2026-09-08", "2026-09-15"]]);
  assert.equal(f.amounts.purchases.state, "complete", "purchases stay present on those dates (never implied zero revenue)");
  // the warning row is the table row immediately after the revenue row (not a footnote), red AND textual
  const rowsHtml = html.split('<tr class="kpi-');
  const revIdx = rowsHtml.findIndex((r) => r.includes(">הכנסות</td>"));
  assert.ok(revIdx > 0 && rowsHtml[revIdx + 1].startsWith('note-row">') && rowsHtml[revIdx + 1].includes("kpi-warning"), "warning row directly below revenue");
  assert.match(text, /הכנסות ₪26,000 \(חלקי\) — ⚠ חסרות הכנסות בימים: 08\.09, 15\.09 — סכום ההכנסות אינו מלא/);
  assert.match(text, /₪[\d,]+ \(חלקי\) תחזית הכנסות \(REV_FORECAST\/v2\)/, "the forecast is labelled partial");
  assert.match(text, /תחזית חלקית — חסרות או לא תקינות הכנסות בימים: 08\.09, 15\.09/);
  assert.deepEqual([snapshot.totalSales, snapshot.netProfit, snapshot.paceRevenue, snapshot.forecast], [null, null, null, null], "legacy number fields carry complete values only");
  // monochrome: the dates survive with every colour / style removed
  const mono = textOf(html.replace(/style="[^"]*"/g, "").replace(/class="[^"]*"/g, ""));
  assert.match(mono, /08\.09, 15\.09/);
});

// ── B2-AT06: operating zero is present and forecast-eligible, not a closure ───
test("B2S-06 an operating day with explicit revenue 0 stays a present operating fact: not closed, not missing, and it enters the weekday forecast sample", async () => {
  const rows = completeSeptember().map((r) => (r.date === "2026-09-22" ? { ...r, sales: "0" } : r));
  const s = await snapOf({ rows });
  const f = s.financials;
  assert.deepEqual([f.coverage.closedDays, f.coverage.revenue.missing, f.amounts.revenue.state, f.amounts.revenue.exact], [[], [], "complete", "27000"]);
  const { projection } = await coreOf();
  const tue = projection.forecast.engine.weekdays.find((w) => w.sampleDates && w.sampleDates.includes("2026-09-22"));
  assert.ok(tue, "the zero Tuesday is one of the six eligible samples");
  assert.equal(f.projection.revenue.exact, projection.forecast.projectedRevenue);
});

// ── B2-AT18 / B2-G08: unreadable exception ledger ─────────────────────────────
test("B2S-07 an UNREADABLE exception ledger: forecast unavailable (typed), global/fixed/profit '—' with the stated reason, revenue kept", async () => {
  const { snapshot, text } = await mail({ rows: completeSeptember(), exceptions: "corrupt" });
  const f = snapshot.financials;
  assert.deepEqual([f.projection.state, f.projection.revenue.state, f.projection.warnings], ["unavailable", "unavailable", ["exception_ledger_unreadable"]]);
  assert.deepEqual([f.amounts.globalEmployerCost.state, f.amounts.fixedRegular.state, f.amounts.operatingProfit.state], ["unavailable", "unavailable", "unavailable"]);
  assert.ok(f.amounts.globalEmployerCost.issueReasons.includes("closure_calendar_unreadable"));
  assert.equal(f.costAllocation.dayPlacement, "closure_calendar_unreadable");
  assert.equal(f.amounts.revenue.exact, "28000");
  assert.match(text, /עלויות חודשיות לא מוצגות: יומן הימים הסגורים אינו קריא/);
  assert.match(text, /תחזית הכנסות לא זמינה \(exception_ledger_unreadable\)/);
  assert.equal(f.provenance.operatingCalendar, "unknown");
});

// ── VD-44 adapted: the revenue-pace insight needs a COMPLETE forecast ────────
test("B2S-08 revenue-pace insight: emitted for a complete forecast, suppressed for a partial one (retained 0.9 / 1.05 literals)", async () => {
  const config = { ...GLOBAL_3000, targetSales: 1000 };
  const complete = await snapOf({ rows: completeSeptember(), config });
  assert.ok(complete.insights.some((i) => i.rule === "revenue_pace" && i.type === "positive"));
  const partial = await snapOf({ rows: INVARIANTS.find((i) => i.id === "INV-02").apply(completeSeptember()), config });
  assert.equal(partial.financials.projection.revenue.state, "partial");
  assert.equal(partial.insights.some((i) => i.rule === "revenue_pace"), false);
});

// ── CDA-02: closure contradicted by recorded revenue ─────────────────────────
test("B2S-09 a closure with recorded non-zero revenue (CD-M2 partial state): revenue not complete, the contradiction named in text, profit '—'", async () => {
  const { snapshot, text } = await mail({ rows: completeSeptember(), exceptions: { "2026-09-10": closure() } });
  const f = snapshot.financials;
  assert.deepEqual(f.coverage.closedWithRevenue, ["2026-09-10"]);
  assert.notEqual(f.amounts.revenue.state, "complete");
  assert.equal(f.amounts.operatingProfit.state, "unavailable");
  assert.match(text, /⚠ סומנו כסגורים אך נרשמו בהם הכנסות: 10\.09 — סכום ההכנסות אינו מלא/);
  assert.doesNotMatch(text, /ערך הכנסה לא תקין בימים: 10\.09/, "named once, as a contradiction");
});

// ── Rent: the core's two values, no B2 sum (B2-G22) ───────────────────────────
test("B2S-10 rent is shown as the core's fixed rent and percentage rent; no rent total is computed anywhere in B2", async () => {
  const pctCfg = await snapOf({ rows: completeSeptember(), config: { ...GLOBAL_3000, rentType: "pct", rentPct: "8" } });
  const { report: r1 } = await coreOf();
  assert.deepEqual([pctCfg.financials.amounts.rentPct.exact, pctCfg.financials.amounts.rentFixed.exact], [r1.actual.fixedAccrual.rentPct, r1.actual.fixedAccrual.rentFixed]);
  assert.deepEqual([pctCfg.rentPctAmount, pctCfg.rentFixedAmount], [2240, 0], "8 % of 28000; no fixed rent");
  const fixedCfg = await snapOf({ rows: completeSeptember(), config: { ...GLOBAL_3000, rentFixed: "6000" } });
  const { report: r2 } = await coreOf();
  assert.deepEqual([fixedCfg.financials.amounts.rentFixed.exact, fixedCfg.financials.amounts.rentPct.exact], [r2.actual.fixedAccrual.rentFixed, "0"]);
  assert.equal(fixedCfg.financials.amounts.rentFixed.exact, "5600", "6000 × 28/30 eligible days");
  for (const f of ["src/snapshot/snapshotEmail.ts", "src/snapshot/snapshotBuilder.ts"]) {
    const code = readFileSync(join(REPO, f), "utf8");
    assert.doesNotMatch(code, /rentFixed[^\n]*ratAdd|ratAdd[^\n]*rentPct|rentAmount/, f + ": no rent sum");
    assert.doesNotMatch(code, /revenueVsSalesTarget|paceVsTarget/, f + ": no B2 target-comparison formula");
  }
  assert.ok(!("rentAmount" in pctCfg) && !("paceVsTarget" in pctCfg));
});

// ── Partial numerators (CD-M1 R2 ruling; B2-G11 / B2-G21) ─────────────────────
test("B2S-11 partial numerators: an invalid purchase cell ⇒ purchases '(חלקי)', food % '—', no food insight; an invalid payroll cell ⇒ labor and labor % '—'", async () => {
  const badPurchase = completeSeptember().map((r) => (r.date === "2026-09-14" ? { ...r, supplier_payments: { s1: "300", s2: "12,5" } } : r));
  const p = await mail({ rows: badPurchase, config: { ...GLOBAL_3000, targets: { foodCostPct: "10" } } });
  const fp = p.snapshot.financials;
  assert.deepEqual([fp.amounts.purchases.state, fp.ratios.purchasesPct.state, fp.coverage.purchases.partial], ["partial", "unavailable", ["2026-09-14"]]);
  assert.equal(p.snapshot.totalFood, null); assert.equal(p.snapshot.foodCostPct, null);
  assert.match(p.text, /קניות \(מזון\) ₪8,400 \(חלקי\) — \(יעד: 10\.0%\)/);
  assert.equal(p.snapshot.insights.some((i) => i.rule === "food_cost"), false, "a partial numerator never feeds a ratio claim");
  assert.match(p.text, /חסרים או לא תקינים נתוני קניות או שכר ב-1 ימים/);
  const badPayroll = completeSeptember().map((r) => (r.date === "2026-09-14" ? { ...r, payroll: "x1" } : r));
  const l = await mail({ rows: badPayroll });
  assert.deepEqual([l.snapshot.financials.amounts.laborEmployerCost.state, l.snapshot.financials.ratios.laborPct.state], ["unavailable", "unavailable"]);
  assert.match(l.text, /עלות עובדים — — \(יעד: 27\.0%\)/);
});

// ── Purchases-only day (B2-AT08 / B2-G12) ─────────────────────────────────────
test("B2S-12 a purchases-only completed day: purchases counted; revenue missing (partial) — never an implied zero revenue", async () => {
  const rows = completeSeptember().map((r) => (r.date === "2026-09-17" ? entry(r.id, r.date, { supplier_payments: { s1: "300" }, payroll: "100" }) : r));
  const { snapshot, text } = await mail({ rows });
  const f = snapshot.financials;
  assert.deepEqual([f.amounts.purchases.exact, f.amounts.purchases.state], ["8400", "complete"]);
  assert.deepEqual([f.amounts.revenue.state, f.coverage.revenue.missing], ["partial", ["2026-09-17"]]);
  assert.match(text, /חסרות הכנסות בימים: 17\.09/);
});

// ── Structure: B2-R01 / B2-G22 / B2-G26 ───────────────────────────────────────
test("B2S-13 B2-R01 structure: no src/finance-server/canonicalSnapshot.ts; the builder imports no core and does no arithmetic; the e-mail module imports no server API", () => {
  assert.throws(() => readFileSync(join(REPO, "src/finance-server/canonicalSnapshot.ts")), /ENOENT/);
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const sb = strip(readFileSync(join(REPO, "src/snapshot/snapshotBuilder.ts"), "utf8"));
  const se = strip(readFileSync(join(REPO, "src/snapshot/snapshotEmail.ts"), "utf8"));
  const specs = (t) => [...t.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual(specs(sb).filter((x) => /(?:^|\/)(?:finance|metrics|policy|presenters|browser)\//.test(x)), [], "builder: no core import");
  assert.deepEqual(specs(se).filter((x) => /finance-server\//.test(x)), [], "e-mail: no server-API import");
  for (const re of [/\bratAdd\b|\bratSub\b|\bratMul\b|\bratDiv\b/, /\bparseAmountString\b/, /[^=!<>]\s[-+*/]\s(?!>)[\w(]/]) assert.doesNotMatch(sb.slice(sb.indexOf("export async function buildSnapshotForBiz"), sb.indexOf("export async function buildSnapshotForAll")), re, "builder orchestration: " + re);
  // the ONE derivation in B2: kpiShares via the core ratioOfTotals
  assert.equal((se.match(/ratioOfTotals\(/g) || []).length, 2, "kpiShares' shareOfRevenue + the calendar progress bar");
  assert.equal(typeof SE.kpiShares, "function");
});

// ── B2-AT24 / B2-AT11 no leakage ──────────────────────────────────────────────
test("B2S-14 no NaN / null / undefined / Infinity text in any state; no general daily-average row (VD-41)", async () => {
  const states = [
    { rows: completeSeptember() }, { rows: completeSeptember({ sales: "0" }) }, { rows: INVARIANTS.find((i) => i.id === "INV-02").apply(completeSeptember()) },
    { rows: completeSeptember(), exceptions: "corrupt" }, { rows: completeSeptember(), config: {}, raw: { config: { _v: "{bad" } } },
    { rows: without(completeSeptember(), "2026-09-06"), exceptions: { "2026-09-06": closure(), "2026-09-30": closure() } },
  ];
  for (const st of states) {
    const { snapshot, subject, text } = await mail(st);
    assert.doesNotMatch(subject + text, /NaN|undefined|Infinity|null|\[object/, JSON.stringify(Object.keys(st)));
    assert.doesNotMatch(text, /ממוצע יומי|dailyAvg|ממוצע/, "no daily-average row");
    assert.deepEqual(badValues(snapshot), []);
  }
});

// ── B2-AT14: month lengths WITH a completed and a future closure ──────────────
test("B2S-15 month lengths 28/29/30/31 with a completed closure (day 2) and a future closure (last day): exact entitlement on eligible days; the future closure does not move the denominator", async () => {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const frac = (n, d) => { const g = gcd(n, d); return d / g === 1 ? String(n / g) : `${n / g}/${d / g}`; };
  for (const [month, days] of [["2027-02", 28], ["2028-02", 29], ["2026-04", 30], ["2027-01", 31]]) {
    const date = (k) => `${month}-${String(k).padStart(2, "0")}`;
    const asOf = date(days - 1);                                 // window = days 1 … days-2
    const rows = Array.from({ length: days - 2 }, (_, i) => i + 1).filter((k) => k !== 2).map((k) => fullDay(date(k)));
    const exceptions = { [date(2)]: closure(), [date(days)]: closure() };
    const s = await snapOf({ rows, exceptions }, nowMsFor(asOf));
    const f = s.financials, eligibleWindow = days - 3, eligibleMonth = days - 1;
    assert.equal(f.costAllocation.allocationEligibleDays, eligibleWindow, month);
    assert.deepEqual(f.costAllocation.completedClosureDates, [date(2)], month);
    assert.equal(f.amounts.globalEmployerCost.exact, frac(3000 * eligibleWindow, eligibleMonth), month + " global: 3000 × eligible-in-window / eligible-in-month (future closure still eligible)");
    assert.equal(f.amounts.fixedRegular.exact, frac(3100 * eligibleWindow, eligibleMonth), month + " fixed");
    assert.deepEqual(f.projection.futureClosureDates, [date(days)], month);
    assert.deepEqual([f.window.recognizedDays, f.window.daysInMonth, f.window.daysLeft], [days - 2, days, 2], month + " calendar measures");
    const { report } = await coreOf(nowMsFor(asOf));
    assert.equal(f.amounts.operatingProfit.exact, report.actual.operatingProfit.value, month + " profit = core");
  }
});

// ── B2-AT17: six eligible samples, operating zero included, closures skipped ─
test("B2S-16 the forecast's weekday samples include an operating zero and skip closures (searching earlier dates) — the snapshot shows the core's figure", async () => {
  const hist = [];
  for (let d = Date.UTC(2026, 6, 1); d < Date.UTC(2026, 8, 29); d += 86400000) hist.push(fullDay(new Date(d).toISOString().slice(0, 10)));
  const rows = hist.filter((r) => r.date !== "2026-09-15").map((r) => (r.date === "2026-09-08" ? { ...r, sales: "0" } : r));
  const s = await snapOf({ rows, exceptions: { "2026-09-15": closure() } });
  const { projection } = await coreOf();
  const tue = projection.forecast.engine.weekdays.find((w) => w.sampleDates && w.sampleDates.includes("2026-09-08"));
  assert.ok(tue, "the operating-zero Tuesday is sampled");
  assert.equal(tue.sampleDates.length, 6); assert.ok(!tue.sampleDates.includes("2026-09-15"), "the closed Tuesday is skipped");
  assert.ok(tue.sampleDates.includes("2026-08-18"), "an earlier Tuesday replaces it");
  assert.equal(s.financials.projection.revenue.exact, projection.forecast.projectedRevenue);
  assert.equal(s.financials.projection.state, "complete");
});

// ── B2-AT22: Israel-midnight boundary with an advancing clock ─────────────────
test("B2S-17 one captured clock across the Israel midnight boundary: an advancing clock is read once, so report and projection share one business date", async () => {
  seed({ rows: completeSeptember() });
  const real = Date.now; let t = Date.UTC(2026, 8, 28, 20, 59, 59, 999); // 23:59:59.999 in Israel (UTC+3) on 28.09
  let reads = 0; Date.now = () => { reads += 1; const v = t; t += 1000; return v; };
  try {
    const s = await SB.buildSnapshotForBiz(T, B);
    assert.equal(reads, 1);
    assert.deepEqual([s.date, s.financials.window.completedThrough, s.financials.provenance.asOfBusinessDate], ["2026-09-28", "2026-09-27", "2026-09-28"]);
  } finally { Date.now = real; }
});

// ── B2-AT05: missing payroll through the e-mail subject ───────────────────────
test("B2S-18 missing completed payroll: labor / labor % / profit '—', the subject says 'רווח: —', no labor or profit insight", async () => {
  const { subject, text, snapshot } = await mail({ rows: INVARIANTS.find((i) => i.id === "INV-05").apply(completeSeptember()) });
  assert.match(subject, /\| רווח: —$/);
  assert.match(text, /עלות עובדים — — \(יעד: 27\.0%\)/);
  assert.equal(snapshot.insights.some((i) => i.rule === "labor" || i.rule === "net_profit"), false);
});

// ── B2-AT14 (no eligible dates) — presenter mapping of the core's typed placement ─
test("B2S-19 'no eligible allocation days' (core typed state): the monthly cost is '—' with the stated reason, never ₪0 (synthetic core report: unreachable in an open-month compat snapshot)", async () => {
  seed({ rows: completeSeptember() });
  const { report, projection, inputs } = await coreOf();
  const issue = [{ component: "global_employer_cost", kind: "missing", reason: "no_eligible_allocation_days", dates: ["2026-09-01"] }];
  const r = { ...report, actual: { ...report.actual,
    labor: { ...report.actual.labor, globalEmployerCost: { state: "incomplete_components", value: null, issues: issue }, employerCost: { state: "incomplete_components", value: null, issues: issue }, employerCostPct: { state: "incomplete_components" } },
    operatingProfit: { state: "incomplete_components", value: null, issues: issue },
    costAllocation: { ...report.actual.costAllocation, dayPlacement: "no_eligible_allocation_days", placementUnavailableDates: ["2026-09-01"] } } };
  const { provenance } = CM.canonicalMonthReport(inputs, { kind: "open_month", month: "2026-09" });
  const view = SE.buildSnapshotView({ report: r, projection, provenance, config: null });
  assert.deepEqual([view.amounts.globalEmployerCost.exact, view.amounts.globalEmployerCost.state, view.amounts.globalEmployerCost.issueReasons], [null, "unavailable", ["no_eligible_allocation_days"]]);
  assert.equal(view.costAllocation.dayPlacement, "no_eligible_allocation_days");
  const snap = { tenantId: "t", bizId: "b", bizName: "B", date: "2026-09-29", insights: [], financials: view };
  await SE.sendSnapshotEmail("x@example.test", snap);
  const text = textOf(globalThis.__EMAILS.at(-1).html);
  assert.match(text, /עלות עובדים — —/); assert.match(text, /עלויות חודשיות לא מוצגות: אין ימי פעילות לחלוקת העלות החודשית/);
});

