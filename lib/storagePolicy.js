// Marjin — STORAGE V2 VERSION FENCE: the server-owned per-business storage policy
// contract (P0-DATA-01, CTO D-VF1/D-VF2).
//
// HARD BOUNDARY — this module:
//   • is PURE: no Firebase import, no I/O, no environment, no credentials;
//   • decodes the control record at `/storage_v2_control/{tenantId}/{bizId}` exactly as
//     the RTDB Rules predicate reads it (FENCE_GUARD in database.rules.json) — the two
//     MUST agree on what "valid" means, and the client block in index.html mirrors it;
//   • decides honest-client / Admin-admission behaviour from that record; it is NOT the
//     trust boundary (Rules are) and it never grants anything a client could not do.
//
// Contract (CANONICAL — artifacts/p0-data-01-version-fence-r1/POLICY_CONTRACT_PARITY.md; the
// Rules predicate VALID in database.rules.json enforces the SAME domain, field by field):
//   ABSENT record (whole node missing)         → legacy defaults: legacy-shaped writes only,
//                                                never V2 initialization, existing V2 blocked.
//   PRESENT record must be VALID:
//     contractVersion        required, number === 1
//     phase                  required, one of POLICY_PHASES
//     policyRevision         required, integer, 1 ≤ x ≤ Number.MAX_SAFE_INTEGER
//     allowV2Initialization  required, boolean; true ONLY while phase === "v2_active"
//     minStorageProtocol     required, integer, 1 ≤ x ≤ Number.MAX_SAFE_INTEGER
//     operation              optional (absent/null = none); else object with id (non-empty
//                            string), kind ∈ OPERATION_KINDS, owner (non-empty string),
//                            startedAt (integer, 1 ≤ x ≤ MAX_SAFE_INTEGER)
//     conversionAttempted    optional (absent = false); else boolean (an in-memory explicit
//                            null is malformed — RTDB can never deliver one)
//     updatedAt/updatedBy/approvedReleaseId  diagnostic only, never authorization
//   Anything else present                      → MALFORMED → fail closed (no entries mutation,
//                                                no Admin admission, no tooling transition).
//   RTDB stores no nulls: a null child never reaches the parser or Rules; `operation: null`
//   (the tooling's explicit "no operation") is normalised to absent by the write itself.
//   phase legacy        → legacy writes;  quiesced / recovery_hold → nothing;
//   phase v2_active     → V2 protocol writes; absent → V2 only with allowV2Initialization.

export const POLICY_CONTRACT_VERSION = 1;
export const STORAGE_PROTOCOL_V2 = 2;
export const POLICY_PHASES = Object.freeze(["legacy", "quiesced", "v2_active", "recovery_hold"]);
export const OPERATION_KINDS = Object.freeze(["cutover", "recovery"]);

const isPlain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isPosSafeInt = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;

/**
 * Decode a raw control-record value (snapshot.val()).
 *  { status:"absent" }
 *  { status:"valid", record }            // normalized copy (unknown extra keys dropped)
 *  { status:"unsupported_contract", contractVersion }   // well-formed, newer contract → honest clients: update required
 *  { status:"malformed", reason }
 */
export function parsePolicyRecord(raw) {
  if (raw === null || raw === undefined) return { status: "absent" };
  if (!isPlain(raw)) return { status: "malformed", reason: "not_an_object" };
  if (raw.contractVersion !== POLICY_CONTRACT_VERSION) {
    if (isPosSafeInt(raw.contractVersion) && raw.contractVersion > POLICY_CONTRACT_VERSION && POLICY_PHASES.includes(raw.phase) && isPosSafeInt(raw.policyRevision)) {
      return { status: "unsupported_contract", contractVersion: raw.contractVersion };
    }
    return { status: "malformed", reason: "contract_version" };
  }
  if (!POLICY_PHASES.includes(raw.phase)) return { status: "malformed", reason: raw.phase === undefined ? "phase_missing" : "phase_invalid" };
  if (!isPosSafeInt(raw.policyRevision)) return { status: "malformed", reason: "policy_revision" };
  if (typeof raw.allowV2Initialization !== "boolean") return { status: "malformed", reason: "allow_v2_initialization" };
  if (raw.allowV2Initialization === true && raw.phase !== "v2_active") return { status: "malformed", reason: "initialization_flag_outside_active" };
  if (!isPosSafeInt(raw.minStorageProtocol)) return { status: "malformed", reason: "min_storage_protocol" };
  let operation = null;
  if (raw.operation !== undefined && raw.operation !== null) {
    const o = raw.operation;
    if (!isPlain(o) || typeof o.id !== "string" || !o.id || !OPERATION_KINDS.includes(o.kind) || typeof o.owner !== "string" || !o.owner || !isPosSafeInt(o.startedAt)) {
      return { status: "malformed", reason: "operation" };
    }
    operation = { id: o.id, kind: o.kind, owner: o.owner, startedAt: o.startedAt };
  }
  if (raw.conversionAttempted !== undefined && typeof raw.conversionAttempted !== "boolean") return { status: "malformed", reason: "conversion_attempted" };
  const record = {
    contractVersion: POLICY_CONTRACT_VERSION,
    phase: raw.phase,
    policyRevision: raw.policyRevision,
    allowV2Initialization: raw.allowV2Initialization,
    minStorageProtocol: raw.minStorageProtocol,
    operation,
    conversionAttempted: raw.conversionAttempted === true,
  };
  if (typeof raw.updatedAt === "number") record.updatedAt = raw.updatedAt;
  if (typeof raw.updatedBy === "string") record.updatedBy = raw.updatedBy;
  if (typeof raw.approvedReleaseId === "string") record.approvedReleaseId = raw.approvedReleaseId;
  return { status: "valid", record };
}

