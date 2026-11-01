// DELIVERY-PCT (server) — the morning snapshot (builder → view → e-mail) includes the estimated delivery cost by the
// SAME rule as the page (src/snapshot/snapshotEmail.ts over the server API's per-day revenue) is checked figure-for-figure against
// the page's own view models (index.html window.MarjinC1: P&L + Dashboard) on the same rows and settings, over the
// real compiled builder, loader, core and e-mail presenter (sendEmail captured, never sent). Synthetic data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { srv, SE, textOf } from "../support/b2-email-harness.mjs";
import { makeDb, installDb } from "../support/server-reader-harness.mjs";
import { env, T, B, configWithGlobal, fixedItems } from "../support/b1-fixtures.mjs";
import { INV_NOW_MS, INV_AS_OF } from "../support/financial-invariants.mjs";
import { loadFinance, loadSeam, present, row, srcOf } from "../support/c1-seam.mjs";

const SB = await srv.import("src/snapshot/snapshotBuilder.js");
const DE = SE;
const F = await loadFinance();
const C = loadSeam();
const B2 = "bizB";
const n = (x) => F.metrics.adapters.legacyNumber.amountToNumber(x);
let seq = 1;
const uid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const SEP = Array.from({ length: 28 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
const day = (d, o = {}) => row(d, { sales: "1000", deliveries: "200", other_income: "0", supplier_payments: { s1: "300" }, payroll: "100", other_expense: "0", ...o }, uid());
const ROWS = SEP.map((d) => day(d));
const BASE = { ...configWithGlobal("3000"), businessName: "Biz", rentType: "fixed", rentFixed: 4000, hasRoyalty: false };
const FIXED = fixedItems("3100");
const v = (effectiveFrom, ratePct, recordedAt = 1) => ({ versionId: effectiveFrom + "/" + ratePct, effectiveFrom, ratePct, recordedAt });
const withRates = (versions) => (versions === undefined ? BASE : { ...BASE, deliveryCost: { versions } });

/** both businesses in ONE tenant; bizB never has a rate */
function seedTwo({ rowsA = ROWS, cfgA = BASE, rowsB = ROWS }) {
  const db = installDb(makeDb());
  for (const [biz, rows, cfg] of [[B, rowsA, cfgA], [B2, rowsB, BASE]]) {
    db.seed(`tenants/${T}/biz:${biz}:entries`, env(rows)); db.seed(`tenants/${T}/biz:${biz}:config`, env(cfg)); db.seed(`tenants/${T}/biz:${biz}:fixed`, env(FIXED));
  }
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "Biz A" }, { id: B2, name: "Biz B" }]));
  return db;
}
const snap = (biz = B) => SB.buildSnapshotForBiz(T, biz, { nowMs: INV_NOW_MS });
async function email(snapshot) { await SE.sendSnapshotEmail("owner@example.test", snapshot); const m = globalThis.__EMAILS.at(-1); return { subject: m.subject, text: textOf(m.html) }; }
/** the page's view models on the same rows / settings */
const page = (rows, cfg) => {
  const s = srcOf({ rows, asOf: INV_AS_OF, config: present(cfg), fixed: present(FIXED) });
  return { pnl: C.pnl(F, s, "2026-09", null), dash: C.dashboard(F, s, { nowMs: INV_NOW_MS, lastYearSales: null }) };
};

test("DLVS-01 no rate configured: the snapshot and the e-mail are exactly as before (no estimate, the core profit)", async () => {
  seedTwo({});
  const s = await snap();
  assert.equal(s.financials.delivery, undefined); assert.equal("deliveryEstimate" in s, false);
  const p = page(ROWS, BASE);
  assert.equal(s.financials.amounts.operatingProfit.exact, p.pnl.report.actual.operatingProfit.value);
  const m = await email(s);
  assert.doesNotMatch(m.text, /משלוחים \(הערכה\)/); assert.doesNotMatch(m.text, /הערכה/);
});

