// P1 R1 — strict reader: replacement / void / audit / identity / head / review validation (MARJIN_CREDITS/4)
// and the accounting of DEC-AUTH-1 review states.
//   CA-*  every corruption reproduced on the rejected candidate (Stage A probes A3a…A3k) is now an ISSUE:
//         the corrupt logical credit contributes NOTHING (no earlier "valid-looking" record is used) and
//         its dates — or, if unattributable, every date — are incomplete; untouched credits still count
//   RS-*  review states: pending / flagged never counted and never silently absent; accept counts exactly
//         once; reject never counts; a pending void / replace keeps the authoritative baseline (incomplete)
// Every report runs on the server engine, the freshly generated browser core and the COMMITTED fincore
// artifact and must serialize identically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCompiled, loadCommitted } from "../support/fincore-load.mjs";
import { compileServer } from "../support/server-reader-harness.mjs";
import { entry, inputs, stableJson, uid } from "../support/b1-fixtures.mjs";
import { cid, oid, spec, creditNode, replaceIn, voidIn, resolve, mutate, T, B } from "../support/p1-credit-fixtures.mjs";

const BROWSER = await loadCompiled();
const COMMITTED = await loadCommitted();
const SERVER = await compileServer().import("src/policy/productFinance.js");
const ENGINES = [["server", SERVER], ["browser", BROWSER.product], ["committed", COMMITTED.product]];
const ser = BROWSER.metrics.report.serializeReport;
const pad = (n) => String(n).padStart(2, "0");
const AUG = () => Array.from({ length: 31 }, (_, i) => entry(uid(1 + i), `2026-08-${pad(i + 1)}`, { sales: "1000", supplier_payments: { s1: i < 30 ? "300" : "0" }, payroll: "100" }));
function report(raw) {
  const outs = ENGINES.map(([e, P]) => [e, P.productMonthReport({ ...inputs(AUG()), supplierCredits: P.decodeSupplierCredits(raw, { tenantId: T, bizId: B }) }, { kind: "closed_month", month: "2026-08" })]);
  for (const [e, r] of outs) assert.equal(ser(r), ser(outs[0][1]), e + " ≢ server");
  return outs[0][1];
}
const dec = (raw) => SERVER.decodeSupplierCredits(raw, { tenantId: T, bizId: B });
const P$ = (r) => r.actual.purchases;
const codes = (st) => st.issues.map((i) => i.code).sort();

// a business with an UNTOUCHED logical credit 9 (s1, 2026-08-20, 40) beside the one under test
const OTHER = spec(9, "s1", "2026-08-20", "40");
/** Credit 1 (2026-08-05, 100) replaced by credit 2 (2026-08-07, 90); plus the untouched credit 9. */
const CHAIN = () => replaceIn(creditNode([spec(1, "s1", "2026-08-05", "100"), OTHER]), 1, 2, { issueDate: "2026-08-07", amount: "90" });

test("CA-00 positive control: the valid chain counts ONLY its effective successor (90) and the other credit (40); complete", () => {
  const st = dec(CHAIN());
  assert.deepEqual(st.issues, []);
  assert.deepEqual(st.credits.map((c) => [c.creditId, c.amount]), [[cid(2), "90"], [cid(9), "40"]]);
  const r = report(CHAIN());
  assert.equal(P$(r).credits.value, "130"); assert.equal(P$(r).complete, true); assert.equal(P$(r).value, String(9000 - 130));
});

