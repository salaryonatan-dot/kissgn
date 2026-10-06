// F1/F2 R2 — trusted cost-history command; the F2 HTTP route exposes bounded commands, never a client RTDB grant.
// The F2 route calls the explicit activation/edit/attestation/review methods with the
// real request so lib/securityContext.js requireBizContext performs, in order: verified Firebase identity
// (lib/verifyToken.js requireAuth, checkRevoked) → id validation → requireTenantAccess(floor "manager")
// → explicit WRITE role set {manager, owner, super_owner} → requireBizAccess. These are the approved
// helpers; experiments inject ONLY a mock identity verifier and the
// emulator Admin DB (createCostHistoryWriter deps). The mock does NOT prove token verification.
//
// Storage: ONE node per business, { head:{revision, headVersionId}, versions:{uuid: record}, review:{uuid: entry} },
// mutated ONLY by one Admin transaction on that node. Unrelated tenant/business writes cannot force its retries.
//
// Core/F1 R4 — the canonical lifecycle and the complete operation authorization:
//   • stored review states are exactly pending / cleared / flagged / rejected; the owner's acceptance stores
//     `cleared` + decision audit `accepted`, the rejection `rejected` + decision audit `rejected`;
//   • ONE operation-specific authorization predicate (verified identity → tenant membership → explicit role,
//     the exact required role for activation / re-activation → business access → the business REGISTRY
//     tenants/{t}/app/business) runs at entry, immediately before the commit (after every preparatory read /
//     write), after the commit (the only step that may clear), before every owner decision and inside
//     reconciliation; a pre-commit loss denies, an in-window loss leaves pending or becomes flagged with its
//     atomic audit, never authoritative; the registry is re-read before every review transition;
//   • every integrity value (payload digest, flag identity, attestation digest) is produced by the ONE
//     canonical procedure of the core (fincore/v1/finance/canonical.js) that every strict reader recomputes;
//   • a numeric / malformed operation id is refused before any read or write.
import { requireBizContext, requireBizAccess, WRITE_ROLES, isValidId } from "../securityContext.js";
import { requireTenantAccess as helpersRequireTenantAccess } from "../helpers.js";
import { costHistoryCodec, UUID4, REVIEW_SCHEMA, FLAG_AUDIT_SCHEMA, DECISION_AUDIT_SCHEMA, REVIEW_RESOLUTIONS, intentDigestOf, flagOperationIdOf } from "../../fincore/v1/finance/costHistory.js";
import { canonicalDigest, canonicalJson } from "../../fincore/v1/finance/canonical.js";
import * as businessDate from "../../fincore/v1/finance/businessDate.js";
import { getAdminDb } from "../adminSdk.js";
import { readRegistryTarget, isRegistryBizId } from "../businessRegistry.js";

export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;   // predecessor recordedAt this far ahead of now ⇒ history anomaly (fail closed)
export const CLOCK_WAIT_MAX_MS = 2000;             // bounded wait when this instance's clock is just behind the predecessor
export const REVIEW_DEADLINE_MS = 5000;             // one bounded flag/clear/accept transaction attempt
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const only = (o, allowed) => isObj(o) && Object.keys(o).every((k) => allowed.includes(k));
const stable = canonicalJson;                       // ONE canonical serialization (shared with every reader)
const REQUEST_FIELDS = ["versionId", "expectedHead", "effectiveFrom", "basis", "globalEmployees", "fixedItems", "rent", "royalty", "note", "attestation", "attestationReason"];
/** The owner's decisions and the state each one stores (the canonical four-state lifecycle). */
export const DECISION_STATES = Object.freeze({ accepted: "cleared", rejected: "rejected" });
const isOperationId = (x) => typeof x === "string" && UUID4.test(x);
const DIGEST_RE = /^[0-9a-f]{64}$/;

/** Integrity link between the attested confirmation and the exact snapshot/date (NOT proof of human typing). */
export function attestationDigest(body) {
  const v = { effectiveFrom: body.effectiveFrom, basis: body.basis, globalEmployees: body.globalEmployees, fixedItems: body.fixedItems, rent: body.rent, royalty: body.royalty };
  if (Object.prototype.hasOwnProperty.call(body, "note")) v.note = body.note;
  if (Object.prototype.hasOwnProperty.call(body, "attestationReason")) v.attestationReason = body.attestationReason;
  return canonicalDigest(v);
}

function toWire(body, { versionId, recordedAt, recordedBy, predecessorVersionId }) {
  const w = { versionId, schema: body.basis === "attested_retroactive" ? "MARJIN_COSTV/2" : "MARJIN_COSTV/1", effectiveFrom: body.effectiveFrom, recordedAt, recordedBy, basis: body.basis,
    globalEmployeesCount: body.globalEmployees.length, fixedItemsCount: body.fixedItems.length, rent: body.rent, royalty: body.royalty, predecessorVersionId };
  if (body.globalEmployees.length) w.globalEmployees = body.globalEmployees.map((x) => ({ ...x }));
  if (body.fixedItems.length) w.fixedItems = body.fixedItems.map((x) => ({ ...x }));
  if (Object.prototype.hasOwnProperty.call(body, "note")) w.note = body.note;
  if (body.basis === "attested_retroactive") {
    w.attestationReason = body.attestationReason;
    w.attestationDigest = body.attestation.confirmedSnapshotDigest;
    w.attestedBy = recordedBy;
    w.attestedAt = recordedAt;
  }
  return w;
}
const intentOf = (w) => { const { recordedAt, ...rest } = w; return stable(rest); };   // every field but the server timestamp (same node)

