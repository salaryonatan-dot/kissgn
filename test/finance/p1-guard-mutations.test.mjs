// P1 Supplier Credits — guard changes: the P1 index.html scope contract (test/support/p1-index-scope.mjs)
// and the P1 identity pins (test/support/p1-candidate-pin.mjs) used by the P1 layer of B2G-05, with
// negative controls: formula duplication, negative-purchase substitution, write-path changes,
// protected-path changes and C1-surface edits are all refused. The BASE page is read from git
// objects (the reviewed C1 R2 commit), never from the working tree. Committed-clone variants live
// in b2-guard-mutations.test.mjs (B2G-05-P1a / P1b).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { gitIn } from "../support/git-context.mjs";
import { C1_PROTECTED, diffHunks } from "../support/c1-index-scope.mjs";
import { C1_INDEX_PIN } from "../support/c1-candidate-pin.mjs";
import { P1_ACTIONS, P1_BASE, P1_ZONES, p1IndexVerdict } from "../support/p1-index-scope.mjs";
import { P1_PINS } from "../support/p1-candidate-pin.mjs";
import { p1Layer } from "../support/m1-layer.mjs";

const blob = (spec) => { const r = gitIn(REPO, ["cat-file", "blob", spec], { encoding: "buffer" }); assert.equal(r.status, 0, spec); return r.stdout; };
const base = blob(P1_BASE + ":index.html").toString("utf8");
// M1 integration: on the integrated tree the P1 layer is verified at its exact commit (git objects); the integrated page
// is held to the M1 derivation + P1 invariants by test/finance/m1-integration-guard.test.mjs. Standalone: working tree.
const LP = p1Layer(REPO);
const candidate = LP.read("index.html").toString("utf8");
const once = (src, from, to) => { assert.equal(src.split(from).length, 2, "mutation anchor unique: " + from.slice(0, 70)); return src.replace(from, to); };
const reason = (b) => p1IndexVerdict(base, b).reason;
const blobOf = (buf) => { const r = spawnSync("git", ["hash-object", "--stdin"], { input: buf, encoding: "utf8" }); assert.equal(r.status, 0); return r.stdout.trim(); };
const onP1 = gitIn(REPO, ["merge-base", "--is-ancestor", P1_BASE, "HEAD"]).status === 0 && gitIn(REPO, ["rev-parse", "HEAD"]).stdout.trim() !== P1_BASE;

test("P1G-01 the base is the C1-pinned page; every zone anchor is unique in it", () => {
  assert.equal(blobOf(Buffer.from(base, "utf8")), C1_INDEX_PIN.blob, "P1 base = the C1 identity-pinned blob");
  for (const [name, s] of P1_ZONES) assert.equal(base.split(s).length, 2, name + ": start anchor unique in the base");
});

test("P1G-02 positive control: the candidate satisfies the P1 contract; every changed hunk lies in a named zone", () => {
  assert.deepEqual(p1IndexVerdict(base, candidate), { ok: true });
  assert.ok(diffHunks(base, candidate).length >= P1_ZONES.length - 1, "the candidate exercises the zones");
});

test("P1G-03 not tautological: the base page compared with itself FAILS (the P1 block and identities are required)", () => {
  assert.equal(reason(base), "p1_block_shape");
});

test("P1G-04 negative controls OUTSIDE the P1 zones (C1 dashboard / history / seam, HF-1, CD-M2, storage) are refused", () => {
  const cases = [
    ["C1 dashboard financial calculation", "var target = D(F).serializeRat(D(F).ratMul(amt(F, lySales), growthFactor));", 'var target = "1";'],
    ["HF-1 setup-config block", "// ── HF-1: Setup Wizard config preservation", "// ── HF-1: Setup Wizard config preservation (edited)"],
    ["CD-M2 closure panel", '{/* CD-M2: explicit "Business closed" action', '{/* CD-M2 (edited): explicit "Business closed" action'],
    ["storage transport", '        if (!snap.exists()) throw new Error("not found");', '        if (!snap.exists()) throw new Error("missing");'],
    ["C1 history view", "    function history(F, src, month) {", "    function history(F, src, month) { month = month;"],
  ];
  for (const [label, from, to] of cases) assert.equal(reason(once(candidate, from, to)), "change_outside_p1_zones", label);
});

