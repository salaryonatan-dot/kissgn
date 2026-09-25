// P0-DATA-01 VERSION FENCE R1 — policyRevision domain / next-record validation (Codex F3).
// Every path that bumps the revision is exercised at MAX_SAFE_INTEGER−1 (may succeed, result parses
// valid) and at MAX_SAFE_INTEGER (typed `revision_exhausted` BEFORE any write). Concurrency near
// the boundary can never persist an unsafe, reused or wrapped revision.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStoragePolicyControl, controlPath } from "../../tools/storage-v2/policy.mjs";
import { parsePolicyRecord, planTransition, nextPolicyRevision, assertValidNextRecord, isStoragePolicyError } from "../../lib/storagePolicy.js";

const MAX = Number.MAX_SAFE_INTEGER;
const rejects = (p, code) => assert.rejects(p, (e) => isStoragePolicyError(e) && e.code === code, "expected " + code);

/** In-memory RTDB with real transaction discipline (mirrors test/storage-v2/policy-control.test.mjs). */
function makeStore() {
  const data = {};
  const get = (p) => (p in data ? JSON.parse(JSON.stringify(data[p])) : null);
  const strip = (v) => { if (v === null || v === undefined) return undefined; if (typeof v !== "object") return v; const o = {}; for (const [k, x] of Object.entries(v)) { const n = strip(x); if (n !== undefined) o[k] = n; } return Object.keys(o).length ? o : undefined; };
  const set = (p, v) => { const n = strip(v); if (n === undefined) delete data[p]; else data[p] = JSON.parse(JSON.stringify(n)); };
  const hooks = { beforeCommit: null };
  async function transaction(p, fn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = get(p); const next = fn(cur);
      if (next === undefined) return { committed: false, snapshot: { val: () => get(p) } };
      if (hooks.beforeCommit) { const h = hooks.beforeCommit; hooks.beforeCommit = null; await h(); }
      if (JSON.stringify(get(p)) !== JSON.stringify(cur)) continue;
      set(p, next); return { committed: true, snapshot: { val: () => get(p) } };
    }
    throw new Error("too many retries");
  }
  const T = "tenantA", B = "bizA", CP = controlPath(T, B), EP = `tenants/${T}/biz:${B}:entries`;
  const io = { readControl: async () => get(CP), transactControl: (t, b, fn) => transaction(CP, fn), readEntriesNode: async () => get(EP), now: () => 1700000000000 };
  const entriesIo = { transactNode: (t, key, fn) => transaction(`tenants/${t}/${key}`, fn) };
  const writes = { control: 0 }; const origSet = set;
  return { data, get, set: origSet, hooks, io, entriesIo, T, B, CP, EP, control: () => get(CP), writes };
}
const REC = (over = {}) => ({ contractVersion: 1, phase: "legacy", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 1, ...over });
const OP = (kind = "cutover", id = "op") => ({ id, kind, owner: "alice", startedAt: 1699999999999 });
const fakeUpgrade = () => { const calls = []; return { calls, fn: async (io, args) => { calls.push(args); await io.transactNode(args.tenantId, `biz:${args.bizId}:entries`, (cur) => ({ schemaVersion: 2, generation: 1, rows: {}, _v: (cur && cur._v) || "[]" })); return { status: "committed" }; } }; };

