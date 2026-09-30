// snapshotBuilder: legacy-vs-V2 financial equivalence (canonical open month), poison, malformed, D1 aggregation, D3 isolation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileServer, makeDb, installDb, seedBusiness, offlineFetch, T, B } from "../support/server-reader-harness.mjs";
import { asLegacy, asV2, malformedNodes, plain, row, canonical } from "../support/entries-fixtures.mjs";

offlineFetch();
const srv = compileServer();
const SB = await srv.import("src/snapshot/snapshotBuilder.js");
const R = await import("../../lib/analytics/entriesReader.js");
// Financial Core B2: the builder reports the canonical open month of an INJECTED clock
// (asOf 2026-09-29 ⇒ Actual = completed days 09-01…09-28, VD-30); expectations are the
// canonical values (VD-31 hourly_payroll never counted, VD-04 a duplicate date is ONE day,
// VD-28r global by calendar day, VD-16 supplier map per row).
const NOW = Date.UTC(2026, 8, 29, 9);
const month = "2026-09";
const d = (n) => `${month}-${String(n).padStart(2, "0")}`;
const monthRows = (n = 12) => Array.from({ length: n }, (_, i) => row("m" + i, d(i + 1), { sales: String(1000 + i * 10), deliveries: String(i), other_income: i % 3 ? "0" : "7", supplier_payments: { s1: String(100 + i), s2: i % 2 ? "skip" : "5" }, hourly_payroll: { e1: 40 + i }, payroll: "10", other_expense: "3" }));
const config = { rentType: "pct", rentPct: 8, hasRoyalty: true, royaltyPct: 4, targetSales: 500000, targetFoodCost: 30, targetLabor: 25, employees: [{ type: "global", monthlySalary: 9000 }] };
const fixed = [{ amount: 1000 }, { amount: 500, disabled: true }, { amount: 700, rentPct: 1 }];
const strip = (s) => { const x = plain(s); delete x.date; return x; };
async function snap(node, extra = {}) { const db = installDb(makeDb()); seedBusiness(db, { entries: node, config, fixed, ...extra }); return { db, s: await SB.buildSnapshotForBiz(T, B, { nowMs: NOW }) }; }

test("equivalence: same month rows in both physical forms → identical financial snapshot; canonical values hold", async () => {
  const rows = [...monthRows(12), row("old", "2025-12-31", { sales: "99999" })];
  const a = (await snap(asLegacy(rows))).s, b = (await snap(asV2(rows, { keepV: true }))).s;
  assert.deepEqual(strip(b), strip(a));
  const inMonth = rows.filter((r) => r.date.startsWith(month));
  const expSales = inMonth.reduce((s, r) => s + Number(r.sales) + Number(r.deliveries) + Number(r.other_income), 0);
  assert.equal(a.financials.amounts.revenue.exact, String(expSales));
  assert.equal(a.financials.amounts.revenue.state, "partial", "12 of 28 completed days entered — a partial sum, never a complete month");
  assert.equal(a.daysPassed, 28, "calendar days through D-1 (VD-21), not entry rows"); assert.equal(a.presentDays, 12);
  const expFood = inMonth.reduce((s, r) => s + Object.values(r.supplier_payments).reduce((x, v) => x + (Number(v) || 0), 0), 0);
  assert.equal(a.financials.amounts.purchases.exact, String(expFood), "supplier map per row; 'skip' is a recorded zero");
  assert.equal(a.totalPayroll, null, "missing payroll days ⇒ labor unavailable (C-14), and hourly_payroll is never counted (VD-31)");
  assert.equal(a.netProfit, null, "a partial month has no complete profit (FC-01)");
  assert.equal(a.bizName, "Biz " + B);
  const empty = (await snap(asLegacy([]))).s, emptyV2 = (await snap(asV2([]))).s; assert.deepEqual(strip(emptyV2), strip(empty)); assert.equal(empty.presentDays, 0);
  assert.equal(empty.totalSales, null, "no entries ⇒ revenue unavailable, never 0");
  const absent = (await snap(null)).s; assert.equal(absent.totalSales, null);
});
test("native V2 without `_v`; numeric-key maps read back as arrays give the identical snapshot (shared core readback rule)", async () => {
  const rows = [row("nm", d(1), { sales: "10", payroll: "5", supplier_payments: { "0": "3", "1": "4" }, hourly_payroll: { "0": 10, "1": 20 } })];
  const v2 = await snap(asV2(rows));
  const rt = plain(v2.db.read(`tenants/${T}/biz:${B}:entries`)); const id = rows[0].id; rt.rows[id].hourly_payroll = [10, 20]; rt.rows[id].supplier_payments = ["3", "4"]; // RTDB readback shape
  const v2arr = await snap(rt); assert.deepEqual(strip(v2arr.s), strip(v2.s));
  assert.equal(v2.s.financials.amounts.purchases.exact, "7");
  assert.equal(v2.s.financials.amounts.hourlyEmployerCost.exact, "5", "payroll only; hourly_payroll [10, 20] not counted");
});
test("NO-FALLBACK poison: rows say 555, stale `_v` says 100/500 + an extra row → snapshot from rows", async () => {
  const current = [row("p1", d(3), { sales: "555" })];
  const stale = [row("p1", d(3), { sales: "100" }), row("p2", d(3), { sales: "500" }), row("p3", d(4), { sales: "9999" })];
  const { s } = await snap(asV2(current, { poisonV: JSON.stringify(stale) }));
  assert.equal(s.financials.amounts.revenue.exact, "555"); assert.equal(s.presentDays, 1);
});
test("D1: duplicate business dates are ONE aggregated day (VD-04) — every row summed — in both forms", async () => {
  const rows = [row("d1", d(5), { sales: "100" }), row("d2", d(5), { sales: "500" }), row("d3", d(6), { sales: "7" })];
  const a = (await snap(asLegacy(rows))).s, b = (await snap(asV2(rows))).s;
  assert.deepEqual(strip(b), strip(a)); assert.equal(a.financials.amounts.revenue.exact, "607"); assert.equal(a.presentDays, 2, "two business dates");
});
test("MALFORMED V2: typed error, no email path; buildSnapshotForAll skips the bad business and keeps the healthy one", async () => {
  for (const [name, node] of Object.entries(malformedNodes())) {
    const db = installDb(makeDb()); seedBusiness(db, { entries: node, config, fixed });
    await assert.rejects(() => SB.buildSnapshotForBiz(T, B), (e) => R.isEntriesStorageError(e) && e.site === "snapshotBuilder", name);
    assert.deepEqual(globalThis.__EMAILS, [], name);
  }
  const db = installDb(makeDb());
  const biz = [["good", asV2(monthRows(3))], ["bad", malformedNodes().gen_mismatch]];
  for (const [b, node] of biz) seedBusiness(db, { biz: b, entries: node, config, fixed, businesses: biz.map(([x]) => ({ id: x, name: "Biz " + x })) });
  db.seed("proactive_biz_index", Object.fromEntries(biz.map(([b]) => [`${T}_${b}`, { tenantId: T, bizId: b, active: true }])));
  const all = await SB.buildSnapshotForAll();
  assert.deepEqual(all.map((s) => s.bizId), ["good"], "the malformed business is skipped, the healthy one built");
});