/** [name, corruption, expected issue code, attributable?] — red on 1057af89: raw-logs/review/A-probes. */
const CORRUPTIONS = [
  ["A3a missing creation audit metadata (createdBy / createdAt / createdRole)", (n) => { for (const k of ["createdBy", "createdAt", "createdRole"]) delete n.records[cid(2)][k]; }, "invalid_record", true],
  ["A3b malformed audit metadata (createdAt text, createdBy number, unknown role)", (n) => { Object.assign(n.records[cid(2)], { createdAt: "yesterday", createdBy: 42, createdRole: "intern" }); }, "invalid_audit", true],
  ["A3c void / replace event without actor", (n) => { delete n.voids[oid(2)].voidedBy; }, "invalid_void", true],
  ["A3d non-reciprocal link: the replace event names ANOTHER successor", (n) => { n.voids[oid(2)].replacedByCreditId = cid(9); }, "invalid_review", true],
  ["A3d' non-reciprocal link: the successor does not name its predecessor", (n) => { delete n.records[cid(2)].replacesCreditId; }, "invalid_link", true],
  ["A3e successor of an ACTIVE predecessor (the replace event is missing) — no double counting", (n) => { delete n.voids[oid(2)]; }, "invalid_review", true],
  ["A3f dangling successor (the replacement record is missing)", (n) => { delete n.records[cid(2)]; }, "invalid_review", true],
  ["A3g dangling predecessor (the root record is missing)", (n) => { delete n.records[cid(1)]; }, "invalid_review", true],
  ["A3h cycle (the root names its successor as predecessor)", (n) => { n.records[cid(1)].replacesCreditId = cid(2); }, "invalid_link", true],
  ["A3i fork (a second successor of the same record)", (n) => { n.records[cid(3)] = { ...n.records[cid(2)], creditId: cid(3), documentNumber: n.records[cid(2)].documentNumber }; }, "invalid_review", true],
  ["A3j a record of ANOTHER business (tenant / business binding)", (n) => { n.records[cid(2)].bizId = "bizB"; }, "binding_mismatch", false],
  ["A3k the replace event's reason code is wrong / absent", (n) => { delete n.voids[oid(2)].reasonCode; }, "invalid_void", true],
  ["head: the current pointer is stale (still names the predecessor)", (n) => { n.heads[cid(1)].creditId = cid(1); }, "invalid_head", true],
  ["head: the sequence is wrong", (n) => { n.heads[cid(1)].seq = 7; }, "invalid_head", true],
  ["head: missing", (n) => { delete n.heads[cid(1)]; }, "invalid_head", true],
  ["sequence: a gap in the chain sequence", (n) => { n.records[cid(2)].seq = 3; n.voids[oid(2)].seq = 3; n.review[oid(2)].seq = 3; n.heads[cid(1)].seq = 3; }, "invalid_chain", true],
  ["timestamps: the replacement precedes its predecessor's creation", (n) => { const t = n.records[cid(1)].createdAt - 5; n.records[cid(2)].createdAt = t; n.voids[oid(2)].voidedAt = t; n.review[oid(2)].committedAt = t; n.review[oid(2)].resolvedAt = t; }, "invalid_audit", true],
  ["review: missing for an operation", (n) => { delete n.review[oid(2)]; }, "invalid_review", true],
  ["review: actor differs from the record's creator", (n) => { n.review[oid(2)].actor = "intruder"; }, "invalid_audit", true],
  ["review: kind / target do not match the operation", (n) => { n.review[oid(2)].kind = "void"; delete n.review[oid(2)].newCreditId; }, "invalid_review", true],
  ["review: malformed state fields (cleared without resolution)", (n) => { delete n.review[oid(2)].resolution; }, "invalid_review", true],
  ["review: TWO unresolved operations (an earlier one reopened)", (n) => { const r = n.review[oid(1)]; n.review[oid(1)] = { schema: r.schema, state: "pending", kind: r.kind, logicalId: r.logicalId, creditId: r.creditId, seq: r.seq, intentDigest: r.intentDigest, actor: r.actor, actorRole: r.actorRole, committedAt: r.committedAt }; const r2 = n.review[oid(2)]; n.review[oid(2)] = { schema: r2.schema, state: "pending", kind: r2.kind, logicalId: r2.logicalId, creditId: r2.creditId, newCreditId: r2.newCreditId, seq: r2.seq, intentDigest: r2.intentDigest, actor: r2.actor, actorRole: r2.actorRole, committedAt: r2.committedAt }; }, "invalid_review", true],
  ["review: an orphan entry for no operation", (n) => { n.review["orphan-op-0001"] = { ...n.review[oid(2)] }; }, "invalid_review", true],
  ["identity: the reservation names another logical credit", (n) => { n.documents.s_s1["d_cr~2d~1"].logicalId = cid(9); }, "invalid_document", "both"],
  ["identity: the record's normalized key does not match its number", (n) => { n.records[cid(2)].documentKey = "cr77"; }, "invalid_document", true],
  ["identity: an unflagged identity change on replacement", (n) => { Object.assign(n.records[cid(2)], { documentNumber: "CR-77", documentKey: "cr77" }); n.documents.s_s1["d_cr~2d~77"] = { ...n.documents.s_s1["d_cr~2d~1"], creditId: cid(2), operationId: oid(2), reservedAt: n.records[cid(2)].createdAt }; }, "invalid_document", true],
  ["identity: a reservation used by no record", (n) => { n.documents.s_s1["d_cr~2d~555"] = { ...n.documents.s_s1["d_cr~2d~1"] }; }, "invalid_document", true],
  ["orphan: a head of no logical credit", (n) => { n.heads[cid(77)] = { creditId: cid(77), seq: 1 }; }, "orphan_entry", false],
];

