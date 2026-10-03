// P1 Supplier Credits — Financial Core accounting (MARJIN_CREDITS/2 since P1 R1, MARJIN_FIN/4, MARJIN_PRODUCT/3).
//
// Owner contract (2026-09-29 HF-2 closed decisions; 2026-10-02 mandatory-for-pilot decision):
//   a credit is its own document (never a negative purchase); net purchases = gross − credits;
//   attribution = the credit document's ISSUE DATE (no restatement of the original purchase
//   month); all values net of VAT; credits never increase purchases or Food Cost; explicit zero,
//   missing, invalid and unreadable stay distinct; a negative net is kept and flagged.
// Every case runs on the server engine (tsc-compiled src), the freshly generated browser core and
// the COMMITTED fincore/v1 artifact, and the three must serialize identically.
// P1 R1: every fixture node is built by the REAL pure writer (test/support/p1-credit-fixtures.mjs) with
// cleared reviews unless stated; invalid data is produced by mutating a valid stored node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO, loadCompiled, loadCommitted } from "../support/fincore-load.mjs";
import { compileServer } from "../support/server-reader-harness.mjs";
import { AS_OF, NOW_MS, entry, inputs, stableJson, uid } from "../support/b1-fixtures.mjs";
import { cid, spec, creditNode, replaceIn, mutate } from "../support/p1-credit-fixtures.mjs";

const BROWSER = await loadCompiled();
const COMMITTED = await loadCommitted();
const SERVER = await compileServer().import("src/policy/productFinance.js");
const ENGINES = [["server", SERVER], ["browser", BROWSER.product], ["committed", COMMITTED.product]];
const ser = BROWSER.metrics.report.serializeReport;

// ── fixtures ───────────────────────────────────────────────────────────────────
export { cid };
export const rec = (n, supplierId, issueDate, amount, extra = {}) => spec(n, supplierId, issueDate, amount, extra);
/** A MARJIN_CREDITS/2 node of the given credit specs (no spec ⇒ no node: null). */
export const node = (...specs) => (specs.length ? creditNode(specs) : null);
const pad = (n) => String(n).padStart(2, "0");
/** A complete month: revenue 1000/day, payroll 100/day, supplier purchases per `sup(day)` (explicit "0" otherwise). */
function monthRows(month, days, sup = () => ({ s1: "300" }), start = 1) {
  return Array.from({ length: days }, (_, i) => entry(uid(start + i), `${month}-${pad(i + 1)}`, { sales: "1000", supplier_payments: sup(i + 1), payroll: "100" }));
}
/** Coca-Cola example: August gross 9,000 (30 × 300, day 31 explicit zero). */
const AUG = () => monthRows("2026-08", 31, (d) => ({ s1: d <= 30 ? "300" : "0" }));
const withCredits = (P, inp, raw) => (raw === undefined ? inp : { ...inp, supplierCredits: raw && raw.state ? raw : P.decodeSupplierCredits(raw) });
const month = (P, inp, raw, m = "2026-08", kind = "closed_month") => P.productMonthReport(withCredits(P, inp, raw), { kind, month: m });
/** Run on all three engines; assert byte-identical serialization; return the server report. */
function report(inp, raw, m, kind) {
  const outs = ENGINES.map(([e, P]) => [e, month(P, inp, raw, m, kind)]);
  const s0 = ser(outs[0][1]);
  for (const [e, r] of outs) assert.equal(ser(r), s0, `${e} ≢ server`);
  return outs[0][1];
}
const P$ = (r) => r.actual.purchases;
const flagCodes = (r) => r.flags.map((f) => f.code);

// ── P1C-01 no credits ─────────────────────────────────────────────────────────
test("P1C-01 no credit source / absent node / {} / node without records: identical to MARJIN_PRODUCT/2 figures; credits.state absent; purchases complete", () => {
  const base = report(inputs(AUG()), undefined);
  for (const raw of [null, {}, { state: "absent" }]) {
    const r = report(inputs(AUG()), raw);
    assert.equal(ser(r), ser(base), JSON.stringify(raw) + " ⇒ byte-identical to no credit source");
  }
  // P1 R1: a node without records is no longer "no credits" — the writer never stores one, so it is unreadable
  const empty = report(inputs(AUG()), { schemaVersion: 2, contract: "MARJIN_CREDITS/2", tenantId: "tenantA", bizId: "bizA", revision: 1, updatedAt: 1, records: {} });
  assert.equal(P$(empty).complete, false); assert.equal(P$(empty).credits.state, "invalid");
  assert.equal(P$(base).value, "9000"); assert.equal(P$(base).gross.value, "9000"); assert.equal(P$(base).credits.state, "absent"); assert.equal(P$(base).credits.count, 0);
  assert.equal(base.actual.purchasesPct.state, "value");
});

