// F1 R1 test fixtures: a MARJIN_COSTH/2 history carries one authorization-review entry per version.
// `reviewFor` builds RESOLVED (cleared) entries bound to each version — the state an ordinary,
// successfully re-authorized commit reaches. Tests of pending / flagged states build their own entries.
export const REVIEW_SCHEMA = "MARJIN_COSTR/1";
export const DIGEST = (c = "a") => c.repeat(64);
export function reviewEntry(v, state = "cleared", over = {}) {
  const base = { schema: REVIEW_SCHEMA, state, intentDigest: DIGEST(), actor: v.recordedBy, committedAt: v.recordedAt };
  if (state === "pending") return { ...base, ...over };
  const resolved = { ...base, resolvedAt: v.recordedAt, resolution: state === "cleared" ? "post_commit_authorized" : "revoked_during_commit" };
  return state === "acknowledged" ? { ...resolved, acknowledgedAt: v.recordedAt, acknowledgedBy: "owner", ...over } : { ...resolved, ...over };
}
export const reviewFor = (versions, state = "cleared") => Object.fromEntries(Object.entries(versions).map(([k, v]) => [k, reviewEntry(v, state)]));
