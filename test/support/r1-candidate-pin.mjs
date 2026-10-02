// Fixed F1 R1 (consolidated core/F1 remediation) identities — CANDIDATE, pending independent Codex review.
// These are literal ids (never computed from the working tree). They are NOT an approval.
export const R1_COMMIT = "26556a1ad07266184f09498ade3e1023fce6870e";
export const R1_INDEX_PIN = Object.freeze({ blob: "1b421e12c2ef3ae56507906716bbb45bbc410f69", status: "pending independent Codex review" });
// The ONLY protected runtime files R1 changes beyond the page (pinned to their R1_COMMIT blobs).
export const R1_RUNTIME = Object.freeze(["src/finance/costHistory.ts", "fincore/v1/finance/costHistory.js", "fincore/v1/MANIFEST.json", "lib/finance/costHistoryWriter.js"]);