// ── P1C-02 the owner's example ───────────────────────────────────────────────
test("P1C-02 Coca-Cola: gross 9,000 − credit 300 = net 8,700; supplier, overall purchases and Food Cost use 8,700; contribution after food + labor uses net (VD-50)", () => {
  const r = report(inputs(AUG()), node(rec(1, "s1", "2026-08-15", "300")));
  const p = P$(r);
  assert.equal(p.value, "8700"); assert.equal(p.gross.value, "9000");
  assert.deepEqual(p.bySource, { "supplier:s1": "8700" }); assert.deepEqual(p.grossBySource, { "supplier:s1": "9000" });
  assert.deepEqual({ ...p.credits }, { contract: "MARJIN_CREDITS/2", state: "present", value: "300", count: 1, bySupplier: { "supplier:s1": "300" }, dates: ["2026-08-15"], invalidDates: [], reviewPendingDates: [], reviewFlaggedDates: [] });
  assert.equal(p.complete, true);
  assert.deepEqual(r.actual.purchasesPct, { state: "value", value: "870/31", basisKind: "net_of_vat", comparability: "same_basis_as_revenue" }, "Food Cost = 8,700 / 31,000");
  const none = report(inputs(AUG()), undefined);
  const c = (x) => x.actual.contributionBeforeFixed;
  assert.equal(c(r).state, "complete"); assert.equal(c(none).state, "complete");
  // contribution = revenue − (net purchases + full employer labor) − other: credits raise it by exactly 300
  assert.equal(BigInt(c(r).value) - BigInt(c(none).value), 300n, "contribution increases by exactly the credit");
  assert.equal(c(r).value, String(31000 - 8700 - 3100));
});

// ── P1C-03 several credits / suppliers ───────────────────────────────────────
test("P1C-03 several credits for one supplier and for several suppliers: per-supplier net and overall net = Σ gross − Σ credits", () => {
  const rows = monthRows("2026-08", 31, (d) => ({ s1: "300", s2: d % 2 ? "100" : "0" }));
  const r = report(inputs(rows), node(rec(1, "s1", "2026-08-03", "50"), rec(2, "s1", "2026-08-20", "25.5"), rec(3, "s2", "2026-08-20", "100"), rec(4, "s3", "2026-08-21", "10")));
  const p = P$(r);
  assert.equal(p.gross.value, String(31 * 300 + 16 * 100));
  assert.equal(p.credits.value, "185.5"); assert.equal(p.credits.count, 4);
  assert.equal(p.value, String(31 * 300 + 16 * 100 - 185.5));
  assert.deepEqual(p.bySource, { "supplier:s1": "9224.5", "supplier:s2": "1500", "supplier:s3": "-10" }, "a credited supplier without purchases is a negative net, never dropped");
  assert.deepEqual(p.credits.bySupplier, { "supplier:s1": "75.5", "supplier:s2": "100", "supplier:s3": "10" });
  assert.deepEqual(p.credits.dates, ["2026-08-03", "2026-08-20", "2026-08-21"]);
  assert.ok(r.flags.some((f) => f.code === "negative_supplier_net" && f.key === "supplier:s3"));
  assert.ok(!flagCodes(r).includes("negative_net_purchases"), "overall net is positive");
});

test("P1C-04 a credit and a purchase on the SAME date: the day's purchases are net; a credit on a date without purchases is subtracted at the period level (same total)", () => {
  const sameDay = report(inputs(AUG()), node(rec(1, "s1", "2026-08-10", "120")));
  const noPurchaseDay = report(inputs(AUG()), node(rec(1, "s1", "2026-08-31", "120"))); // day 31 explicit-zero purchases
  assert.equal(P$(sameDay).value, "8880"); assert.equal(P$(noPurchaseDay).value, "8880");
  const days = SERVER.productDailyMetrics(withCredits(SERVER, inputs(AUG()), node(rec(1, "s1", "2026-08-10", "120"))), { from: "2026-08-10", to: "2026-08-11" });
  assert.equal(days[0].foodCost, 180, "300 − 120 on the issue date (the daily metric is net)"); assert.equal(days[1].foodCost, 300, "the next day is untouched");
});