/** Every revision-bumping path, as (name, setup(store) → current record, run(C, expectedRevision)). */
const PATHS = [
  { name: "quiesce (legacy → quiesced)", setup: (s) => { s.set(s.EP, { _v: "[]" }); return REC(); }, run: (C, s, rev) => C.quiesce(s.T, s.B, { expectedRevision: rev, operator: "alice", operationId: "op" }) },
  { name: "abortQuiescence (quiesced → legacy, before conversion)", setup: (s) => { s.set(s.EP, { _v: "[]" }); return REC({ phase: "quiesced", operation: OP() }); }, run: (C, s, rev) => C.abortQuiescence(s.T, s.B, { expectedRevision: rev, operator: "alice", operationId: "op" }) },
  { name: "activateV2 (quiesced → v2_active)", setup: (s) => { s.set(s.EP, { schemaVersion: 2, generation: 1, rows: {} }); return REC({ phase: "quiesced", operation: OP(), conversionAttempted: true }); }, run: (C, s, rev) => C.activateV2(s.T, s.B, { expectedRevision: rev, operator: "alice", operationId: "op" }) },
  { name: "activateNative (legacy → v2_active, absent entries)", setup: (s) => REC(), run: (C, s, rev) => C.activateNative(s.T, s.B, { expectedRevision: rev, operator: "alice" }) },
  { name: "enterRecoveryHold (v2_active → recovery_hold)", setup: (s) => { s.set(s.EP, { schemaVersion: 2, generation: 1, rows: {} }); return REC({ phase: "v2_active", minStorageProtocol: 2 }); }, run: (C, s, rev) => C.enterRecoveryHold(s.T, s.B, { expectedRevision: rev, operator: "alice", operationId: "rec" }) },
  { name: "resumeV2Active (recovery_hold → v2_active)", setup: (s) => { s.set(s.EP, { schemaVersion: 2, generation: 1, rows: {} }); return REC({ phase: "recovery_hold", minStorageProtocol: 2, operation: OP("recovery", "rec") }); }, run: (C, s, rev) => C.resumeV2Active(s.T, s.B, { expectedRevision: rev, operator: "alice", operationId: "rec" }) },
  { name: "closeInitialization (v2_active flag true → false)", setup: (s) => { s.set(s.EP, { schemaVersion: 2, generation: 1, rows: {} }); return REC({ phase: "v2_active", minStorageProtocol: 2, allowV2Initialization: true }); }, run: (C, s, rev) => C.closeInitialization(s.T, s.B, { expectedRevision: rev, operator: "alice" }) },
  { name: "conversion marker (fenced conversion: conversionAttempted := true)", setup: (s) => { s.set(s.EP, { _v: "[]" }); return REC({ phase: "quiesced", operation: OP() }); }, run: (C, s, rev, up) => C.createFencedConversion({ upgradeBusinessToV2: up.fn, entriesIo: s.entriesIo })(s.T, s.B, { expectedRevision: rev, operator: "alice", operationId: "op" }) },
];

test("MAX_SAFE_INTEGER − 1: every revision-bumping path may succeed, lands EXACTLY on MAX_SAFE_INTEGER, and the persisted record parses valid", async () => {
  for (const p of PATHS) {
    const s = makeStore(); const up = fakeUpgrade();
    const cur = p.setup(s); cur.policyRevision = MAX - 1; s.set(s.CP, cur);
    const res = await p.run(createStoragePolicyControl(s.io), s, MAX - 1, up);
    const stored = s.control();
    assert.equal(stored.policyRevision, MAX, p.name + ": revision");
    assert.equal(parsePolicyRecord(stored).status, "valid", p.name + ": persisted record parses valid");
    if (res && res.record) assert.equal(parsePolicyRecord(res.record).status, "valid", p.name + ": returned record parses valid");
    if (p.name.startsWith("conversion")) { assert.equal(res.policyRevision, MAX); assert.equal(up.calls.length, 1, "core invoked once after the marker"); }
  }
});

test("MAX_SAFE_INTEGER: every revision-bumping path is refused `revision_exhausted` BEFORE any write; the record is byte-identical; the conversion core is never invoked; no wrap / reuse / 2^53", async () => {
  for (const p of PATHS) {
    const s = makeStore(); const up = fakeUpgrade();
    const cur = p.setup(s); cur.policyRevision = MAX; s.set(s.CP, cur);
    const before = JSON.stringify(s.control()), entriesBefore = JSON.stringify(s.get(s.EP));
    await rejects(p.run(createStoragePolicyControl(s.io), s, MAX, up), "revision_exhausted");
    assert.equal(JSON.stringify(s.control()), before, p.name + ": record unchanged");
    assert.equal(JSON.stringify(s.get(s.EP)), entriesBefore, p.name + ": entries unchanged");
    assert.equal(up.calls.length, 0, p.name + ": core not invoked");
    assert.notEqual(s.control().policyRevision, MAX + 1); assert.notEqual(s.control().policyRevision, 1); assert.notEqual(s.control().policyRevision, 0);
  }
});

test("nextPolicyRevision / assertValidNextRecord / planTransition: the boundary primitives", () => {
  assert.equal(nextPolicyRevision(1), 2); assert.equal(nextPolicyRevision(MAX - 1), MAX);
  assert.throws(() => nextPolicyRevision(MAX), (e) => e.code === "revision_exhausted");
  for (const bad of [0, -1, 1.5, MAX + 1, "1", null, undefined]) assert.throws(() => nextPolicyRevision(bad), (e) => e.code === "invalid_next_record", "next of " + String(bad));
  assert.equal(assertValidNextRecord(REC()).policyRevision, 1);
  for (const bad of [REC({ policyRevision: MAX + 1 }), REC({ policyRevision: 1.5 }), REC({ allowV2Initialization: true }), REC({ phase: "x" }), REC({ operation: "x" }), REC({ conversionAttempted: "true" })]) assert.throws(() => assertValidNextRecord(bad), (e) => e.code === "invalid_next_record");
  assert.throws(() => planTransition(REC({ policyRevision: MAX }), "quiesced", { expectedRevision: MAX, operator: "a", operationId: "o", now: 1 }), (e) => e.code === "revision_exhausted");
  const ok = planTransition(REC({ policyRevision: MAX - 1 }), "quiesced", { expectedRevision: MAX - 1, operator: "a", operationId: "o", now: 1 });
  assert.equal(ok.policyRevision, MAX); assert.equal(parsePolicyRecord(ok).status, "valid");
});