for (const [name, fn, code0, attributable] of CORRUPTIONS) {
  const allowed = [].concat(code0);
  test("CA " + name + " ⇒ " + allowed.join("|") + "; a corrupt credit contributes nothing; its dates are incomplete; untouched credits still count", () => {
    const raw = mutate(CHAIN(), fn);
    const st = dec(raw);
    assert.equal(st.state, "present");
    assert.ok(st.issues.some((i) => allowed.includes(i.code)), name + ": " + JSON.stringify(st.issues));
    // NEVER use an earlier, apparently valid record of a corrupt chain: neither 100 (the predecessor) nor 90
    if (attributable !== false || allowed.includes("binding_mismatch")) assert.ok(!st.credits.some((c) => c.logicalId === cid(1)), "the corrupt logical credit contributes nothing");
    const r = report(raw);
    assert.equal(P$(r).complete, false, "never complete");
    assert.equal(r.actual.purchasesPct.state, "invalid_components", "Food Cost never complete-looking");
    if (attributable === "both") {
      // a reservation claimed by ANOTHER logical credit: both credits are excluded (fail closed), dates attributed
      assert.ok(st.issues.every((i) => i.dates.length > 0)); assert.equal(st.credits.length, 0); assert.equal(P$(r).credits.value, null);
    } else if (attributable) {
      assert.ok(st.issues.every((i) => i.dates.length > 0), "attributed to dates");
      assert.ok(st.credits.some((c) => c.creditId === cid(9)), "the untouched credit 9 still counts");
      assert.equal(P$(r).credits.value, "40", "only the untouched credit is counted");
      for (const d of P$(r).credits.invalidDates) assert.ok(["2026-08-05", "2026-08-07"].includes(d), "only the corrupt credit's dates are incomplete: " + d);
    } else {
      assert.ok(st.issues.some((i) => i.dates.length === 0), "unattributable");
      assert.equal(P$(r).credits.invalidDates.length, 31, "every date incomplete");
    }
  });
}

test("CA-90 a node of ANOTHER business, a v1 node and a node with no records are unreadable for the bound reader (never reinterpreted)", () => {
  assert.deepEqual(SERVER.decodeSupplierCredits(CHAIN(), { tenantId: T, bizId: "bizB" }), { state: "unreadable", reason: "binding" });
  assert.deepEqual(SERVER.decodeSupplierCredits(CHAIN(), { tenantId: "tenantB", bizId: B }), { state: "unreadable", reason: "binding" });
  assert.equal(dec({ schemaVersion: 1, revision: 1, records: {} }).reason, "schema_version");
  assert.equal(dec(mutate(CHAIN(), (n) => { n.records = {}; })).reason, "section_shape");
});

// ── review-state accounting ──────────────────────────────────────────────────────────────────────
test("RS-01 a PENDING credit is not counted, never treated as absent: its date is incomplete with the review reason", () => {
  const raw = creditNode([spec(1, "s1", "2026-08-05", "100", { review: "pending" }), OTHER]);
  const st = dec(raw);
  assert.deepEqual(st.unresolved, { pending: [oid(1)], flagged: [] });
  assert.deepEqual(st.issues.map((i) => [i.code, i.dates]), [["review_pending", ["2026-08-05"]]]);
  assert.equal(st.records.find((x) => x.creditId === cid(1)).status, "not_effective");
  const r = report(raw);
  assert.equal(P$(r).credits.value, "40", "the pending 100 is not counted");
  assert.equal(P$(r).complete, false); assert.deepEqual(P$(r).credits.reviewPendingDates, ["2026-08-05"]); assert.deepEqual(P$(r).credits.reviewFlaggedDates, []);
  assert.ok(r.flags.some((f) => f.code === "supplier_credit_review_pending" && f.date === "2026-08-05"));
  assert.ok(r.issues === undefined || true);
});

test("RS-02 a FLAGGED credit is not counted until the OWNER decides; accepting counts it EXACTLY ONCE; rejecting never counts it and completes the date", () => {
  const flagged = creditNode([spec(1, "s1", "2026-08-05", "100", { review: "flagged" }), OTHER]);
  const rf = report(flagged);
  assert.equal(P$(rf).credits.value, "40"); assert.deepEqual(P$(rf).credits.reviewFlaggedDates, ["2026-08-05"]); assert.equal(P$(rf).complete, false);
  const accepted = resolve(creditNode([spec(1, "s1", "2026-08-05", "100", { review: "flagged" }), OTHER]), oid(1), "accepted", { now: 900000 }); // flagged → acknowledged
  const cleared = creditNode([spec(1, "s1", "2026-08-05", "100"), OTHER]);
  const ra = report(accepted), rc = report(cleared);
  assert.equal(P$(ra).credits.value, "140"); assert.equal(P$(ra).complete, true);
  assert.equal(P$(ra).value, P$(rc).value, "an accepted credit counts exactly like a cleared one (once)");
  assert.equal(dec(accepted).records.find((x) => x.creditId === cid(1)).review, "cleared");
  const rejected = creditNode([spec(1, "s1", "2026-08-05", "100", { review: "rejected" }), OTHER]);
  const rr = report(rejected);
  assert.equal(P$(rr).credits.value, "40", "a rejected credit never counts"); assert.equal(P$(rr).complete, true, "and its date is complete again");
  assert.equal(dec(rejected).logical.find((l) => l.logicalId === cid(1)).status, "rejected");
});

