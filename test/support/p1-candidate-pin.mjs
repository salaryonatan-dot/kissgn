// P1 R7 fixed candidate identity — pending independent Claude review.
// Refused R1/R2/R3 identities remain in p1-refused-identities.json; R4 requires remediation.
export const P1_PINS = Object.freeze({
  status: "CANDIDATE (P1 R7) — pending independent review (Claude)",
  lineage: "P1 R7 sole parent 0e320384f394618788da08004d13f8336224bdd0; approved C1 R2 base 358ce56be97a4222609a02f1a126e261744ee6fa",
  blobs: Object.freeze({
    "api/admin.js": "c042127d1a9a73e4a05a65a93f68e8f8e20b3de7",
    "database.rules.json": "d8650f2343d63c7b5679b3e7481345e6fe571e98",
    "fincore/v1/MANIFEST.json": "02c696b29bf9d206441550cf5ba296b92d9176be",
    "fincore/v1/browser/marjinFinanceGlobal.js": "b512ea5b3835f1e8cf7985942c513e64b5f73cec",
    "fincore/v1/finance/creditEvidence.js": "6e62eb310894b973962856960c00fc14d27ea7d0",
    "fincore/v1/finance/supplierCredits.js": "8ef955a74f5b1fdc85874a65bdb8c0f3ec8ecfb7",
    "fincore/v1/metrics/report.js": "5d7922ebfc5b3bc497a772e79bb6347d4a4cd619",
    "fincore/v1/policy/productFinance.js": "e2dc6dafff8a6cdf0417a1eef1e3c618ee0d3f2c",
    "index.html": "3eaeb430ae688b2a97d51c2709a409ab2de0fc0b",
    "lib/repositories/supplierCreditsRepo.js": "f68b86e0919e744e1efed3dd6b72bbc0c2eeda82",
    "lib/supplierCredits.js": "3e834535d6580193b05135d11fa378cc7c64de11",
    "src/browser/marjinFinanceGlobal.ts": "96573cd63843a444e377857418353e11238f6cc6",
    "src/finance-server/canonicalInputs.ts": "d2f0cf4bac5446626964cd850eb1f090dd6f58e6",
    "src/finance-server/canonicalMetrics.ts": "a558351db763630d717460c1ae8f40b21b9a65ee",
    "src/finance/creditEvidence.ts": "dbcf2dc113f03e4e51e13ddc8ac08d5bdbba8e75",
    "src/finance/supplierCredits.ts": "fecdf50be76c0c04ba3e4f9e435c2a030aeaf55c",
    "src/finance/types.ts": "ccb3daf5307f0b76f332e2285a531aee6d1bd3d9",
    "src/metrics/report.ts": "c446b8c947d56e33924cddd3d53ef7be0b8c9310",
    "src/policy/productFinance.ts": "981dd3b1d7610e92e5c52d791bc3b932a45fd4d1",
    "test/support/rules-authorized-delta.mjs": "6d31b81dc44451b52eaf5791593d7b1ea4b02593"
}),
});
