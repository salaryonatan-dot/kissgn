// M1 integration candidate (LOCAL; pending independent Codex review) — CROSS-COMPONENT contracts of Core/F1 R4 (cost
// history, MARJIN_COSTH/6 + the four-state review lifecycle + VD-47 attested past edits + VD-50) and P1 R7 (supplier
// credits, MARJIN_CREDITS/4) running TOGETHER: the REAL Core trusted writer (lib/finance/costHistoryWriter.js) and the
// REAL P1 admin API (api/admin.js) write into ONE shared database; the compiled server loader / canonical report and the
// integrated page's C1 seam read both.
//   MIC-01  one report carries both: VAT-net purchases net of credits by verified issue date (a closed-day credit counts),
//           full employer labor from the persisted (attested) cost history, closed-day fixed placement, VD-50 gross profit
//           and Food Cost on net purchases; credits change ONLY purchases and their dependents
//   MIC-02  Actual MTD through D-1 only (a credit / entry of the current business day never counts) and month transitions
//   MIC-03  year transition
//   MIC-04  corrupt chains: a P1 (a)–(d) chain defect with a valid cost history, a corrupt cost history with valid credits,
//           and both — every affected figure is incomplete (never a fabricated value), the other side stays exact
//   MIC-05  owner decisions across both APIs: flagged credit + flagged cost version are both unresolved; the tenant-wide
//           owner (no biz_access row) accepts / rejects / re-activates; manager / super_owner / viewer and an ex-owner with
//           a stale biz_access row never decide
//   MIC-06  tenant / business isolation, registry removal, malformed / unavailable registry, membership revocation
//   MIC-07  lost acknowledgements on the shared database resolve by full-payload readback and never touch the other node
//   MIC-08  empty datasets
//   MIC-09  browser ≡ server: the integrated page's C1 views (cost history + credits through the merged inputsFor) are
//           byte-identical to the server canonical report; VD-50 / Food Cost display consistency
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "../support/fincore-load.mjs";
import { loadWriter } from "../support/f1-writer-harness.mjs";
import { compileServer, offlineFetch } from "../support/server-reader-harness.mjs";
import { asLegacy, entry, uid, stableJson } from "../support/b1-fixtures.mjs";
import { apiHarness, memoryDb, seed as p1Seed, env } from "../support/p1-r3-api-harness.mjs";
import { spec, creditNode, replaceIn, voidIn, mutate, cid, oid } from "../support/p1-credit-fixtures.mjs";
import { loadFinance, loadSeam, srcOf, present, absent, ledgerOf } from "../support/c1-seam.mjs";
import * as SC from "../../lib/supplierCredits.js";

offlineFetch();
const W = await loadWriter(REPO);
const SRV = compileServer();
const CI = await SRV.import("src/finance-server/canonicalInputs.js"), CM = await SRV.import("src/finance-server/canonicalMetrics.js");
const F = await loadFinance();
const HTML = readFileSync(join(REPO, "index.html"), "utf8");
const C1 = loadSeam(HTML);
const P1 = (() => { const i = HTML.indexOf("// ── P1 supplier credits browser seam"); const win = {}; vm.runInNewContext(HTML.slice(i, HTML.indexOf("</script>", i)), { window: win, Object, Promise, setTimeout, clearTimeout, AbortController }); return win.MarjinP1; })();

const T = "tenantA", B = "bizA", B2 = "bizB";
const CREDITS = (b = B, t = T) => `tenants/${t}/biz:${b}:supplier_credits`;
const HISTORY = (b = B, t = T) => `tenants/${t}/biz:${b}:cost_history`;
const NOW = Date.parse("2026-10-02T09:00:00Z");              // business date 2026-10-02 (Asia/Jerusalem) ⇒ Actual through 2026-10-01
const at = (date) => Date.parse(date + "T09:00:00Z");
const V = (n) => `00000000-0000-4000-8000-0000000000${n}`;
const req = { headers: {} };
const clone = (x) => JSON.parse(JSON.stringify(x));
const pad = (n) => String(n).padStart(2, "0");
const CLOSED = "2026-09-08";
const days = (from, to) => { const out = []; for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const rowsFor = (list, skip = [CLOSED]) => list.filter((d) => !skip.includes(d)).map((d, i) => entry(uid(i + 1), d, { sales: "1000", supplier_payments: { s1: "300" }, payroll: "100" }));
const ACT = { globalEmployees: [{ employeeKey: "g1", monthlyEmployerCost: "9300" }], fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }], rent: { mode: "none" }, royalty: { mode: "none" } };
const PAST = { globalEmployees: [{ employeeKey: "g1", monthlyEmployerCost: "9000" }], fixedItems: [{ itemKey: "f1", monthlyAmount: "3000" }], rent: { mode: "none" }, royalty: { mode: "none" } };

