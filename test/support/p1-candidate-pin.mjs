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
export const P1_PINS = Object.freeze({
  status: "CANDIDATE — pending independent review",
  lineage: "P1 Supplier Credits successor of C1 R2 358ce56be97a4222609a02f1a126e261744ee6fa",
  blobs: Object.freeze({
    "api/admin.js": "36f71a60dc5dcf05bcc744dd999ee30c241cc425",
    "fincore/v1/MANIFEST.json": "668ff17d9cd476b259662f61cfd96483c9866a46",
    "fincore/v1/browser/marjinFinanceGlobal.js": "b512ea5b3835f1e8cf7985942c513e64b5f73cec",
    "fincore/v1/finance/supplierCredits.js": "33a4c11df1d88cd730007c93acf61261dd0f3c33",
    "fincore/v1/metrics/report.js": "d1bee7a1e9e90e38fa1eeb5636be901a68f93d1b",
    "fincore/v1/policy/productFinance.js": "32304ee62bc023dcdb6a4ac387db14f915952717",
    "index.html": "c35e1babe4d45be06ec2e569b35cfe1b4d5efbcb",
    "lib/repositories/supplierCreditsRepo.js": "4aa0e7a84659460ed55cc03dc574202f0c31dcb7",
    "lib/supplierCredits.js": "7e2a6c57f97daff1c95140b17abc353fbdfffbd3",
    "src/browser/marjinFinanceGlobal.ts": "96573cd63843a444e377857418353e11238f6cc6",
    "src/finance-server/canonicalInputs.ts": "d991f79af55fb93330df11b500f10b32b1e3f46a",
    "src/finance-server/canonicalMetrics.ts": "e91f71482805ffd9b56f462ffea099e38c9c3aa9",
    "src/finance/supplierCredits.ts": "c8639b08ea212909d0eb67eae3b5d3e5b537ede8",
    "src/finance/types.ts": "29cbcea52b7ede8dd8903b3065a752a9302a89a7",
    "src/metrics/report.ts": "6ad57ea596a6eb3dd22e19860c6e34edfc54f295",
    "src/policy/productFinance.ts": "bd255d78163928c166ce7e0d83517e66e6c27c22",
  }),
});
