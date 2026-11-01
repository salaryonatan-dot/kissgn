// FIXCAT — fixed-expense categories over the F2 cost history.
// The page's pure helpers (window.MarjinFixedCat, extracted from index.html) + the REAL trusted writer
// (lib/finance/costHistoryWriter.js through the F1 writer harness) + the shared core view models
// (window.MarjinC1 via the C1 seam). Activation records the legacy settings as today's activation AND an
// attested baseline from the compat start date, so earlier periods keep their results; category changes
// are an effective-dated version on top. Synthetic, isolated data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { makeDb } from "../../tools/storage-v2/reader-sandbox.mjs";
import { loadWriter } from "../support/f1-writer-harness.mjs";
import { REPO } from "../support/fincore-load.mjs";
import { attestationDigest } from "../../lib/finance/costHistoryWriter.js";
import { loadFinance, loadSeam, present, row, srcOf, ledgerOf } from "../support/c1-seam.mjs";

const html = readFileSync(join(REPO, "index.html"), "utf8");
const a = html.indexOf("// FIXCAT-BEGIN"), b = html.indexOf("// FIXCAT-END");
assert.ok(a > 0 && b > a, "index.html carries the FIXCAT helper block");
const box = { window: {} }; new Function("window", html.slice(a, b))(box.window);   // same realm: plain objects / arrays compare structurally
const FC = box.window.MarjinFixedCat;
const W = await loadWriter(REPO), F = await loadFinance(), C = loadSeam();
const T = "tenantA", B = "bizA", B2 = "bizB", BIND = { tenantId: T, bizId: B };
const plain = (x) => JSON.parse(JSON.stringify(x));

const CONFIG = { employees: [{ id: "g1", name: "מנהלת", type: "global", monthlySalary: 3100 }], rentType: "fixed", rentFixed: 4000, hasRoyalty: true, royaltyPct: 7 };
const FIXED = [{ id: 11, name: "חשמל", amount: 1500, dueDay: 1 }, { id: 12, name: "ארנונה", amount: 2000, dueDay: 5 },
  { id: 13, name: "מבוטל", amount: 999, disabled: true }, { id: "rent", name: "שכ״ד", rentPct: true }];

