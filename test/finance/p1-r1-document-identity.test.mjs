// P1 R1 — mandatory document number and its uniqueness (owner decisions 2 / 3).
//   DI-N*  the ONE normalization rule (core ≡ writer ≡ browser): display value, key, refusals
//   DI-U*  uniqueness boundary tenant + business + canonical supplier + normalized number; void / reject never
//          free an identity; same-number replacement keeps it; an explicit corrected replacement reserves a new
//          one (the old stays reserved); no orphan reservation after a refused write
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCompiled, loadCommitted } from "../support/fincore-load.mjs";
import * as SC from "../../lib/supplierCredits.js";
import { cid, oid, spec, creditNode, replaceIn, voidIn, mutate } from "../support/p1-credit-fixtures.mjs";

const BROWSER = await loadCompiled(), COMMITTED = await loadCommitted();
const N = COMMITTED.finance.supplierCredits.normalizeDocumentNumber;

test("DI-N01 normalization: trimmed display with collapsed white space; key = NFKC + locale-independent lower case with every separator REMOVED (Codex remediation contract)", () => {
  const ok = [
    ["CR-001", "CR-001", "cr001"], ["CR001", "CR001", "cr001"], ["  cr 001  ", "cr 001", "cr001"], ["CR/001", "CR/001", "cr001"], ["CR - 001", "CR - 001", "cr001"],
    ["CR_001", "CR_001", "cr001"], ["CR.001", "CR.001", "cr001"], ["CR:001", "CR:001", "cr001"], ["CR\\001", "CR\\001", "cr001"], ["#001", "#001", "001"], ["CR \u00A0 001", "CR 001", "cr001"],
    ["CR–001", "CR–001", "cr001"], ["CR—001", "CR—001", "cr001"], ["CR\u2212001", "CR\u2212001", "cr001"], ["זכ־123", "זכ־123", "זכ123"], ["ＣＲ１２３", "CR123", "cr123"], ["ﬁ-1", "fi-1", "fi1"],
    ["חשבונית 45/7", "חשבונית 45/7", "חשבונית457"], ["7", "7", "7"], ["x".repeat(64), "x".repeat(64), "x".repeat(64)],
  ];
  for (const [raw, display, key] of ok) assert.deepEqual({ ...N(raw) }, { ok: true, display, key }, JSON.stringify(raw));
});

test("DI-N02 only separator formatting merges: leading zeros, letters vs digits and different scripts stay distinct; numbers differing ONLY in separator placement are one identity (accepted, OPEN_DECISIONS)", () => {
  const distinct = [["CR-001", "CR-1"], ["001", "1"], ["CR1", "CRI"], ["A1", "א1"], ["CR1", "CR11"], ["INV-1", "CR-1"]];
  for (const [a, b] of distinct) assert.notEqual(N(a).key, N(b).key, `${a} vs ${b}`);
  const merged = [["CR001", "CR-001"], ["CR 001", "cr/001"], ["12-3", "1-23"], ["CR 12", "CR 1 2"]];
  for (const [a, b] of merged) assert.equal(N(a).key, N(b).key, `${a} ≡ ${b}`);
});

test("DI-N03 refusals (never stripped, never truncated): missing / blank, non-string, control / bidi / format / private-use characters, other punctuation, no letter or digit, > 64", () => {
  const bad = [
    [undefined, "document_number_required"], [null, "document_number_required"], ["", "document_number_required"], ["   ", "document_number_required"],
    [7, "invalid_document_number"], [{}, "invalid_document_number"], ["CR\u0000", "invalid_document_number"], ["CR\t001", "invalid_document_number"], ["CR‏1", "invalid_document_number"], ["CR‮1", "invalid_document_number"],
    ["CR1", "invalid_document_number"], ["CR 1", "invalid_document_number"],
    ["CR*1", "invalid_document_number_chars"], ["CR(1)", "invalid_document_number_chars"], ["--", "invalid_document_number_chars"], ["#/.", "invalid_document_number_chars"],
    ["x".repeat(65), "invalid_document_number_too_long"],
  ];
  for (const [raw, code] of bad) assert.deepEqual({ ...N(raw) }, { ok: false, code }, JSON.stringify(raw));
});

test("DI-N04 one rule everywhere: server compile ≡ browser bundle ≡ committed bundle ≡ writer (imported)", () => {
  const inputs = ["CR-001", "  cr 001  ", "ＣＲ１２３", "12-3", "", null, "x".repeat(65), "CR‏1", "זכ־123"];
  for (const x of inputs) {
    const ref = JSON.stringify(N(x));
    assert.equal(JSON.stringify(BROWSER.finance.supplierCredits.normalizeDocumentNumber(x)), ref);
    assert.equal(JSON.stringify(SC.normalizeDocumentNumber(x)), ref);
  }
});

// ── uniqueness ───────────────────────────────────────────────────────────────────────────────────
const run = (node, c) => { c.requestHash = SC.requestHash(c); return SC.applyCreditOperation(node, c); };
const create = (node, n, over = {}, ctx = {}) => run(node, { action: "create", tenantId: ctx.tenantId || "tenantA", bizId: ctx.bizId || "bizA", creditId: cid(n), operationId: oid(n), input: SC.validateCreditInput({ supplierId: "s1", issueDate: "2026-08-10", amount: "10", documentNumber: "CR-1", ...over }), actorUid: "u1", actorRole: "manager", now: 2000 + n });

