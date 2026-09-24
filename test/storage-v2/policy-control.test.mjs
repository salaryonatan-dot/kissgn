// Version fence — tools/storage-v2/policy.mjs: operator control plane over an in-memory
// CAS transport. Proves serialization (VF-21/22), the migration-phase gate around the
// UNCHANGED conversion core (VF-23), recovery hold (VF-24/25), no downgrade (VF-11) and
// the abort boundary. The real emulator matrix repeats the transport-level cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStoragePolicyControl, controlPath, CONTROL_ROOT } from "../../tools/storage-v2/policy.mjs";
import { createStorageV2Upgrader } from "../../tools/storage-v2/upgrade.mjs";
import { createLegacyPreflight } from "../../tools/storage-v2/preflight.mjs";
import { parsePolicyRecord, isStoragePolicyError } from "../../lib/storagePolicy.js";
import { loadClientStorageV2, asLegacy, FIXTURES } from "../support/entries-fixtures.mjs";

const W = loadClientStorageV2();
const ME = W.MarjinEntries, ML = W.MarjinSaveLifecycle, V2 = W.MarjinStorageV2;
const { preflightLegacyNode } = createLegacyPreflight({ parseEntriesNode: ML.parseEntriesNode, isValidEntryId: ML.isValidEntryId, isPlainRow: (r) => !!r && typeof r === "object" && !Array.isArray(r), entryDateKey: ME.entryDateKey, detectStorageMode: V2.detectStorageMode, rowGenKey: V2.ROW_GEN_KEY, mapFields: V2.MAP_FIELDS });
const { upgradeBusinessToV2 } = createStorageV2Upgrader({ preflightLegacyNode, isV2Node: V2.isV2Node, stampRow: V2.stampRow, generationFirst: V2.GENERATION_FIRST });

/** In-memory RTDB with a real transaction discipline: the callback may be re-run; `hooks.beforeCommit` lets a test interleave a competing write. */
function makeStore() {
  const data = {};
  const get = (p) => (p in data ? JSON.parse(JSON.stringify(data[p])) : null);
  const set = (p, v) => { if (v === null || v === undefined) delete data[p]; else data[p] = JSON.parse(JSON.stringify(v)); };
  const hooks = { beforeCommit: null };
  async function transaction(p, fn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = get(p);
      const next = fn(cur);
      if (next === undefined) return { committed: false, snapshot: { val: () => get(p) } };
      if (hooks.beforeCommit) { const h = hooks.beforeCommit; hooks.beforeCommit = null; await h(); }
      if (JSON.stringify(get(p)) !== JSON.stringify(cur)) continue;   // value moved → re-run against the new value
      set(p, next); return { committed: true, snapshot: { val: () => get(p) } };
    }
    throw new Error("too many retries");
  }
  const T = "tenantA";
  const io = {
    readControl: async (t, b) => get(controlPath(t, b)),
    transactControl: (t, b, fn) => transaction(controlPath(t, b), fn),
    readEntriesNode: async (t, b) => get(`tenants/${t}/biz:${b}:entries`),
    now: () => 1000,
  };
  const entriesIo = { transactNode: (t, key, fn) => transaction(`tenants/${t}/${key}`, fn), readNode: async (t, key) => get(`tenants/${t}/${key}`), writeNode: async (t, key, v) => set(`tenants/${t}/${key}`, v) };
  return { data, get, set, hooks, io, entriesIo, T };
}
const rejects = (p, code) => assert.rejects(p, (e) => isStoragePolicyError(e) && e.code === code, "expected " + code);