function world(nowIso) {
  let now = Date.parse(nowIso);
  const db = makeDb();
  for (const biz of [B, B2]) { db.seed(`tenants/${T}/biz_access/${biz}/owner`, true); }
  db.seed(`tenants/${T}/members/owner`, true); db.seed(`tenants/${T}/roles/owner`, "owner");
  db.seed(`tenants/${T}/app/business`, { _v: JSON.stringify([{ id: B, name: "A" }, { id: B2, name: "B" }]) });
  globalThis.__DB = db; globalThis.__CLAIMS = { uid: "owner", email: "o@x" };
  const w = W.createCostHistoryWriter({ db, clock: () => now });
  return { db, w, tick: (ms = 1000) => { now += ms; } };
}
const req = { headers: {} };
/** the editor's activation plan, step for step: activate (today, legacy) → attested baseline (legacy) → optional change */
async function activateLikeEditor(env, today, legacy, change, biz = B) {
  const { w, tick } = env;
  const act = await w.activateCostHistory(req, { tenantId: T, bizId: biz, body: { versionId: randomUUID(), expectedHead: null, effectiveFrom: today, basis: "recorded", ...plain(legacy) } });
  assert.equal(act.status, "committed_current"); tick();
  const bb = { versionId: randomUUID(), expectedHead: act.head, effectiveFrom: FC.BASELINE_FROM, basis: "attested_retroactive", ...plain(legacy), attestationReason: FC.BASELINE_REASON };
  bb.attestation = { confirmed: true, typedEffectiveFrom: FC.BASELINE_FROM, confirmedSnapshotDigest: attestationDigest(bb) };
  const base = await w.attestHistoricalCostEdit(req, { tenantId: T, bizId: biz, body: bb });
  assert.equal(base.status, "committed_current", JSON.stringify(base)); tick();
  if (!change) return base.head;
  const ed = await w.recordCostEdit(req, { tenantId: T, bizId: biz, body: { versionId: randomUUID(), expectedHead: base.head, basis: "recorded", ...plain(change) } });
  assert.equal(ed.status, "committed_current", JSON.stringify(ed)); tick();
  return ed.head;
}
const history = (env, biz = B) => F.costHistory.codec.decodeHistory({ exists: true, value: env.db.read(`tenants/${T}/biz:${biz}:cost_history`) }, { tenantId: T, bizId: biz });
let seq = 1;
const uid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const monthDays = (m, n) => Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`);
const day = (d, o = {}) => row(d, { sales: "1000", deliveries: "0", other_income: "0", supplier_payments: { s1: "300" }, payroll: "100", other_expense: "0", ...o }, uid());
const ROWS = [...monthDays("2026-09", 30), ...monthDays("2026-10", 31), ...monthDays("2026-11", 30)].map((d) => day(d));
const src = (asOf, costHistory, rows = ROWS, extra = {}) => ({ ...srcOf({ rows: rows.filter((r) => r.date < asOf), asOf, config: present(CONFIG), fixed: present(FIXED) }), ...(costHistory ? { costHistory } : {}), ...extra });
const pnl = (s, m) => C.pnl(F, s, m, null);
const dash = (s, asOf) => C.dashboard(F, s, { nowMs: Date.parse(asOf + "T08:00:00Z"), lastYearSales: null });

test("FIXCAT-01 amounts: typed values become canonical decimal strings; negatives, text and > 2 decimals are refused", () => {
  for (const [x, y] of [["1500", "1500"], ["1,500", "1500"], ["₪ 1,500.50", "1500.5"], ["0", "0"], ["007", "7"], ["12.30", "12.3"], ["12.", "12"], [1500, "1500"]]) assert.equal(FC.normalizeAmount(x), y, String(x));
  for (const x of ["", "-5", "abc", "1.234", "1e3", null, undefined, "1 0 0x"]) assert.equal(FC.normalizeAmount(x), null, String(x));
});

test("FIXCAT-02 legacy snapshot: exactly the compat version (disabled / rent / royalty markers excluded) with the legacy category names; unclean legacy settings → null", () => {
  const s = FC.legacySnapshot(F, present(CONFIG), present(FIXED));
  assert.deepEqual(plain(s.fixedItems), [{ itemKey: "11", name: "חשמל", monthlyAmount: "1500" }, { itemKey: "12", name: "ארנונה", monthlyAmount: "2000" }]);
  assert.deepEqual(plain(s.rent), { mode: "fixed", monthlyAmount: "4000" }); assert.deepEqual(plain(s.royalty), { mode: "pct", ratePct: "7" });
  assert.deepEqual(plain(s.globalEmployees), [{ employeeKey: "g1", monthlyEmployerCost: "3100" }]);
  const compat = F.metrics.adapters.configCompat.costTimelineFromCurrentConfig(CONFIG, FIXED).versions[0];
  assert.deepEqual(s.fixedItems.map((f) => [f.itemKey, f.monthlyAmount]), compat.fixedItems.map((f) => [f.itemKey, f.monthlyAmount]), "same amounts as the reports use today");
  assert.equal(FC.legacySnapshot(F, present(CONFIG), present([{ id: 1, name: "x", amount: "abc" }])), null, "invalid legacy amount: no activation basis");
  assert.equal(FC.legacySnapshot(F, present(CONFIG), present([{ id: 1, name: "x" }])), null, "missing legacy amount");
  assert.equal(FC.legacySnapshot(F, { state: "loading" }, present(FIXED)), null);
});

test("FIXCAT-03 validation and change summary: names required and unique, amounts valid; added / renamed / amount-changed / removed by item key", () => {
  const v = FC.validateItems([{ itemKey: "a", name: " חשמל ", monthlyAmount: "1,600" }, { itemKey: "b", name: "", monthlyAmount: "5" }, { itemKey: "c", name: "חשמל", monthlyAmount: "-1" }]);
  assert.deepEqual(plain(v.items[0]), { itemKey: "a", name: "חשמל", monthlyAmount: "1600" });
  assert.deepEqual(v.errors.map((e) => `${e.index}:${e.code}`), ["1:name_required", "2:name_duplicate", "2:amount_invalid"]);
  const before = [{ itemKey: "11", name: "חשמל", monthlyAmount: "1500" }, { itemKey: "12", name: "ארנונה", monthlyAmount: "2000" }];
  const after = [{ itemKey: "11", name: "חשמל ומים", monthlyAmount: "1700" }, { itemKey: "n1", name: "אינטרנט", monthlyAmount: "250" }];
  const d = FC.diffItems(before, after);
  assert.equal(d.any, true);
  assert.deepEqual(d.added.map((x) => x.name), ["אינטרנט"]); assert.deepEqual(d.removed.map((x) => x.name), ["ארנונה"]);
  assert.deepEqual(plain(d.renamed), [{ itemKey: "11", from: "חשמל", to: "חשמל ומים" }]); assert.deepEqual(d.amountChanged.map((x) => [x.from, x.to]), [["1500", "1700"]]);
  assert.equal(FC.diffItems(before, before.map((x) => ({ ...x }))).any, false);
  assert.equal(FC.sameSnapshot({ ...FC.legacySnapshot(F, present(CONFIG), present(FIXED)) }, FC.legacySnapshot(F, present(CONFIG), present([...FIXED].reverse()))), true, "order-independent");
});

test("FIXCAT-04 in-force version: greatest effective date ≤ the day, latest recording on the same date; later versions are scheduled", () => {
  const vs = [{ versionId: "v1", effectiveFrom: "0000-01-01", recordedAt: 2 }, { versionId: "v2", effectiveFrom: "2026-11-01", recordedAt: 1 },
    { versionId: "v3", effectiveFrom: "2026-11-01", recordedAt: 3 }, { versionId: "v4", effectiveFrom: "2026-12-01", recordedAt: 4 }];
  assert.equal(FC.inForce(vs, "2026-10-31").versionId, "v1"); assert.equal(FC.inForce(vs, "2026-11-15").versionId, "v3");
  assert.equal(FC.inForce(vs, "2027-01-01").versionId, "v4"); assert.deepEqual(FC.scheduledAfter(vs, "2026-11-15").map((v) => v.versionId), ["v4"]);
});

test("FIXCAT-05 activation without changes keeps every result: past months, the current month and the Dashboard equal the legacy settings", async () => {
  const env = world("2026-11-11T08:00:00Z");
  const legacy = FC.legacySnapshot(F, present(CONFIG), present(FIXED));
  await activateLikeEditor(env, "2026-11-11", legacy, null);
  const h = history(env);
  assert.equal(h.state, "present"); assert.deepEqual(h.versions.map((v) => v.effectiveFrom).sort(), ["0000-01-01", "2026-11-11"]);
  for (const asOf of ["2026-11-11", "2026-11-25"]) {
    for (const m of ["2026-09", "2026-10", "2026-11"]) {
      const p0 = pnl(src(asOf, null), m), p1 = pnl(src(asOf, h), m);
      for (const k of ["fixedRent", "royalty", "labor", "net"]) assert.equal(p1.rows[k].text, p0.rows[k].text, `${asOf} ${m} ${k}`);
    }
    const d0 = dash(src(asOf, null), asOf), d1 = dash(src(asOf, h), asOf);
    assert.equal(d1.fixedRent.text, d0.fixedRent.text); assert.equal(d1.royalty.text, d0.royalty.text); assert.equal(d1.labor.text, d0.labor.text);
    assert.deepEqual(d1.breakdown.map((x) => x.text), d0.breakdown.map((x) => x.text)); assert.equal(d1.projectedProfit.text, d0.projectedProfit.text);
  }
  assert.deepEqual([...pnl(src("2026-11-11", h), "2026-10").configurationBasis], ["attested_retroactive"], "the source of the past is named honestly");
});

test("FIXCAT-06 add, rename, change amount, remove from 2026-11-15: stored version reads back exactly; earlier dates unchanged, later dates use the new categories; Dashboard = P&L", async () => {
  const env = world("2026-11-11T08:00:00Z");
  const legacy = FC.legacySnapshot(F, present(CONFIG), present(FIXED));
  const items = FC.validateItems([{ itemKey: "11", name: "חשמל ומים", monthlyAmount: "1,800" }, { itemKey: "n1", name: "אינטרנט", monthlyAmount: "300" }]).items;  // ארנונה removed
  await activateLikeEditor(env, "2026-11-11", legacy, { ...plain(legacy), effectiveFrom: "2026-11-15", fixedItems: items });
  const stored = env.db.read(`tenants/${T}/biz:${B}:cost_history`);
  const change = Object.values(stored.versions).find((v) => v.effectiveFrom === "2026-11-15");
  assert.deepEqual(change.fixedItems, [{ itemKey: "11", name: "חשמל ומים", monthlyAmount: "1800" }, { itemKey: "n1", name: "אינטרנט", monthlyAmount: "300" }], "read back as saved");
  assert.equal(change.fixedItemsCount, 2); assert.equal(change.basis, "recorded");
  const h = history(env);
  // September / October: the full legacy month, exactly as before
  for (const m of ["2026-09", "2026-10"]) assert.equal(pnl(src("2026-11-30", h), m).rows.fixedRent.text, pnl(src("2026-11-30", null), m).rows.fixedRent.text, m);
  // November: 1–14 at 3500/month regular (legacy), 15–30 at 2100/month; fixed rent 4000/month throughout
  const nov = pnl(src("2026-12-01", h), "2026-11");
  const expectRegular = 3500 * 14 / 30 + 2100 * 16 / 30;
  assert.equal(nov.rows.fixedRent.text, "₪" + Math.round(expectRegular + 4000).toLocaleString("en-US"), "P&L fixed + rent for November");
  const nAcc = nov.report.actual.fixedAccrual;
  assert.ok(Math.abs(Number(F.metrics.adapters.legacyNumber.amountToNumber(nAcc.regular)) - expectRegular) < 1e-6, nAcc.regular);
  // December (after the change): the new categories only
  const rowsDec = [...ROWS, ...monthDays("2026-12", 31).map((d) => day(d))];
  const dec = pnl(src("2027-01-01", h, rowsDec), "2026-12");
  assert.equal(F.metrics.adapters.legacyNumber.amountToNumber(dec.report.actual.fixedAccrual.regular), 2100);
  // the day before / on the effective date
  const before = pnl(src("2026-11-15", h), "2026-11").report.actual.fixedAccrual, before0 = pnl(src("2026-11-15", null), "2026-11").report.actual.fixedAccrual;
  assert.equal(before.regular, before0.regular, "through 14.11 identical to legacy");
  // Dashboard and P&L agree for the open month, also with missing revenue days
  for (const rows of [ROWS, ROWS.map((r) => (r.date >= "2026-11-20" ? day(r.date, { sales: "", deliveries: "", other_income: "" }) : r))]) {
    const asOf = "2026-11-28", s = src(asOf, h, rows), d = dash(s, asOf), p = pnl(s, "2026-11");
    assert.equal(d.fixedRent.text, p.rows.fixedRent.text, "fixed + rent"); assert.equal(d.royalty.text, p.rows.royalty.text, "royalty");
    const reg = d.report.actual.fixedAccrual.state === "complete" ? d.report.actual.fixedAccrual.regular : null;
    const bdFixed = d.breakdown.find((x) => x.key === "fixed").text;
    assert.match(bdFixed, /^₪[\d,]+$/, "the breakdown shows the regular fixed categories once: " + bdFixed);
    if (reg !== null) assert.equal(bdFixed, F.presenters.money.formatShekel(reg));
  }
});

test("FIXCAT-07 business isolation: a history is bound to its tenant / business; another business keeps its legacy settings", async () => {
  const env = world("2026-11-11T08:00:00Z");
  const legacy = FC.legacySnapshot(F, present(CONFIG), present(FIXED));
  await activateLikeEditor(env, "2026-11-11", legacy, { ...plain(legacy), effectiveFrom: "2026-11-11", fixedItems: [] });
  assert.equal(env.db.read(`tenants/${T}/biz:${B2}:cost_history`), null, "bizB untouched");
  const wrong = F.costHistory.codec.decodeHistory({ exists: true, value: env.db.read(`tenants/${T}/biz:${B}:cost_history`) }, { tenantId: T, bizId: B2 });
  assert.equal(wrong.state, "unreadable", "bizA's history never decodes as bizB's");
  const p = pnl(src("2026-11-20", null), "2026-10");
  assert.equal(p.configurationBasis[0], "current_applied_retrospectively");
});

test("FIXCAT-08 a removed category stays in the earlier versions (history kept), and a past effective date needs the attested path", async () => {
  const env = world("2026-11-11T08:00:00Z");
  const legacy = FC.legacySnapshot(F, present(CONFIG), present(FIXED));
  const head = await activateLikeEditor(env, "2026-11-11", legacy, { ...plain(legacy), effectiveFrom: "2026-11-11", fixedItems: legacy.fixedItems.filter((f) => f.itemKey !== "12") });
  const stored = env.db.read(`tenants/${T}/biz:${B}:cost_history`);
  const base = Object.values(stored.versions).find((v) => v.effectiveFrom === FC.BASELINE_FROM);
  assert.deepEqual(base.fixedItems.map((f) => f.name), ["חשמל", "ארנונה"], "the baseline still carries ארנונה");
  const past = await env.w.recordCostEdit(req, { tenantId: T, bizId: B, body: { versionId: randomUUID(), expectedHead: head, effectiveFrom: "2026-11-01", basis: "recorded", ...plain(legacy) } });
  assert.equal(past.status, "recorded_past_date", "a normal edit cannot rewrite the past");
});

test("FIXCAT-09 closures: full past months equal the legacy result; in the activation month the core splits the month at the activation date (eligible-day allocation per version)", async () => {
  const env = world("2026-11-11T08:00:00Z");
  const legacy = FC.legacySnapshot(F, present(CONFIG), present(FIXED));
  await activateLikeEditor(env, "2026-11-11", legacy, null);
  const h = history(env);
  const ledger = ledgerOf(C.structuredStates({ "2026-10-05": { source: "structured", status: "active", reasonCode: "closure" }, "2026-11-03": { source: "structured", status: "active", reasonCode: "closure" } }), "2000-01-01", "2100-12-31");
  const rows = ROWS.filter((r) => r.date !== "2026-10-05" && r.date !== "2026-11-03");
  const s0 = src("2026-12-01", null, rows, { ledger }), s1 = src("2026-12-01", h, rows, { ledger });
  for (const m of ["2026-10", "2026-11"]) assert.equal(pnl(s1, m).rows.fixedRent.text, pnl(s0, m).rows.fixedRent.text, "full month " + m);
  const mtd0 = pnl(src("2026-11-11", null, rows, { ledger }), "2026-11").report.actual.fixedAccrual.regular;
  const mtd1 = pnl(src("2026-11-11", h, rows, { ledger }), "2026-11").report.actual.fixedAccrual.regular;
  const n = (x) => F.metrics.adapters.legacyNumber.amountToNumber(x);
  assert.ok(Math.abs(n(mtd0) - 3500 * 9 / 29) < 1e-6, "legacy: 9 eligible of 29");
  assert.ok(Math.abs(n(mtd1) - 3500 * 10 / 30) < 1e-6, "history: segment 1–10 of 30 days");
});