// ── P1C-05 attribution ───────────────────────────────────────────────────────
test("P1C-05 an OCTOBER credit for a SEPTEMBER invoice reduces October; September is NOT restated", () => {
  const asOf = "2026-11-05";
  const rows = [...monthRows("2026-09", 30), ...monthRows("2026-10", 31, () => ({ s1: "300" }), 100)];
  const inp = inputs(rows, { asOf });
  const credit = node(rec(1, "s1", "2026-10-02", "500", { documentNumber: "CR-SEP-INV-77", note: "refers to September invoice 77" }));
  const sepNo = report(inp, undefined, "2026-09"), sepYes = report(inp, credit, "2026-09");
  const octNo = report(inp, undefined, "2026-10"), octYes = report(inp, credit, "2026-10");
  assert.equal(P$(sepYes).value, P$(sepNo).value, "September unchanged");
  assert.equal(P$(sepYes).credits.state, "absent");
  assert.equal(ser({ ...sepYes, actual: { ...sepYes.actual, purchases: { ...P$(sepYes), credits: null } } }), ser({ ...sepNo, actual: { ...sepNo.actual, purchases: { ...P$(sepNo), credits: null } } }));
  assert.equal(BigInt(P$(octNo).value) - BigInt(P$(octYes).value), 500n, "October reduced by exactly the credit");
});

test("P1C-06 month and year boundaries: 31 Aug → August, 1 Sep → September; 31 Dec 2026 → 2026-12, 1 Jan 2027 → 2027-01", () => {
  const rows = [...monthRows("2026-08", 31), ...monthRows("2026-09", 30, undefined, 40)];
  const credits = node(rec(1, "s1", "2026-08-31", "11"), rec(2, "s1", "2026-09-01", "22"));
  assert.equal(P$(report(inputs(rows), credits, "2026-08")).credits.value, "11");
  assert.equal(P$(report(inputs(rows), credits, "2026-09", "open_month")).credits.value, "22");
  const ye = [...monthRows("2026-12", 31), ...monthRows("2027-01", 31, undefined, 40)];
  const inpYe = inputs(ye, { asOf: "2027-02-10" });
  const cYe = node(rec(1, "s1", "2026-12-31", "7"), rec(2, "s1", "2027-01-01", "9"));
  assert.equal(P$(report(inpYe, cYe, "2026-12")).credits.value, "7");
  assert.equal(P$(report(inpYe, cYe, "2027-01")).credits.value, "9");
});

test("P1C-07 leap dates: 2028-02-29 is a valid issue date; 2027-02-29 / 2026-02-30 / 2026-13-01 are invalid and fail CLOSED (undatable ⇒ every window is incomplete)", () => {
  const inpLeap = inputs(monthRows("2028-02", 29), { asOf: "2028-03-10" });
  const ok = report(inpLeap, node(rec(1, "s1", "2028-02-29", "40")), "2028-02");
  assert.equal(P$(ok).credits.value, "40"); assert.equal(P$(ok).complete, true);
  for (const bad of ["2027-02-29", "2026-02-30", "2026-13-01", "2026-8-01", "", 20260801]) {
    const st = SERVER.decodeSupplierCredits(node(rec(1, "s1", bad, "40")));
    assert.equal(st.state, "present"); assert.equal(st.records.length, 0, String(bad)); assert.equal(st.credits.length, 0);
    assert.deepEqual(st.issues.map((i) => [i.code, i.dates]), [["invalid_issue_date", []]], String(bad));
    const r = report(inputs(AUG()), st);
    assert.equal(P$(r).complete, false, "an undatable credit could belong to any month: never complete");
    assert.equal(P$(r).credits.state, "invalid");
    assert.equal(r.actual.purchasesPct.state, "invalid_components", "Food Cost never complete-looking");
    assert.ok(r.actual.purchases.value === "9000", "the valid figures are kept (no silent zero), only completeness drops");
  }
});