/** ONE shared database: P1 harness tenants (own = tenant-wide owner WITHOUT a biz_access row, mgr / view with rows, super),
 *  registry [bizA, bizB], suppliers; plus entries, settings and the closure ledger for each business. */
function sharedDb({ entries = rowsFor(days("2026-09-01", "2026-10-02")) } = {}) {
  const s = p1Seed();
  s.tenants.tenantA.biz_access.bizB = { mgr: true };
  for (const b of [B, B2]) {
    s.tenants.tenantA[`biz:${b}:entries`] = asLegacy(entries);
    s.tenants.tenantA[`biz:${b}:config`] = env({ employees: [] });
    s.tenants.tenantA[`biz:${b}:fixed`] = env([]);
    s.tenants.tenantA.entry_exceptions = { ...(s.tenants.tenantA.entry_exceptions || {}), [b]: { [CLOSED]: { state: { status: "active", reasonCode: "closure" } } } };
  }
  const db = memoryDb(s);
  globalThis.__DB = db;                                      // the Core writer's helper seam reads the same database
  return db;
}
let tick = NOW;
const as = (uid) => { globalThis.__CLAIMS = { uid, email: uid + "@example.test" }; };
const writer = (db, hooks = {}) => W.createCostHistoryWriter({ db, clock: () => (tick += 1000), hooks });
/** Core: the tenant-wide owner activates today, then attests the past (VD-47) from 2026-09-01. */
async function costHistory(db, b = B, ids = ["a0", "a1"]) {
  tick = NOW; as("own");
  const a = await writer(db).activateCostHistory(req, { tenantId: T, bizId: b, body: { versionId: V(ids[0]), expectedHead: null, effectiveFrom: "2026-10-02", basis: "recorded", ...ACT } });
  assert.equal(a.status, "committed_current", JSON.stringify(a));
  const body = { versionId: V(ids[1]), expectedHead: db.read(HISTORY(b)).head, effectiveFrom: "2026-09-01", basis: "attested_retroactive", attestationReason: "supplier invoices", ...PAST };
  body.attestation = { confirmed: true, typedEffectiveFrom: body.effectiveFrom, confirmedSnapshotDigest: W.attestationDigest(body) };
  const e = await writer(db).attestHistoricalCostEdit(req, { tenantId: T, bizId: b, body });
  assert.equal(e.status, "committed_current", JSON.stringify(e)); assert.equal(e.review, "cleared");
}
const CREDIT_SET = [["2026-09-08", "40"], ["2026-09-15", "120"], ["2026-09-30", "10"], ["2026-10-01", "50"], ["2026-10-02", "70"]];
/** P1: the manager records credits through the REAL admin API (cleared by the post-commit re-authorization). */
async function credits(h, b = B, set = CREDIT_SET, base = 1) {
  for (const [k, [issueDate, amount]] of set.entries()) {
    const n = base + k;
    const r = await h.call("create-supplier-credit", { tenantId: T, bizId: b, creditId: cid(n), operationId: oid(n), supplierId: "s1", issueDate, amount, documentNumber: "CR-" + n }, "mgr");
    assert.equal(r.code, 200, JSON.stringify(r.body));
  }
}
const load = (db, b = B, nowMs = NOW) => CI.loadCanonicalInputs(db, T, b, { site: "m1", nowMs, need: { config: true, fixed: true, exceptions: true, costHistory: true } });
const month = async (db, m, nowMs = NOW, b = B) => CM.canonicalMonthReport(await load(db, b, nowMs), { kind: m >= new Date(nowMs).toISOString().slice(0, 7) ? "open_month" : "closed_month", month: m });
async function world({ withCredits = true, withHistory = true } = {}) {
  const db = sharedDb(), h = await apiHarness(db);
  if (withHistory) await costHistory(db);
  if (withCredits) await credits(h);
  return { db, h };
}