test("happy path: absent → legacy → quiesced → (fenced conversion) → v2_active; revisions strictly +1; floor rises to 2; operation ownership visible then cleared", async () => {
  const s = makeStore(); const C = createStoragePolicyControl(s.io); const B = "bizA";
  s.set(`tenants/${s.T}/biz:${B}:entries`, asLegacy(FIXTURES.F2_multi));
  assert.equal((await C.inspect(s.T, B)).parsed.status, "absent");
  const r1 = await C.initializeLegacy(s.T, B, { operator: "alice" }); assert.equal(r1.record.policyRevision, 1); assert.equal(r1.record.phase, "legacy");
  const r2 = await C.quiesce(s.T, B, { expectedRevision: 1, operator: "alice", operationId: "op-1" });
  assert.deepEqual(r2.record.operation, { id: "op-1", kind: "cutover", owner: "alice", startedAt: 1000 }); assert.equal(r2.record.policyRevision, 2);
  const run = C.createFencedConversion({ upgradeBusinessToV2, entriesIo: s.entriesIo });
  const conv = await run(s.T, B, { expectedRevision: 2, operator: "alice", operationId: "op-1" });
  assert.equal(conv.result.status, "committed"); assert.equal(conv.policyRevision, 3, "conversionAttempted CAS bumped the revision BEFORE the core ran");
  const mid = parsePolicyRecord(s.get(controlPath(s.T, B))); assert.equal(mid.record.phase, "quiesced"); assert.equal(mid.record.conversionAttempted, true);
  assert.equal(s.get(`tenants/${s.T}/biz:${B}:entries`).schemaVersion, 2, "the UNCHANGED upgrader converted the node");
  await rejects(C.abortQuiescence(s.T, B, { expectedRevision: 3, operator: "alice", operationId: "op-1" }), "transition_not_allowed");   // after an attempt: never back to legacy
  const r4 = await C.activateV2(s.T, B, { expectedRevision: 3, operator: "alice", operationId: "op-1", approvedReleaseId: "rel-1" });
  assert.equal(r4.record.phase, "v2_active"); assert.equal(r4.record.policyRevision, 4); assert.equal(r4.record.minStorageProtocol, 2); assert.equal(r4.record.allowV2Initialization, false); assert.equal(r4.record.operation, null);
  assert.equal(r4.record.approvedReleaseId, "rel-1");
  // recovery hold ↔ v2_active, owned; never legacy
  const r5 = await C.enterRecoveryHold(s.T, B, { expectedRevision: 4, operator: "bob", operationId: "rec-1" }); assert.equal(r5.record.operation.kind, "recovery");
  await rejects(C.resumeV2Active(s.T, B, { expectedRevision: 5, operator: "alice", operationId: "rec-1" }), "operation_not_owned");
  const r6 = await C.resumeV2Active(s.T, B, { expectedRevision: 5, operator: "bob", operationId: "rec-1" }); assert.equal(r6.record.phase, "v2_active"); assert.equal(r6.record.policyRevision, 6);
  await rejects(C.quiesce(s.T, B, { expectedRevision: 6, operator: "bob", operationId: "op-2" }), "transition_not_allowed");   // v2_active → quiesced not in P0
});

test("VF-21 revision rollback / reuse / stale expected revision are rejected with no write", async () => {
  const s = makeStore(); const C = createStoragePolicyControl(s.io); const B = "bizA";
  s.set(`tenants/${s.T}/biz:${B}:entries`, asLegacy(FIXTURES.F1_one));
  await C.initializeLegacy(s.T, B, { operator: "alice" });
  const before = JSON.stringify(s.data);
  await rejects(C.quiesce(s.T, B, { expectedRevision: 0, operator: "alice", operationId: "op" }), "stale_revision");
  await rejects(C.quiesce(s.T, B, { expectedRevision: 2, operator: "alice", operationId: "op" }), "stale_revision");
  await rejects(C.initializeLegacy(s.T, B, { expectedRevision: 0, operator: "alice" }), "stale_revision");
  await rejects(C.initializeLegacy(s.T, B, { expectedRevision: 1, operator: "alice" }), "policy_already_exists");
  assert.equal(JSON.stringify(s.data), before, "nothing written");
  // a privileged actor that rewrites the record to a LOWER revision (bypassing the tool) is detected: the tool's next CAS sees the mismatch
  s.set(controlPath(s.T, B), { ...s.get(controlPath(s.T, B)), policyRevision: 1 });   // same as current — no-op; now simulate rollback below current
  const q = await C.quiesce(s.T, B, { expectedRevision: 1, operator: "alice", operationId: "op" }); assert.equal(q.record.policyRevision, 2);
  s.set(controlPath(s.T, B), { ...s.get(controlPath(s.T, B)), policyRevision: 1 });     // rolled back out of band
  await rejects(C.abortQuiescence(s.T, B, { expectedRevision: 2, operator: "alice", operationId: "op" }), "stale_revision");
});

