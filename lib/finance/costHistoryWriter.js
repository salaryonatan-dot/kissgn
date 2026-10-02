// F1/F2 R2 — internal trusted cost-history command; no public route or client grant.
// Not production code; no HTTP endpoint. A future F2 route calls `saveCostVersion(req, body)` with the
// real request so lib/securityContext.js requireBizContext performs, in order: verified Firebase identity
// (lib/verifyToken.js requireAuth, checkRevoked) → id validation → requireTenantAccess(floor "manager")
// → explicit WRITE role set {manager, owner, super_owner} → requireBizAccess. These are the approved
// helpers, vendored byte-identical here; experiments inject ONLY a mock identity verifier and the
// emulator Admin DB (createCostHistoryWriter deps). The mock does NOT prove token verification.
//
// Storage: ONE node per business, { head:{revision, headVersionId}, versions:{uuid: record} }, mutated
// ONLY by one Admin transaction on that node. Unrelated tenant/business writes cannot force its retries.
import { createHash } from "node:crypto";
import { requireBizContext, requireBizAccess, WRITE_ROLES } from "../securityContext.js";
import { requireTenantAccess as helpersRequireTenantAccess } from "../helpers.js";
import { costHistoryCodec, UUID4, REVIEW_SCHEMA } from "../../fincore/v1/finance/costHistory.js";
import * as businessDate from "../../fincore/v1/finance/businessDate.js";
import { getAdminDb } from "../adminSdk.js";