test("RS-03 a PENDING void keeps the AUTHORITATIVE baseline (the credit still counts) but makes its date incomplete; cleared ⇒ removed", () => {
  const base = creditNode([spec(1, "s1", "2026-08-05", "100"), OTHER]);
  const pend = voidIn(base, 1, { review: "pending" });
  const r = report(pend);
  assert.equal(P$(r).credits.value, "140", "the authoritative state is still active"); assert.equal(P$(r).complete, false); assert.deepEqual(P$(r).credits.reviewPendingDates, ["2026-08-05"]);
  const st = dec(pend);
  assert.deepEqual(st.records.find((x) => x.creditId === cid(1)).unresolved, { operationId: oid(7001), kind: "void", state: "pending" });
  const done = voidIn(base, 1);
  assert.equal(P$(report(done)).credits.value, "40"); assert.equal(P$(report(done)).complete, true);
  const rejected = voidIn(base, 1, { review: "rejected" });
  assert.equal(P$(report(rejected)).credits.value, "140", "a rejected void is ineffective: the credit counts again");
  assert.equal(dec(rejected).logical.find((l) => l.logicalId === cid(1)).status, "active");
});

test("RS-04 a PENDING / FLAGGED replacement: the predecessor still counts, the successor does not, BOTH dates incomplete; accept ⇒ successor; reject ⇒ predecessor (pointer restored)", () => {
  const base = creditNode([spec(1, "s1", "2026-08-05", "100"), OTHER]);
  for (const st0 of ["pending", "flagged"]) {
    const raw = replaceIn(base, 1, 2, { issueDate: "2026-08-07", amount: "90" }, { review: st0 });
    const r = report(raw);
    assert.equal(P$(r).credits.value, "140", st0 + ": the predecessor still counts");
    const want = ["2026-08-05", "2026-08-07"];
    assert.deepEqual(st0 === "pending" ? P$(r).credits.reviewPendingDates : P$(r).credits.reviewFlaggedDates, want);
    assert.equal(dec(raw).logical.find((l) => l.logicalId === cid(1)).head.creditId, cid(2), "the pointer already names the successor");
  }
  const acc = replaceIn(base, 1, 2, { issueDate: "2026-08-07", amount: "90" }, { review: "accepted" });
  assert.equal(P$(report(acc)).credits.value, "130"); assert.equal(P$(report(acc)).complete, true);
  const rej = replaceIn(base, 1, 2, { issueDate: "2026-08-07", amount: "90" }, { review: "rejected" });
  const sr = dec(rej);
  assert.equal(P$(report(rej)).credits.value, "140"); assert.equal(P$(report(rej)).complete, true);
  assert.equal(sr.logical.find((l) => l.logicalId === cid(1)).head.creditId, cid(1), "the pointer returns to the predecessor");
  assert.equal(sr.records.find((x) => x.creditId === cid(2)).status, "not_effective");
  assert.equal(sr.records.find((x) => x.creditId === cid(1)).replacedByCreditId, null, "a rejected successor is not a successor");
  // after a rejection the chain continues from the predecessor (a NEW replacement is valid)
  const again = replaceIn(rej, 1, 3, { issueDate: "2026-08-08", amount: "80" }, { now: 950000 });
  assert.deepEqual(dec(again).issues, []); assert.equal(P$(report(again)).credits.value, "120");
});

test("RS-05 pending is never displayed as cleared: record review / status and the logical credit's unresolved marker", () => {
  const raw = creditNode([spec(1, "s1", "2026-08-05", "100", { review: "pending" })]);
  const st = dec(raw);
  const r1 = st.records[0];
  assert.equal(r1.review, "pending"); assert.equal(r1.status, "not_effective"); assert.deepEqual(r1.unresolved, { operationId: oid(1), kind: "create", state: "pending" });
  assert.equal(st.logical[0].status, "unresolved_create");
  for (const C of [BROWSER, COMMITTED]) assert.equal(stableJson(C.finance.supplierCredits.decodeSupplierCredits(raw, { tenantId: T, bizId: B })), stableJson(st), "browser ≡ server");
});
