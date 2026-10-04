// P1 Supplier Credits — the canonical SERVER API (src/finance-server/*) consumers.
//   P1S-01 the loader ALWAYS reads the credit node once; unreadable / invalid are input issues; a rejected read propagates
//   P1S-02 month report / provenance: net purchases, credits contract + node state in the provenance
//   P1S-03 per-day purchase records: amount NET, grossAmount and creditsAmount reconcile
//   P1S-04 analytics fin block: credit facts only on credit dates; absent credits ⇒ byte-identical block
//   P1S-05 daily series (analytics / Agent input) foodCost is net on the issue date
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileServer, makeDb, offlineFetch } from "../support/server-reader-harness.mjs";
import { NOW_MS, T, B, asLegacy, entry, env, recordingDb, seedRaw, stableJson, uid } from "../support/b1-fixtures.mjs";
import { spec, creditNode } from "../support/p1-credit-fixtures.mjs";

offlineFetch();
const srv = compileServer();
const CI = await srv.import("src/finance-server/canonicalInputs.js");
const CM = await srv.import("src/finance-server/canonicalMetrics.js");
const NODE = `tenants/${T}/biz:${B}:supplier_credits`;
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rec = (n, supplierId, issueDate, amount, extra = {}) => spec(n, supplierId, issueDate, amount, extra);
/** The STORED node (with the server ledger) built by the real writer domain. */
const node = (...specs) => creditNode(specs);
const AUG = () => Array.from({ length: 31 }, (_, i) => entry(uid(i + 1), `2026-08-${String(i + 1).padStart(2, "0")}`, { sales: "1000", supplier_payments: i < 30 ? { s1: "300" } : { s1: "0" }, payroll: "100" }));
async function load(credits, need = { config: true, fixed: true, exceptions: true }) {
  const db = seedRaw(makeDb(), { entries: asLegacy(AUG()), config: env({}), suppliers: env([{ id: "s1", name: "Coca" }]) });
  if (credits !== undefined) db.seed(NODE, credits);
  return CI.loadCanonicalInputs(db, T, B, { site: "t", nowMs: NOW_MS, need });
}

test("P1S-01 loader: the credit node is read exactly once on every call; unreadable / invalid records are input issues; a rejected read is never 'no credits'", async () => {
  const db = seedRaw(makeDb(), { entries: asLegacy(AUG()) }); db.seed(NODE, node(rec(1, "s1", "2026-08-15", "300")));
  const rdb = recordingDb(db);
  const i = await CI.loadCanonicalInputs(rdb, T, B, { site: "t", nowMs: NOW_MS, need: { config: false, fixed: false } });
  assert.equal(rdb.reads.filter((p) => p === NODE).length, 1); assert.equal(i.supplierCreditsState, "present"); assert.deepEqual(i.inputIssues, []);
  assert.equal((await load("garbage")).inputIssues.includes("supplier_credits_unreadable"), true);
  assert.equal((await load(node(rec(1, "s1", "2026-08-15", "1", { raw: { amount: "0" } })))).inputIssues.includes("supplier_credits_invalid"), true);
  assert.deepEqual((await load(node(rec(1, "s1", "2026-08-15", "5", { review: "pending" })))).inputIssues, ["supplier_credits_review_unresolved"], "an unresolved review is its own input issue (not invalid data)");
  assert.equal((await load({ schemaVersion: 1, revision: 1, records: {} })).inputIssues.includes("supplier_credits_unreadable"), true, "the rejected P1 schema is never reinterpreted");
  assert.equal((await load(creditNode([rec(1, "s1", "2026-08-15", "5")], { bizId: "bizOther" }))).supplierCreditsState, "unreadable", "a node bound to another business is unreadable");
  assert.equal((await load(undefined)).supplierCreditsState, "absent");
  const failing = { ref: (p) => (p === NODE ? { once: async () => { throw new Error("rtdb down"); } } : db.ref(p)) };
  await assert.rejects(() => CI.loadCanonicalInputs(failing, T, B, { site: "t", nowMs: NOW_MS, need: { config: false, fixed: false } }), /rtdb down/);
  assert.deepEqual(db.writes, [], "the loader never writes");
});

