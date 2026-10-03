// F1 R1 test fixtures (R3: MARJIN_COSTR/3 — adds the terminal `rejected` state): a MARJIN_COSTH/2+ history carries one authorization-review entry per version.
// `reviewFor` builds RESOLVED (cleared) entries bound to each version — the state an ordinary,
// successfully re-authorized commit reaches. Tests of pending / flagged states build their own entries.
export const REVIEW_SCHEMA = "MARJIN_COSTR/3";
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
  if (state === "acknowledged") return { ...flagged, acknowledgedAt: v.recordedAt, acknowledgedBy: "owner", acceptOperationId: "00000000-0000-4000-8000-0000000000aa", ...over };
  if (state === "rejected") return { ...flagged, rejectedAt: v.recordedAt, rejectedBy: "owner", rejectOperationId: "00000000-0000-4000-8000-0000000000ad", ...over };
  return { ...flagged, ...over };
}
export const reviewFor = (versions, state = "cleared") => Object.fromEntries(Object.entries(versions).map(([k, v]) => [k, reviewEntry(v, state)]));
