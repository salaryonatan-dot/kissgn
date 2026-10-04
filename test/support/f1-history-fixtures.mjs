// F1 test fixtures — Core/F1 R4 (MARJIN_COSTR/4, the CANONICAL four-state review lifecycle): a MARJIN_COSTH/6
// history carries one authorization-review entry per version, bound to the version bytes, the tenant and the
// business by the ONE canonical digest (fincore/v1/finance/canonical.js). `reviewFor` builds RESOLVED (cleared)
// entries — the state an ordinary, successfully re-authorized commit reaches. Fixture labels:
//   "pending" | "cleared" | "flagged" | "accepted" (stored cleared + decision audit accepted) | "rejected"
// The fixtures compute REAL digests and flag identities, so a reader that recomputes them accepts the fixture
// and refuses any mutation of the version payload, the bindings or the audits.
import { REVIEW_SCHEMA as R4_REVIEW_SCHEMA, FLAG_AUDIT_SCHEMA, DECISION_AUDIT_SCHEMA, intentDigestOf, flagOperationIdOf } from "../../fincore/v1/finance/costHistory.js";
export const REVIEW_SCHEMA = R4_REVIEW_SCHEMA;
export const FIXTURE_BIND = Object.freeze({ tenantId: "tenantA", bizId: "bizA" });
export const DIGEST = (c = "a") => c.repeat(64);
export const ACCEPT_OP = "00000000-0000-4000-8000-0000000000aa";
export const REJECT_OP = "00000000-0000-4000-8000-0000000000ad";
/**
 * One review entry for the stored (wire) version `v` in the given fixture state. `over` patches the entry AFTER
 * construction; `bind` selects the tenant / business the entry is bound to (default FIXTURE_BIND).
 */
export function reviewEntry(v, state = "cleared", over = {}, bind = FIXTURE_BIND) {
  const intentDigest = intentDigestOf(bind.tenantId, bind.bizId, v);
  const base = { schema: REVIEW_SCHEMA, state: state === "accepted" ? "cleared" : state, intentDigest, actor: v.recordedBy, committedAt: v.recordedAt };
  if (state === "pending") return { ...base, ...over };
  const resolution = over.resolution ?? (state === "cleared" ? "post_commit_authorized" : "revoked_during_commit");
  const resolvedAt = over.resolvedAt ?? v.recordedAt;
  const resolved = { ...base, resolvedAt, resolution };
  if (state === "cleared") return { ...resolved, ...over };
  const flagAudit = { schema: FLAG_AUDIT_SCHEMA, operationId: flagOperationIdOf({ tenantId: bind.tenantId, bizId: bind.bizId, versionId: v.versionId, intentDigest, outcome: resolution }),
    tenantId: bind.tenantId, bizId: bind.bizId, versionId: v.versionId, intentDigest, recordedBy: v.recordedBy, recordedAt: v.recordedAt,
    outcome: resolution, resultingState: "flagged", detectedAt: resolvedAt };
  const flagged = { ...resolved, flagAudit };
  if (state === "flagged") return { ...flagged, ...over };
  const decision = state === "accepted" ? "accepted" : "rejected";
  const decidedAt = over.decidedAt ?? resolvedAt;
  const decisionAudit = { schema: DECISION_AUDIT_SCHEMA, operationId: state === "accepted" ? ACCEPT_OP : REJECT_OP, tenantId: bind.tenantId, bizId: bind.bizId,
    versionId: v.versionId, intentDigest, decidedBy: "owner", decision, resultingState: base.state, decidedAt };
  const { decidedAt: _d, ...rest } = over;
  return { ...flagged, decision, decisionAudit, ...rest };
}
export const reviewFor = (versions, state = "cleared", bind = FIXTURE_BIND) => Object.fromEntries(Object.entries(versions).map(([k, v]) => [k, reviewEntry(v, state, {}, bind)]));