test("DLVS-02 a rate change inside the month (10% → 14% from 15.09): server estimate = the page's P&L line; net profit = the page's net; projected profit = the Dashboard's; revenue / purchases / Food Cost unchanged", async () => {
  const cfg = withRates([v("2026-09-01", "10"), v("2026-09-15", "14", 2)]);
  seedTwo({ cfgA: cfg });
  const s = await snap(), p = page(ROWS, cfg), p0 = page(ROWS, BASE);
  const f = s.financials;
  assert.equal(n(f.delivery.amount.exact), 14 * 1200 * 0.10 + 14 * 1200 * 0.14);
  assert.equal(f.delivery.amount.exact, p.pnl.rows.delivery.amount, "server estimate = the page's P&L estimate");
  assert.equal(f.amounts.operatingProfit.exact, p.pnl.rows.net.amount, "net profit after the estimate = the page's P&L net");
  assert.equal(f.projection.operatingProfit.exact, p.dash.projectedProfit.amount, "projected profit = the Dashboard's");
  assert.equal(s.netProfit, n(p.pnl.rows.net.amount)); assert.equal(s.forecast, n(p.dash.projectedProfit.amount)); assert.equal(s.deliveryEstimate, n(p.pnl.rows.delivery.amount));
  // exactly once: core profit − estimate
  assert.equal(n(f.amounts.operatingProfit.exact), n(p0.pnl.rows.net.amount) - n(f.delivery.amount.exact));
  // preserved
  const s0 = (seedTwo({}), await snap());
  for (const k of ["revenue", "purchases", "laborEmployerCost", "fixedRegular", "rentFixed", "otherExpense"]) assert.deepEqual(f.amounts[k], s0.financials.amounts[k], k);
  assert.deepEqual(f.ratios.purchasesPct, s0.financials.ratios.purchasesPct, "Food Cost"); assert.equal(s.totalSales, s0.totalSales); assert.equal(s.totalFood, s0.totalFood);
  // the e-mail: a labelled estimate row, the explanation, and the profit (subject + KPI) including it
  seedTwo({ cfgA: cfg });
  const m = await email(await snap());
  assert.match(m.text, /עלות משלוחים \(הערכה\)/);
  assert.match(m.text, /עלות משלוחים היא הערכה \(לפי האחוז שבתוקף בכל יום \(10%, 14%\); אין חיבור למערכת משלוחים או קופה\)\. הרווח הנקי והרווח החזוי כוללים אותה פעם אחת/);
  assert.ok(m.subject.includes(F.presenters.money.formatShekel(p.pnl.rows.net.amount)), m.subject);
});

test("DLVS-03 missing revenue days: the estimate is on the recorded revenue (labelled partial with its coverage), equal to the page's; profit stays unavailable as before", async () => {
  const cfg = withRates([v("2026-09-01", "14")]);
  const rows = ROWS.filter((r) => r.date !== "2026-09-10");
  seedTwo({ cfgA: cfg, rowsA: rows });
  const s = await snap(), p = page(rows, cfg);
  assert.equal(s.financials.delivery.amount.exact, p.pnl.rows.delivery.amount);
  assert.equal(n(s.financials.delivery.amount.exact), 27 * 1200 * 0.14);
  assert.equal(s.financials.delivery.amount.state, "partial");
  assert.match(s.financials.delivery.note, /שהוזן \(27\/28 ימי הכנסה\)/);
  assert.equal(s.financials.amounts.operatingProfit.state, "unavailable", "an incomplete month has no complete profit (unchanged rule)");
  assert.equal(s.netProfit, null);
});

test("DLVS-04 business isolation: bizA's rate never reaches bizB (same tenant); bizB's snapshot equals a no-rate snapshot", async () => {
  seedTwo({ cfgA: withRates([v("2026-09-01", "14")]) });
  const b = await snap(B2), a = await snap(B);
  assert.equal(b.financials.delivery, undefined); assert.ok(a.financials.delivery);
  seedTwo({});
  const b0 = await snap(B2);
  assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(b0)));
});

test("DLVS-05 an invalid setting / invalid revenue: no estimate value and no profit (never 0); the note says why", async () => {
  seedTwo({ cfgA: { ...BASE, deliveryCost: { versions: [{ effectiveFrom: "2026-09-01", ratePct: "140", recordedAt: 1 }] } } });
  const s = await snap();
  assert.equal(s.financials.delivery.amount.exact, null); assert.equal(s.financials.amounts.operatingProfit.exact, null); assert.equal(s.netProfit, null);
  assert.match(s.financials.delivery.note, /הגדרת עלות המשלוחים אינה תקינה/);
  const p = page(ROWS, { ...BASE, deliveryCost: { versions: [{ effectiveFrom: "2026-09-01", ratePct: "140", recordedAt: 1 }] } });
  assert.equal(p.pnl.rows.net.text, "—", "the page withholds it too");
  const bad = ROWS.map((r, i) => (i === 3 ? day(r.date, { sales: "abc" }) : r));
  seedTwo({ cfgA: withRates([v("2026-09-01", "14")]), rowsA: bad });
  const s2 = await snap();
  assert.equal(s2.financials.delivery.amount.exact, null); assert.equal(page(bad, withRates([v("2026-09-01", "14")])).pnl.rows.delivery.text, "—");
});

