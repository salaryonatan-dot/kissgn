// Version fence — lib/storagePolicy.js pure contract: parse (valid / absent / malformed /
// unsupported), honest-client access decision, Admin admission, transition table, planning.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePolicyRecord, decideEntriesAccess, decideAdminAdmission, isAllowedTransition, planTransition,
  POLICY_CONTRACT_VERSION, POLICY_PHASES, STORAGE_PROTOCOL_V2, isStoragePolicyError,
} from "../../lib/storagePolicy.js";

export const VALID = (over = {}) => ({ contractVersion: 1, phase: "legacy", policyRevision: 3, allowV2Initialization: false, minStorageProtocol: 1, ...over });

test("parse: absent only for a missing WHOLE record; every present-but-malformed shape fails closed", () => {
  assert.deepEqual(parsePolicyRecord(null), { status: "absent" });
  assert.deepEqual(parsePolicyRecord(undefined), { status: "absent" });
  const malformed = {
    scalar: 7, string: "legacy", array: [VALID()],
    phase_missing: { contractVersion: 1, policyRevision: 7, allowV2Initialization: false, minStorageProtocol: 1 },
    revision_only: { policyRevision: 7 },
    phase_only: { phase: "v2_active" },
    phase_invalid: VALID({ phase: "active" }),
    phase_number: VALID({ phase: 7 }),
    contract_missing: (() => { const v = VALID(); delete v.contractVersion; return v; })(),
    contract_zero: VALID({ contractVersion: 0 }),
    contract_string: VALID({ contractVersion: "1" }),
    revision_zero: VALID({ policyRevision: 0 }),
    revision_negative: VALID({ policyRevision: -1 }),
    revision_fraction: VALID({ policyRevision: 1.5 }),
    revision_string: VALID({ policyRevision: "3" }),
    revision_unsafe: VALID({ policyRevision: 2 ** 53 }),
    init_string: VALID({ allowV2Initialization: "true" }),
    init_missing: (() => { const v = VALID(); delete v.allowV2Initialization; return v; })(),
    init_true_outside_active: VALID({ phase: "legacy", allowV2Initialization: true }),
    init_true_quiesced: VALID({ phase: "quiesced", allowV2Initialization: true }),
    min_missing: (() => { const v = VALID(); delete v.minStorageProtocol; return v; })(),
    min_zero: VALID({ minStorageProtocol: 0 }),
    operation_bad: VALID({ phase: "quiesced", operation: { id: "", kind: "cutover", owner: "op", startedAt: 1 } }),
    operation_kind: VALID({ phase: "quiesced", operation: { id: "x", kind: "migrate", owner: "op", startedAt: 1 } }),
    conversion_flag_string: VALID({ conversionAttempted: "yes" }),
  };
  for (const [name, raw] of Object.entries(malformed)) {
    const p = parsePolicyRecord(raw);
    assert.equal(p.status, "malformed", name + ": " + JSON.stringify(p));
    assert.equal(decideEntriesAccess(p, "legacy").writable, false, name + " client");
    assert.equal(decideAdminAdmission(p).admitted, false, name + " admin");
  }
  // valid records normalize and keep the operation / flags
  for (const phase of POLICY_PHASES) {
    const p = parsePolicyRecord(VALID({ phase, allowV2Initialization: phase === "v2_active" }));
    assert.equal(p.status, "valid", phase); assert.equal(p.record.phase, phase); assert.equal(p.record.conversionAttempted, false); assert.equal(p.record.operation, null);
  }
  const op = parsePolicyRecord(VALID({ phase: "quiesced", operation: { id: "op-1", kind: "cutover", owner: "alice", startedAt: 5 }, conversionAttempted: true, extra: "ignored" }));
  assert.deepEqual(op.record.operation, { id: "op-1", kind: "cutover", owner: "alice", startedAt: 5 }); assert.equal(op.record.conversionAttempted, true); assert.equal("extra" in op.record, false);
  // a well-formed NEWER contract is reported as unsupported (honest client: update required), never as legacy
  const newer = parsePolicyRecord(VALID({ contractVersion: 2, phase: "v2_active" }));
  assert.equal(newer.status, "unsupported_contract");
  assert.equal(decideEntriesAccess(newer, "v2").state, "update_required");
  assert.equal(decideAdminAdmission(newer).admitted, false);
});

