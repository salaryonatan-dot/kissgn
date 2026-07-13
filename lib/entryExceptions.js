// ─────────────────────────────────────────────────────────────────────────────
// entryExceptions.js — server-authoritative structured exception domain (schema v1).
//
// One current governance STATE per (tenantId, bizId, businessDate), stored as an
// atomic envelope { state, operations } so state + durable idempotency + audit
// change together in ONE RTDB transaction on the business-date node.
//
// PURE (except node:crypto for the request hash). No firebase-admin, no network.
// The browser NEVER imports this — it receives already-normalized effective data
// from the API. src/* consumers use the parity-tested resolver semantics.
//
// Confirmed policy (v1):
//   - client may NOT choose effects, category, or any server-managed metadata;
//   - effects are server-derived; category is server-derived from reasonCode;
//   - active exception  → excluded from forecast baseline AND insight comparison;
//   - actual revenue is never affected here (kept by the entries/revenue path);
//   - clearing returns the date to normal (status "cleared").
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;

// Reason codes — the current validated UI enum (index.html), verbatim.
export const EXCEPTION_REASONS = [
  "closure", "holiday_eve", "holiday", "partial_hours", "one_off",
  "promotion", "operational_failure", "extreme_weather", "renovation", "force_majeure", "other",
];
const REASON_SET = new Set(EXCEPTION_REASONS);

export const EXCEPTION_CATEGORIES = ["closure", "reduced_ops", "special_event", "external_disruption", "data_quality"];
const REASON_CATEGORY = {
  closure: "closure", renovation: "closure",
  partial_hours: "reduced_ops",
  holiday: "special_event", holiday_eve: "special_event", one_off: "special_event", promotion: "special_event",
  operational_failure: "external_disruption", extreme_weather: "external_disruption", force_majeure: "external_disruption",
  other: "data_quality",
};
/** Server-derived category for a reason code (never client-authoritative). */
export function categoryForReason(reasonCode) { return REASON_CATEGORY[reasonCode] || "data_quality"; }

/** Server-derived effects (v1: an active exception always excludes from baseline + insight comparison). */
export function activeEffects() { return { excludeFromForecastBaseline: true, excludeFromInsightComparison: true }; }
function clearedEffects() { return { excludeFromForecastBaseline: false, excludeFromInsightComparison: false }; }

export const MAX_REASON_TEXT = 500;
// Foundation Release v1 pilot cap on the per-date operations ledger. A new
// operation beyond this fails with `operation_limit_reached`; an existing-op
// REPLAY is still honored at/above the limit (checked before the cap).
export const MAX_OPERATIONS_PER_DATE = 32;
const OP_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RTDB_FORBIDDEN = /[.#$\[\]\/]/;

function daysInMonth(y, m1) { return new Date(Date.UTC(y, m1, 0)).getUTCDate(); }

/** Strict Israel business-date validation: exact YYYY-MM-DD, real calendar date, no ambiguous parsing, no RTDB-forbidden chars. */
export function isValidBusinessDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s) || RTDB_FORBIDDEN.test(s)) return false;
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  if (y < 2000 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > daysInMonth(y, m)) return false;
  return true;
}
export function isValidOperationId(s) { return typeof s === "string" && OP_ID_RE.test(s); }

// Part 8 — list range: absolute cap (calendar days). Reversed range is invalid.
export const MAX_LIST_RANGE_DAYS = 400;
export function dateRangeDays(fromDate, toDate) {
  const f = Date.UTC(+fromDate.slice(0, 4), +fromDate.slice(5, 7) - 1, +fromDate.slice(8, 10));
  const t = Date.UTC(+toDate.slice(0, 4), +toDate.slice(5, 7) - 1, +toDate.slice(8, 10));
  return Math.round((t - f) / 86400000); // negative if reversed
}
export function isValidExpectedRevision(v) { return Number.isSafeInteger(v) && v >= 0; }

/** Trim + bound reasonText; reject (never truncate) oversize. Empty → undefined. */
export function normalizeReasonText(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw { code: "invalid_reason_text" };
  const t = v.trim();
  if (t.length === 0) return undefined;
  if (t.length > MAX_REASON_TEXT) throw { code: "reason_too_long" };
  return t;
}

/** Validate the client-controllable inputs of a SET command → normalized, server-derived fields. */
export function validateSetInput({ reasonCode, reasonText }) {
  if (typeof reasonCode !== "string" || !REASON_SET.has(reasonCode)) throw { code: "invalid_reason_code" };
  const text = normalizeReasonText(reasonText);
  return { reasonCode, reasonText: text, category: categoryForReason(reasonCode), effects: activeEffects() };
}