test("DLVS-06 a rate that starts after the as-of date: no estimate yet, profit unchanged; the projection adds nothing", async () => {
  seedTwo({ cfgA: withRates([v("2026-10-01", "14")]) });
  const s = await snap(); seedTwo({});
  const s0 = await snap();
  assert.equal(s.financials.delivery, undefined);
  assert.equal(s.financials.amounts.operatingProfit.exact, s0.financials.amounts.operatingProfit.exact);
  assert.equal(s.financials.projection.operatingProfit.exact, s0.financials.projection.operatingProfit.exact);
});

test("DLVS-07 the server rule decodes exactly like the page's (versions, rate in force, invalid shapes)", () => {
  const cases = [undefined, null, "x", { versions: "x" }, { versions: [] }, { versions: [v("2026-09-01", "14")] }, { versions: [v("2026-09-01", "100")] }, { versions: [v("2026-09-01", "100.5")] },
    { versions: [v("2026-09-01", "05")] }, { versions: [v("2026-09-01", "13.50")] }, { versions: [v("2026-09-01", "13.5"), { effectiveFrom: "bad", ratePct: "1", recordedAt: 1 }] }, { versions: [{ effectiveFrom: "2026-09-01", ratePct: "1" }] }];
  for (const dc of cases) {
    const cfg = dc === undefined ? {} : { deliveryCost: dc };
    const a = DE.decodeDeliveryVersions(cfg), b = C.deliveryVersions(cfg);
    assert.equal(a.state, b.state, JSON.stringify(dc)); assert.equal(JSON.stringify(a.versions.map((x) => [x.effectiveFrom, x.ratePct])), JSON.stringify(b.versions.map((x) => [x.effectiveFrom, x.ratePct])), JSON.stringify(dc));
  }
  const vs = [v("2026-09-01", "10", 1), v("2026-09-15", "14", 2), v("2026-09-15", "13", 3)];
  for (const d of ["2026-08-31", "2026-09-01", "2026-09-14", "2026-09-15", "2026-12-01"]) {
    const a = DE.deliveryRateOn(vs, d), b = C.deliveryRateOn(vs, d);
    assert.equal(a && a.ratePct, b && b.ratePct, d);
  }
});

test("DLVS-08 the other server consumers carry no profit / expense / balance figure, so a configured rate leaves them identical: the stored daily analytics doc, the agent's month source (AI chat / proactive) and the alerts' month report", async () => {
  const DB = await srv.import("src/analytics/dailyBuilder.js");
  const AG = await srv.import("src/agent/financialMonthSource.js");
  const AL = await srv.import("src/alerts/alertMonthReport.js");
  const run = async (cfg) => {
    seedTwo({ cfgA: cfg });
    const doc = await DB.buildAnalyticsForBiz(T, B, "2026-09-20", { nowMs: INV_NOW_MS });
    const agent = await AG.loadAgentMonthSource(T, B, INV_NOW_MS);
    const alerts = await AL.loadAlertMonthReport(T, B, INV_NOW_MS);
    const strip = (x) => JSON.parse(JSON.stringify(x, (k, val) => (k === "config" || k === "configState" || k === "generatedAt" || k === "createdAt" || k === "builtAt" || k === "updatedAt" ? undefined : val)));
    return { doc: strip(doc), agentReport: strip(agent.report || agent), alerts: strip(alerts.report || alerts) };
  };
  const a = await run(BASE), b = await run(withRates([v("2026-09-01", "10"), v("2026-09-15", "14", 2)]));
  assert.deepEqual(b.doc, a.doc, "daily analytics doc (revenue, food cost, labor) identical");
  assert.deepEqual(b.agentReport, a.agentReport, "agent / AI-chat month report identical");
  assert.deepEqual(b.alerts, a.alerts, "alerts month report identical");
  assert.equal(JSON.stringify(a.doc).includes("deliveryEstimate"), false);
});
