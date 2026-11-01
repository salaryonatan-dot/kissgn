// PNL-AVAIL (server) — the morning snapshot e-mail of an INCOMPLETE month keeps the valid recorded amounts and shows the
// page's recorded-data balance ("יתרה לפי הנתונים שהוזנו", never net profit), with the quiet basis note, the missing
// components named (never ₪0) and the delivery estimate included once; checked figure-for-figure against the page's
// P&L view model (index.html window.MarjinC1.pnl) on the same rows. Synthetic data only; sendEmail captured, never sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { srv, SE, textOf } from "../support/b2-email-harness.mjs";
import { makeDb, installDb } from "../support/server-reader-harness.mjs";
import { env, T, B, configWithGlobal, fixedItems } from "../support/b1-fixtures.mjs";
import { INV_NOW_MS, INV_AS_OF } from "../support/financial-invariants.mjs";
import { loadFinance, loadSeam, present, row, srcOf } from "../support/c1-seam.mjs";

const SB = await srv.import("src/snapshot/snapshotBuilder.js");
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
async function email(snapshot) { await SE.sendSnapshotEmail("owner@example.test", snapshot); const m = globalThis.__EMAILS.at(-1); return { subject: m.subject, text: textOf(m.html), html: m.html }; }
/** the page's view models on the same rows / settings */
const page = (rows, cfg) => {
  const s = srcOf({ rows, asOf: INV_AS_OF, config: present(cfg), fixed: present(FIXED) });
  return { pnl: C.pnl(F, s, "2026-09", null), dash: C.dashboard(F, s, { nowMs: INV_NOW_MS, lastYearSales: null }) };
};


const kpi = (text, label) => { const i = text.indexOf(label); return i < 0 ? null : text.slice(i, i + label.length + 40); };
const missingDay = ROWS.filter((r) => r.date !== "2026-09-10");
async function both(rows, cfg) { seedTwo({ rowsA: rows, cfgA: cfg }); const s = await snap(); return { s, m: await email(s), p: page(rows, cfg).pnl }; }