test("P1S-02 canonical month report: net purchases (8,700), Food Cost on net; provenance names MARJIN_CREDITS/4 and the node state", async () => {
  const i = await load(node(rec(1, "s1", "2026-08-15", "300")));
  const { report, provenance } = CM.canonicalMonthReport(i, { kind: "closed_month", month: "2026-08" });
  assert.equal(report.actual.purchases.value, "8700"); assert.equal(report.actual.purchases.gross.value, "9000");
  assert.equal(report.actual.purchasesPct.value, "870/31");
  assert.equal(provenance.credits, "MARJIN_CREDITS/4"); assert.equal(provenance.supplierCreditsState, "present");
  assert.equal(provenance.product, "MARJIN_PRODUCT/3"); assert.equal(report.versions.fin, "MARJIN_FIN/4");
  const bad = CM.canonicalMonthReport(await load("garbage"), { kind: "closed_month", month: "2026-08" });
  assert.equal(bad.report.actual.purchases.complete, false); assert.equal(bad.report.actual.purchasesPct.state, "invalid_components");
});

test("P1S-03 per-day purchase records: amount is NET; grossAmount − creditsAmount = amount; dayPurchases partial when the credit source is invalid", async () => {
  const i = await load(node(rec(1, "s1", "2026-08-15", "120")));
  const recs = CM.canonicalPurchaseRecords(i, { from: "2026-08-14", to: "2026-08-16" }, { s1: "Coca" });
  assert.deepEqual(recs.map((r) => [r.date, r.amount, r.grossAmount, r.creditsAmount, r.dayPurchases]), [
    ["2026-08-14", 300, 300, 0, "present"], ["2026-08-15", 180, 300, 120, "present"], ["2026-08-16", 300, 300, 0, "present"],
  ]);
  const inv = await load(node(rec(1, "s1", "2026-08-15", "1", { raw: { amount: "0" } })));
  assert.equal(CM.canonicalPurchaseRecords(inv, { from: "2026-08-15", to: "2026-08-15" }, {})[0].dayPurchases, "partial_invalid");
});

test("P1S-04 analytics fin block: supplierCredits / purchasesGross appear ONLY on a credit date; without credits the block is byte-identical", async () => {
  const none = await load(undefined), yes = await load(node(rec(1, "s1", "2026-08-15", "120")));
  for (const d of ["2026-08-14", "2026-08-15"]) {
    const a = CM.toAnalyticsFinancials(CM.canonicalDayRecord(none, d)), b = CM.toAnalyticsFinancials(CM.canonicalDayRecord(yes, d));
    assert.equal(a.fin.supplierCredits, undefined); assert.equal(a.fin.purchasesGross, undefined);
    if (d === "2026-08-14") {
      assert.equal(b.fin.supplierCredits, undefined, "no field on a date without credits");
      // the only difference on a credit-free date is the provenance's node state (absent → present)
      assert.equal(stableJson(b).replace(/"supplierCreditsState":"present"/g, '"supplierCreditsState":"absent"'), stableJson(a));
    } else {
      assert.deepEqual(b.fin.supplierCredits, { state: "present", value: "120", count: 1, bySupplier: [{ source: "supplier:s1", amount: "120" }] });
      assert.equal(b.fin.purchasesGross.state, "present"); assert.equal(b.fin.purchasesGross.value, "300");
    }
  }
  const unr = await load("garbage");
  assert.deepEqual(CM.toAnalyticsFinancials(CM.canonicalDayRecord(unr, "2026-08-14")).fin.supplierCredits, { state: "invalid", reason: "supplier_credits_unreadable" }, "an unreadable source is an explicit state on every date");
  const pend = await load(node(rec(1, "s1", "2026-08-15", "120", { review: "pending" })));
  assert.deepEqual(CM.toAnalyticsFinancials(CM.canonicalDayRecord(pend, "2026-08-15")).fin.supplierCredits, { state: "invalid", reason: "supplier_credit_review_pending" }, "a pending credit is never a counted fact");
});

test("P1S-05 the daily series (analytics / Agent input) carries NET foodCost on the issue date and the credits provenance", async () => {
  const yes = await load(node(rec(1, "s1", "2026-08-15", "120")));
  const s = CM.canonicalDailySeries(yes, { from: "2026-08-15", to: "2026-08-15" });
  assert.equal(s.days[0].foodCost, 180); assert.equal(s.days[0].fin.credits, "MARJIN_CREDITS/4");
});