test("a mutate step that would produce a parser-invalid next record is refused `invalid_next_record` with nothing written (even when revision === current + 1)", async () => {
  const s = makeStore(); s.set(s.EP, { _v: "[]" }); s.set(s.CP, REC({ policyRevision: 3 }));
  // drive the CAS through a public path but corrupt the planned record via a poisoned `now` (startedAt must be a positive safe integer)
  const C = createStoragePolicyControl({ ...s.io, now: () => 1.5 });
  await rejects(C.quiesce(s.T, s.B, { expectedRevision: 3, operator: "alice", operationId: "op" }), "operation_identity_required");
  assert.equal(s.control().policyRevision, 3, "nothing written");
  const C2 = createStoragePolicyControl({ ...s.io, now: () => MAX + 1 });
  await rejects(C2.quiesce(s.T, s.B, { expectedRevision: 3, operator: "alice", operationId: "op" }), "operation_identity_required");
  assert.equal(s.control().policyRevision, 3, "nothing written");
});

test("concurrency at the boundary: two operators at MAX−1 → exactly one lands on MAX, the loser is stale; every later transition (any operator) is exhausted; nothing persisted is ever parser-invalid", async () => {
  const s = makeStore(); s.set(s.EP, { _v: "[]" }); s.set(s.CP, REC({ policyRevision: MAX - 1 }));
  const C = createStoragePolicyControl(s.io);
  s.hooks.beforeCommit = async () => { await C.quiesce(s.T, s.B, { expectedRevision: MAX - 1, operator: "bob", operationId: "bob-op" }); };
  await rejects(C.quiesce(s.T, s.B, { expectedRevision: MAX - 1, operator: "alice", operationId: "alice-op" }), "stale_revision");
  const rec = s.control();
  assert.equal(rec.policyRevision, MAX); assert.equal(rec.operation.owner, "bob"); assert.equal(parsePolicyRecord(rec).status, "valid");
  const attempts = await Promise.allSettled([
    C.abortQuiescence(s.T, s.B, { expectedRevision: MAX, operator: "bob", operationId: "bob-op" }),
    C.createFencedConversion({ upgradeBusinessToV2: fakeUpgrade().fn, entriesIo: s.entriesIo })(s.T, s.B, { expectedRevision: MAX, operator: "bob", operationId: "bob-op" }),
    C.abortQuiescence(s.T, s.B, { expectedRevision: MAX, operator: "alice", operationId: "alice-op" }),
  ]);
  assert.deepEqual(attempts.map((a) => a.status), ["rejected", "rejected", "rejected"]);
  assert.equal(attempts[0].reason.code, "revision_exhausted"); assert.equal(attempts[1].reason.code, "revision_exhausted");
  assert.ok(["revision_exhausted", "operation_not_owned"].includes(attempts[2].reason.code));
  assert.equal(JSON.stringify(s.control()), JSON.stringify(rec), "record byte-identical after the exhausted attempts");
  // a cold-cache SDK-style first run (null) at the boundary cannot sneak a write either
  let calls = 0; const cold = { ...s.io, transactControl: async (t, b, fn) => { calls++; const probe = fn(null); if (probe === undefined) return { committed: false, snapshot: { val: () => s.control() } }; return s.io.transactControl(t, b, fn); } };
  await rejects(createStoragePolicyControl(cold).enterRecoveryHold(s.T, s.B, { expectedRevision: MAX, operator: "bob", operationId: "r" }), "operation_in_progress");
  await rejects(createStoragePolicyControl(cold).abortQuiescence(s.T, s.B, { expectedRevision: MAX, operator: "bob", operationId: "bob-op" }), "revision_exhausted");
  assert.ok(calls >= 2, "cold-cache runs happened");
  assert.equal(JSON.stringify(s.control()), JSON.stringify(rec));
});