test("VF-22 concurrent transitions: one wins inside the CAS; the loser gets stale_revision and writes nothing; operation ownership blocks a second operator", async () => {
  const s = makeStore(); const C = createStoragePolicyControl(s.io); const B = "bizA";
  s.set(`tenants/${s.T}/biz:${B}:entries`, asLegacy(FIXTURES.F1_one));
  await C.initializeLegacy(s.T, B, { operator: "alice" });
  // alice and bob both read revision 1 and both try to quiesce; bob's write lands first (interleaved before alice's commit)
  s.hooks.beforeCommit = async () => { await C.quiesce(s.T, B, { expectedRevision: 1, operator: "bob", operationId: "bob-op" }); };
  await rejects(C.quiesce(s.T, B, { expectedRevision: 1, operator: "alice", operationId: "alice-op" }), "stale_revision");
  const rec = parsePolicyRecord(s.get(controlPath(s.T, B))).record;
  assert.equal(rec.policyRevision, 2); assert.deepEqual(rec.operation, { id: "bob-op", kind: "cutover", owner: "bob", startedAt: 1000 }, "bob owns the cutover");
  // alice cannot abort, convert or activate bob's operation even with the right revision
  await rejects(C.abortQuiescence(s.T, B, { expectedRevision: 2, operator: "alice", operationId: "alice-op" }), "operation_not_owned");
  const run = C.createFencedConversion({ upgradeBusinessToV2, entriesIo: s.entriesIo });
  await rejects(run(s.T, B, { expectedRevision: 2, operator: "alice", operationId: "bob-op" }), "operation_not_owned");
  await rejects(C.activateV2(s.T, B, { expectedRevision: 2, operator: "alice", operationId: "alice-op" }), "operation_not_owned");
  assert.equal(s.get(`tenants/${s.T}/biz:${B}:entries`).schemaVersion, undefined, "no conversion happened");
  // a second quiesce while one is in progress is refused
  await rejects(C.enterRecoveryHold(s.T, B, { expectedRevision: 2, operator: "carol", operationId: "r" }), "operation_in_progress");
  // bob aborts cleanly (no attempt yet) → legacy, operation cleared, revision 3
  const ab = await C.abortQuiescence(s.T, B, { expectedRevision: 2, operator: "bob", operationId: "bob-op" });
  assert.equal(ab.record.phase, "legacy"); assert.equal(ab.record.operation, null); assert.equal(ab.record.policyRevision, 3);
});

test("VF-23 the fenced conversion refuses outside quiesced / without ownership / with a stale revision — BEFORE the core is invoked; core untouched", async () => {
  const s = makeStore(); const C = createStoragePolicyControl(s.io); const B = "bizA";
  s.set(`tenants/${s.T}/biz:${B}:entries`, asLegacy(FIXTURES.F1_one));
  let coreCalls = 0;
  const spyUpgrade = async (io, args) => { coreCalls++; return upgradeBusinessToV2(io, args); };
  const run = C.createFencedConversion({ upgradeBusinessToV2: spyUpgrade, entriesIo: s.entriesIo });
  await rejects(run(s.T, B, { expectedRevision: 0, operator: "alice", operationId: "op" }), "policy_required");            // absent policy
  await C.initializeLegacy(s.T, B, { operator: "alice" });
  await rejects(run(s.T, B, { expectedRevision: 1, operator: "alice", operationId: "op" }), "conversion_requires_quiesced"); // legacy
  await C.quiesce(s.T, B, { expectedRevision: 1, operator: "alice", operationId: "op" });
  await rejects(run(s.T, B, { expectedRevision: 1, operator: "alice", operationId: "op" }), "stale_revision");
  await rejects(run(s.T, B, { expectedRevision: 2, operator: "mallory", operationId: "op" }), "operation_not_owned");
  assert.equal(coreCalls, 0, "the conversion core was never invoked");
  assert.equal(s.get(`tenants/${s.T}/biz:${B}:entries`).schemaVersion, undefined);
  const ok = await run(s.T, B, { expectedRevision: 2, operator: "alice", operationId: "op" });
  assert.equal(coreCalls, 1); assert.equal(ok.result.status, "committed");
  // a second invocation (e.g. retry after unknown outcome) needs the NEW revision and still runs the idempotent core (already_v2)
  const again = await run(s.T, B, { expectedRevision: 3, operator: "alice", operationId: "op" });
  assert.equal(again.result.status, "already_v2"); assert.equal(coreCalls, 2);
  // after conversion the ONLY exits are v2_active (or staying held); legacy is impossible
  await rejects(C.abortQuiescence(s.T, B, { expectedRevision: 4, operator: "alice", operationId: "op" }), "transition_not_allowed");
});