test("decideEntriesAccess: every (policy × raw mode) cell; absent policy is legacy-only and never V2", () => {
  const absent = parsePolicyRecord(null);
  assert.deepEqual(decideEntriesAccess(null, "legacy").state, "policy_unresolved");
  assert.equal(decideEntriesAccess(absent, "legacy").writable, true);
  assert.equal(decideEntriesAccess(absent, "legacy").revision, 0, "confirmed-absent sentinel");
  assert.equal(decideEntriesAccess(absent, "absent").state, "initialization_not_enabled");
  assert.equal(decideEntriesAccess(absent, "v2").state, "v2_without_policy");
  assert.equal(decideEntriesAccess(absent, "malformed").state, "storage_malformed");
  assert.equal(decideEntriesAccess(absent, null).state, "storage_unresolved");
  const legacy = parsePolicyRecord(VALID({ phase: "legacy" }));
  assert.equal(decideEntriesAccess(legacy, "legacy").state, "legacy"); assert.equal(decideEntriesAccess(legacy, "legacy").revision, 3);
  assert.equal(decideEntriesAccess(legacy, "absent").state, "initialization_not_enabled");
  assert.equal(decideEntriesAccess(legacy, "v2").state, "v2_without_policy");
  for (const phase of ["quiesced", "recovery_hold"]) {
    const p = parsePolicyRecord(VALID({ phase }));
    for (const mode of ["legacy", "v2", "absent", null, "malformed"]) { const d = decideEntriesAccess(p, mode); assert.equal(d.state, "maintenance_read_only", phase + "/" + mode); assert.equal(d.writable, false); assert.equal(d.reason, phase); }
  }
  const active = parsePolicyRecord(VALID({ phase: "v2_active", minStorageProtocol: 2 }));
  assert.deepEqual(decideEntriesAccess(active, "v2"), { state: "v2", writable: true, revision: 3 });
  assert.equal(decideEntriesAccess(active, "legacy").state, "conversion_pending");
  assert.equal(decideEntriesAccess(active, "absent").state, "initialization_not_enabled");
  const activeInit = parsePolicyRecord(VALID({ phase: "v2_active", minStorageProtocol: 2, allowV2Initialization: true }));
  assert.deepEqual(decideEntriesAccess(activeInit, "absent"), { state: "v2", writable: true, revision: 3, initialization: true });
  // protocol floor above this build → update required, even on legacy
  const future = parsePolicyRecord(VALID({ phase: "v2_active", minStorageProtocol: 3 }));
  assert.equal(decideEntriesAccess(future, "v2", STORAGE_PROTOCOL_V2).state, "update_required");
  assert.equal(decideEntriesAccess(parsePolicyRecord(VALID({ phase: "legacy", minStorageProtocol: 3 })), "legacy").state, "update_required");
});

test("decideAdminAdmission: absent/legacy/v2_active admit; quiesced/recovery_hold/malformed/unsupported/unresolved refuse", () => {
  assert.equal(decideAdminAdmission(parsePolicyRecord(null)).admitted, true);
  assert.equal(decideAdminAdmission(parsePolicyRecord(VALID({ phase: "legacy" }))).admitted, true);
  assert.equal(decideAdminAdmission(parsePolicyRecord(VALID({ phase: "v2_active" }))).admitted, true);
  assert.deepEqual(decideAdminAdmission(parsePolicyRecord(VALID({ phase: "quiesced" }))), { admitted: false, reason: "maintenance", phase: "quiesced" });
  assert.deepEqual(decideAdminAdmission(parsePolicyRecord(VALID({ phase: "recovery_hold" }))), { admitted: false, reason: "maintenance", phase: "recovery_hold" });
  assert.equal(decideAdminAdmission(parsePolicyRecord({ phase: "legacy" })).admitted, false);
  assert.equal(decideAdminAdmission(null).admitted, false);
});