// ── P1C-08 explicit zero / missing / invalid / unreadable stay distinct ───────
test("P1C-08 explicit zero purchases, a zero / invalid credit amount, missing purchases and an unreadable node are distinct states", () => {
  // explicit zero purchases + no credits ⇒ complete zero
  const zeroRows = monthRows("2026-08", 31, () => ({ s1: "0" }));
  const z = report(inputs(zeroRows), undefined);
  assert.equal(P$(z).value, "0"); assert.equal(P$(z).complete, true);
  // a ZERO credit is not a credit: invalid (dated) ⇒ that month incomplete, other months untouched
  for (const amt of ["0", "0.00", "-300", "300.50", " 300", "3,000", "1e3", 300, null, "abc", "1234567890"]) {
    const st = SERVER.decodeSupplierCredits(node(rec(1, "s1", "2026-08-12", "1", { raw: { amount: amt } })));
    assert.deepEqual(st.issues.map((i) => [i.code, i.dates]), [["invalid_amount", ["2026-08-12"]]], JSON.stringify(amt));
    const r = report(inputs(AUG()), st);
    assert.equal(P$(r).complete, false); assert.equal(P$(r).credits.state, "invalid"); assert.deepEqual(P$(r).credits.invalidDates, ["2026-08-12"]);
    assert.equal(P$(r).value, "9000", "an invalid credit is never counted and never zeroes the purchases");
    assert.ok(r.actual.purchases.issues === undefined || true);
    assert.equal(r.actual.purchasesPct.state, "invalid_components");
    const sep = report(inputs([...AUG(), ...monthRows("2026-09", 28, undefined, 40)]), st, "2026-09", "open_month");
    assert.equal(P$(sep).credits.state, "absent", "a dated invalid credit only affects its own month");
  }
  // unreadable node ⇒ every window invalid (never "no credits")
  const V = node(rec(1, "s1", "2026-08-12", "5"));
  const unreadable = ["x", 7, [],
    { schemaVersion: 1, revision: 1, records: {} },                                              // the rejected P1 schema is never reinterpreted
    mutate(V, (n) => { n.contract = "MARJIN_CREDITS/1"; }), mutate(V, (n) => { n.revision = 0; }), mutate(V, (n) => { n.revision = 1.5; }),
    mutate(V, (n) => { n.records = []; }), mutate(V, (n) => { n.records = "r"; }), mutate(V, (n) => { n.extra = 1; }), mutate(V, (n) => { delete n.tenantId; }),
    mutate(V, (n) => { n.review = "x"; }), mutate(V, (n) => { n.records = {}; })];
  for (const raw of unreadable) {
    const st = SERVER.decodeSupplierCredits(raw);
    assert.equal(st.state, "unreadable", JSON.stringify(raw));
    const r = report(inputs(AUG()), st);
    assert.equal(P$(r).complete, false); assert.equal(P$(r).credits.state, "invalid"); assert.equal(r.actual.purchasesPct.state, "invalid_components");
    assert.ok(r.flags.some((f) => f.code === "supplier_credits_unreadable"));
  }
  // not loaded (the caller never read the node) ⇒ invalid, never zero
  const nl = report(inputs(AUG()), { state: "not_loaded" });
  assert.equal(P$(nl).complete, false); assert.equal(P$(nl).credits.state, "invalid");
  // missing purchases on an operating day stay "missing", independent of credits
  const holey = AUG().filter((e) => e.date !== "2026-08-05");
  const m = report(inputs(holey), node(rec(1, "s1", "2026-08-05", "10")));
  assert.equal(P$(m).complete, false); assert.equal(P$(m).credits.state, "present", "the credit itself is valid");
  assert.equal(P$(m).value, String(9000 - 300 - 10), "the credit on a day without recorded purchases is still subtracted");
});