test("MIC-01 one canonical report carries both lines: net purchases by verified issue date, full employer labor from the attested history, closed-day placement, VD-50 and Food Cost on net", async () => {
  const { db } = await world();
  assert.equal(db.read(HISTORY()).head.revision, 2);
  const { report, provenance, inputIssues } = await month(db, "2026-09");
  const a = report.actual;
  assert.deepEqual(inputIssues, []);
  assert.equal(provenance.timelineSource, "persisted"); assert.equal(provenance.credits, "MARJIN_CREDITS/4"); assert.equal(provenance.supplierCreditsState, "present");
  assert.equal(provenance.product, "MARJIN_PRODUCT/3"); assert.equal(report.versions.fin, "MARJIN_FIN/4");
  // 29 present days (2026-09-08 closed, no entry): revenue 29,000; gross purchases 8,700; credits 40 (closed day) + 120 + 10 (month end)
  assert.equal(a.revenue.value, "29000");
  assert.equal(a.purchases.gross.value, "8700"); assert.equal(a.purchases.credits.value, "170"); assert.equal(a.purchases.value, "8530");
  assert.deepEqual(a.purchases.credits.dates, ["2026-09-08", "2026-09-15", "2026-09-30"], "credits by verified issue date; a closed-day credit counts in its month");
  assert.equal(a.purchases.complete, true);
  // full employer labor = hourly 2,900 + the ATTESTED (VD-47) global employer cost 9,000 (not the later 9,300)
  assert.equal(a.labor.globalEmployerCost.value, "9000"); assert.equal(a.labor.employerCost.value, "11900"); assert.equal(a.labor.employerCost.state, "complete");
  // closed-day allocation: the attested fixed 3,000 placed on eligible days excluding the completed closure
  assert.equal(a.fixedAccrual.total, "3000"); assert.equal(a.fixedAccrual.allocation, "eligible_days_excluding_completed_closures");
  assert.ok(a.costAllocation.completedClosureDates.includes(CLOSED));
  // VD-50 gross profit = revenue − NET purchases − full employer labor; Food Cost on net purchases
  assert.equal(a.grossProfitBeforeFixed.value, "8570"); assert.equal(a.operatingProfit.value, "5570"); assert.equal(a.contributionBeforeFixed.value, "17570");
  assert.equal(a.purchasesPct.state, "value"); assert.equal(a.purchasesPct.value, "853/29"); assert.equal(a.purchasesPct.basisKind, "net_of_vat");
  // the same world WITHOUT credits: only purchases and their dependents move, by exactly the credited 170
  const db0 = memoryDb(db.value()); db0.put(CREDITS(), null);
  const z = (await month(db0, "2026-09")).report.actual;
  for (const k of ["revenue", "hourlyLabor", "otherExpense", "labor", "fixedAccrual", "costAllocation"]) assert.equal(stableJson(z[k]), stableJson(a[k]), k + " is independent of credits");
  assert.equal(z.purchases.value, "8700"); assert.equal(z.grossProfitBeforeFixed.value, "8400"); assert.equal(BigInt(a.grossProfitBeforeFixed.value) - BigInt(z.grossProfitBeforeFixed.value), 170n);
  assert.equal(z.purchasesPct.value, "30");
});

test("MIC-02 Actual MTD through D-1 only, month transition: today's credit never counts; a month-end credit stays in its month; a closed month is stable as D advances", async () => {
  const { db } = await world();
  const oct2 = (await month(db, "2026-10", NOW)).report.actual, oct3 = (await month(db, "2026-10", at("2026-10-03"))).report.actual;
  assert.deepEqual(oct2.purchases.credits.dates, ["2026-10-01"]); assert.equal(oct2.purchases.value, "250"); assert.equal(oct2.revenue.value, "1000");
  assert.deepEqual(oct3.purchases.credits.dates, ["2026-10-01", "2026-10-02"]); assert.equal(oct3.purchases.value, "480"); assert.equal(oct3.revenue.value, "2000");
  assert.equal(oct2.labor.globalEmployerCost.value, "9000/31", "the global employer cost accrues only over the completed day");
  assert.equal(oct2.grossProfitBeforeFixed.value, "11150/31");
  const s2 = (await month(db, "2026-09", NOW)).report, s3 = (await month(db, "2026-09", at("2026-10-03"))).report;
  assert.equal(stableJson(s2.actual), stableJson(s3.actual), "a completed month does not change as D advances");
  assert.ok(s2.actual.purchases.credits.dates.includes("2026-09-30") && !oct3.purchases.credits.dates.includes("2026-09-30"));
});

test("MIC-03 year transition: Dec 31 credit in December, Jan 1 in January MTD, Jan 2 (today) excluded", async () => {
  const db = sharedDb({ entries: rowsFor(days("2026-12-29", "2027-01-02"), []) }), h = await apiHarness(db);
  db.put(CREDITS(), creditNode([spec(1, "s1", "2026-12-31", "30"), spec(2, "s1", "2027-01-01", "20"), spec(3, "s1", "2027-01-02", "5")]));
  void h;
  const now = at("2027-01-02");
  const dec = (await month(db, "2026-12", now)).report.actual, jan = (await month(db, "2027-01", now)).report.actual;
  assert.deepEqual(dec.purchases.credits.dates, ["2026-12-31"]); assert.equal(dec.purchases.value, "870");
  assert.deepEqual(jan.purchases.credits.dates, ["2027-01-01"]); assert.equal(jan.purchases.value, "280");
});

