// Storage V2 — VERSION FENCE CONTROL PLANE (operator contract), for LOCAL/emulator proof
// and for a SEPARATELY reviewed production operator wrapper.
//
// HARD BOUNDARY — this module:
//   • has NO CLI entry point and NO side effects on import;
//   • is not imported by the runtime;
//   • reads no credentials, no environment and no configuration — every transport is
//     INJECTED (`io.transactControl`, `io.readControl`, `io.readEntriesNode`);
//   • performs one compare-and-swap per transition on the control record, keyed by the
//     server-owned monotonic `policyRevision`; a stale expected revision or a concurrent
//     transition aborts inside the transaction and writes nothing;
//   • gates the (unchanged, independently approved) conversion core
//     `tools/storage-v2/upgrade.mjs` from OUTSIDE: `createFencedConversion` refuses to call
//     it unless the record is `quiesced`, the cutover operation is owned by this operator
//     and the expected revision matches — and it records `conversionAttempted: true` (CAS)
//     BEFORE the first invocation, so an abort back to legacy is impossible afterwards;
//   • grants no authorization to touch any Production business. The Admin SDK bypasses
//     Rules: these checks are an APPLICATION-LEVEL invariant, never a Rules guarantee.

import { parsePolicyRecord, planTransition, policyError, isAllowedTransition, POLICY_CONTRACT_VERSION, nextPolicyRevision, assertValidNextRecord } from "../../lib/storagePolicy.js";

export const CONTROL_ROOT = "storage_v2_control";
export const controlPath = (tenantId, bizId) => `${CONTROL_ROOT}/${tenantId}/${bizId}`;

/**
 * io contract (all injected, all async):
 *   readControl(tenantId, bizId)            → raw record | null
 *   transactControl(tenantId, bizId, fn)    → { committed, snapshot }   // RTDB transaction on the record
 *   readEntriesNode(tenantId, bizId)        → raw entries node | null
 *   now()                                    → epoch ms (optional; Date.now)
 */