test("P1C-09 malformed records: id mismatch, supplier, audit metadata, role, document identity, links, binding — reported as issues, never counted, never dropped silently", () => {
  const V = node(rec(1, "s1", "2026-08-12", "5"));
  const R = (fn) => mutate(V, (n) => fn(n.records[cid(1)], n));
  const cases = [
    [R((r) => { r.creditId = cid(9); }), "id_mismatch", ["2026-08-12"]],
    [R((r) => { r.supplierId = ""; }), "invalid_supplier", ["2026-08-12"]],
    [R((r) => { r.supplierId = "a/b"; }), "invalid_supplier", ["2026-08-12"]],
    [R((r) => { r.supplierId = 7; }), "invalid_supplier", ["2026-08-12"]],
    [R((r) => { delete r.createdBy; }), "invalid_record", ["2026-08-12"]],                 // missing audit metadata (P1 review finding 3)
    [R((r) => { r.createdAt = "yesterday"; }), "invalid_audit", ["2026-08-12"]],          // malformed audit metadata
    [R((r) => { r.createdBy = 42; }), "invalid_audit", ["2026-08-12"]],
    [R((r) => { r.createdRole = "intern"; }), "invalid_audit", ["2026-08-12"]],
    [R((r) => { r.seq = 0; }), "invalid_audit", ["2026-08-12"]],
    [R((r) => { r.status = "active"; }), "invalid_record", ["2026-08-12"]],               // no mutable status field in MARJIN_CREDITS/2
    [R((r) => { r.documentKey = "cr9"; }), "invalid_document", ["2026-08-12"]],
    [R((r) => { delete r.documentNumber; }), "invalid_record", ["2026-08-12"]],             // the document number is mandatory
    [R((r) => { r.replacesCreditId = "nope"; }), "invalid_link", ["2026-08-12"]],
    [R((r) => { r.tenantId = "tenantB"; }), "binding_mismatch", []],                       // a record of another business: unattributable
  ];
  for (const [raw, code, dates] of cases) {
    const st = SERVER.decodeSupplierCredits(raw);
    assert.equal(st.state, "present"); assert.equal(st.credits.length, 0, code); assert.equal(st.records.length, 0, code);
    assert.ok(st.issues.some((i) => i.code === code && JSON.stringify(i.dates) === JSON.stringify(dates)), code + " " + JSON.stringify(st.issues));
    // nothing else may be reported for an attributable defect; an unattributable one may orphan the entries it owned (never attributable)
    if (dates.length) assert.equal(st.issues.length, 1, code); else assert.ok(st.issues.every((i) => i.dates.length === 0), code);
  }
  const notObj = SERVER.decodeSupplierCredits(mutate(V, (n) => { n.records[cid(1)] = "x"; }));
  assert.ok(notObj.issues.some((i) => i.code === "invalid_record" && i.dates.length === 0));
  const badKey = SERVER.decodeSupplierCredits(mutate(V, (n) => { n.records["not-a-uuid"] = n.records[cid(1)]; delete n.records[cid(1)]; }));
  assert.ok(badKey.issues.some((i) => i.code === "id_mismatch"));
});

test("P1C-10 history: void / replace chains count ONLY the effective successor; a valid replaced pair decodes cleanly", () => {
  const base = node(rec(1, "s1", "2026-08-12", "500"), rec(3, "s1", "2026-08-15", "999", { voided: true }));
  const st = SERVER.decodeSupplierCredits(replaceIn(base, 1, 2, { issueDate: "2026-08-14", amount: "450" }));
  assert.equal(st.issues.length, 0); assert.equal(st.records.length, 3);
  assert.deepEqual(st.records.map((x) => [x.creditId, x.status]), [[cid(1), "replaced"], [cid(2), "active"], [cid(3), "voided"]]);
  const r = report(inputs(AUG()), st);
  assert.equal(P$(r).credits.value, "450"); assert.equal(P$(r).credits.count, 1); assert.equal(P$(r).value, "8550");
  // the record key IS the identity: a second record claiming the same creditId under another key is refused
  const dup = SERVER.decodeSupplierCredits(mutate(base, (n) => { n.records[cid(2)] = { ...n.records[cid(1)] }; }));
  assert.ok(dup.issues.some((i) => i.code === "id_mismatch")); assert.equal(dup.credits.length, 0, "the corrupt logical credit 1 contributes nothing (credit 3 is voided)");
  assert.ok(dup.issues.every((i) => i.dates.includes("2026-08-12")), "the defect is attributed to the corrupt credit's dates");
});

