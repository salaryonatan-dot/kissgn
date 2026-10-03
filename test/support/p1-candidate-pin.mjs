// P1 Supplier Credits — content IDENTITY pins for B2G-05 (separate from scope validation).
//
// On a tree descending from the reviewed C1 R2 commit (test/support/p1-index-scope.mjs P1_BASE):
//   1. the P1 BASE page (P1_BASE:index.html, from git objects) must be the C1 identity-pinned blob
//      and satisfy the C1 contract;
//   2. SCOPE (p1-index-scope.mjs): index.html may differ from that base only inside the P1 zones;
//   3. IDENTITY (this file): every protected path the P1 candidate changes — and ONLY those — must
//      be EXACTLY the blob below (committed, staged and checked out). Any later change fails B2G-05
//      until a literal here is changed, which is a visible, reviewable diff.
//
// The literals are FIXED values written by the P1 implementer for the candidate submitted for
// review; they are never computed at test time. They are NOT approved: they become approved pins
// only when an independent reviewer confirms that these blobs are the ones they reviewed.
//
// P1 R1 (consolidated remediation of the rejected candidate 1057af892db981531c6ab67df86fea873914d0f5): the
// literals below are the P1 R1 successor's blobs — CANDIDATE identities, pending independent Codex review.
// The rejected candidate's literals are recorded in the handoff (P1_R1_HANDOFF.md), never reused here.
export const P1_PINS = Object.freeze({
  status: "CANDIDATE (P1 R1) — pending independent review (Codex)",
  lineage: "P1 Supplier Credits R1 successor of the rejected P1 candidate 1057af892db981531c6ab67df86fea873914d0f5 (base C1 R2 358ce56be97a4222609a02f1a126e261744ee6fa)",
  blobs: Object.freeze({
    "api/admin.js": "a0973f0146f706105b4f5d3b62e7123ffd066061",
    "fincore/v1/MANIFEST.json": "9e9e2d3f2f4555fa704c5ed0c267b041f50d440c",
    "fincore/v1/browser/marjinFinanceGlobal.js": "b512ea5b3835f1e8cf7985942c513e64b5f73cec",
    "fincore/v1/finance/supplierCredits.js": "bb97ebab758920b722c50c028f4222713c9ff233",
    "fincore/v1/metrics/report.js": "dd5010b961b4047877b0f2bc8e043c235c9f1348",
    "fincore/v1/policy/productFinance.js": "0aa99b1bf9ba891fab600b39c82178cf4414d173",
    "index.html": "7e9f9ccd4f6b56d82dc2531f0c3170d379d0f336",
    "lib/repositories/supplierCreditsRepo.js": "4aff658c088f18bf2899d94e7b9e63e100919bd7",
    "lib/supplierCredits.js": "5fb219603ead0fafec2cd00afa7ecb7b3fcbe9b2",
    "src/browser/marjinFinanceGlobal.ts": "96573cd63843a444e377857418353e11238f6cc6",
    "src/finance-server/canonicalInputs.ts": "b1c9da2d10611078d6afc45edb5b048e37d32b74",
    "src/finance-server/canonicalMetrics.ts": "106148d9c4532f075883d63bb65b6f1d19463c26",
    "src/finance/supplierCredits.ts": "cd7019167ba96c837d8d530b2b201ce0f219b893",
    "src/finance/types.ts": "09c06d9ac16eb8b6211f5688691391a44b1c7e16",
    "src/metrics/report.ts": "3e88efd22f2df1bc105cabc92b633039993bea80",
    "src/policy/productFinance.ts": "696a702052b282e2ec96ca734931536273da16c2",
  }),
});
