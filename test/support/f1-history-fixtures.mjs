// F1 R1 test fixtures: a MARJIN_COSTH/2 history carries one authorization-review entry per version.
// `reviewFor` builds RESOLVED (cleared) entries bound to each version — the state an ordinary,
// successfully re-authorized commit reaches. Tests of pending / flagged states build their own entries.
export const REVIEW_SCHEMA = "MARJIN_COSTR/2";
export const DIGEST = (c = "a") => c.repeat(64);
export function reviewEntry(v, state = "cleared", over = {}) {
  const base = { schema: REVIEW_SCHEMA, state, intentDigest: DIGEST(), actor: v.recordedBy, committedAt: v.recordedAt };
  if (state === "pending") return { ...base, ...over };
  const resolved = { ...base, resolvedAt: v.recordedAt, resolution: state === "cleared" ? "post_commit_authorized" : "revoked_during_commit" };
  if (state === "cleared") return { ...resolved, ...over };
  const flagAudit = { schema: "MARJIN_COST_AUDIT/2", operationId: DIGEST("b"), tenantId: "tenantA", bizId: "bizA",
    versionId: v.versionId, intentDigest: base.intentDigest, recordedBy: v.recordedBy, recordedAt: v.recordedAt,
    outcome: over.resolution ?? resolved.resolution, detectedAt: over.resolvedAt ?? resolved.resolvedAt };
  const flagged = { ...resolved, flagAudit };
  return state === "acknowledged" ? { ...flagged, acknowledgedAt: v.recordedAt, acknowledgedBy: "owner", acceptOperationId: "00000000-0000-4000-8000-0000000000aa", ...over } : { ...flagged, ...over };
}
export const reviewFor = (versions, state = "cleared") => Object.fromEntries(Object.entries(versions).map(([k, v]) => [k, reviewEntry(v, state)]));
