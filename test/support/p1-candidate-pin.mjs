// P1 R2 candidate exact-byte identity, pending Claude's independent review.
// B2G-05 compares every listed protected file at committed HEAD, staged index and checkout.
// This file contains fixed literal hashes; it never derives approval from HEAD at test time.
export const P1_PINS = Object.freeze({
  status: "CANDIDATE (P1 R2) — pending independent review (Claude)",
  lineage: "P1 R2 successor of ce506449b0377632bd9ad2f2b4192954b1696af7; base C1 R2 358ce56be97a4222609a02f1a126e261744ee6fa",
  blobs: Object.freeze({
    "api/admin.js": "bdf43759924f056602ecea5c1d954fd919abb036",
    "database.rules.json": "d8650f2343d63c7b5679b3e7481345e6fe571e98",
    "fincore/v1/MANIFEST.json": "e60242938ab6899fd2aba2f451dc6274ccdfced9",
    "fincore/v1/browser/marjinFinanceGlobal.js": "b512ea5b3835f1e8cf7985942c513e64b5f73cec",
    "fincore/v1/finance/supplierCredits.js": "cbaa3aa6f44d09fc4836851137f61c7ef093d883",
    "fincore/v1/metrics/report.js": "21ece0d637a762a2f94da8c52e1979247fbf5276",
    "fincore/v1/policy/productFinance.js": "4b0838878ae446b8eb5a9434b80094834bf291d6",
    "index.html": "a2f46cfaa3fd4ac7a86876b291dc0dd3074c71b2",
    "lib/repositories/supplierCreditsRepo.js": "f7362b19181f32f4bcdca1fc8e075caf5668a0b9",
    "lib/supplierCredits.js": "ec78f509298c784eddbc03c6dbc398177b62d545",
    "src/browser/marjinFinanceGlobal.ts": "96573cd63843a444e377857418353e11238f6cc6",
    "src/finance-server/canonicalInputs.ts": "7d3e4c77369bfa849a090a89b85e5c75fe63eda5",
    "src/finance-server/canonicalMetrics.ts": "c21ff04230d1cb81f86a38900c83975ebf256615",
    "src/finance/supplierCredits.ts": "03761f9ad27690d8ca907803cbffd708db22689e",
    "src/finance/types.ts": "18b62dbf68e79da85de50f664b1e8f0848ab0226",
    "src/metrics/report.ts": "ac7a944ac8c2c062d51b67ab0ac524c2e2a3ee33",
    "src/policy/productFinance.ts": "ccaf7b12b0109efc23991ee832aaf44a7cd146b5",
    "test/support/rules-authorized-delta.mjs": "6d31b81dc44451b52eaf5791593d7b1ea4b02593",
  }),
});