test("P1G-05 negative controls INSIDE the P1 zones: write path, negative-purchase substitution, formula duplication, block / identity / action shape", () => {
  const TAB = '          {fcTab==="credits" && (()=>{';
  const BLOCK = '    function errorText(code) { return ERRORS[code] || TXT.unknown; }';
  const cases = [
    ["a purchase write inside the credits tab (credit as a negative invoice)", TAB, TAB + "\n            const __neg = () => setSupPayDate(creditForm.supplierId, creditForm.issueDate, \"-\" + creditForm.amount);", "write_path_lines_changed"],
    ["supplier_payments written by the P1 block", BLOCK, BLOCK + "\n    function asPurchase(e, c) { e.supplier_payments = { [c.supplierId]: \"-\" + c.amount }; return e; }", "purchase_path_changed"],
    ["net computed in the page (formula duplication)", BLOCK, BLOCK + "\n    function net(F, g, c) { return F.finance.decimal.decSub(g, c); }", "formula_duplication"],
    ["subAmounts net in the suppliers view", "        var creditBy = (A.purchases.credits && A.purchases.credits.bySupplier) || {};", "        var creditBy = (A.purchases.credits && A.purchases.credits.bySupplier) || {}; var __n = subAmounts(F, \"1\", \"0\");", "formula_duplication"],
    ["a second P1 block", BLOCK, BLOCK + "\n    // ── P1 supplier credits browser seam (copy)", "p1_block_shape"],
    ["bundle identity reverted", 'v.product !== "MARJIN_PRODUCT/3"', 'v.product !== "MARJIN_PRODUCT/2"', "bundle_identity"],
    ["an extra credit-write call", '      else await runCreditOperation("create-supplier-credit", P1.createBody(ctx, v.input, creditId, operationId), ctx, P1.TXT.saved, after);', '      else await runCreditOperation("create-supplier-credit", P1.createBody(ctx, v.input, creditId, operationId), ctx, P1.TXT.saved, after) || await creditMutation("create-supplier-credit", {}, ctx);', "credit_action_shape"],
    ["the P1 seam no longer names its R1 contract", 'var CREDITS_CONTRACT = "MARJIN_CREDITS/4";', 'var CREDITS_CONTRACT = "MARJIN_CREDITS/1";', "p1_contract_identity"],
    ["a hard-delete action", BLOCK, BLOCK + '\n    var DEL = "delete-supplier-credit"; var X = "void-supplier-credit";', "credit_action_shape"],
  ];
  for (const [label, from, to, want] of cases) assert.equal(reason(once(candidate, from, to)), want, label);
  // every C1 protected sub-region is byte-identical in the candidate (the supplier grid write lane included)
  for (const [name, s] of C1_PROTECTED) assert.ok(candidate.includes(s), name);
  for (const a of P1_ACTIONS) assert.equal(candidate.split(a).length - 1, 1, a);
});

test("P1G-06 scope is not identity: a non-protected in-zone edit (a tab label) passes the P1 scope but changes the pinned blob", () => {
  const edited = once(candidate, "הוספת זיכוי ספק", "הוספת זיכוי ספק (edited)");
  assert.deepEqual(p1IndexVerdict(base, edited), { ok: true }, "scope alone accepts it");
  assert.notEqual(blobOf(Buffer.from(edited, "utf8")), P1_PINS.blobs["index.html"], "the identity pin refuses it");
});

test("P1G-07 the pins are fixed literals, pending independent review, cover exactly the protected P1 delta, and equal the candidate bytes", { skip: !onP1 && "P1 not committed in this tree" }, () => {
  assert.match(P1_PINS.status, /pending independent review/);
  const pinSrc = readFileSync(new URL("../support/p1-candidate-pin.mjs", import.meta.url), "utf8");
  assert.ok(!/rev-parse|hash-object|readFileSync|execSync|spawnSync/.test(pinSrc), "pin module computes nothing");
  const PROTECTED = /^(src\/(finance|metrics|policy|presenters|browser|finance-server)\/|fincore\/|api\/|lib\/|database\.rules\.json$|test\/support\/rules-authorized-delta\.mjs$|index\.html$)/;
  const delta = gitIn(REPO, ["diff", "--name-only", P1_BASE, LP.ref, "--"]).stdout.trim().split("\n").filter((f) => PROTECTED.test(f)).sort();
  assert.deepEqual(Object.keys(P1_PINS.blobs).sort(), delta, "pinned set = the protected P1 delta");
  for (const [f, b] of Object.entries(P1_PINS.blobs)) {
    assert.match(b, /^[0-9a-f]{40}$/, f);
    assert.equal(blobOf(LP.read(f)), b, f + " = pinned blob");
  }
  assert.ok(P1_PINS.blobs["database.rules.json"], "the legacy-credit Rules denial has an exact candidate pin");
  assert.ok(P1_PINS.blobs["test/support/rules-authorized-delta.mjs"], "the semantic Rules guard has an exact candidate pin");
  assert.ok(!Object.keys(P1_PINS.blobs).some((f) => f.startsWith("test/") && f !== "test/support/rules-authorized-delta.mjs"), "no unrelated test file is a runtime pin");
});

test("P1G-08 owner decision 4: the legacy pending-credit card stays RETIRED — re-adding its subscription, state, input component, alert card or resolve action is refused (R6)", () => {
  const SUB = "  // P1 R1: the legacy pending-credit card is retired (no state, no subscription, no write path).";
  const CARD = "      {/* P1 R1 (owner decision 4): the legacy pending-credit alert card is retired; its stored";
  const COMP = "// P1 R1 (owner decision 4): the legacy pending-credit input component is RETIRED. Supplier";
  const cases = [
    ["the legacy state", SUB, SUB + "\n  const [pendingCredits, setPendingCredits] = useState([]);"],
    ["the legacy RTDB subscription", SUB, SUB + "\n  // sub(`biz:${currentBizId}:credits`, setPendingCredits);"],
    ["the legacy alert card", CARD, "      {/* ═══ CREDIT ALERTS ═══ */}\n" + CARD],
    ["the legacy resolve action", CARD, CARD + " resolveCredit(cr.id)"],
    ["the legacy input component", COMP, COMP + "\nfunction CreditInput() { return null; }"],
  ];
  for (const [label, from, to] of cases) assert.equal(reason(once(candidate, from, to)), "legacy_credit_card_reactivated", label);
  for (const t of ["pendingCredits", "CreditInput", "resolveCredit", ":credits`", "CREDIT ALERTS"]) assert.equal(candidate.includes(t), false, t + " is gone from the page");
  // the stored legacy data is never read or rewritten by the page (no path names the legacy key)
  assert.doesNotMatch(candidate, /biz:\$\{[^}]+\}:credits`/);
});