// ── State builders (ALL metadata server-managed; client input cannot reach these) ──
export function buildSetState({ prevState, tenantId, bizId, businessDate, reasonCode, reasonText, actorUid, now, nextRevision }) {
  const state = {
    schemaVersion: SCHEMA_VERSION,
    tenantId, bizId, businessDate,
    reasonCode,
    category: categoryForReason(reasonCode),
    effects: activeEffects(),
    status: "active",
    source: "manual",
    createdBy: (prevState && prevState.createdBy) || actorUid,
    createdAt: (prevState && prevState.createdAt) || now,
    updatedBy: actorUid,
    updatedAt: now,
    revision: nextRevision,
  };
  if (reasonText !== undefined) state.reasonText = reasonText;
  return state;
}
export function buildClearState({ prevState, tenantId, bizId, businessDate, actorUid, now, nextRevision }) {
  const state = {
    schemaVersion: SCHEMA_VERSION,
    tenantId, bizId, businessDate,
    reasonCode: (prevState && prevState.reasonCode) || "other",
    category: (prevState && prevState.category) || "data_quality",
    effects: clearedEffects(),
    status: "cleared",
    source: "manual",
    createdBy: (prevState && prevState.createdBy) || actorUid,
    createdAt: (prevState && prevState.createdAt) || now,
    updatedBy: actorUid,
    updatedAt: now,
    revision: nextRevision,
  };
  if (prevState && prevState.reasonText !== undefined) state.reasonText = prevState.reasonText;
  return state;
}

/** Canonical string of the AUTHORIZED command (actor fields are server-derived). */
export function canonicalRequest(cmd) {
  return JSON.stringify({
    action: cmd.action,
    tenantId: cmd.tenantId, bizId: cmd.bizId, businessDate: cmd.businessDate,
    reasonCode: cmd.reasonCode ?? null,
    reasonText: cmd.reasonText ?? null,
    actorUid: cmd.actorUid, actorRole: cmd.actorRole,
    expectedRevision: cmd.expectedRevision,
  });
}
export function requestHash(cmd) { return createHash("sha256").update(canonicalRequest(cmd)).digest("hex"); }