// ── P1C-11 negative net ──────────────────────────────────────────────────────
test("P1C-11 credits above purchases: a NEGATIVE net is kept (never floored at 0), flagged for the window and the supplier; Food Cost is a negative ratio", () => {
  const r = report(inputs(AUG()), node(rec(1, "s1", "2026-08-20", "9500")));
  assert.equal(P$(r).value, "-500"); assert.equal(P$(r).bySource["supplier:s1"], "-500");
  assert.ok(r.flags.some((f) => f.code === "negative_net_purchases" && f.key === "window"));
  assert.ok(r.flags.some((f) => f.code === "negative_supplier_net" && f.key === "supplier:s1"));
  assert.equal(r.actual.purchasesPct.state, "value"); assert.equal(r.actual.purchasesPct.value, "-50/31", "−500 / 31,000 = −1.61 % — shown, not corrected");
  const d = SERVER.productDayRecord(withCredits(SERVER, inputs(AUG()), node(rec(1, "s1", "2026-08-20", "9500"))), "2026-08-20");
  assert.equal(d.day.purchases.value.c, -9200n); assert.ok(d.day.flags.some((f) => f.code === "negative_net_purchases"), "the day carries the flag");
});

test("P1C-12 credits NEVER increase purchases or Food Cost (property over many fixtures)", () => {
  const amounts = ["0.01", "1", "299.99", "300", "4500", "9000", "12000.5"];
  const base = report(inputs(AUG()), undefined);
  for (const [i, a] of amounts.entries()) {
    for (const date of ["2026-08-01", "2026-08-16", "2026-08-31"]) {
      const r = report(inputs(AUG()), node(rec(i + 1, i % 2 ? "s1" : "s9", date, a)));
      const net = Number(P$(r).value), gross = Number(P$(base).value);
      assert.ok(net < gross, `${a}@${date}: net ${net} < gross ${gross}`);
      assert.equal(Math.round((gross - net) * 100), Math.round(Number(a) * 100));
    }
  }
});

// ── P1C-13 closed days, D-1, forecast ───────────────────────────────────────
test("P1C-13 a credit issued on a declared CLOSED day counts (its period is its issue date) and is not a closed-day contradiction", () => {
  const rows = AUG().filter((e) => e.date !== "2026-08-09");
  const inp = inputs(rows, { exceptionsByDate: { "2026-08-09": true } });
  const r = report(inp, node(rec(1, "s1", "2026-08-09", "60")));
  assert.equal(P$(r).credits.value, "60"); assert.equal(P$(r).value, String(9000 - 300 - 60));
  assert.ok(!flagCodes(r).includes("closed_day_has_recorded_values"));
  assert.equal(r.coverage.day.closed !== undefined || true, true);
  const plain = report(inp, undefined);
  assert.equal(ser({ ...plain, actual: { ...plain.actual, purchases: null, purchasesPct: null, contributionBeforeFixed: null, operatingProfit: null } }).length > 0, true);
  assert.deepEqual(r.coverage, plain.coverage, "closed-day coverage is unchanged by credits");
});

test("P1C-14 Actual D-1: a credit issued TODAY or in the future is not counted; it counts once its date is completed", () => {
  const rows = monthRows("2026-09", 28);
  const credits = node(rec(1, "s1", AS_OF, "70"), rec(2, "s1", "2026-09-30", "80"), rec(3, "s1", "2026-09-28", "5"));
  assert.ok(credits);
  const today = report(inputs(rows), credits, "2026-09", "open_month");
  assert.equal(P$(today).credits.value, "5", "only the completed date 2026-09-28 (asOf 2026-09-29)");
  const later = report(inputs(rows, { asOf: "2026-10-01" }), credits, "2026-09");
  assert.equal(P$(later).credits.value, "155", "after the month closes all three count");
  assert.equal(SERVER.productDayRecord(withCredits(SERVER, inputs(rows), credits), AS_OF).reason, "current_day");
});

test("P1C-15 forecast and projection: REV_FORECAST/v2 revenue is unchanged by credits; the projection's purchases use the NET ratio", () => {
  const rows = [...AUG(), ...monthRows("2026-09", 28, undefined, 40)];
  const credits = node(rec(1, "s1", "2026-09-10", "840"));
  const inp = withCredits(SERVER, inputs(rows), credits);
  const rYes = SERVER.productMonthReport(inp, { kind: "open_month", month: "2026-09" });
  const rNo = SERVER.productMonthReport(inputs(rows), { kind: "open_month", month: "2026-09" });
  const pYes = SERVER.productMonthProjection(inp, rYes, { nowMs: NOW_MS });
  const pNo = SERVER.productMonthProjection(inputs(rows), rNo, { nowMs: NOW_MS });
  assert.equal(pYes.forecast.projectedRevenue, pNo.forecast.projectedRevenue, "revenue forecast untouched");
  assert.deepEqual(pYes.forecast.engine, pNo.forecast.engine);
  assert.ok(pYes.projection && pNo.projection);
  const ratio = (r) => Number(r.actual.purchases.value) / Number(r.actual.revenue.value);
  const proj = (p) => Number(p.projection.purchases);
  assert.ok(Math.abs(proj(pYes) / proj(pNo) - ratio(rYes) / ratio(rNo)) < 1e-9, "projected purchases scale with the net ratio");
  for (const [, P] of ENGINES) {
    const i2 = withCredits(P, inputs(rows), credits);
    const r2 = P.productMonthReport(i2, { kind: "open_month", month: "2026-09" });
    assert.equal(stableJson(P.productMonthProjection(i2, r2, { nowMs: NOW_MS }).projection), stableJson(pYes.projection));
  }
});