test("DI-U01 the boundary: same supplier + same normalized number ⇒ duplicate_document (any formatting); another supplier, business or tenant may reuse it", () => {
  const base = creditNode([spec(1, "s1", "2026-08-10", "10", { documentNumber: "CR-1" })]);
  for (const variant of ["CR-1", "CR1", "cr 1", "CR/1", " CR _ 1 ", "ＣＲ-１"]) {
    const r = create(base, 2, { documentNumber: variant });
    assert.deepEqual([r.outcome, r.code, r.detail], ["conflict", "duplicate_document", { logicalId: cid(1) }], variant);
  }
  assert.equal(create(base, 3, { supplierId: "s2", documentNumber: "CR-1" }).outcome, "applied", "another supplier");
  assert.equal(create(null, 4, {}, { bizId: "bizB" }).outcome, "applied", "another business (its own node)");
  assert.equal(create(null, 5, {}, { tenantId: "tenantB" }).outcome, "applied", "another tenant");
  assert.equal(create(base, 6, { documentNumber: "CR-01" }).outcome, "applied", "a genuinely different number");
});

test("DI-U02 void, rejection and a pending / flagged state never free an identity", () => {
  const voided = creditNode([spec(1, "s1", "2026-08-10", "10", { voided: true })]);
  assert.equal(create(voided, 2).code, "duplicate_document", "voided");
  const rejected = creditNode([spec(1, "s1", "2026-08-10", "10", { review: "rejected" })]);
  assert.equal(create(rejected, 2).code, "duplicate_document", "rejected");
  for (const review of ["pending", "flagged"]) assert.equal(create(creditNode([spec(1, "s1", "2026-08-10", "10", { review })]), 2).code, "duplicate_document", review);
});

test("DI-U03 a same-number replacement keeps the SAME identity; an explicit corrected-number replacement reserves the new one (old stays reserved and linked); correcting back to the chain's own earlier number is allowed", () => {
  const base = creditNode([spec(1, "s1", "2026-08-10", "10", { documentNumber: "CR-1" })]);
  const same = replaceIn(base, 1, 2, { amount: "9", documentNumber: "cr 1" });
  assert.deepEqual(Object.keys(same.documents.s_s1), ["d_cr1"]);
  assert.equal(same.records[cid(2)].identityCorrection, undefined);
  const corrected = replaceIn(base, 1, 3, { documentNumber: "CR-2" }, { identityCorrection: true });
  assert.deepEqual(Object.keys(corrected.documents.s_s1).sort(), ["d_cr1", "d_cr2"]);
  assert.equal(corrected.documents.s_s1["d_cr2"].logicalId, cid(1)); assert.equal(corrected.documents.s_s1["d_cr2"].creditId, cid(3));
  assert.equal(create(corrected, 4, { documentNumber: "CR-1" }).code, "duplicate_document", "the old identity stays reserved");
  assert.equal(create(corrected, 4, { documentNumber: "CR-2" }).code, "duplicate_document", "the corrected identity is reserved");
  const back = replaceIn(corrected, 3, 5, { documentNumber: "CR-1" }, { identityCorrection: true, now: 990000 });
  assert.deepEqual(COMMITTED.finance.supplierCredits.decodeSupplierCredits(back).issues, [], "correcting back to an identity this chain already holds is valid");
  // a correction to an identity held by ANOTHER logical credit is a duplicate
  const two = creditNode([spec(1, "s1", "2026-08-10", "10", { documentNumber: "CR-1" }), spec(2, "s1", "2026-08-11", "20", { documentNumber: "CR-9" })]);
  const head = two.heads[cid(1)];
  const c = { action: "replace", tenantId: "tenantA", bizId: "bizA", creditId: cid(1), newCreditId: cid(3), expectedSeq: head.seq, identityCorrection: true, input: SC.validateCreditInput({ supplierId: "s1", issueDate: "2026-08-10", amount: "10", documentNumber: "cr/9" }), operationId: oid(3), actorUid: "u1", actorRole: "manager", now: 99999 };
  assert.deepEqual(run(two, c).detail, { logicalId: cid(2) });
  // a supplier change is an identity change too
  assert.equal(run(base, { ...c, expectedSeq: base.heads[cid(1)].seq, identityCorrection: undefined, input: SC.validateCreditInput({ supplierId: "s2", issueDate: "2026-08-10", amount: "10", documentNumber: "CR-1" }) }).code, "identity_change_requires_correction");
});

test("DI-U04 no orphan reservation after a refused write: the transaction is atomic (record + reservation + review + ledger, or nothing)", () => {
  const base = creditNode([spec(1, "s1", "2026-08-10", "10")]);
  const before = JSON.stringify(base);
  for (const r of [create(base, 2), create(base, 1, { documentNumber: "CR-7" }), create(base, 3, { documentNumber: "CR-1" })]) assert.equal(r.outcome, "conflict");
  assert.equal(JSON.stringify(base), before, "the pure body never mutates its input");
  const extra = mutate(base, (n) => { n.documents.s_s1["d_cr99"] = { ...n.documents.s_s1["d_cr1"] }; });
  assert.ok(COMMITTED.finance.supplierCredits.decodeSupplierCredits(extra).issues.some((i) => i.code === "invalid_document"), "a reservation no record carries is a defect");
});

test("DI-U05 the reservation keys are RTDB-safe and never array-like, whatever the supplier id or number", () => {
  const node = creditNode([spec(1, "2", "2026-08-10", "10", { documentNumber: "1" }), spec(2, "3", "2026-08-11", "10", { documentNumber: "2" })]);
  assert.deepEqual(Object.keys(node.documents).sort(), ["s_2", "s_3"]);
  assert.deepEqual(Object.keys(node.documents.s_2), ["d_1"]);
  for (const k of [...Object.keys(node.documents), ...Object.keys(node.documents.s_2)]) assert.doesNotMatch(k, /^[0-9]+$|[.#$\[\]\/]/);
  assert.deepEqual(COMMITTED.finance.supplierCredits.decodeSupplierCredits(node).issues, []);
});