// P1 R7 (a)–(d) chain defects on a lineage replaced ACROSS a month (the credit moved 2026-08-15 → 2026-09-20): a defect is
// never date-scoped — every date of the bound tenant / business is incomplete, including a month the lineage never touched
const LINEAGE = () => replaceIn(creditNode([spec(1, "s1", "2026-08-15", "120"), spec(5, "s1", "2026-09-22", "10")]), 1, 2, { issueDate: "2026-09-20", amount: "110" });
const CORRECTED = () => replaceIn(creditNode([spec(1, "s1", "2026-08-15", "120"), spec(5, "s1", "2026-09-22", "10")]), 1, 2, { issueDate: "2026-09-20", amount: "110", documentNumber: "CR-77" }, { identityCorrection: true });
const VOIDED = () => voidIn(LINEAGE(), 2);                    // the lineage head voided: an EVENT with its own review
const DEFECTS = [
  ["(a) a lineage record without its verified review", LINEAGE, (n) => { delete n.review[oid(1)]; }],
  ["(b) a lineage event without its verified review", VOIDED, (n) => { assert.ok(n.voids[oid(7002)]); delete n.review[oid(7002)]; }],
  // (c) isolated: after an identity-correction successor is rolled back, ONLY the document reservation still references it
  ["(c) a referenced credit id that is not a lineage record", CORRECTED, (n) => { delete n.records[cid(2)]; delete n.review[oid(2)]; delete n.voids[oid(2)]; n.heads[cid(1)] = { creditId: cid(1), seq: 1 }; }],
  ["(d) a head whose seq is not the operation count", LINEAGE, (n) => { n.heads[cid(1)] = { ...n.heads[cid(1)], seq: 1 }; }],
];
test("MIC-04 corrupt chains: a P1 (a)–(d) defect leaves purchases, Food Cost and VD-50 incomplete while the cost history stays exact; a corrupt cost history leaves labor incomplete while credits stay exact", async () => {
  const { db } = await world({ withCredits: false });
  const clean = memoryDb(db.value()); clean.put(CREDITS(), LINEAGE());
  const c = (await month(clean, "2026-09")).report.actual;
  assert.equal(c.purchases.complete, true); assert.equal(c.purchases.credits.value, "120");
  for (const [label, baseOf, fn] of DEFECTS) {
    const d = memoryDb(db.value()); d.put(CREDITS(), mutate(baseOf(), fn));
    const ok = memoryDb(db.value()); ok.put(CREDITS(), baseOf());
    assert.equal((await month(ok, "2026-09")).report.actual.purchases.complete, true, label + ": the undamaged base is complete (non-vacuous)");
    assert.equal((await month(ok, "2026-10")).report.actual.purchases.complete, true, label + ": the undamaged base's untouched month is complete");
    const oct = (await month(d, "2026-10")).report.actual;
    assert.equal(oct.purchases.complete, false, label + ": a month the lineage never touched is incomplete too (node-wide, never date-scoped)");
    assert.equal(oct.purchasesPct.state, "invalid_components", label + ": no October Food Cost"); assert.equal(oct.grossProfitBeforeFixed.value, null, label + ": no October VD-50");
    const { report, inputIssues } = await month(d, "2026-09");
    const a = report.actual;
    assert.equal(a.purchases.complete, false, label + ": purchases incomplete");
    assert.equal(a.purchasesPct.state, "invalid_components", label + ": Food Cost unavailable"); assert.equal("value" in a.purchasesPct, false, label + ": no final percentage");
    assert.notEqual(a.grossProfitBeforeFixed.state, "complete", label + ": VD-50 not complete-looking"); assert.equal(a.grossProfitBeforeFixed.value, null, label + ": no VD-50 value");
    assert.ok(inputIssues.includes("supplier_credits_invalid") || inputIssues.includes("supplier_credits_unreadable"), label + " " + JSON.stringify(inputIssues));
    for (const k of ["revenue", "labor", "fixedAccrual", "costAllocation"]) assert.equal(stableJson(a[k]), stableJson(c[k]), label + ": " + k + " unaffected");
  }
  // corrupt cost history (a version payload byte changed after commit: the review digest no longer binds) + valid credits
  const h = memoryDb(db.value()); h.put(CREDITS(), LINEAGE());
  const node = h.read(HISTORY()); node.versions[V("a1")].fixedItems[0].monthlyAmount = "1"; h.put(HISTORY(), node);
  const { report: hr, inputIssues: hi } = await month(h, "2026-09");
  assert.ok(hi.includes("cost_history_unreadable"));
  assert.equal(hr.actual.purchases.value, "8580", "credits stay exact"); assert.equal(hr.actual.purchases.complete, true);
  assert.notEqual(hr.actual.labor.employerCost.state, "complete"); assert.equal(hr.actual.grossProfitBeforeFixed.value, null, "no VD-50 value without a readable labor basis");
  // both corrupt: nothing complete-looking, no fabricated zero
  const both = memoryDb(h.value()); both.put(CREDITS(), mutate(LINEAGE(), DEFECTS[0][2]));
  const ba = (await month(both, "2026-09")).report.actual;
  assert.equal(ba.purchasesPct.state, "invalid_components"); assert.equal(ba.grossProfitBeforeFixed.value, null); assert.equal(ba.operatingProfit.value, null);
});

