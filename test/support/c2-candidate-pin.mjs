// WP-C2 — content IDENTITY pin of the C2 index.html for B2G-05 (separate from scope validation).
//
// On a tree descending from the reviewed C1 R2 commit (test/support/c2-index-scope.mjs C2_BASE):
//   1. the C2 BASE page (C2_BASE:index.html, from git objects) must be the C1 identity-pinned blob
//      (test/support/c1-candidate-pin.mjs) and satisfy the C1 contract;
//   2. SCOPE (c2-index-scope.mjs): the candidate may differ from that base page only inside the two
//      C2 zones, with the save call site byte-identical and no write call changed;
//   3. IDENTITY (this file): the committed, staged and checked-out index.html must be EXACTLY the
//      blob below. Any later change — including an in-zone edit of the fingerprint — fails B2G-05
//      until this literal is changed, which is a visible, reviewable diff.
//
// The literal is a FIXED value written by the C2 implementer for the candidate submitted for
// review; it is never computed at test time. It is NOT approved: it becomes the approved pin only
// when an independent reviewer confirms that this blob is the one they reviewed.
export const C2_INDEX_PIN = Object.freeze({
  blob: "bd2c22734b48de1a78f39a8a94284d998b1c8bbd",                       // git blob id (sha1) of the C2 candidate index.html
  status: "CANDIDATE — pending independent review",   // a reviewer changes nothing here except to confirm
  lineage: "C2 successor of C1 R2 358ce56be97a4222609a02f1a126e261744ee6fa",
});
