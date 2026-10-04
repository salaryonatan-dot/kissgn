// FIXED candidate byte identities of the Core/F1 R4 remediation successor (canonical four-state lifecycle:
// acceptance = stored cleared + decision audit accepted; one canonical digest procedure MARJIN_CANON/1; the
// complete operation-authorization predicate at every boundary incl. the business registry; bound page
// decode through the verified selection), pending independent Codex review. Never derived from HEAD.
// The parent is the independently REJECTED R3 candidate, preserved unchanged in ancestry; the R3 pins
// (r3-candidate-pin.mjs) are HISTORICAL and refused as the current identity.
// A changed pin is a new candidate and does not inherit any earlier approval.
export const R4_PARENT = '950045c683cc14d0354f4f6b9d3a93fba271aa00';
export const R4_INDEX_PIN = Object.freeze({blob:'aafb2b47259e1dd34526b55daa8cab4ec2617c11',status:'pending independent Codex review'});
export const R4_RUNTIME_BLOBS = Object.freeze({
  'src/finance/canonical.ts':'d2a266f65453494e1d5b42fd58af61f11dd4aa77',
  'src/finance/costHistory.ts':'3f520edc11456d5e3b0eaa4083544be7716dbf3f',
  'src/browser/marjinFinanceGlobal.ts':'1c6c5d469163e19a600efbd1c88d53c90955e287',
  'src/finance-server/canonicalInputs.ts':'b1c44b74929140128256b1efb3691179372a5f76',
  'fincore/v1/finance/canonical.js':'116a2952e0e458f8d3cb7ce2a3c078a0f8803c19',
  'fincore/v1/finance/costHistory.js':'82f3ad0f74fa18a1760a220e41b8df5a9d0a7473',
  'fincore/v1/browser/marjinFinanceGlobal.js':'ea09934e1f146fcf52dbb602267fbe11b2ed4c93',
  'fincore/v1/MANIFEST.json':'43b6586604b80b6efb1a8e5f152ad372f00962cf',
  'lib/finance/costHistoryWriter.js':'ff50562fde70a03d99fceeefb88912362964c56b',
  'api/cost-history.js':'88324f61cc660e09b3028679c08f83ef7152a6f2',
});
/** Runtime files that did not exist in the R4 parent (new protected files). */
export const R4_NEW_FILES = Object.freeze(['src/finance/canonical.ts','fincore/v1/finance/canonical.js']);