export function createStoragePolicyControl(io) {
  for (const k of ["readControl", "transactControl", "readEntriesNode"]) {
    if (typeof (io || {})[k] !== "function") throw new Error("policy control requires: " + k);
  }
  const now = () => (typeof io.now === "function" ? io.now() : Date.now());
  const entriesModeOf = (raw) => {
    if (raw === null || raw === undefined) return "absent";
    if (raw && typeof raw === "object" && raw.schemaVersion === 2) return "v2";
    if (raw && typeof raw === "object" && typeof raw._v === "string") return "legacy";
    return "malformed";
  };

  async function inspect(tenantId, bizId) {
    const raw = await io.readControl(tenantId, bizId);
    const parsed = parsePolicyRecord(raw);
    const entriesMode = entriesModeOf(await io.readEntriesNode(tenantId, bizId));
    return { tenantId, bizId, parsed, raw, entriesMode, policyRevision: parsed.status === "valid" ? parsed.record.policyRevision : 0 };
  }

  // One CAS. `mutate(currentParsed, entriesMode)` returns the next record or throws a
  // StoragePolicyError; the transaction aborts (nothing written) on any throw or on a
  // revision that moved between the operator's read and the commit.
  async function cas(tenantId, bizId, expectedRevision, mutate) {
    let error = null, next = null, runs = 0, probes = 0;
    const entriesMode = entriesModeOf(await io.readEntriesNode(tenantId, bizId));
    const preread = await io.readControl(tenantId, bizId);
    const res = await io.transactControl(tenantId, bizId, (cur) => {
      runs++;
      error = null; next = null;
      // An SDK transaction may run first against an EMPTY local cache (cur === null) although the
      // record exists on the server. Returning the current (null) value is a no-op probe: the server
      // answers with the real record when one exists (and this function runs again with it), and
      // commits nothing new when the record is truly absent (detected below as a vanished record).
      if (cur === null && preread !== null && probes === 0) { probes++; return cur; }
      const parsed = parsePolicyRecord(cur);
      const current = parsed.status === "valid" ? parsed.record.policyRevision : 0;
      if (parsed.status === "malformed") { error = policyError("current_policy_malformed", parsed.reason); return undefined; }
      if (parsed.status === "unsupported_contract") { error = policyError("current_policy_unsupported"); return undefined; }
      if (current !== expectedRevision) { error = policyError("stale_revision", `expected ${expectedRevision}, current ${current}`); return undefined; }
      try { next = mutate(parsed, entriesMode); } catch (e) { error = e; return undefined; }
      if (!next || next.policyRevision !== current + 1 || next.contractVersion !== POLICY_CONTRACT_VERSION) { error = policyError("invalid_next_record", "revision/contract"); return undefined; }
      // R1: the FULL next record is validated against the canonical contract before anything is written —
      // a record the parser (and Rules) would reject can never be persisted by the control plane.
      try { assertValidNextRecord(next); } catch (e) { error = e; return undefined; }
      return next;
    });
    if (error) throw error;
    if (!res || res.committed === false) throw policyError("not_committed", `runs=${runs}`);
    if (next === null) throw policyError("stale_revision", `expected ${expectedRevision}, current 0 (record vanished during CAS)`);
    return { committed: true, record: next, runs };
  }

  const requireOwnedOperation = (rec, kind, operator, operationId) => {
    if (!rec.operation) throw policyError("no_operation_in_progress");
    if (rec.operation.kind !== kind) throw policyError("operation_kind_mismatch", rec.operation.kind);
    if (rec.operation.owner !== operator || rec.operation.id !== operationId) throw policyError("operation_not_owned", `${rec.operation.owner}/${rec.operation.id}`);
  };

  /** absent → legacy (explicit legacy policy for an existing business before a rollout). */
  const initializeLegacy = (tenantId, bizId, { expectedRevision = 0, operator } = {}) =>
    cas(tenantId, bizId, expectedRevision, (parsed) => {
      if (parsed.status !== "absent") throw policyError("policy_already_exists");
      return planTransition(parsed, "legacy", { expectedRevision, operator, now: now() });
    });

  /** legacy → quiesced; opens the cutover operation owned by (operator, operationId). */
  const quiesce = (tenantId, bizId, { expectedRevision, operator, operationId } = {}) =>
    cas(tenantId, bizId, expectedRevision, (parsed) => {
      if (parsed.status !== "valid") throw policyError("policy_required", "initialize legacy policy first");
      if (parsed.record.operation) throw policyError("operation_in_progress", parsed.record.operation.id);
      return planTransition(parsed, "quiesced", { expectedRevision, operator, operationId, now: now() });
    });

  /** quiesced → legacy — ONLY before any conversion attempt, only by the operation owner. */
  const abortQuiescence = (tenantId, bizId, { expectedRevision, operator, operationId } = {}) =>
    cas(tenantId, bizId, expectedRevision, (parsed, entriesMode) => {
      if (parsed.status !== "valid") throw policyError("policy_required");
      requireOwnedOperation(parsed.record, "cutover", operator, operationId);
      const next = planTransition(parsed, "legacy", { expectedRevision, operator, now: now(), conversionAttempted: parsed.record.conversionAttempted, entriesMode });
      next.operation = null;
      return next;
    });

  /** quiesced → v2_active after a COMMITTED conversion (entries node must be V2); flag false. */
  const activateV2 = (tenantId, bizId, { expectedRevision, operator, operationId, approvedReleaseId } = {}) =>
    cas(tenantId, bizId, expectedRevision, (parsed, entriesMode) => {
      if (parsed.status !== "valid") throw policyError("policy_required");
      requireOwnedOperation(parsed.record, "cutover", operator, operationId);
      const next = planTransition(parsed, "v2_active", { expectedRevision, operator, now: now(), entriesMode, approvedReleaseId });
      next.operation = null;
      return next;
    });

  /** absent/legacy → v2_active + allowV2Initialization=true for a GENUINELY absent business (native V2). */
  const activateNative = (tenantId, bizId, { expectedRevision = 0, operator, approvedReleaseId } = {}) =>
    cas(tenantId, bizId, expectedRevision, (parsed, entriesMode) => {
      if (parsed.status === "valid" && parsed.record.operation) throw policyError("operation_in_progress", parsed.record.operation.id);
      return planTransition(parsed, "v2_active", { expectedRevision, operator, now: now(), entriesMode, native: true, approvedReleaseId });
    });

  /** v2_active → v2_active with allowV2Initialization=false once the first row exists (optional hygiene). */
  const closeInitialization = (tenantId, bizId, { expectedRevision, operator } = {}) =>
    cas(tenantId, bizId, expectedRevision, (parsed) => {
      if (parsed.status !== "valid" || parsed.record.phase !== "v2_active") throw policyError("transition_not_allowed", "not v2_active");
      return { ...parsed.record, policyRevision: nextPolicyRevision(parsed.record.policyRevision), allowV2Initialization: false, updatedAt: now(), ...(operator ? { updatedBy: operator } : {}) };
    });

  /** v2_active → recovery_hold (incident); opens a recovery operation. */
  const enterRecoveryHold = (tenantId, bizId, { expectedRevision, operator, operationId } = {}) =>
    cas(tenantId, bizId, expectedRevision, (parsed) => {
      if (parsed.status !== "valid") throw policyError("policy_required");
      if (parsed.record.operation) throw policyError("operation_in_progress", parsed.record.operation.id);
      return planTransition(parsed, "recovery_hold", { expectedRevision, operator, operationId, now: now() });
    });

  /** recovery_hold → v2_active after reconciliation, by the recovery operation owner. */
  const resumeV2Active = (tenantId, bizId, { expectedRevision, operator, operationId } = {}) =>
    cas(tenantId, bizId, expectedRevision, (parsed, entriesMode) => {
      if (parsed.status !== "valid") throw policyError("policy_required");
      requireOwnedOperation(parsed.record, "recovery", operator, operationId);
      const next = planTransition(parsed, "v2_active", { expectedRevision, operator, now: now(), entriesMode });
      next.operation = null;
      return next;
    });

  /**
   * Gate the approved conversion core from outside. `upgradeBusinessToV2(io, {tenantId, bizId})`
   * is the UNCHANGED function from tools/storage-v2/upgrade.mjs; `entriesIo` is its transport.
   * Sequence: verify quiesced + owned cutover + expected revision → CAS `conversionAttempted: true`
   * (revision+1) → invoke the core exactly once → return { policyRevision, result }.
   * The policy stays `quiesced` whatever the outcome; `activateV2` is a separate, owned step.
   */
  function createFencedConversion({ upgradeBusinessToV2, entriesIo }) {
    if (typeof upgradeBusinessToV2 !== "function") throw new Error("fenced conversion requires upgradeBusinessToV2");
    return async function runConversion(tenantId, bizId, { expectedRevision, operator, operationId } = {}) {
      const marked = await cas(tenantId, bizId, expectedRevision, (parsed) => {
        if (parsed.status !== "valid") throw policyError("policy_required");
        if (parsed.record.phase !== "quiesced") throw policyError("conversion_requires_quiesced", parsed.record.phase);
        requireOwnedOperation(parsed.record, "cutover", operator, operationId);
        return { ...parsed.record, policyRevision: nextPolicyRevision(parsed.record.policyRevision), conversionAttempted: true, updatedAt: now(), updatedBy: String(operator) };
      });
      const result = await upgradeBusinessToV2(entriesIo, { tenantId, bizId });
      return { policyRevision: marked.record.policyRevision, result };
    };
  }

  return { inspect, initializeLegacy, quiesce, abortQuiescence, activateV2, activateNative, closeInitialization, enterRecoveryHold, resumeV2Active, createFencedConversion, isAllowedTransition };
}