/**
 * Honest-client decision. `parsed` is a parsePolicyRecord result or null (unresolved);
 * `entriesMode` is the RAW node mode the client hydrated ("absent" | "legacy" | "v2" |
 * "malformed" | null); `clientProtocol` is the build's STORAGE_PROTOCOL constant.
 * Returns { state, writable, reason?, revision }:
 *  policy_unresolved · policy_malformed · update_required · maintenance_read_only ·
 *  initialization_not_enabled · storage_unresolved · storage_malformed ·
 *  v2_without_policy · conversion_pending · legacy · v2
 */
export function decideEntriesAccess(parsed, entriesMode, clientProtocol = STORAGE_PROTOCOL_V2) {
  if (!parsed) return { state: "policy_unresolved", writable: false, revision: null };
  if (parsed.status === "malformed") return { state: "policy_malformed", writable: false, reason: parsed.reason, revision: null };
  if (parsed.status === "unsupported_contract") return { state: "update_required", writable: false, reason: "contract_version", revision: null };
  const rec = parsed.status === "valid" ? parsed.record : null;
  const revision = rec ? rec.policyRevision : 0;   // 0 = confirmed-absent sentinel (never a valid revision)
  if (rec && rec.minStorageProtocol > clientProtocol) return { state: "update_required", writable: false, reason: "min_storage_protocol", revision };
  if (rec && (rec.phase === "quiesced" || rec.phase === "recovery_hold")) return { state: "maintenance_read_only", writable: false, reason: rec.phase, revision };
  if (entriesMode === null || entriesMode === undefined) return { state: "storage_unresolved", writable: false, revision };
  if (entriesMode === "malformed") return { state: "storage_malformed", writable: false, revision };
  const phase = rec ? rec.phase : "legacy";
  if (phase === "legacy") {
    if (entriesMode === "v2") return { state: "v2_without_policy", writable: false, revision };
    if (entriesMode === "absent") return { state: "initialization_not_enabled", writable: false, reason: rec ? "phase_legacy" : "no_policy", revision };
    return { state: "legacy", writable: true, revision };
  }
  // v2_active
  if (entriesMode === "legacy") return { state: "conversion_pending", writable: false, revision };
  if (entriesMode === "absent") return rec.allowV2Initialization === true
    ? { state: "v2", writable: true, revision, initialization: true }
    : { state: "initialization_not_enabled", writable: false, reason: "flag_false", revision };
  return { state: "v2", writable: true, revision };
}

/** Admin-side admission for server actions that mutate a business's entries domain ledgers. */
export function decideAdminAdmission(parsed) {
  if (!parsed) return { admitted: false, reason: "policy_unresolved" };
  if (parsed.status === "absent") return { admitted: true, reason: "no_policy" };
  if (parsed.status === "malformed") return { admitted: false, reason: "policy_malformed" };
  if (parsed.status === "unsupported_contract") return { admitted: false, reason: "unsupported_contract" };
  const p = parsed.record.phase;
  if (p === "quiesced" || p === "recovery_hold") return { admitted: false, reason: "maintenance", phase: p };
  return { admitted: true, reason: p };
}

// ── transitions (Admin tooling; Rules do not see these — application-level invariant) ──
/**
 * Allowed transitions. `from` is "absent" or a phase; `to` is a phase; `ctx` carries the
 * facts the tool verified: conversionAttempted, entriesMode ("absent"|"legacy"|"v2"),
 * native (explicit native-activation of a genuinely absent business).
 */