/** Compact integrity hash of a state (or null). Avoids storing a 2nd full snapshot. */
export function hashState(state) {
  if (!state) return null;
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

export function buildOperation({ operationId, action, actorUid, actorRole, tenantId, bizId, businessDate, requestHash: rh, revisionFrom, revisionTo, before, after, now }) {
  // COMPACT record: keep `after` (the original result, reconstructable with revisionTo)
  // + a `beforeHash` integrity field. We do NOT store a full `before` snapshot.
  return {
    schemaVersion: SCHEMA_VERSION, operationId, action, actorUid, actorRole,
    tenantId, bizId, businessDate, requestHash: rh, revisionFrom, revisionTo,
    beforeHash: hashState(before ?? null), after, createdAt: now,
  };
}

/**
 * PURE transaction body. Given the current envelope and an authorized command,
 * decide the outcome and (when applied) build the next envelope with state AND
 * exactly one immutable operation record TOGETHER.
 * @returns {{outcome:"applied"|"replayed"|"conflict", code?, envelope?, state?, revision?}}
 */
export function applyOperation(currentEnvelope, cmd) {
  const env = currentEnvelope && typeof currentEnvelope === "object" ? currentEnvelope : null;
  const ops = (env && env.operations && typeof env.operations === "object") ? env.operations : {};
  const priorState = env && env.state ? env.state : null;

  // 1–2. durable idempotency by operationId — checked BEFORE the ledger cap so a
  //   replay stays valid even when the ledger is full. Replay returns the ORIGINAL
  //   operation result (`after` / `revisionTo`), NOT the envelope's current state,
  //   so a retry of op A after a later op B still returns A's result. No state change.
  const existing = ops[cmd.operationId];
  if (existing) {
    if (existing.requestHash === cmd.requestHash && existing.action === cmd.action && existing.actorUid === cmd.actorUid) {
      return { outcome: "replayed", envelope: env, state: existing.after, revision: existing.revisionTo };
    }
    return { outcome: "conflict", code: "idempotency_conflict" };
  }

  // Bounded ledger: a NEW operation beyond the cap fails closed (writes nothing).
  if (Object.keys(ops).length >= MAX_OPERATIONS_PER_DATE) {
    return { outcome: "conflict", code: "operation_limit_reached" };
  }

  // 3–5. exact expectedRevision
  const currentRevision = priorState && Number.isInteger(priorState.revision) ? priorState.revision : 0;
  if (cmd.expectedRevision !== currentRevision) return { outcome: "conflict", code: "revision_conflict" };

  // 6. next server-managed state
  const nextRevision = currentRevision + 1;
  const nextState = cmd.action === "set"
    ? buildSetState({ prevState: priorState, tenantId: cmd.tenantId, bizId: cmd.bizId, businessDate: cmd.businessDate, reasonCode: cmd.reasonCode, reasonText: cmd.reasonText, actorUid: cmd.actorUid, now: cmd.now, nextRevision })
    : buildClearState({ prevState: priorState, tenantId: cmd.tenantId, bizId: cmd.bizId, businessDate: cmd.businessDate, actorUid: cmd.actorUid, now: cmd.now, nextRevision });

  // 7. exactly one immutable operation record
  const op = buildOperation({
    operationId: cmd.operationId, action: cmd.action, actorUid: cmd.actorUid, actorRole: cmd.actorRole,
    tenantId: cmd.tenantId, bizId: cmd.bizId, businessDate: cmd.businessDate, requestHash: cmd.requestHash,
    revisionFrom: currentRevision, revisionTo: nextRevision, before: priorState, after: nextState, now: cmd.now,
  });

  // 8. commit state + operation together
  const nextEnvelope = { state: nextState, operations: { ...ops, [cmd.operationId]: op } };
  return { outcome: "applied", envelope: nextEnvelope, state: nextState, revision: nextRevision };
}

/**
 * Part 1 — normalized EFFECTIVE record for the list API. The client never has to
 * infer structured-vs-legacy precedence: source/status are explicit.
 *   structured active  → source=structured, status=active,  reason/text, revision
 *   structured cleared → source=structured, status=cleared, reason/text=null, revision
 *   legacy active      → source=legacy,     status=active,  reason/text, revision=0
 *   none               → source=none,       status=normal,  reason/text=null, revision=0
 * Never exposes the operations ledger.
 */
export function buildEffectiveRecord(businessDate, structuredEnvelope, legacyEntry) {
  const state = structuredEnvelope && structuredEnvelope.state ? structuredEnvelope.state : null;
  if (state) {
    const active = state.status === "active";
    return {
      businessDate, source: "structured", status: active ? "active" : "cleared",
      reasonCode: active ? (state.reasonCode ?? null) : null,
      reasonText: active ? (state.reasonText ?? null) : null,
      revision: Number.isSafeInteger(state.revision) ? state.revision : 0,
      structured: true,
    };
  }
  if (legacyEntry && legacyEntry.is_exception === true) {
    return {
      businessDate, source: "legacy", status: "active",
      reasonCode: legacyEntry.exception_reason ?? null,
      reasonText: legacyEntry.exception_note ?? null,
      revision: 0, structured: false,
    };
  }
  return { businessDate, source: "none", status: "normal", reasonCode: null, reasonText: null, revision: 0, structured: false };
}

/** Part 4 — single deterministic rebuild decision after required save steps succeed. */
export function shouldRebuildDecision(revenueChanged, exResponse) {
  if (revenueChanged) return true;
  return !!(exResponse && exResponse.applied === true && exResponse.rebuildRequired === true);
}

/** Safe outward view of a state (never exposes the operations ledger). */
export function safeStateView(state) {
  if (!state) return null;
  const v = {
    schemaVersion: state.schemaVersion, tenantId: state.tenantId, bizId: state.bizId, businessDate: state.businessDate,
    reasonCode: state.reasonCode, category: state.category, effects: state.effects, status: state.status,
    source: state.source, createdBy: state.createdBy, createdAt: state.createdAt,
    updatedBy: state.updatedBy, updatedAt: state.updatedAt, revision: state.revision,
  };
  if (state.reasonText !== undefined) v.reasonText = state.reasonText;
  return v;
}

/**
 * CANONICAL effective-resolution (structured-first). Used server-side by the API
 * list action and by the analytics builder (via a parity-tested mirror in TS).
 *   - structured active  → exception (blocks legacy)
 *   - structured cleared → normal    (blocks legacy)
 *   - structured absent  → narrow legacy fallback (entry._v is_exception)
 *   - missing everywhere → normal
 * @returns {{isException:boolean, origin:"structured"|"legacy"|"none", state:object|null}}
 */
export function resolveEffectiveException(envelope, legacyEntry) {
  const state = envelope && envelope.state ? envelope.state : null;
  if (state) {
    return { isException: state.status === "active", origin: "structured", state };
  }
  if (legacyEntry && legacyEntry.is_exception === true) {
    return { isException: true, origin: "legacy", state: null };
  }
  return { isException: false, origin: "none", state: null };
}
