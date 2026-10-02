// WP-C1 — content IDENTITY pin of the C1 index.html for B2G-05 (separate from scope validation).
//
// Two distinct layers protect index.html on a C1 tree:
//   1. SCOPE (test/support/c1-index-scope.mjs, candidate-independent): the page may differ from
//      the approved release assembly only inside fixed C1 zones, with protected write regions
//      byte-identical and no write call changed. Scope alone does NOT pin content: an edit inside
//      a zone (e.g. a financial calculation) can satisfy it.
//   2. IDENTITY (this file): the committed, staged and checked-out index.html must be EXACTLY the
//      blob below. Any later change to index.html — including an in-zone financial edit — fails
//      B2G-05 until this literal is changed, which is a visible, reviewable diff.
//
// The literal is a FIXED value written by the implementer for the candidate submitted for
// review. It is NOT computed from HEAD or the working tree at test time (no self-updating hash).
// It becomes the approved pin only when the independent reviewer confirms that this blob is the
// one they reviewed; until then its status is the candidate's, never "approved".
export const C1_INDEX_PIN = Object.freeze({
  blob: "07f00dc2894543ab36d77ce21f939d2d71db56af",                       // git blob id (sha1) of the candidate index.html
  status: "CANDIDATE — pending independent review",   // a reviewer changes nothing here except to confirm
  lineage: "C1 R1 successor of rejected e1a24d9582e0109524eed29fe5bfeb3981f1a8dd",
});