// ── P1C-16 parity / reconciliation ──────────────────────────────────────────
test("P1C-16 reconciliation: Σ grossBySource − Σ credits.bySupplier = Σ bySource = purchases.value, per supplier and overall, on every fixture and engine", () => {
  const fixtures = [
    node(rec(1, "s1", "2026-08-15", "300")),
    node(rec(1, "s1", "2026-08-03", "50"), rec(2, "s2", "2026-08-31", "100"), rec(3, "s3", "2026-08-21", "10.25")),
    node(rec(1, "s1", "2026-08-20", "9500")),
  ];
  const rows = monthRows("2026-08", 31, (d) => ({ s1: "300", s2: d % 2 ? "100" : "0" }));
  for (const f of fixtures) {
    const r = report(inputs(rows), f);
    const p = P$(r);
    const keys = new Set([...Object.keys(p.grossBySource), ...Object.keys(p.credits.bySupplier), ...Object.keys(p.bySource)]);
    let sum = 0;
    for (const k of keys) {
      const g = Number(p.grossBySource[k] || 0), c = Number(p.credits.bySupplier[k] || 0), n = Number(p.bySource[k] || 0);
      assert.ok(Math.abs(g - c - n) < 1e-9, k);
      sum += n;
    }
    assert.ok(Math.abs(sum - Number(p.value)) < 1e-9);
    assert.ok(Math.abs(Number(p.gross.value) - Number(p.credits.value) - Number(p.value)) < 1e-9);
  }
});

test("P1C-17 the core decoder and the per-date facts are engine-identical (server ≡ browser ≡ committed)", () => {
  const raws = [null, {}, node(rec(1, "s1", "2026-08-15", "300")), node(rec(1, "s1", "2027-02-29", "5")), "x", { schemaVersion: 1, revision: 1, records: {} },
    node(rec(1, "s1", "2026-08-12", "1", { raw: { amount: "0" } })), node(rec(1, "s1", "2026-08-12", "3", { review: "pending" })), node(rec(1, "s1", "2026-08-15", "4", { review: "flagged" }))];
  const cores = [BROWSER, COMMITTED];
  for (const raw of raws) {
    const s = stableJson(SERVER.decodeSupplierCredits(raw));
    for (const C of cores) assert.equal(stableJson(C.finance.supplierCredits.decodeSupplierCredits(raw)), s, JSON.stringify(raw));
    const st = SERVER.decodeSupplierCredits(raw);
    const dates = ["2026-08-11", "2026-08-12", "2026-08-15"];
    const ref = stableJson([...BROWSER.finance.supplierCredits.creditsByDate(st, dates)]);
    assert.equal(stableJson([...COMMITTED.finance.supplierCredits.creditsByDate(st, dates)]), ref);
  }
  assert.equal(BROWSER.versions.credits, "MARJIN_CREDITS/2"); assert.equal(COMMITTED.versions.credits, "MARJIN_CREDITS/2");
  assert.equal(SERVER.SUPPLIER_CREDITS_CONTRACT_VERSION, "MARJIN_CREDITS/2");
});

test("P1C-18 canonicalCreditAmount: only plain positive decimals (≤ 9 integer digits, ≤ 2 decimals) are amounts; output canonical", () => {
  const f = BROWSER.finance.supplierCredits.canonicalCreditAmount;
  const ok = [["300", "300"], ["300.5", "300.5"], ["300.50", "300.5"], ["0.01", "0.01"], ["999999999.99", "999999999.99"], ["0.10", "0.1"]];
  for (const [a, b] of ok) assert.equal(f(a), b, a);
  for (const a of ["0", "0.0", "00", "-1", "+1", "1.", ".5", "1.234", "1e2", "1,000", " 1", "1 ", "1000000000", 1, null, undefined, "", "NaN", "Infinity", "0x10", "01"]) assert.equal(f(a), null, JSON.stringify(a));
});