test("VF-11/25 no downgrade through tooling; VF-14/16 native activation only for a genuinely absent business; malformed current record blocks every transition", async () => {
  const s = makeStore(); const C = createStoragePolicyControl(s.io); const B = "bizA";
  s.set(`tenants/${s.T}/biz:${B}:entries`, asLegacy(FIXTURES.F1_one));
  await rejects(C.activateNative(s.T, B, { operator: "alice" }), "transition_not_allowed");   // populated legacy: never native
  s.set(`tenants/${s.T}/biz:${B}:entries`, null);
  const n = await C.activateNative(s.T, B, { operator: "alice" });
  assert.equal(n.record.phase, "v2_active"); assert.equal(n.record.allowV2Initialization, true); assert.equal(n.record.minStorageProtocol, 2);
  const closed = await C.closeInitialization(s.T, B, { expectedRevision: 1, operator: "alice" }); assert.equal(closed.record.allowV2Initialization, false); assert.equal(closed.record.policyRevision, 2);
  await rejects(C.abortQuiescence(s.T, B, { expectedRevision: 2, operator: "alice", operationId: "x" }), "no_operation_in_progress");
  const hold = await C.enterRecoveryHold(s.T, B, { expectedRevision: 2, operator: "alice", operationId: "rec" });
  await rejects(C.resumeV2Active(s.T, B, { expectedRevision: 3, operator: "alice", operationId: "wrong" }), "operation_not_owned");
  // there is no API to reach legacy from v2_active or recovery_hold at all; a malformed record blocks everything
  s.set(controlPath(s.T, B), { phase: "v2_active" });
  await rejects(C.resumeV2Active(s.T, B, { expectedRevision: 3, operator: "alice", operationId: "rec" }), "current_policy_malformed");
  await rejects(C.enterRecoveryHold(s.T, B, { expectedRevision: 3, operator: "alice", operationId: "rec" }), "current_policy_malformed");
  assert.equal(CONTROL_ROOT, "storage_v2_control"); assert.equal(controlPath("t", "b"), "storage_v2_control/t/b");
  assert.equal(hold.record.phase, "recovery_hold");
});

test("SDK cold-cache discipline: a transaction that first runs against null although the record exists is probed (no-op) and re-run with the real record; a record that vanished mid-CAS is a typed stale_revision, never a re-creation", async () => {
  const s = makeStore(); const B = "bizA";
  s.set(`tenants/${s.T}/biz:${B}:entries`, { _v: "[]" });
  // a store that behaves like the Firebase SDK: the first callback sees an EMPTY local cache
  // (the SDK sends the callback's output with the HASH of what the callback saw — null — and the server
  //  answers "datastale" with the real record whenever that hash does not match, which re-runs the callback)
  let calls = 0; const coldIo = { ...s.io, transactControl: async (t, b, fn) => {
    calls++; const cold = fn(null);
    if (cold === undefined) return { committed: false, snapshot: { val: () => s.get(controlPath(t, b)) } };
    if (s.get(controlPath(t, b)) === null) { s.set(controlPath(t, b), cold); return { committed: true, snapshot: { val: () => s.get(controlPath(t, b)) } }; }
    calls++; return s.io.transactControl(t, b, fn);   // datastale → warm re-run
  } };
  const C = createStoragePolicyControl(coldIo);
  await C.initializeLegacy(s.T, B, { operator: "alice" });                       // absent → legacy: the cold run IS the real run (preread null)
  assert.equal(s.get(controlPath(s.T, B)).policyRevision, 1);
  calls = 0;
  const q = await C.quiesce(s.T, B, { expectedRevision: 1, operator: "alice", operationId: "op" });
  assert.equal(q.record.policyRevision, 2); assert.equal(q.record.phase, "quiesced");
  assert.ok(calls >= 2, "the null run was a probe and the real record was re-read (" + calls + " runs)");
  // the record vanishes between the operator's read and the CAS: nothing is written, typed stale
  const vanishing = { ...s.io, transactControl: (t, b, fn) => { s.set(controlPath(t, b), null); return s.io.transactControl(t, b, fn); } };
  await rejects(createStoragePolicyControl(vanishing).abortQuiescence(s.T, B, { expectedRevision: 2, operator: "alice", operationId: "op" }), "stale_revision");
  assert.equal(s.get(controlPath(s.T, B)), null, "the vanished record was not re-created");
});