/** commit by the manager whose membership is removed right AFTER the node transaction (before the post-check) ⇒ flagged */
function revokeAfterCommit(db, path) {
  let fired = false;
  db.afterTransaction = (p) => { if (p === path && !fired) { fired = true; db.put(`tenants/${T}/members/mgr`, null); } };
  return () => { db.afterTransaction = null; db.put(`tenants/${T}/members/mgr`, true); };
}
test("MIC-05 owner decisions across both APIs: flagged credit + flagged cost version are unresolved; only the CURRENT tenant-wide owner decides; acceptance and rejection", async () => {
  const { db, h } = await world({ withCredits: false, withHistory: false });
  // a flagged credit (manager revoked during its commit)
  let restore = revokeAfterCommit(db, CREDITS());
  assert.equal((await h.call("create-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(1), supplierId: "s1", issueDate: "2026-09-15", amount: "120", documentNumber: "CR-1" }, "mgr")).code, 200);
  restore();
  assert.equal(db.read(CREDITS()).review[oid(1)].state, "flagged");
  // owner activation, then a flagged manager edit (revoked during its commit)
  tick = NOW; as("own");
  assert.equal((await writer(db).activateCostHistory(req, { tenantId: T, bizId: B, body: { versionId: V("a0"), expectedHead: null, effectiveFrom: "2026-10-02", basis: "recorded", ...ACT } })).status, "committed_current");
  restore = revokeAfterCommit(db, HISTORY()); as("mgr");
  const edit = await writer(db).recordCostEdit(req, { tenantId: T, bizId: B, body: { versionId: V("a2"), expectedHead: db.read(HISTORY()).head, effectiveFrom: "2026-10-03", basis: "recorded", ...PAST } });
  restore();
  assert.equal(edit.review, "flagged", JSON.stringify(edit));
  const unresolved = await load(db, B, at("2026-10-04"));
  assert.ok(unresolved.inputIssues.includes("supplier_credits_review_unresolved"), JSON.stringify(unresolved.inputIssues));
  const ur = CM.canonicalMonthReport(unresolved, { kind: "closed_month", month: "2026-09" }).report.actual;
  assert.equal(ur.purchases.complete, false); assert.equal(ur.purchasesPct.state, "invalid_components");
  // nobody but the current tenant owner decides — on EITHER API
  const creditDecision = (decision, opN) => ({ tenantId: T, bizId: B, operationId: oid(opN), targetOperationId: oid(1), intentDigest: db.read(CREDITS()).review[oid(1)].intentDigest, decision });
  const costDecision = (opN) => ({ tenantId: T, bizId: B, versionId: V("a2"), intentDigest: db.read(HISTORY()).review[V("a2")].intentDigest, operationId: V(opN) });
  for (const actor of ["mgr", "super", "view"]) {
    const before = db.value();
    assert.equal((await h.call("decide-supplier-credit-review", creditDecision("accept", 90), actor)).code, 403, actor + " credit decision");
    as(actor); assert.notEqual((await writer(db).acceptFlaggedVersion(req, costDecision("b0"))).status, "resolved", actor + " cost decision");
    assert.deepEqual(db.value(), before, actor + ": nothing written");
  }
  // an ex-owner (now manager) with a STALE biz_access row cannot decide either
  db.put(`tenants/${T}/roles/own`, "manager"); db.put(`tenants/${T}/biz_access/${B}/own`, true);
  { const before = db.value();
    assert.equal((await h.call("decide-supplier-credit-review", creditDecision("accept", 91), "own")).code, 403);
    as("own"); assert.notEqual((await writer(db).acceptFlaggedVersion(req, costDecision("b1"))).status, "resolved");
    assert.deepEqual(db.value(), before); }
  db.put(`tenants/${T}/roles/own`, "owner"); db.put(`tenants/${T}/biz_access/${B}/own`, null);
  // the tenant-wide owner (NO biz_access row) accepts both
  assert.equal((await h.call("decide-supplier-credit-review", creditDecision("accept", 92), "own")).code, 200);
  as("own"); assert.deepEqual(await writer(db).acceptFlaggedVersion(req, costDecision("b2")), { status: "resolved", state: "cleared", decision: "accepted" });
  const cr = db.read(CREDITS()).review[oid(1)], hr = db.read(HISTORY()).review[V("a2")];
  assert.equal(cr.state, "cleared"); assert.equal(cr.decisionAudit.decision, "accepted");
  assert.equal(hr.state, "cleared"); assert.equal(hr.decision, "accepted"); assert.equal(hr.decisionAudit.decision, "accepted");
  const acc = await load(db, B, at("2026-10-04"));
  assert.deepEqual(acc.inputIssues, []);
  assert.equal(CM.canonicalMonthReport(acc, { kind: "closed_month", month: "2026-09" }).report.actual.purchases.credits.value, "120");
  // rejection: a second flagged credit rejected ⇒ not counted, purchases complete; persisted states stay within the four
  restore = revokeAfterCommit(db, CREDITS());
  assert.equal((await h.call("create-supplier-credit", { tenantId: T, bizId: B, creditId: cid(2), operationId: oid(2), supplierId: "s1", issueDate: "2026-09-16", amount: "7", documentNumber: "CR-2" }, "mgr")).code, 200);
  restore();
  assert.equal((await h.call("decide-supplier-credit-review", { tenantId: T, bizId: B, operationId: oid(93), targetOperationId: oid(2), intentDigest: db.read(CREDITS()).review[oid(2)].intentDigest, decision: "reject" }, "own")).code, 200);
  assert.equal(db.read(CREDITS()).review[oid(2)].state, "rejected");
  const rej = CM.canonicalMonthReport(await load(db, B, at("2026-10-04")), { kind: "closed_month", month: "2026-09" }).report.actual;
  assert.equal(rej.purchases.complete, true); assert.equal(rej.purchases.credits.value, "120", "the rejected credit is never counted");
  const states = new Set([...Object.values(db.read(CREDITS()).review), ...Object.values(db.read(HISTORY()).review)].map((r) => r.state));
  for (const s of states) assert.ok(["pending", "cleared", "flagged", "rejected"].includes(s), "persisted state " + s);
});

test("MIC-05b cost history: an owner-rejected flagged successor never applies (the previous valid version stays); credits are unaffected throughout", async () => {
  const { db, h } = await world({ withHistory: false });
  // the manager's FIRST version is refused activation; the owner activates, then a flagged successor is rejected ⇒ the previous valid version stays
  tick = NOW; as("own");
  assert.equal((await writer(db).activateCostHistory(req, { tenantId: T, bizId: B, body: { versionId: V("a0"), expectedHead: null, effectiveFrom: "2026-10-02", basis: "recorded", ...ACT } })).status, "committed_current");
  const restore = revokeAfterCommit(db, HISTORY()); as("mgr");
  const edit = await writer(db).recordCostEdit(req, { tenantId: T, bizId: B, body: { versionId: V("a2"), expectedHead: db.read(HISTORY()).head, effectiveFrom: "2026-10-03", basis: "recorded", ...PAST } });
  restore(); assert.equal(edit.review, "flagged");
  as("own");
  assert.deepEqual(await writer(db).rejectFlaggedVersion(req, { tenantId: T, bizId: B, versionId: V("a2"), intentDigest: db.read(HISTORY()).review[V("a2")].intentDigest, operationId: V("b3") }), { status: "resolved", state: "rejected", decision: "rejected" });
  const i = await load(db, B, at("2026-10-05"));
  assert.equal(i.costHistoryState, "present"); assert.deepEqual(i.inputIssues, []);
  const oct = CM.canonicalMonthReport(i, { kind: "open_month", month: "2026-10" }).report.actual;
  // counterfactual world in which the rejected successor was never written: identical cost figures
  const only = memoryDb(db.value()); const n = only.read(HISTORY());
  only.put(HISTORY(), null); tick = NOW; globalThis.__DB = only; as("own");
  assert.equal((await writer(only).activateCostHistory(req, { tenantId: T, bizId: B, body: { versionId: V("e0"), expectedHead: null, effectiveFrom: "2026-10-02", basis: "recorded", ...ACT } })).status, "committed_current");
  globalThis.__DB = db;
  const o = CM.canonicalMonthReport(await load(only, B, at("2026-10-05")), { kind: "open_month", month: "2026-10" }).report.actual;
  for (const k of ["labor", "fixedAccrual", "costAllocation", "grossProfitBeforeFixed", "operatingProfit"]) assert.equal(stableJson(oct[k]), stableJson(o[k]), k + ": the rejected successor never applies");
  assert.equal(n.review[V("a2")].state, "rejected"); assert.equal(n.review[V("a0")].state, "cleared");
  assert.deepEqual(oct.purchases.credits.dates, ["2026-10-01", "2026-10-02"], "credits unaffected by the cost-history decision");
  void h;
});

test("MIC-06 isolation and registry: per-business nodes stay isolated; registry removal / malformed / unavailable registry and revoked membership fail closed on BOTH writers and write nothing", async () => {
  const { db, h } = await world();
  await costHistory(db, B2, ["d0", "d1"]); await credits(h, B2, [["2026-09-15", "999"]], 50);
  const a = (await month(db, "2026-09")).report.actual, b = (await month(db, "2026-09", NOW, B2)).report.actual;
  assert.equal(a.purchases.credits.value, "170"); assert.equal(b.purchases.credits.value, "999");
  // a node copied under the other business key is unreadable (both bindings): never another business's figures
  const swap = memoryDb(db.value()); swap.put(CREDITS(B), db.read(CREDITS(B2))); swap.put(HISTORY(B), db.read(HISTORY(B2)));
  const si = await load(swap, B);
  assert.equal(si.supplierCreditsState, "unreadable"); assert.equal(si.costHistoryState, "unreadable");
  assert.ok(si.inputIssues.includes("supplier_credits_unreadable") && si.inputIssues.includes("cost_history_unreadable"));
  // registry removal of bizA: both writers refuse; a stale biz_access row for the removed business authorizes nothing
  const costEdit = (versionId) => ({ tenantId: T, bizId: B, body: { versionId, expectedHead: db.read(HISTORY()).head, effectiveFrom: "2026-10-05", basis: "recorded", ...ACT } });
  const credit = (n) => ({ tenantId: T, bizId: B, creditId: cid(n), operationId: oid(n), supplierId: "s1", issueDate: "2026-09-20", amount: "1", documentNumber: "CR-" + n });
  for (const [label, setRegistry, creditCode, costStatus] of [
    ["removed", () => db.put(`tenants/${T}/app/business`, env([{ id: B2 }])), 403, "business_not_in_tenant"],
    ["malformed", () => db.put(`tenants/${T}/app/business`, { _v: "not json" }), 503, "authorization_unavailable"],
    ["unavailable", () => { db.beforeGet = (p) => { if (p.endsWith("/app/business")) throw new Error("down"); }; }, 503, "authorization_unavailable"],
  ]) {
    const registry = db.read(`tenants/${T}/app/business`);
    setRegistry();
    const before = db.value();
    for (const actor of ["mgr", "own"]) {
      const r = await h.call("create-supplier-credit", credit(60), actor);
      assert.equal(r.code, creditCode, `${label} ${actor} credit ${JSON.stringify(r.body)}`);
      as(actor); assert.equal((await writer(db).recordCostEdit(req, costEdit(V("c0")))).status, costStatus, `${label} ${actor} cost`);
    }
    assert.deepEqual(db.value(), before, label + ": nothing written");
    db.beforeGet = null; db.put(`tenants/${T}/app/business`, registry);
  }
  // revoked membership: both refuse; foreign-tenant owner: both refuse
  db.put(`tenants/${T}/members/mgr`, null);
  { const before = db.value();
    assert.equal((await h.call("create-supplier-credit", credit(61), "mgr")).code, 403);
    as("mgr"); assert.notEqual((await writer(db).recordCostEdit(req, costEdit(V("c1")))).status, "committed_current");
    as("foreign"); assert.notEqual((await writer(db).recordCostEdit(req, costEdit(V("c2")))).status, "committed_current");
    assert.ok([401, 403].includes((await h.call("create-supplier-credit", credit(62), "foreign")).code));
    assert.deepEqual(db.value(), before); }
});

test("MIC-07 lost acknowledgements on the shared database resolve by full-payload readback and never touch the other node", async () => {
  const { db, h } = await world({ withCredits: false });
  const historyBefore = db.read(HISTORY());
  let lost = 0; db.afterTransaction = (p) => { if (p === CREDITS() && lost++ === 0) throw new Error("ack lost after commit"); };
  const r = await h.call("create-supplier-credit", { tenantId: T, bizId: B, creditId: cid(1), operationId: oid(1), supplierId: "s1", issueDate: "2026-09-15", amount: "120", documentNumber: "CR-1" }, "mgr");
  db.afterTransaction = null;
  assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(db.read(CREDITS()).records[cid(1)].amount, "120");
  assert.equal(lost, 2, "the lost acknowledgement fired, then the review transaction committed"); assert.deepEqual(Object.keys(db.read(CREDITS()).records), [cid(1)], "stored exactly once"); assert.equal(db.read(CREDITS()).review[oid(1)].state, "cleared");
  assert.deepEqual(db.read(HISTORY()), historyBefore, "the cost history node is untouched by the credit readback");
  const creditsBefore = db.read(CREDITS());
  as("own"); let lostH = 0; db.afterTransaction = (p) => { if (p === HISTORY() && lostH++ === 0) throw new Error("ack lost after commit"); };
  const e = await writer(db).recordCostEdit(req, { tenantId: T, bizId: B, body: { versionId: V("a3"), expectedHead: db.read(HISTORY()).head, effectiveFrom: "2026-10-03", basis: "recorded", ...ACT } });
  db.afterTransaction = null;
  assert.equal(e.status, "committed_current", JSON.stringify(e)); assert.equal(e.resolvedBy, "readback"); assert.equal(e.uncertain, true); assert.equal(e.review, "cleared");
  assert.ok(db.read(HISTORY()).versions[V("a3")], "the version is stored exactly once");
  assert.deepEqual(db.read(CREDITS()), creditsBefore, "the credit node is untouched by the cost-history readback");
  const i = await load(db, B, at("2026-10-04")); assert.deepEqual(i.inputIssues, []);
});

test("MIC-08 empty datasets: no entries, no history, no credits ⇒ absent states and no fabricated credit; isolation of an empty sibling", async () => {
  const db = sharedDb({ entries: [] }); await apiHarness(db);
  const { report, provenance, inputIssues } = await month(db, "2026-09");
  assert.deepEqual(inputIssues, []); assert.equal(provenance.supplierCreditsState, "absent");
  const i = await load(db); assert.equal(i.costHistoryState, "absent");
  assert.equal(report.actual.revenue.presentDays ?? report.actual.purchases.presentDays ?? 0, 0);
  assert.equal(report.actual.purchases.credits.value, null, "no credit node ⇒ no credit figure (never a fabricated 0)");
  const { db: full } = await world();
  assert.equal((await month(full, "2026-09", NOW, B2)).report.actual.purchases.credits.value, null, "bizB stays empty next to a populated bizA");
});

test("MIC-09 browser ≡ server: the integrated page's C1 views over the same stored cost history + credits equal the server canonical report byte-for-byte; VD-50 and Food Cost display agree", async () => {
  const serialize = F.metrics.report.serializeReport;
  const cases = [["clean", (db) => db], ["corrupt credit chain", (db) => { db.put(CREDITS(), mutate(CORRECTED(), DEFECTS[2][2])); return db; }], ["pending credit", (db) => { db.put(CREDITS(), creditNode([spec(1, "s1", "2026-09-15", "120", { review: "pending" })])); return db; }]];
  const { db: base } = await world();
  for (const [label, prep] of cases) {
    const db = prep(memoryDb(base.value()));
    const si = await load(db, B, at("2026-10-05"));
    const history = F.costHistory.codec.decodeHistory({ exists: true, value: db.read(HISTORY()) }, { tenantId: T, bizId: B });
    assert.equal(history.state, "present", label);
    const states = Object.fromEntries(Object.entries(db.read(`tenants/${T}/entry_exceptions/${B}`)).map(([d, v]) => [d, { ...v.state, revision: 1 }]));
    const credits = P1.sourceFor(F, { key: "k", state: "ready", node: SC.safeNodeView(db.read(CREDITS())) }, "k", { tenantId: T, bizId: B });
    const src = { ...srcOf({ rows: si.rows, asOf: si.asOfBusinessDate, config: present({ employees: [] }), fixed: present([]), ledger: ledgerOf(states, "2026-01-01", "2026-12-31") }), costHistory: history, credits };
    for (const m of ["2026-09", "2026-10"]) {
      const server = CM.canonicalMonthReport(si, { kind: m === "2026-10" ? "open_month" : "closed_month", month: m }).report;
      const sup = C1.suppliers(F, src, m, [{ id: "s1", name: "Coca" }]);
      assert.equal(sup.status, "ready", label + " " + JSON.stringify(sup).slice(0, 200));
      assert.equal(serialize(sup.report), serialize(server), `${label} ${m}: browser ≡ server`);
      const p = C1.pnl(F, src, m, null);
      assert.equal(p.status, "ready", label);
      assert.equal(serialize(p.report), serialize(server), `${label} ${m}: P&L report ≡ server`);
      // Food Cost display: a value exactly when the server has one; never a percentage over incomplete purchases
      assert.equal(sup.purchasesPct.num === null, server.actual.purchasesPct.state !== "value", `${label} ${m}: Food Cost display consistent`);
    }
  }
  void absent;
});