test("transition table: monotonic, no V2→legacy, abort only before a conversion attempt, native activation explicit", () => {
  const ok = (f, t, c) => assert.equal(isAllowedTransition(f, t, c).ok, true, `${f}→${t}`);
  const no = (f, t, c, reason) => { const r = isAllowedTransition(f, t, c); assert.equal(r.ok, false, `${f}→${t}`); if (reason) assert.equal(r.reason, reason, `${f}→${t}`); };
  ok("absent", "legacy"); ok("legacy", "quiesced"); ok("quiesced", "v2_active", { entriesMode: "v2" }); ok("v2_active", "recovery_hold"); ok("recovery_hold", "v2_active");
  ok("quiesced", "legacy", { conversionAttempted: false, entriesMode: "legacy" });
  ok("legacy", "v2_active", { native: true, entriesMode: "absent" }); ok("absent", "v2_active", { native: true, entriesMode: "absent" });
  no("quiesced", "legacy", { conversionAttempted: true, entriesMode: "legacy" }, "conversion_attempted");
  no("quiesced", "legacy", { conversionAttempted: false, entriesMode: "v2" }, "entries_already_v2");
  no("quiesced", "v2_active", { entriesMode: "legacy" }, "entries_not_v2");
  no("v2_active", "legacy", {}, "legacy_downgrade_forbidden"); no("recovery_hold", "legacy", {}, "legacy_downgrade_forbidden");
  no("legacy", "v2_active", { entriesMode: "absent" }, "native_activation_not_explicit");
  no("legacy", "v2_active", { native: true, entriesMode: "legacy" }, "entries_not_absent");
  no("v2_active", "quiesced", {}, "transition_not_allowed"); no("legacy", "recovery_hold", {}); no("recovery_hold", "quiesced", {}); no("absent", "quiesced", {});
});

test("planTransition: revision +1 exactly, stale expected revision rejected, protocol floor never decreases, operation identity required", () => {
  const abs = planTransition(parsePolicyRecord(null), "legacy", { expectedRevision: 0, operator: "op", now: 10 });
  assert.deepEqual(abs, { contractVersion: 1, phase: "legacy", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 1, conversionAttempted: false, operation: null, updatedAt: 10, updatedBy: "op" });
  const q = planTransition(parsePolicyRecord(abs), "quiesced", { expectedRevision: 1, operator: "op", operationId: "op-1", now: 11 });
  assert.equal(q.policyRevision, 2); assert.deepEqual(q.operation, { id: "op-1", kind: "cutover", owner: "op", startedAt: 11 });
  assert.throws(() => planTransition(parsePolicyRecord(abs), "quiesced", { expectedRevision: 5, operator: "op", operationId: "x", now: 1 }), (e) => isStoragePolicyError(e) && e.code === "stale_revision");
  assert.throws(() => planTransition(parsePolicyRecord(abs), "quiesced", { expectedRevision: 1, operator: "op", now: 1 }), (e) => e.code === "operation_identity_required");
  const act = planTransition(parsePolicyRecord({ ...q, conversionAttempted: true }), "v2_active", { expectedRevision: 2, operator: "op", now: 12, entriesMode: "v2" });
  assert.equal(act.minStorageProtocol, 2, "activation raises the floor to the V2 protocol"); assert.equal(act.allowV2Initialization, false); assert.equal(act.conversionAttempted, true);
  assert.throws(() => planTransition(parsePolicyRecord({ ...q, conversionAttempted: true }), "legacy", { expectedRevision: 2, operator: "op", now: 1, conversionAttempted: true, entriesMode: "legacy" }), (e) => e.code === "transition_not_allowed" && /conversion_attempted/.test(e.message));
  assert.throws(() => planTransition(parsePolicyRecord(act), "legacy", { expectedRevision: 3, operator: "op", now: 1 }), (e) => /legacy_downgrade_forbidden/.test(e.message));
  const hold = planTransition(parsePolicyRecord(act), "recovery_hold", { expectedRevision: 3, operator: "op", operationId: "rec-1", now: 13 });
  assert.equal(hold.minStorageProtocol, 2); assert.equal(hold.operation.kind, "recovery");
  const native = planTransition(parsePolicyRecord(null), "v2_active", { expectedRevision: 0, operator: "op", now: 1, native: true, entriesMode: "absent" });
  assert.equal(native.allowV2Initialization, true); assert.equal(native.policyRevision, 1); assert.equal(native.minStorageProtocol, 2);
  assert.throws(() => planTransition({ policyRevision: 7 }, "quiesced", { expectedRevision: 7 }), (e) => e.code === "current_policy_malformed");
  assert.throws(() => planTransition(parsePolicyRecord(VALID({ policyRevision: Number.MAX_SAFE_INTEGER, phase: "v2_active" })), "recovery_hold", { expectedRevision: Number.MAX_SAFE_INTEGER, operator: "o", operationId: "r", now: 1 }), (e) => e.code === "revision_exhausted");
  assert.equal(POLICY_CONTRACT_VERSION, 1);
});