/**
 * R3 (owner decision 1): the target business must BELONG to the tenant. Tenant membership and role are
 * tenant-wide, so the registry `tenants/{t}/app/business` is the authority for "this business exists in
 * this tenant". M1 R1: the decision is the SHARED target-scoped predicate (lib/businessRegistry.js), the same one
 * the P1 supplier-credit routes use, so one business is available to both or to neither. Fail closed: an
 * unavailable read, an uninterpretable registry or an ambiguous identity of the requested business is
 * `authorization_unavailable` (503, never definitive); an unlisted business is `business_not_in_tenant` (403).
 * A defect confined to an unrelated registry record does not affect the requested business. Never a
 * cross-tenant lookup.
 */
export async function requireBusinessInTenant(db, tenantId, bizId) {
  if (!isValidId(tenantId) || !isRegistryBizId(bizId)) throw { status: 400, msg: "invalid id" };
  const t = await readRegistryTarget(db, tenantId, bizId);
  if (t.state === "registered") return true;
  if (t.state === "not_registered") throw { status: 403, msg: "business_not_in_tenant" };
  if (t.state === "unavailable") throw { status: 503, msg: "authorization check unavailable" };
  if (t.state === "ambiguous") throw { status: 503, msg: "business registry ambiguous" };
  throw { status: 503, msg: "business registry unreadable" };
}
const registryStatus = (e) => (e && e.status === 403 ? "business_not_in_tenant" : e && e.status === 400 ? "request_scope_invalid" : "authorization_unavailable");

/**
 * deps (TEST SEAMS — production omits them all):
 *   db            Admin database (production: lib/adminSdk.js getAdminDb via requireBizContext)
 *   core          approved core date functions (fincore/v1/finance/businessDate.js)
 *   authDeps      passed to requireBizContext (tests: { requireAuth: MOCK, getDb }); production: {}
 *   clock         ms clock (production: Date.now)
 *   hooks         { afterAuth?, txFault?, reviewDeadlineMs? } deterministic emulator probes only
 */
