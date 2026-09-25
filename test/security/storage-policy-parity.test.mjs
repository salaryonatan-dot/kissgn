// P0-DATA-01 VERSION FENCE R1 — parser side of the control-record validity contract.
// The Rules side of the SAME matrix runs on the real emulator (test/emulator/storage-policy-parity.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePolicyRecord, decideEntriesAccess, decideAdminAdmission } from "../../lib/storagePolicy.js";
import { VALID_POLICIES, INVALID_POLICIES, generatedMutants, rtdbNormalize, MAX } from "../support/policy-fixtures.mjs";
import { FENCE_GUARD } from "../support/rules-authorized-delta.mjs";

test("every VALID fixture parses as valid, before and after RTDB normalisation, with its fields preserved", () => {
  for (const f of VALID_POLICIES) {
    for (const raw of [f.record, rtdbNormalize(f.record)]) {
      const p = parsePolicyRecord(raw);
      assert.equal(p.status, "valid", f.name + ": " + JSON.stringify(p));
      assert.equal(p.record.phase, f.record.phase, f.name);
      assert.equal(p.record.policyRevision, f.record.policyRevision, f.name);
      assert.equal(p.record.conversionAttempted, f.record.conversionAttempted === true, f.name);
      if (f.record.operation) assert.deepEqual(p.record.operation, { id: f.record.operation.id, kind: f.record.operation.kind, owner: f.record.operation.owner, startedAt: f.record.operation.startedAt }, f.name);
      else assert.equal(p.record.operation, null, f.name);
    }
  }
  assert.ok(VALID_POLICIES.length >= 12);
});

test("every INVALID fixture and every generated mutant is rejected (malformed / unsupported_contract), in memory and in RTDB-deliverable form; none is ever 'valid' or 'absent'", () => {
  const all = [...INVALID_POLICIES, ...generatedMutants()];
  assert.ok(all.length >= 100, "matrix size " + all.length);
  for (const f of all) {
    const inMemory = parsePolicyRecord(f.record);
    assert.equal(inMemory.status, f.parser, f.name + " (in memory): " + JSON.stringify(inMemory));
    const norm = rtdbNormalize(f.record);
    const delivered = parsePolicyRecord(norm === undefined ? null : norm);
    // an invalid record can never normalise into an ABSENT one (RTDB drops nulls/empties, never whole malformed records)
    assert.notEqual(delivered.status, "absent", f.name + " normalised to absent");
    assert.notEqual(delivered.status, "valid", f.name + " normalised to valid");
    // every rejected record closes every consumer
    for (const mode of ["absent", "legacy", "v2"]) assert.equal(decideEntriesAccess(delivered, mode).writable, false, f.name + " client " + mode);
    assert.equal(decideAdminAdmission(delivered).admitted, false, f.name + " admin");
  }
});

test("only WHOLE-record absence is absent: null/undefined → absent; nothing else", () => {
  assert.equal(parsePolicyRecord(null).status, "absent");
  assert.equal(parsePolicyRecord(undefined).status, "absent");
  assert.equal(parsePolicyRecord({}).status, "malformed");
  assert.equal(parsePolicyRecord({ phase: "legacy" }).status, "malformed");
});

test("the Rules VALID predicate literal enforces the same numeric and structural domain as the parser (integer via `% 1 === 0`, 1 ≤ x ≤ MAX_SAFE_INTEGER, flag×phase, operation shape, conversionAttempted boolean)", () => {
  const CTRL = "root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries',''))";
  const c = (f) => `${CTRL}.child('${f}')`;
  const safeInt = (x) => `(${x}.isNumber() && ${x}.val() % 1 === 0 && ${x}.val() >= 1 && ${x}.val() <= ${MAX})`;
  for (const field of ["policyRevision", "minStorageProtocol"]) assert.ok(FENCE_GUARD.includes(safeInt(c(field))), field + " safe-integer conjunct");
  assert.ok(FENCE_GUARD.includes(safeInt(`${c("operation")}.child('startedAt')`)), "operation.startedAt safe-integer conjunct");
  assert.ok(FENCE_GUARD.includes(`${c("contractVersion")}.val() === 1`), "contractVersion === 1");
  assert.ok(FENCE_GUARD.includes(`${c("allowV2Initialization")}.isBoolean() && (${c("allowV2Initialization")}.val() !== true || ${c("phase")}.val() === 'v2_active')`), "flag × phase relationship");
  assert.ok(FENCE_GUARD.includes(`(!${c("operation")}.exists() || (${c("operation")}.child('id').isString() && ${c("operation")}.child('id').val() !== '' && (${c("operation")}.child('kind').val() === 'cutover' || ${c("operation")}.child('kind').val() === 'recovery') && ${c("operation")}.child('owner').isString() && ${c("operation")}.child('owner').val() !== '' && `), "operation structural conjuncts");
  assert.ok(FENCE_GUARD.includes(`(!${c("conversionAttempted")}.exists() || ${c("conversionAttempted")}.isBoolean())`), "conversionAttempted boolean conjunct");
  for (const ph of ["legacy", "quiesced", "v2_active", "recovery_hold"]) assert.ok(FENCE_GUARD.includes(`${c("phase")}.val() === '${ph}'`), "phase " + ph);
  assert.equal(String(MAX), "9007199254740991");
});