test("AVAIL-01 missing revenue day, no rate: the e-mail shows the page's recorded-data balance, labelled as such, with the quiet basis note; no complete-profit claim", async () => {
  const { s, m, p } = await both(missingDay, BASE);
  assert.equal(p.netLabel, "יתרה לפי הנתונים שהוזנו");
  const av = s.financials.available;
  assert.equal(av.balance.exact, p.rows.net.amount, "balance = the page's P&L balance");
  assert.equal(n(av.balance.exact), 27 * 1200 - 27 * 300 - n(p.rows.labor.amount) - n(p.rows.fixedRent.amount) - n(p.rows.royalty.amount));
  assert.equal(av.labor.exact, p.rows.labor.amount, "known labor visible"); assert.equal(av.labor.state, "partial");
  assert.match(m.text, new RegExp("יתרה לפי הנתונים שהוזנו " + F.presenters.money.formatShekel(p.rows.net.amount).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(m.text, /השורה התחתונה היא יתרה לפי הנתונים שהוזנו ואינה רווח נקי/);
  assert.match(m.text, /מחושב מהנתונים שהוזנו: 27\/28 ימי הכנסה, 27\/28 ימי קניות, 27\/28 ימי עלות עובדים שעתית/);
  assert.match(m.html, /<div class="forecast-label">מחושב מהנתונים שהוזנו/, "a quiet note, not an alert");
  // no complete-profit claim anywhere
  assert.equal(s.financials.amounts.operatingProfit.state, "unavailable"); assert.equal(s.netProfit, null);
  assert.match(m.subject, /רווח: —$/); assert.doesNotMatch(m.text, /רווח נקי ₪/);
  assert.match(kpi(m.text, "עלות עובדים"), /₪5,500 \(חלקי\)/);
});

test("AVAIL-02 missing revenue day + a rate change inside the month: the balance includes the estimate once and equals the page's; the note says the balance includes it", async () => {
  const cfg = withRates([v("2026-09-01", "10"), v("2026-09-15", "14", 2)]);
  const { s, m, p } = await both(missingDay, cfg), b0 = await both(missingDay, BASE);
  assert.equal(s.financials.available.balance.exact, p.rows.net.amount);
  assert.equal(n(s.financials.available.balance.exact), n(b0.s.financials.available.balance.exact) - n(s.financials.delivery.amount.exact), "exactly once");
  assert.match(m.text, /עלות משלוחים \(הערכה\)/); assert.match(m.text, /היתרה לפי הנתונים שהוזנו כוללת אותה פעם אחת/);
  assert.doesNotMatch(m.text, /הרווח הנקי והרווח החזוי כוללים/);
  for (const k of ["revenue", "purchases"]) assert.deepEqual(s.financials.amounts[k], b0.s.financials.amounts[k], k);
});

test("AVAIL-03 percentage royalty with a missing revenue day: royalty on the recorded revenue (the page's recorded accrual), shown partial; balance = the page's", async () => {
  const cfg = { ...BASE, hasRoyalty: true, royaltyPct: 7 };
  const { s, m, p } = await both(missingDay, cfg);
  assert.equal(s.financials.amounts.royalty.state, "unavailable", "the core still withholds the complete accrual");
  assert.equal(s.financials.available.royalty.exact, p.rows.royalty.amount); assert.equal(n(p.rows.royalty.amount), 0.07 * 27 * 1200);
  assert.equal(s.financials.available.royalty.state, "partial");
  assert.equal(s.financials.available.balance.exact, p.rows.net.amount);
  assert.match(m.text, /אחוזי שכ״ד ותמלוגים לפי ההכנסות שהוזנו/);
  assert.match(kpi(m.text, "תמלוגים"), /₪2,268 \(חלקי\)/);
});

test("AVAIL-04 a component with nothing recorded is named and excluded, never ₪0: no payroll at all ⇒ labor '—', balance without it", async () => {
  const rows = missingDay.map((r) => day(r.date, { payroll: undefined }));
  const { s, m, p } = await both(rows, BASE);
  assert.equal(s.financials.available.labor.exact, null); assert.equal(p.rows.labor.text, "—");
  assert.equal(s.financials.available.balance.exact, p.rows.net.amount);
  assert.match(m.text, /היתרה אינה כוללת: עלות עובדים \(לא הוזנו נתונים\)/);
  assert.match(kpi(m.text, "עלות עובדים"), /^עלות עובדים — /);
});

test("AVAIL-05 invalid data withholds the balance (never 0): the row stays 'רווח נקי —' and the note says why; the page withholds it too", async () => {
  const rows = missingDay.map((r, i) => (i === 3 ? day(r.date, { supplier_payments: { s1: "12,5" } }) : r));
  const { s, m, p } = await both(rows, BASE);
  assert.equal(s.financials.available.balance.exact, null); assert.equal(s.financials.available.invalid, true); assert.equal(p.rows.net.text, "—");
  assert.match(m.text, /רווח נקי — — /); assert.doesNotMatch(m.text, /יתרה לפי הנתונים שהוזנו ₪/);
  assert.match(m.text, /בחודש יש נתונים לא תקינים — הסעיפים שלהם מוצגים כ־"—" והיתרה לא מחושבת/);
  const inv = await both(missingDay, { ...BASE, deliveryCost: { versions: [{ effectiveFrom: "2026-09-01", ratePct: "140", recordedAt: 1 }] } });
  assert.equal(inv.s.financials.available.balance.exact, null, "an invalid delivery setting withholds the balance"); assert.equal(inv.p.rows.net.text, "—");
});

test("AVAIL-06 a complete month is unchanged (no available block, the core's net profit); business isolation: bizB complete while bizA is incomplete", async () => {
  seedTwo({ rowsA: missingDay });
  const b = await snap(B2), a = await snap(B);
  assert.equal(b.financials.available, undefined); assert.ok(a.financials.available);
  assert.equal(b.financials.amounts.operatingProfit.state, "complete");
  const m = await email(b); assert.match(m.text, /רווח נקי ₪/); assert.doesNotMatch(m.text, /יתרה לפי הנתונים שהוזנו/);
});

test("AVAIL-07 missing revenue days only: a QUIET dated coverage note directly below revenue (no ⚠, no alert); invalid revenue and a closed day with revenue keep the visible warning", async () => {
  const quiet = await both(missingDay, BASE);
  assert.match(quiet.m.text, /חסרות הכנסות בימים: 10\.09 — ההכנסות לפי הימים שהוזנו/);
  assert.doesNotMatch(quiet.m.html, /role="alert"|kpi-cell kpi-warning/); assert.doesNotMatch(quiet.m.text, /⚠/);
  const bad = ROWS.map((r, i) => (i === 3 ? day(r.date, { sales: "abc" }) : r));
  const loud = await both(bad, BASE);
  assert.match(loud.m.html, /<td class="kpi-cell kpi-warning" colspan="3" role="alert">⚠ הכנסה חלקית \(תא לא תקין\) בימים: 04\.09/);
  const both2 = await both(bad.filter((r) => r.date !== "2026-09-10"), BASE);
  assert.match(both2.m.html, /role="alert">⚠ הכנסה חלקית \(תא לא תקין\) בימים: 04\.09/, "an invalid cell stays a warning");
  assert.match(both2.m.html, /kpi-note" colspan="3">חסרות הכנסות בימים: 10\.09/, "the missing day alongside it is the quiet note");
});

test("AVAIL-08 compatibility: the available block never reads as net profit — legacy netProfit stays null, operatingProfit unavailable, the balance is 'partial' with reason recorded_data_balance, no net-profit insight, subject 'רווח: —'; no rate ⇒ no delivery row or field", async () => {
  const { s, m } = await both(missingDay, BASE);
  const av = s.financials.available;
  assert.equal(s.netProfit, null); assert.equal(s.financials.amounts.operatingProfit.exact, null);
  assert.deepEqual([av.balance.state, av.balance.reason], ["partial", "recorded_data_balance"]);
  assert.equal(s.insights.some((i) => i.rule === "net_profit"), false);
  assert.match(m.subject, /רווח: —$/);
  assert.equal(s.financials.delivery, undefined); assert.equal("deliveryEstimate" in s, false);
  assert.doesNotMatch(m.text, /משלוחים/);
  // the run endpoint's response reads only the legacy fields (netProfit / totalSales), never `financials.available`
  const run = (await import("node:fs")).readFileSync(new URL("../../api/daily-snapshot/run.ts", import.meta.url), "utf8");
  assert.doesNotMatch(run, /available\./); assert.match(run, /netProfit: snapshot\.netProfit/);
});