export function isAllowedTransition(from, to, ctx = {}) {
  const c = { conversionAttempted: false, entriesMode: null, native: false, ...ctx };
  if (from === "absent" && to === "legacy") return { ok: true };
  if (from === "legacy" && to === "quiesced") return { ok: true };
  if (from === "quiesced" && to === "v2_active") {
    if (c.entriesMode !== "v2") return { ok: false, reason: "entries_not_v2" };
    return { ok: true };
  }
  if (from === "quiesced" && to === "legacy") {
    if (c.conversionAttempted) return { ok: false, reason: "conversion_attempted" };
    if (c.entriesMode === "v2") return { ok: false, reason: "entries_already_v2" };
    return { ok: true };
  }
  if ((from === "legacy" || from === "absent") && to === "v2_active") {
    if (!c.native) return { ok: false, reason: "native_activation_not_explicit" };
    if (c.entriesMode !== "absent") return { ok: false, reason: "entries_not_absent" };
    return { ok: true };
  }
  if (from === "v2_active" && to === "recovery_hold") return { ok: true };
  if (from === "recovery_hold" && to === "v2_active") return { ok: true };
  if (to === "legacy") return { ok: false, reason: "legacy_downgrade_forbidden" };
  return { ok: false, reason: "transition_not_allowed" };
}

/**
 * The ONLY way a revision advances: +1, and only while the result stays inside the contract's
 * safe-integer domain. At Number.MAX_SAFE_INTEGER every further transition is a typed refusal
 * (`revision_exhausted`) — never a wrap, never a reuse, never 2^53.
 */
export function nextPolicyRevision(currentRevision) {
  if (!isPosSafeInt(currentRevision)) throw policyError("invalid_next_record", "current revision outside the contract domain");
  const next = currentRevision + 1;
  if (!Number.isSafeInteger(next)) throw policyError("revision_exhausted", `policyRevision ${currentRevision} cannot be incremented`);
  return next;
}

/** A record about to be WRITTEN must satisfy the same canonical contract the parser and Rules enforce. */
export function assertValidNextRecord(next) {
  const check = parsePolicyRecord(next);
  if (check.status !== "valid") throw policyError("invalid_next_record", check.status === "malformed" ? check.reason : check.status);
  return check.record;
}

/** Build the next record for a transition; pure. Throws on any invariant violation. */
export function planTransition(current, target, opts = {}) {
  const now = opts.now;
  const parsed = current && current.status ? current : parsePolicyRecord(current);
  if (parsed.status === "malformed") throw policyError("current_policy_malformed", parsed.reason);
  if (parsed.status === "unsupported_contract") throw policyError("current_policy_unsupported");
  const rec = parsed.status === "valid" ? parsed.record : null;
  const from = rec ? rec.phase : "absent";
  const expected = opts.expectedRevision;
  if (rec && expected !== rec.policyRevision) throw policyError("stale_revision", `expected ${expected}, current ${rec.policyRevision}`);
  if (!rec && expected !== 0 && expected !== undefined) throw policyError("stale_revision", `expected ${expected}, current absent`);
  const allowed = isAllowedTransition(from, target, opts);
  if (!allowed.ok) throw policyError("transition_not_allowed", `${from} → ${target}: ${allowed.reason}`);
  const nextRevision = rec ? nextPolicyRevision(rec.policyRevision) : 1;
  const minProto = rec ? rec.minStorageProtocol : 1;
  const nextMin = target === "v2_active" || target === "recovery_hold" ? Math.max(minProto, STORAGE_PROTOCOL_V2) : minProto;
  if (nextMin < minProto) throw policyError("min_protocol_decrease");
  const next = {
    contractVersion: POLICY_CONTRACT_VERSION,
    phase: target,
    policyRevision: nextRevision,
    allowV2Initialization: target === "v2_active" && opts.native === true,
    minStorageProtocol: nextMin,
    conversionAttempted: rec ? rec.conversionAttempted : false,
    operation: null,
  };
  if (target === "quiesced") next.operation = { id: String(opts.operationId || ""), kind: "cutover", owner: String(opts.operator || ""), startedAt: now };
  if (target === "recovery_hold") next.operation = { id: String(opts.operationId || ""), kind: "recovery", owner: String(opts.operator || ""), startedAt: now };
  if (next.operation && (!next.operation.id || !next.operation.owner || !isPosSafeInt(next.operation.startedAt))) throw policyError("operation_identity_required");
  if (typeof now === "number") next.updatedAt = now;
  if (typeof opts.operator === "string") next.updatedBy = opts.operator;
  if (typeof opts.approvedReleaseId === "string") next.approvedReleaseId = opts.approvedReleaseId;
  assertValidNextRecord(next);   // the FULL next record must satisfy the canonical contract (not only revision + 1)
  return next;
}

export function policyError(code, detail) {
  const e = new Error(detail ? `${code}: ${detail}` : code);
  e.name = "StoragePolicyError";
  e.code = code;
  if (detail !== undefined) e.detail = detail;
  return e;
}
export const isStoragePolicyError = (e) => !!e && e.name === "StoragePolicyError";