export function createCostHistoryWriter({ db, core = businessDate, authDeps = {}, clock = () => Date.now(), hooks = {} }) {
  const codec = costHistoryCodec;
  const nodeRef = (t, b) => db.ref(`tenants/${t}/biz:${b}:cost_history`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * R4: THE operation authorization predicate. Verified identity → tenant membership → explicit write role →
   * (the exact required role, e.g. `owner` for activation) → business access → business registry. Used at
   * entry, immediately before the commit, after the commit, before an owner decision and in reconciliation.
   *   { ok:true, ctx }                              authorized now
   *   { ok:false, status, definitive:true|false }   definitive (401 / 403 / unregistered) or unavailable (503 …)
   */
  async function authorizeOperation(req, { tenantId, bizId, mode = "write", requiredRole = null, expectUid = null }) {
    let ctx;
    try { ctx = await requireBizContext(req, { tenantId, bizId, mode }, { getDb: async () => db, ...authDeps }); }
    catch (e) {
      const st = e && e.status;
      if (st === 401) return { ok: false, status: "unauthenticated", definitive: true, http: st };
      if (st === 403) return { ok: false, status: "unauthorized", definitive: true, http: st };
      if (st === 400) return { ok: false, status: "request_scope_invalid", definitive: true, http: st };
      return { ok: false, status: "authorization_unavailable", definitive: false, http: st };
    }
    if (expectUid !== null && ctx.uid !== expectUid) return { ok: false, status: "unauthorized", definitive: true };
    if (requiredRole && ctx.role !== requiredRole) return { ok: false, status: "role_not_allowed", definitive: true };
    try { await requireBusinessInTenant(db, tenantId, bizId); }
    catch (e) { return { ok: false, status: registryStatus(e), definitive: !!(e && (e.status === 403 || e.status === 400)) }; }
    return { ok: true, ctx };
  }

  function parse(body, uid, nowMs) {
    if (!only(body, REQUEST_FIELDS) || typeof body.versionId !== "string" || !UUID4.test(body.versionId)) return { error: "request_shape" };
    const e = body.expectedHead;
    if (e !== null && !codec.validHead(e)) return { error: "expected_head_shape" };
    if (!Array.isArray(body.globalEmployees) || !Array.isArray(body.fixedItems)) return { error: "list_shape" };
    if (typeof body.effectiveFrom !== "string" || core.parseBusinessDate(body.effectiveFrom) === null) return { error: "record_shape", detail: "effective_from_invalid" };
    const today = core.israelBusinessDate(nowMs);
    if (body.basis === "recorded") {
      if (body.attestation !== undefined || body.attestationReason !== undefined) return { error: "attestation_not_applicable" };
      if (body.effectiveFrom < today) return { error: "recorded_past_date" };
    } else if (body.basis === "attested_retroactive") {
      if (typeof body.attestationReason !== "string" || !body.attestationReason.trim() || body.attestationReason !== body.attestationReason.trim() || body.attestationReason.length > 500) return { error: "attestation_reason_missing" };
      const a = body.attestation;
      if (!only(a, ["confirmed", "typedEffectiveFrom", "confirmedSnapshotDigest"]) || Object.keys(a).length !== 3 || a.confirmed !== true ||
        a.typedEffectiveFrom !== body.effectiveFrom || a.confirmedSnapshotDigest !== attestationDigest(body)) return { error: "attestation_missing" };
      if (body.effectiveFrom >= today) return { error: "attestation_not_past" };
    }
    let wire;
    try { wire = toWire(body, { versionId: body.versionId, recordedAt: nowMs, recordedBy: uid, predecessorVersionId: e ? e.headVersionId : "none" }); } catch { return { error: "record_shape" }; }
    // the candidate record must pass the SAME strict reader decision (shape + semantic invariants)
    const d = codec.decodeRecord(body.versionId, wire);
    if (d.error) return { error: "record_shape", detail: d.error };
    return { wire, today };
  }

  /** Authoritative payload readback (one snapshot of the node). Record existence alone is never success. */
  async function recover({ tenantId, bizId, wire }) {
    let snap;
    try { snap = await nodeRef(tenantId, bizId).get(); } catch (e) { return { status: "outcome_unknown", detail: "readback_failed" }; }
    // structural decision: a pending/flagged review must not hide the authoritative payload from readback
    const h = codec.decodeHistoryStructure({ exists: snap.exists(), value: snap.val() }, { tenantId, bizId });
    if (h.state === "unreadable") return { status: "history_unreadable", reason: h.reason };
    const stored = snap.exists() ? (snap.val().versions || {})[wire.versionId] : undefined;
    if (!stored) return { status: "not_committed", head: h.head || null };
    if (intentOf(stored) !== intentOf(wire)) return { status: "identity_reused", head: h.head };
    return { status: h.head.headVersionId === wire.versionId ? "committed_current" : "committed_superseded", head: h.head, recordedAt: stored.recordedAt, resolvedBy: "readback",
      review: h.review[wire.versionId].state, intentDigest: h.review[wire.versionId].intentDigest };
  }

  /**
   * R4: a version is an ACTIVATION (owner-only, re-activation included) iff every version before it in the
   * chain is rejected. `rejected` and `cleared` are terminal and no version can be inserted between a version
   * and its predecessors, so this classification is stable for the life of the version: retries,
   * reconciliation and recovery derive the required role from the chain itself (never from a client claim).
   */
  function isActivationVersion(h, versionId) {
    const i = h.versions.findIndex((v) => v.versionId === versionId);
    if (i < 0) return false;
    return h.versions.slice(0, i).every((v) => h.review[v.versionId].state === "rejected");
  }

  async function attemptOnce(req, body, { requiredRole = null } = {}) {
    const { tenantId, bizId } = body.__scope;
    // (1) fresh, fail-closed, OPERATION-SPECIFIC authorization through the approved helper chain + registry
    const entry = await authorizeOperation(req, { tenantId, bizId, requiredRole });
    if (!entry.ok) return { status: entry.status, http: entry.http };
    const ctx = entry.ctx;
    const bind = { tenantId, bizId };
    const command = body.__command || null;
    let authDoneAt = Date.now();
    // (2) one authoritative server instant: recordedAt AND the Israel business date of this attempt
    const nowMs = clock();
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return { status: "clock_invalid" };
    const parsed = parse(stripScope(body), ctx.uid, nowMs);
    if (parsed.error) return { status: parsed.error, detail: parsed.detail };
    const { wire } = parsed;
    const intentDigest = intentDigestOf(tenantId, bizId, wire);
    const ref = nodeRef(tenantId, bizId);
    let primed;
    try { primed = await ref.get(); } catch { return { status: "history_unavailable" }; }
    const initial = codec.decodeHistoryStructure({ exists: primed.exists(), value: primed.val() }, bind);
    if (initial.state === "unreadable") return { status: "history_unreadable:" + initial.reason };
    if (initial.state === "present" && Object.prototype.hasOwnProperty.call(primed.val().versions, wire.versionId)) {
      return { ...(await recover({ tenantId, bizId, wire })), uid: ctx.uid };
    }
    // R3 activation rule: activation creates the FIRST EFFECTIVE version — either on an absent history or
    // over a history whose every version was rejected; an ordinary edit needs an effective version to edit.
    const activationGate = (h) => {
      const effective = h.state === "present" ? h.effectiveVersions.length : 0;
      if (command === "activate" && h.state === "present" && effective > 0) return "already_activated";
      if (command && command !== "activate" && (h.state !== "present" || effective === 0)) return "activation_required";
      return null;
    };
    { const g = activationGate(initial); if (g) return { status: g, head: initial.state === "present" ? initial.head : null }; }
    // F1 R1: no new version over an unresolved authorization review (pending / flagged); it must be
    // reconciled or decided first, so a later version can never bury an earlier unresolved one.
    if (initial.state === "present" && body.expectedHead &&
        (initial.head.revision !== body.expectedHead.revision || initial.head.headVersionId !== body.expectedHead.headVersionId))
      return { status: "head_conflict", head: initial.head };
    if (initial.state === "present" && (initial.unresolved.pending.length || initial.unresolved.flagged.length)) return { status: "review_unresolved", unresolved: initial.unresolved };
    // Durable, immutable pre-commit evidence. If the process stops after the cost
    // transaction, this intent can be reconciled against the authoritative history.
    const auditIntent = { contract: "MARJIN_COST_AUDIT/1", tenantId, bizId, versionId: wire.versionId,
      recordedBy: ctx.uid, intentDigest, precheckedAt: nowMs, ...(requiredRole ? { requiredRole } : {}) };
    const auditRef = db.ref(`tenants/${tenantId}/audit/cost_history_intents/${wire.versionId}`);
    try {
      const existing = await auditRef.get();
      if (existing.exists() && (existing.val().intentDigest !== auditIntent.intentDigest || existing.val().recordedBy !== ctx.uid || existing.val().bizId !== bizId)) return { status: "identity_reused" };
      if (!existing.exists()) {
        const auditTxn = await auditRef.transaction((current) => current === null ? auditIntent : undefined, undefined, false);
        if (!auditTxn.committed) {
          const settled = await auditRef.get();
          if (!settled.exists() || settled.val().intentDigest !== auditIntent.intentDigest || settled.val().recordedBy !== ctx.uid || settled.val().bizId !== bizId) return { status: "identity_reused" };
        }
      }
    } catch { return { status: "audit_unavailable" }; }
    // The audit intent and cold-cache priming are preparatory reads/writes. Re-run the COMPLETE operation
    // predicate (membership, exact role, business access, registry) after them, immediately before the
    // cost-history transaction; a revocation or registry removal already committed now denies.
    const fresh = await authorizeOperation(req, { tenantId, bizId, requiredRole, expectUid: ctx.uid });
    if (!fresh.ok) return { status: fresh.status, http: fresh.http };
    authDoneAt = Date.now();
    if (hooks.afterAuth) await hooks.afterAuth();
    // The same primed snapshot starts the cold-instance transaction callback.
    let first = true, reason = "unknown", waitMs = 0, calls = 0;
    let tx;
    try {
      const run = () => ref.transaction((current) => {
        calls++;
        if (current === null && first) current = primed.val();
        first = false;
        const h = codec.decodeHistoryStructure({ exists: current !== null && current !== undefined, value: current }, bind);
        if (h.state === "unreadable") { reason = "history_unreadable:" + h.reason; return; }
        { const g = activationGate(h); if (g) { reason = g; return; } }
        const versions = h.state === "present" ? current.versions : {};
        const reviews = h.state === "present" ? current.review : {};
        if (Object.prototype.hasOwnProperty.call(versions, wire.versionId)) { reason = "existing_identity"; return; }
        const e = body.expectedHead, head = h.state === "present" ? h.head : null;
        if (e === null ? head !== null : !head || head.revision !== e.revision || head.headVersionId !== e.headVersionId) { reason = "head_conflict"; return; }
        if (h.state === "present" && (h.unresolved.pending.length || h.unresolved.flagged.length)) { reason = "review_unresolved"; return; }
        const pred = head ? h.versions[h.versions.length - 1] : null;
        if (pred && pred.recordedAt > nowMs + MAX_FUTURE_SKEW_MS) { reason = "history_clock_anomaly"; return; }
        if (pred && nowMs <= pred.recordedAt) { reason = "clock_behind_predecessor"; waitMs = pred.recordedAt - nowMs + 1; return; }
        const w = wire;
        // F1 R1: the version and its PENDING authorization review commit together (one transaction).
        const pendingReview = { schema: REVIEW_SCHEMA, state: "pending", intentDigest, actor: wire.recordedBy, committedAt: wire.recordedAt };
        const next = { head: { revision: head ? head.revision + 1 : 1, headVersionId: wire.versionId }, versions: { ...versions, [wire.versionId]: w }, review: { ...reviews, [wire.versionId]: pendingReview } };
        // defence in depth: structurally valid, and NOT authoritative until the review resolves
        const chk = codec.decodeHistoryStructure({ exists: true, value: next }, bind);
        if (chk.state !== "present" || chk.unresolved.pending.join() !== wire.versionId || chk.unresolved.flagged.length) { reason = "internal_invalid"; return; }
        reason = "commit"; return next;
      }, undefined, false);
      tx = hooks.txFault ? await hooks.txFault(run) : await run();
    } catch (err) {
      // R2 C6: a thrown transaction (maxretry, disconnect, lost ack) is an UNKNOWN outcome → authoritative readback
      const r = await recover({ tenantId, bizId, wire });
      return { ...r, uncertain: true, cause: String((err && err.message) || err), calls, uid: ctx.uid };
    }
    if (tx.committed) return { status: "committed_current", head: tx.snapshot.val().head, recordedAt: nowMs, calls, authToCommitMs: Date.now() - authDoneAt, uid: ctx.uid, review: "pending", intentDigest };
    if (reason === "existing_identity") return { ...(await recover({ tenantId, bizId, wire })), calls, uid: ctx.uid };
    if (reason === "clock_behind_predecessor") return { status: reason, waitMs, retryable: true, calls };
    return { status: reason, calls };
  }
  const stripScope = (b) => { const { __scope, __command, ...rest } = b; return rest; };

  // R2: the review and its immutable flag audit live in ONE per-business transaction. No external
  // audit write can race the review state. A flagged record is unreadable unless its audit matches.
  // R4 (canonical lifecycle): pending → cleared | flagged (system resolution); flagged → cleared (owner
  // ACCEPTED) | rejected (owner REJECTED). `cleared` and `rejected` are terminal: nothing transitions out.
  const SYSTEM_TRANSITIONS = Object.freeze({ cleared: ["pending"], flagged: ["pending"] });
  function expectedEntry(cur, { tenantId, bizId, versionId, intentDigest, to, resolution, decision, nowMs, by, operationId, version }) {
    if (decision) {
      const decidedAt = Math.max(nowMs, cur.resolvedAt);
      const decisionAudit = { schema: DECISION_AUDIT_SCHEMA, operationId, tenantId, bizId, versionId, intentDigest, decidedBy: by, decision, resultingState: to, decidedAt };
      return { ...cur, state: to, decision, decisionAudit };
    }
    const resolvedAt = Math.max(nowMs, cur.committedAt);
    if (to === "cleared") return { ...cur, state: to, resolvedAt, resolution };
    const flagAudit = { schema: FLAG_AUDIT_SCHEMA, operationId: flagOperationIdOf({ tenantId, bizId, versionId, intentDigest, outcome: resolution }),
      tenantId, bizId, versionId, intentDigest, recordedBy: version.recordedBy, recordedAt: version.recordedAt,
      outcome: resolution, resultingState: "flagged", detectedAt: resolvedAt };
    return { ...cur, state: to, resolvedAt, resolution, flagAudit };
  }
  /**
   * ONE transaction that moves one version's review. System resolution: { to: cleared|flagged, resolution }.
   * Owner decision: { decision: accepted|rejected, by, operationId } (the state follows DECISION_STATES).
   * The business registry is re-read after priming and immediately before the transaction; `authorize`
   * (the caller's fresh identity predicate) runs there too. A stale request context, a removal during
   * priming or an unregistered business can never resolve or decide anything.
   */
  async function transitionReview({ tenantId, bizId, versionId, intentDigest, to, resolution, decision = null, by, operationId, authorize }) {
    if (typeof versionId !== "string" || !UUID4.test(versionId) || typeof intentDigest !== "string" || !DIGEST_RE.test(intentDigest)) return { status: "request_shape" };
    if (decision !== null) {
      if (!Object.prototype.hasOwnProperty.call(DECISION_STATES, decision) || !isOperationId(operationId) || typeof by !== "string" || by === "") return { status: "request_shape" };
      to = DECISION_STATES[decision];
    } else if (!SYSTEM_TRANSITIONS[to] || !REVIEW_RESOLUTIONS[to].includes(resolution)) return { status: "request_shape" };
    const bind = { tenantId, bizId };
    const ref = nodeRef(tenantId, bizId);
    const nowMs = clock();
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return { status: "clock_invalid" };
    let outcome = null, primedVal, intended = null, expired = false;
    try { primedVal = (await ref.get()).val(); } catch { return { status: "history_unavailable" }; }
    // Fresh registry + caller identity checks are after priming and immediately before the trusted transaction.
    try { await requireBusinessInTenant(db, tenantId, bizId); } catch (e) { return { status: registryStatus(e) }; }
    if (authorize) {
      try { await authorize(); }
      catch (e) { return { status: e && e.status === 503 ? "authorization_unavailable" : "unauthorized" }; }
    }
    let first = true;
    const decide = (current) => {
      const h = codec.decodeHistoryStructure({ exists: current !== null && current !== undefined, value: current }, bind);
      if (h.state !== "present") return { o: h.state === "absent" ? "not_found" : "history_unreadable:" + h.reason };
      const e = current.review[versionId], v = current.versions[versionId];
      if (!e || !v) return { o: "not_found" };
      if (h.head.headVersionId !== versionId) return { o: "head_changed" };
      if (e.intentDigest !== intentDigest || intentDigestOf(tenantId, bizId, v) !== intentDigest) return { o: "review_identity_mismatch" };
      if (decision) {
        // idempotent replay of the SAME decision (same operation, same owner); any other reuse is refused
        if (e.state === to && e.decision === decision) {
          const a = e.decisionAudit;
          if (!a || a.operationId !== operationId || a.decidedBy !== by) return { o: "operation_identity_reused" };
          return { o: "already_" + decision };
        }
        if (e.state !== "flagged") return { o: "review_already_resolved:" + e.state };
      } else {
        if (e.state === to) {
          if (to === "flagged" && (e.flagAudit.operationId !== flagOperationIdOf({ tenantId, bizId, versionId, intentDigest, outcome: resolution }) || e.flagAudit.tenantId !== tenantId || e.flagAudit.bizId !== bizId)) return { o: "operation_identity_reused" };
          return { o: "already_" + to };
        }
        if (!SYSTEM_TRANSITIONS[to].includes(e.state)) return { o: "review_already_resolved:" + e.state };
      }
      const entry = expectedEntry(e, { tenantId, bizId, versionId, intentDigest, to, resolution, decision, nowMs, by, operationId, version: v });
      const next = { ...current, review: { ...current.review, [versionId]: entry } };
      const chk = codec.decodeHistoryStructure({ exists: true, value: next }, bind);
      if (chk.state !== "present") return { o: "internal_invalid" };
      intended = entry;
      return { o: "applied", next };
    };
    try {
      const run = () => ref.transaction((current) => {
        if (expired) return undefined;
        if (current === null && first) current = primedVal;
        first = false;
        const d = decide(current);
        outcome = d.o;
        if (d.o === "applied") return d.next;
        return current === null || current === undefined ? undefined : current;   // absent history: abort (never commit a null), readback reports not_found
      }, undefined, false);
      let timer;
      const deadlineMs = hooks.reviewDeadlineMs ?? REVIEW_DEADLINE_MS;
      let tx;
      try {
        tx = await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error("review_deadline")); }, deadlineMs); })]);
      } finally { clearTimeout(timer); }
      if (!tx.committed) return await readbackReview(ref, { versionId, intentDigest, to, decision, intended, operationId, outcome, bind });
      const confirmed = codec.decodeHistoryStructure({ exists: tx.snapshot.exists(), value: tx.snapshot.val() }, bind);
      if (confirmed.state !== "present") return { status: "outcome_unknown", detail: "invalid_transaction_snapshot" };
      const entry = tx.snapshot.val().review[versionId];
      if (outcome === "applied" && (!intended || stable(entry) !== stable(intended))) return { status: "outcome_unknown", detail: "payload_mismatch" };
      return { status: outcome === "applied" ? "resolved" : outcome, state: entry.state, ...(entry.decision ? { decision: entry.decision } : {}), ...(entry.state === "flagged" ? { audit: "flag_persisted" } : {}) };
    } catch (err) {
      const r = await readbackReview(ref, { versionId, intentDigest, to, decision, intended, operationId, outcome, bind });
      return { ...r, resolvedBy: r.status === "resolved" ? "readback" : undefined, cause: String((err && err.message) || err) };
    }
  }
  async function readbackReview(ref, { versionId, intentDigest, to, decision, intended, operationId, outcome, bind }) {
    let snap;
    try { snap = await ref.get(); } catch { return { status: "outcome_unknown", detail: "readback_failed" }; }
    const h = codec.decodeHistoryStructure({ exists: snap.exists(), value: snap.val() }, bind);
    if (h.state === "absent") return { status: "not_found" };                 // nothing to resolve: never "unknown"
    if (h.state !== "present") return { status: "outcome_unknown", detail: "history_" + h.state };
    const entry = snap.val().review[versionId];
    if (!entry && outcome === "not_found") return { status: "not_found" };
    if (!entry || entry.intentDigest !== intentDigest) return { status: outcome === "review_identity_mismatch" ? outcome : "outcome_unknown", detail: "review_identity_mismatch" };
    // FULL-payload comparison: the stored entry must equal the exact intended entry (state, audits, decision, instants)
    if (entry.state === to && intended && stable(entry) === stable(intended)) return { status: "resolved", state: to, ...(decision ? { decision } : {}), ...(to === "flagged" ? { audit: "flag_persisted" } : {}) };
    if (decision && entry.state === to && entry.decision === decision && entry.decisionAudit && entry.decisionAudit.operationId === operationId && outcome === "already_" + decision) return { status: "already_" + decision, state: to, decision };
    if (!decision && entry.state === to && outcome === "already_" + to) return { status: outcome, state: to };
    if (outcome && outcome.startsWith("review_already_resolved:") && entry.state === outcome.split(":")[1]) return { status: outcome, state: entry.state };
    if (outcome === "head_changed" && h.head.headVersionId !== versionId) return { status: outcome };
    return { status: "outcome_unknown", detail: "review_" + entry.state };
  }

  /** Internal common command. `req` is the real HTTP request (identity source). */
  async function saveCostVersion(req, { tenantId, bizId, body, requiredRole = null, command = null }) {
    const scoped = { ...body, __scope: { tenantId, bizId }, ...(command ? { __command: command } : {}) };
    let r = await attemptOnce(req, scoped, { requiredRole });
    // R2 C4: a clock just behind the predecessor waits (bounded) and retries the SAME intent with a fresh instant
    if (r.status === "clock_behind_predecessor" && r.waitMs <= CLOCK_WAIT_MAX_MS) { await sleep(r.waitMs); r = await attemptOnce(req, scoped, { requiredRole }); }
    if ((r.status === "committed_current" || r.status === "committed_superseded") && r.review === "pending") {
      // R2 C2 option (a) / DEC-AUTH-1: the authorization is checked BEFORE the transaction; a revocation landing
      // in the check→commit window is not prevented, only DETECTED here. F1 R1: the version committed with a
      // PENDING review (non-authoritative); only this post-commit decision clears it. Any failure leaves it
      // pending — visible, non-authoritative and reconcilable — never ordinary approved history.
      // R4: the post-check is the SAME complete operation predicate (identity, exact required role, business
      // access, registry) — an owner downgraded to manager or a business removed during the window is a
      // DEFINITIVE loss ⇒ flagged with its atomic audit; an unavailable check ⇒ pending.
      let decision = null;
      const post = await authorizeOperation(req, { tenantId, bizId, requiredRole, expectUid: r.uid });
      if (post.ok) { r.postCommitAccess = "current"; decision = { to: "cleared", resolution: "post_commit_authorized" }; }
      else if (post.definitive) { r.postCommitAccess = "revoked_during_commit"; decision = { to: "flagged", resolution: "revoked_during_commit" }; }
      else r.postCommitAccess = "verification_unavailable";
      if (decision) {
        const t = await transitionReview({ tenantId, bizId, versionId: body.versionId, intentDigest: r.intentDigest, ...decision, by: r.uid });
        r.review = t.status === "resolved" || t.status === "already_" + decision.to ? decision.to : "pending";
        if (decision.to === "flagged") r.audit = r.review === "flagged" ? "flag_persisted" : "flag_unconfirmed";
        if (r.review === "pending") r.reviewResolution = t.status;
      }
    }
    return r;
  }

  /**
   * Trusted reconciliation (server job / F2 route; no client capability): resolves every PENDING review of one
   * business from the actor's CURRENT authorization as stored (fresh membership, explicit write role, the exact
   * role the operation required — `owner` for an activation / re-activation, derived from the chain — business
   * access, business registry). Authorized ⇒ cleared; definitively unauthorized ⇒ flagged (+ audit record); an
   * unavailable check leaves it pending. Idempotent; never touches flagged / resolved entries.
   */
  async function reconcilePendingReviews({ tenantId, bizId, authorize }) {
    try { await requireBusinessInTenant(db, tenantId, bizId); } catch (e) { return { status: registryStatus(e), results: [] }; }
    let snap;
    try { snap = await nodeRef(tenantId, bizId).get(); } catch { return { status: "history_unavailable" }; }
    const h = codec.decodeHistoryStructure({ exists: snap.exists(), value: snap.val() }, { tenantId, bizId });
    if (h.state !== "present") return { status: h.state === "absent" ? "nothing_pending" : "history_unreadable:" + h.reason, results: [] };
    const results = [];
    const tenantAccess = authDeps.requireTenantAccess || helpersRequireTenantAccess;
    for (const versionId of h.unresolved.pending) {
      const v = h.versions.find((x) => x.versionId === versionId);
      const digestNow = h.review[versionId].intentDigest;
      if (intentDigestOf(tenantId, bizId, snap.val().versions[versionId]) !== digestNow) { results.push({ versionId, status: "review_identity_mismatch" }); continue; }
      const requiredRole = isActivationVersion(h, versionId) ? "owner" : null;
      let decision;
      try {
        const role = await tenantAccess(v.recordedBy, tenantId, "manager");
        if (!WRITE_ROLES.includes(role)) throw { status: 403 };
        if (requiredRole && role !== requiredRole) throw { status: 403 };
        await requireBizAccess(db, tenantId, bizId, v.recordedBy, role);
        await requireBusinessInTenant(db, tenantId, bizId);
        decision = { to: "cleared", resolution: "reconciled_authorized" };
      } catch (e) {
        if (e && e.status === 403) decision = { to: "flagged", resolution: "reconciled_unauthorized" };
        else { results.push({ versionId, status: "verification_unavailable" }); continue; }
      }
      const t = await transitionReview({ tenantId, bizId, versionId, intentDigest: digestNow, ...decision, by: "reconciler", authorize });
      results.push({ versionId, status: t.status, state: t.state, ...(requiredRole ? { requiredRole } : {}), ...(decision.to === "flagged" ? { audit: t.status === "resolved" || t.status === "already_flagged" ? "flag_persisted" : "flag_unconfirmed" } : {}) });
    }
    return { status: "reconciled", results };
  }

  /**
   * The OWNER's decision on a FLAGGED version (owner decisions 1 / 2). Only a CURRENT TENANT OWNER — the
   * existing tenant-wide `owner` role, with no explicit biz_access needed — decides; super_owner, manager,
   * viewer, a removed / stale owner, an owner of another tenant and a non-member are denied. The business
   * must belong to the tenant. Fresh authorization immediately before the trusted transaction.
   *   accept ⇒ stored `cleared` + decision audit `accepted` (authoritative; the flag audit is retained)
   *   reject ⇒ stored `rejected` + decision audit `rejected` (terminal, never authoritative; version + audit immutable)
   * Both are digest-bound, carry a string UUID operation identity (a numeric id is refused before any read),
   * replay idempotently and resolve an unknown outcome by full-payload readback.
   */
  async function ownerDecision(req, { tenantId, bizId, versionId, intentDigest, operationId }, decision) {
    if (!isOperationId(operationId) || typeof versionId !== "string" || !UUID4.test(versionId) || typeof intentDigest !== "string" || !DIGEST_RE.test(intentDigest)) return { status: "request_shape" };
    const entry = await authorizeOperation(req, { tenantId, bizId, requiredRole: "owner" });
    if (!entry.ok) return { status: entry.status };
    const ctx = entry.ctx;
    const authorize = async () => {
      const current = await authorizeOperation(req, { tenantId, bizId, requiredRole: "owner", expectUid: ctx.uid });
      if (!current.ok) throw { status: current.definitive ? 403 : 503 };
    };
    return transitionReview({ tenantId, bizId, versionId, intentDigest, decision, by: ctx.uid, operationId, authorize });
  }
  const acceptFlaggedVersion = (req, args) => ownerDecision(req, args, "accepted");
  const rejectFlaggedVersion = (req, args) => ownerDecision(req, args, "rejected");

  async function recoverSave(req, { tenantId, bizId, body, recordedAtHint }) {
    const auth = await authorizeOperation(req, { tenantId, bizId, mode: "read" });
    if (!auth.ok) return { status: auth.status };
    const e = body.expectedHead;
    const wire = toWire(body, { versionId: body.versionId, recordedAt: recordedAtHint || 1, recordedBy: auth.ctx.uid, predecessorVersionId: e ? e.headVersionId : "none" });
    return recover({ tenantId, bizId, wire });
  }
  /**
   * F2: explicit owner confirmation is the only public path that may create the FIRST EFFECTIVE version:
   * revision 1 on an absent history (expectedHead null), or — R3 — the successor of a history whose every
   * version was rejected (expectedHead = the current head). Today-dated, owner only.
   */
  async function activateCostHistory(req, { tenantId, bizId, body }) {
    if (!body || (body.expectedHead !== null && !codec.validHead(body.expectedHead)) || body.basis !== "recorded") return { status: "activation_shape" };
    const nowMs = clock();
    if (!Number.isSafeInteger(nowMs) || body.effectiveFrom !== core.israelBusinessDate(nowMs)) return { status: "activation_date_mismatch" };
    return saveCostVersion(req, { tenantId, bizId, body, requiredRole: "owner", command: "activate" });
  }
  /** F2: a normal edit has an EFFECTIVE predecessor and cannot backdate or silently activate. */
  async function recordCostEdit(req, { tenantId, bizId, body }) {
    if (!body || body.expectedHead === null || body.basis !== "recorded") return { status: "edit_shape" };
    return saveCostVersion(req, { tenantId, bizId, body, command: "edit" });
  }
  /** F2: historical changes require their own command and persisted attestation evidence. */
  async function attestHistoricalCostEdit(req, { tenantId, bizId, body }) {
    if (!body || body.expectedHead === null || body.basis !== "attested_retroactive") return { status: "attested_edit_shape" };
    return saveCostVersion(req, { tenantId, bizId, body, command: "attest" });
  }
  /** One coherent structural snapshot for an authenticated editor of a REGISTERED business; calculations use decodeHistory. */
  async function readCostHistory(req, { tenantId, bizId }) {
    const auth = await authorizeOperation(req, { tenantId, bizId, mode: "read" });
    if (!auth.ok) return { status: auth.status };
    try {
      const snap = await nodeRef(tenantId, bizId).get();
      const result = codec.decodeHistoryStructure({ exists: snap.exists(), value: snap.val() }, { tenantId, bizId });
      return result.state === "unreadable" ? { status: "unreadable", reason: result.reason } : { status: result.state, history: snap.exists() ? snap.val() : null };
    } catch { return { status: "unreadable", reason: "read_failed" }; }
  }
  return { saveCostVersion, activateCostHistory, recordCostEdit, attestHistoricalCostEdit, readCostHistory, recoverSave, reconcilePendingReviews, acceptFlaggedVersion, rejectFlaggedVersion };
}

/** Production construction fixes the Admin DB and core; tests may use the private factory seam. */
export function createProductionCostHistoryWriter() { return createCostHistoryWriter({ db: getAdminDb() }); }