export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;   // predecessor recordedAt this far ahead of now ⇒ history anomaly (fail closed)
export const CLOCK_WAIT_MAX_MS = 2000;             // bounded wait when this instance's clock is just behind the predecessor
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const only = (o, allowed) => isObj(o) && Object.keys(o).every((k) => allowed.includes(k));
const stable = (x) => JSON.stringify(x, (_, v) => (isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
const REQUEST_FIELDS = ["versionId", "expectedHead", "effectiveFrom", "basis", "globalEmployees", "fixedItems", "rent", "royalty", "note", "attestation"];

/** Integrity link between the attested confirmation and the exact snapshot/date (NOT proof of human typing). */
export function attestationDigest(body) {
  const v = { effectiveFrom: body.effectiveFrom, basis: body.basis, globalEmployees: body.globalEmployees, fixedItems: body.fixedItems, rent: body.rent, royalty: body.royalty };
  if (Object.prototype.hasOwnProperty.call(body, "note")) v.note = body.note;
  return createHash("sha256").update(stable(v)).digest("hex");
}

function toWire(body, { versionId, recordedAt, recordedBy, predecessorVersionId }) {
  const w = { versionId, schema: "MARJIN_COSTV/1", effectiveFrom: body.effectiveFrom, recordedAt, recordedBy, basis: body.basis,
    globalEmployeesCount: body.globalEmployees.length, fixedItemsCount: body.fixedItems.length, rent: body.rent, royalty: body.royalty, predecessorVersionId };
  if (body.globalEmployees.length) w.globalEmployees = body.globalEmployees.map((x) => ({ ...x }));
  if (body.fixedItems.length) w.fixedItems = body.fixedItems.map((x) => ({ ...x }));
  if (Object.prototype.hasOwnProperty.call(body, "note")) w.note = body.note;
  return w;
}
const intentOf = (w) => { const { recordedAt, ...rest } = w; return stable(rest); };   // every field but the server timestamp
const digest = (value) => createHash("sha256").update(stable(value)).digest("hex");

/**
 * deps (TEST SEAMS — production omits them all):
 *   db            Admin database (production: lib/adminSdk.js getAdminDb via requireBizContext)
 *   core          approved core date functions (fincore/v1/finance/businessDate.js)
 *   authDeps      passed to requireBizContext (tests: { requireAuth: MOCK, getDb }); production: {}
 *   clock         ms clock (production: Date.now)
 *   hooks         { afterAuth?, txFault? } deterministic emulator probes only
 *   mutation      red-control switch (red-controls.mjs only)
 */
export function createCostHistoryWriter({ db, core = businessDate, authDeps = {}, clock = () => Date.now(), hooks = {} }) {
  const codec = costHistoryCodec;
  const nodeRef = (t, b) => db.ref(`tenants/${t}/biz:${b}:cost_history`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function parse(body, uid, nowMs) {
    if (!only(body, REQUEST_FIELDS) || typeof body.versionId !== "string" || !UUID4.test(body.versionId)) return { error: "request_shape" };
    const e = body.expectedHead;
    if (e !== null && !codec.validHead(e)) return { error: "expected_head_shape" };
    if (!Array.isArray(body.globalEmployees) || !Array.isArray(body.fixedItems)) return { error: "list_shape" };
    if (typeof body.effectiveFrom !== "string" || core.parseBusinessDate(body.effectiveFrom) === null) return { error: "record_shape", detail: "effective_from_invalid" };
    const today = core.israelBusinessDate(nowMs);
    let wire;
    try { wire = toWire(body, { versionId: body.versionId, recordedAt: nowMs, recordedBy: uid, predecessorVersionId: e ? e.headVersionId : "none" }); } catch { return { error: "record_shape" }; }
    if (body.basis === "recorded") {
      if (body.attestation !== undefined) return { error: "attestation_not_applicable" };
      if (body.effectiveFrom < today) return { error: "recorded_past_date" };
    } else if (body.basis === "attested_retroactive") {
      const a = body.attestation;
      if (!only(a, ["confirmed", "typedEffectiveFrom", "confirmedSnapshotDigest"]) || Object.keys(a).length !== 3 || a.confirmed !== true ||
        a.typedEffectiveFrom !== body.effectiveFrom || a.confirmedSnapshotDigest !== attestationDigest(body)) return { error: "attestation_missing" };
      if (body.effectiveFrom >= today) return { error: "attestation_not_past" };
    }
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
    const h = codec.decodeHistoryStructure({ exists: snap.exists(), value: snap.val() });
    if (h.state === "unreadable") return { status: "history_unreadable", reason: h.reason };
    const stored = snap.exists() ? (snap.val().versions || {})[wire.versionId] : undefined;
    if (!stored) return { status: "not_committed", head: h.head || null };
    if (intentOf(stored) !== intentOf(wire)) return { status: "identity_reused", head: h.head };
    return { status: h.head.headVersionId === wire.versionId ? "committed_current" : "committed_superseded", head: h.head, recordedAt: stored.recordedAt, resolvedBy: "readback",
      review: h.review[wire.versionId].state, intentDigest: h.review[wire.versionId].intentDigest };
  }

  async function attemptOnce(req, body) {
    const { tenantId, bizId } = body.__scope;
    // (1) fresh, fail-closed authorization through the approved helper chain
    let ctx;
    try { ctx = await requireBizContext(req, { tenantId, bizId, mode: "write" }, { getDb: async () => db, ...authDeps }); }
    catch (e) { return { status: e && e.status === 401 ? "unauthenticated" : e && e.status === 503 ? "authorization_unavailable" : e && e.status === 400 ? "request_scope_invalid" : "unauthorized", http: e && e.status }; }
    let authDoneAt = Date.now();
    // (2) one authoritative server instant: recordedAt AND the Israel business date of this attempt
    const nowMs = clock();
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return { status: "clock_invalid" };
    const parsed = parse(stripScope(body), ctx.uid, nowMs);
    if (parsed.error) return { status: parsed.error, detail: parsed.detail };
    const { wire } = parsed;
    const ref = nodeRef(tenantId, bizId);
    let primed;
    try { primed = await ref.get(); } catch { return { status: "history_unavailable" }; }
    const initial = codec.decodeHistoryStructure({ exists: primed.exists(), value: primed.val() });
    if (initial.state === "unreadable") return { status: "history_unreadable:" + initial.reason };
    // F1 R1: no new version over an unresolved authorization review (pending / flagged); it must be
    // reconciled or acknowledged first, so a later version can never bury an earlier unresolved one.
    if (initial.state === "present" && (initial.unresolved.pending.length || initial.unresolved.flagged.length)) return { status: "review_unresolved", unresolved: initial.unresolved };
    // Durable, immutable pre-commit evidence. If the process stops after the cost
    // transaction, this intent can be reconciled against the authoritative history.
    const auditIntent = { contract: "MARJIN_COST_AUDIT/1", tenantId, bizId, versionId: wire.versionId,
      recordedBy: ctx.uid, intentDigest: digest(intentOf(wire)), precheckedAt: nowMs };
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
    // The audit intent and cold-cache priming are preparatory reads/writes. Re-check
    // current membership, role and business access after them, immediately before
    // the cost-history transaction; a revocation already committed now denies.
    try {
      const current = await requireBizContext(req, { tenantId, bizId, mode: "write" }, { getDb: async () => db, ...authDeps });
      if (current.uid !== ctx.uid) return { status: "unauthorized" };
    } catch (e) { return { status: e && e.status === 503 ? "authorization_unavailable" : "unauthorized", http: e && e.status }; }
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
        const h = codec.decodeHistoryStructure({ exists: current !== null && current !== undefined, value: current });
        if (h.state === "unreadable") { reason = "history_unreadable:" + h.reason; return; }
        if (h.state === "present" && (h.unresolved.pending.length || h.unresolved.flagged.length)) { reason = "review_unresolved"; return; }
        const versions = h.state === "present" ? current.versions : {};
        const reviews = h.state === "present" ? current.review : {};
        if (Object.prototype.hasOwnProperty.call(versions, wire.versionId)) { reason = "existing_identity"; return; }
        const e = body.expectedHead, head = h.state === "present" ? h.head : null;
        if (e === null ? head !== null : !head || head.revision !== e.revision || head.headVersionId !== e.headVersionId) { reason = "head_conflict"; return; }
        const pred = head ? h.versions[h.versions.length - 1] : null;
        if (pred && pred.recordedAt > nowMs + MAX_FUTURE_SKEW_MS) { reason = "history_clock_anomaly"; return; }
        if (pred && nowMs <= pred.recordedAt) { reason = "clock_behind_predecessor"; waitMs = pred.recordedAt - nowMs + 1; return; }
        const w = wire;
        // F1 R1: the version and its PENDING authorization review commit together (one transaction).
        const pendingReview = { schema: REVIEW_SCHEMA, state: "pending", intentDigest: auditIntent.intentDigest, actor: wire.recordedBy, committedAt: wire.recordedAt };
        const next = { head: { revision: head ? head.revision + 1 : 1, headVersionId: wire.versionId }, versions: { ...versions, [wire.versionId]: w }, review: { ...reviews, [wire.versionId]: pendingReview } };
        // defence in depth: structurally valid, and NOT authoritative until the review resolves
        const chk = codec.decodeHistoryStructure({ exists: true, value: next });
        if (chk.state !== "present" || chk.unresolved.pending.join() !== wire.versionId || chk.unresolved.flagged.length) { reason = "internal_invalid"; return; }
        reason = "commit"; return next;
      }, undefined, false);
      tx = hooks.txFault ? await hooks.txFault(run) : await run();
    } catch (err) {
      // R2 C6: a thrown transaction (maxretry, disconnect, lost ack) is an UNKNOWN outcome → authoritative readback
      const r = await recover({ tenantId, bizId, wire });
      return { ...r, uncertain: true, cause: String((err && err.message) || err), calls, uid: ctx.uid };
    }
    if (tx.committed) return { status: "committed_current", head: tx.snapshot.val().head, recordedAt: nowMs, calls, authToCommitMs: Date.now() - authDoneAt, uid: ctx.uid, review: "pending", intentDigest: auditIntent.intentDigest };
    if (reason === "existing_identity") return { ...(await recover({ tenantId, bizId, wire })), calls, uid: ctx.uid };
    if (reason === "clock_behind_predecessor") return { status: reason, waitMs, retryable: true, calls };
    return { status: reason, calls };
  }
  const stripScope = (b) => { const { __scope, ...rest } = b; return rest; };

  // ── F1 R1: authorization review resolution (pending → cleared | flagged; flagged → acknowledged) ────────
  // ONE transaction on the history node that changes ONLY the named version's review entry. Versions and
  // head are never touched (immutability). The entry must still carry the caller's intent digest, so an
  // operation can never clear or flag a different version or payload. Every non-applying run re-submits
  // the value it saw (a decision is reported only on a server-confirmed value, never on a cold cache);
  // a thrown transaction (lost acknowledgement) is resolved by a full-payload readback of the entry.
  const TRANSITIONS = Object.freeze({ cleared: ["pending"], flagged: ["pending"], acknowledged: ["flagged"] });
  function resolvedEntry(cur, to, { resolution, nowMs, by }) {
    if (to === "acknowledged") return { ...cur, state: "acknowledged", acknowledgedAt: Math.max(nowMs, cur.resolvedAt), acknowledgedBy: by };
    return { ...cur, state: to, resolvedAt: Math.max(nowMs, cur.committedAt), resolution };
  }
  async function transitionReview({ tenantId, bizId, versionId, intentDigest, to, resolution, by }) {
    if (typeof versionId !== "string" || !UUID4.test(versionId) || typeof intentDigest !== "string" || !TRANSITIONS[to]) return { status: "request_shape" };
    const ref = nodeRef(tenantId, bizId);
    const nowMs = clock();
    let outcome = null, primedVal;
    try { primedVal = (await ref.get()).val(); } catch { return { status: "history_unavailable" }; }
    let first = true;
    const decide = (current) => {
      const h = codec.decodeHistoryStructure({ exists: current !== null && current !== undefined, value: current });
      if (h.state !== "present") return { o: h.state === "absent" ? "not_found" : "history_unreadable:" + h.reason };
      const e = current.review[versionId];
      if (!e) return { o: "not_found" };
      if (e.intentDigest !== intentDigest) return { o: "review_identity_mismatch" };
      if (e.state === to) return { o: "already_" + to };                  // idempotent retry / concurrent resolver
      if (!TRANSITIONS[to].includes(e.state)) return { o: "review_already_resolved:" + e.state };
      const next = { ...current, review: { ...current.review, [versionId]: resolvedEntry(e, to, { resolution, nowMs, by }) } };
      const chk = codec.decodeHistoryStructure({ exists: true, value: next });
      if (chk.state !== "present") return { o: "internal_invalid" };
      return { o: "applied", next };
    };
    try {
      const tx = await ref.transaction((current) => {
        if (current === null && first) current = primedVal;
        first = false;
        const d = decide(current);
        outcome = d.o;
        return d.o === "applied" ? d.next : current;      // non-apply: re-submit (server-confirmed decision)
      }, undefined, false);
      if (!tx.committed) return { status: "outcome_unknown", detail: "not_committed" };
      return { status: outcome === "applied" ? "resolved" : outcome, state: to };
    } catch (err) {
      try {
        const snap = await ref.get();
        const h = codec.decodeHistoryStructure({ exists: snap.exists(), value: snap.val() });
        const e = h.state === "present" ? snap.val().review[versionId] : null;
        if (e && e.intentDigest === intentDigest && e.state === to) return { status: "resolved", state: to, resolvedBy: "readback", cause: String((err && err.message) || err) };
        return { status: "outcome_unknown", detail: e ? "review_" + e.state : "readback_no_entry", cause: String((err && err.message) || err) };
      } catch { return { status: "outcome_unknown", detail: "readback_failed" }; }
    }
  }

  /** Durable audit flag record (separate, append-only evidence; the authoritative state is the review entry). */
  async function persistFlagRecord(tenantId, bizId, versionId, recordedBy, recordedAt, outcome) {
    const event = { contract: "MARJIN_COST_AUDIT/1", outcome, tenantId, bizId, versionId, recordedBy, recordedAt, detectedAt: Date.now() };
    try {
      const flagRef = db.ref(`tenants/${tenantId}/audit/cost_history_flags/${versionId}`);
      const flag = await flagRef.transaction((current) => current === null ? event : undefined, undefined, false);
      if (!flag.committed) {
        const existing = await flagRef.get();
        if (!existing.exists() || existing.val().versionId !== versionId) throw new Error("flag_conflict");
      }
      return "flag_persisted";
    } catch { return "flag_unconfirmed"; }
  }

  /** The internal command a future route would call. `req` is the real HTTP request (identity source). */
  async function saveCostVersion(req, { tenantId, bizId, body }) {
    const scoped = { ...body, __scope: { tenantId, bizId } };
    let r = await attemptOnce(req, scoped);
    // R2 C4: a clock just behind the predecessor waits (bounded) and retries the SAME intent with a fresh instant
    if (r.status === "clock_behind_predecessor" && r.waitMs <= CLOCK_WAIT_MAX_MS) { await sleep(r.waitMs); r = await attemptOnce(req, scoped); }
    if ((r.status === "committed_current" || r.status === "committed_superseded") && r.review === "pending") {
      // R2 C2 option (a) / DEC-AUTH-1: the authorization is checked BEFORE the transaction; a revocation landing
      // in the check→commit window is not prevented, only DETECTED here. F1 R1: the version committed with a
      // PENDING review (non-authoritative); only this post-commit decision clears it. Any failure leaves it
      // pending — visible, non-authoritative and reconcilable — never ordinary approved history.
      let decision = null;
      try { await requireBizContext(req, { tenantId, bizId, mode: "write" }, { getDb: async () => db, ...authDeps }); r.postCommitAccess = "current"; decision = { to: "cleared", resolution: "post_commit_authorized" }; }
      catch (e) {
        if (e && (e.status === 401 || e.status === 403)) {
          r.postCommitAccess = "revoked_during_commit";
          r.audit = await persistFlagRecord(tenantId, bizId, body.versionId, r.uid, r.recordedAt, "revoked_during_commit");
          decision = { to: "flagged", resolution: "revoked_during_commit" };
        } else r.postCommitAccess = "verification_unavailable";
      }
      if (decision) {
        const t = await transitionReview({ tenantId, bizId, versionId: body.versionId, intentDigest: r.intentDigest, ...decision, by: r.uid });
        r.review = t.status === "resolved" || t.status === "already_" + decision.to ? decision.to : "pending";
        if (r.review === "pending") r.reviewResolution = t.status;
      }
    }
    return r;
  }

  /**
   * Trusted reconciliation (server job / future F2 route; no client capability): resolves every PENDING
   * review of one business from the actor's CURRENT authorization as stored (fresh membership, explicit
   * write role, business access). Authorized ⇒ cleared; definitively unauthorized ⇒ flagged (+ audit
   * record); an unavailable check leaves it pending. Idempotent; never touches flagged / resolved entries.
   */
  async function reconcilePendingReviews({ tenantId, bizId }) {
    let snap;
    try { snap = await nodeRef(tenantId, bizId).get(); } catch { return { status: "history_unavailable" }; }
    const h = codec.decodeHistoryStructure({ exists: snap.exists(), value: snap.val() });
    if (h.state !== "present") return { status: h.state === "absent" ? "nothing_pending" : "history_unreadable:" + h.reason, results: [] };
    const results = [];
    const tenantAccess = authDeps.requireTenantAccess || helpersRequireTenantAccess;
    for (const versionId of h.unresolved.pending) {
      const v = h.versions.find((x) => x.versionId === versionId);
      const digestNow = h.review[versionId].intentDigest;
      if (digest(intentOf(snap.val().versions[versionId])) !== digestNow) { results.push({ versionId, status: "review_identity_mismatch" }); continue; }
      let decision;
      try {
        const role = await tenantAccess(v.recordedBy, tenantId, "manager");
        if (!WRITE_ROLES.includes(role)) throw { status: 403 };
        await requireBizAccess(db, tenantId, bizId, v.recordedBy, role);
        decision = { to: "cleared", resolution: "reconciled_authorized" };
      } catch (e) {
        if (e && e.status === 403) decision = { to: "flagged", resolution: "reconciled_unauthorized" };
        else { results.push({ versionId, status: "verification_unavailable" }); continue; }
      }
      const audit = decision.to === "flagged" ? await persistFlagRecord(tenantId, bizId, versionId, v.recordedBy, v.recordedAt, "reconciled_unauthorized") : undefined;
      const t = await transitionReview({ tenantId, bizId, versionId, intentDigest: digestNow, ...decision, by: "reconciler" });
      results.push({ versionId, status: t.status, state: t.state, ...(audit ? { audit } : {}) });
    }
    return { status: "reconciled", results };
  }

  /**
   * An OWNER (or super_owner) explicitly acknowledges a FLAGGED version after review: flagged → acknowledged.
   * Fresh request authorization; managers cannot acknowledge. The flag evidence stays in the entry
   * (resolution + acknowledgedBy/At) and in the audit record; the version itself is unchanged.
   */
  async function acknowledgeFlaggedVersion(req, { tenantId, bizId, versionId, intentDigest }) {
    let ctx;
    try { ctx = await requireBizContext(req, { tenantId, bizId, mode: "write" }, { getDb: async () => db, ...authDeps }); }
    catch (e) { return { status: e && e.status === 401 ? "unauthenticated" : e && e.status === 503 ? "authorization_unavailable" : "unauthorized" }; }
    if (ctx.role !== "owner" && ctx.role !== "super_owner") return { status: "role_not_allowed" };
    return transitionReview({ tenantId, bizId, versionId, intentDigest, to: "acknowledged", by: ctx.uid });
  }

  async function recoverSave(req, { tenantId, bizId, body, recordedAtHint }) {
    let ctx;
    try { ctx = await requireBizContext(req, { tenantId, bizId, mode: "read" }, { getDb: async () => db, ...authDeps }); } catch { return { status: "unauthorized" }; }
    const e = body.expectedHead;
    const wire = toWire(body, { versionId: body.versionId, recordedAt: recordedAtHint || 1, recordedBy: ctx.uid, predecessorVersionId: e ? e.headVersionId : "none" });
    return recover({ tenantId, bizId, wire });
  }
  return { saveCostVersion, recoverSave, reconcilePendingReviews, acknowledgeFlaggedVersion };
}

/** Production construction fixes the Admin DB and core; tests may use the private factory seam. */
export function createProductionCostHistoryWriter() { return createCostHistoryWriter({ db: getAdminDb() }); }