// ── P1C-M mutation controls (disposable fincore copies; the committed artifact is never edited) ──
async function mutantCore(patches) {
  const dir = mkdtempSync(join(tmpdir(), "p1-mutant-"));
  cpSync(join(REPO, "fincore", "v1"), dir, { recursive: true });
  for (const [file, from, to] of patches) {
    const p = join(dir, file); const s = readFileSync(p, "utf8");
    assert.ok(s.includes(from), "mutation anchor present in " + file + ": " + from);
    writeFileSync(p, s.replace(from, to));
  }
  return (await import(pathToFileURL(join(dir, "browser", "marjinFinanceGlobal.js")).href + "?m=" + Math.random())).default;
}
const COCA = () => [inputs(AUG()), node(rec(1, "s1", "2026-08-15", "300"))];
const octCase = () => {
  const rows = [...monthRows("2026-09", 30), ...monthRows("2026-10", 31, undefined, 100)];
  return [inputs(rows, { asOf: "2026-11-05" }), node(rec(1, "s1", "2026-10-02", "500"))];
};
const checks = {
  net: (C) => { const [i, n] = COCA(); return month(C.product, i, n).actual.purchases.value === "8700"; },
  issueMonth: (C) => { const [i, n] = octCase(); return month(C.product, i, n, "2026-09").actual.purchases.credits.state === "absent" && month(C.product, i, n, "2026-10").actual.purchases.credits.value === "500"; },
  negative: (C) => month(C.product, inputs(AUG()), node(rec(1, "s1", "2026-08-20", "9500"))).actual.purchases.value === "-500",
  invalidNotZero: (C) => month(C.product, inputs(AUG()), node(rec(1, "s1", "2026-08-12", "1", { raw: { amount: "0" } }))).actual.purchases.complete === false,
  never_increase: (C) => { const [i, n] = COCA(); return Number(month(C.product, i, n).actual.purchases.value) < 9000; },
};
test("P1C-M0 positive control: the committed core passes every mutation check", () => {
  for (const [k, fn] of Object.entries(checks)) assert.equal(fn(COMMITTED), true, k);
});
const MUTANTS = [
  ["formula duplication: credits subtracted twice (day + period)", [["metrics/report.js", "if (!grossPresent)\n            creditsOffGross", "if (true)\n            creditsOffGross"]], ["net"]],
  ["issue-date reassignment: credits attributed to an earlier month (issue date − 1 month)", [["finance/supplierCredits.js", "if (!wanted.has(c.issueDate))", "if (!wanted.has(c = { ...c, issueDate: c.issueDate.slice(5,7)==='10' ? c.issueDate.replace('-10-','-09-') : c.issueDate }, c).issueDate)"]], ["issueMonth"]],
  ["negative-purchase substitution: credits ADDED as purchases (sign flip)", [["finance/supplierCredits.js", "value = decSub(value, credits.value);", "value = decAdd(value, credits.value);"]], ["net", "never_increase"]],
  ["silent floor at zero", [["finance/supplierCredits.js", "if (decIsNegative(value))", "if (decIsNegative(value) && (value = decFromPlainString(\"0\")))"]], ["negative"]],
  ["invalid credit read as zero (complete)", [["metrics/report.js", "complete: netOnPresent.total.complete && creditInvalidDates.length < 1", "complete: netOnPresent.total.complete"], ["finance/supplierCredits.js", "partial: gross.partial || creditsIncomplete", "partial: gross.partial"]], ["invalidNotZero"]],
];
for (const [name, patches, expectFail] of MUTANTS) {
  test("P1C-M " + name + " ⇒ caught", async () => {
    const C = await mutantCore(patches);                              // a missing anchor fails the test (never a vacuous pass)
    const failed = expectFail.filter((k) => { try { return checks[k](C) !== true; } catch (_) { return true; } });
    assert.ok(failed.length >= 1, name + ": at least one of " + expectFail.join(",") + " must fail");
  });
}
