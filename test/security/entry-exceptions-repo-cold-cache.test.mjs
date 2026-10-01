// CD-M2 — the PRODUCTION structured-exception transaction (lib/repositories/entryExceptionsRepo.js
// runEntryExceptionTxn) under the RTDB transaction contract: the first invocation receives the
// server instance's LOCAL cache (null or stale in a cold instance); returning `undefined` aborts
// WITHOUT consulting the server; returning a value makes the server compare it with its own
// value and either commit or re-run the function with the server value.
//
// Before CD-M2 the wrapper aborted on the first (cache) run, so every operation on an EXISTING
// state — clear (reopen), re-set, replace — failed with a spurious revision_conflict on a cold
// instance. The model below is the documented RTDB semantics; the same behaviour is proven on a
// real emulator in test/emulator/closure-action-emulator.mjs (CDM2-EMU-06).
import { test } from "node:test";
import assert from "node:assert/strict";
import { requestHash } from "../../lib/entryExceptions.js";
import { runEntryExceptionTxn } from "../../lib/repositories/entryExceptionsRepo.js";

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
/** One RTDB node with a server value and a (possibly cold/stale) instance cache. */
function rtdbNode(serverValue, cachedValue) {
  const node = { server: clone(serverValue) ?? null, cache: cachedValue === undefined ? null : clone(cachedValue), runs: 0, writes: 0 };
  node.db = { ref: () => ({ transaction: async (fn) => {
    let local = node.cache;
    for (let i = 0; i < 25; i++) {
      node.runs++;
      const out = fn(clone(local));
      if (out === undefined) return { committed: false, snapshot: local };        // abort: no server round-trip
      if (same(local, node.server)) { node.server = clone(out); node.cache = clone(out); node.writes++; return { committed: true, snapshot: out }; }
      local = clone(node.server); node.cache = clone(node.server);                // hash mismatch: re-run with the server value
    }
    throw new Error("maxretry");
  } }) };
  return node;
}
const base = { tenantId: "T1", bizId: "A", businessDate: "2026-09-10", reasonText: null, actorUid: "u1", actorRole: "owner", now: 1790000000000 };
const cmd = (over) => { const c = { ...base, ...over }; c.requestHash = requestHash(c); return c; };
async function applied(setup) {
  const n = rtdbNode(null, null);
  const r = await runEntryExceptionTxn(cmd({ action: "set", reasonCode: "closure", expectedRevision: 0, operationId: "op-set" }), n.db);
  assert.equal(r.outcome, "applied");
  return setup ? setup(n) : n;
}

test("EXREPO-01 cold instance (cache null) + existing state rev 1: clear (reopen) is APPLIED, not a spurious revision_conflict", async () => {
  const warm = await applied();
  const n = rtdbNode(warm.server, null);
  const r = await runEntryExceptionTxn(cmd({ action: "clear", reasonCode: null, expectedRevision: 1, operationId: "op-clear" }), n.db);
  assert.deepEqual([r.outcome, r.revision, n.server.state.status, n.server.state.revision], ["applied", 2, "cleared", 2]);
  assert.ok(n.runs >= 2, "the server value was consulted");
});

test("EXREPO-02 cold instance: re-set / replace an existing state (holiday → closure) is applied", async () => {
  const w = await applied();
  const n = rtdbNode(w.server, null);
  const r = await runEntryExceptionTxn(cmd({ action: "set", reasonCode: "holiday", expectedRevision: 1, operationId: "op-replace" }), n.db);
  assert.deepEqual([r.outcome, n.server.state.reasonCode, n.server.state.revision], ["applied", "holiday", 2]);
});

test("EXREPO-03 a STALE non-null cache (rev 1) while the server holds rev 2: the server value decides", async () => {
  const w = await applied();
  const s1 = clone(w.server);
  const mid = rtdbNode(w.server, w.server);
  await runEntryExceptionTxn(cmd({ action: "clear", reasonCode: null, expectedRevision: 1, operationId: "op-c1" }), mid.db);
  const n = rtdbNode(mid.server, s1);                                   // cache still shows rev 1
  const r = await runEntryExceptionTxn(cmd({ action: "set", reasonCode: "closure", expectedRevision: 2, operationId: "op-s2" }), n.db);
  assert.deepEqual([r.outcome, n.server.state.status, n.server.state.revision], ["applied", "active", 3]);
});

test("EXREPO-04 a REAL revision conflict is still a conflict and changes nothing (warm and cold)", async () => {
  const w = await applied();
  for (const cache of [w.server, null]) {
    const n = rtdbNode(w.server, cache);
    const before = JSON.stringify(n.server);
    const r = await runEntryExceptionTxn(cmd({ action: "clear", reasonCode: null, expectedRevision: 7, operationId: "op-bad" }), n.db);
    assert.deepEqual([r.outcome, r.code], ["conflict", "revision_conflict"]);
    assert.equal(JSON.stringify(n.server), before, "state and ledger byte-identical");
  }
  const empty = rtdbNode(null, null);
  const r = await runEntryExceptionTxn(cmd({ action: "clear", reasonCode: null, expectedRevision: 1, operationId: "op-none" }), empty.db);
  assert.deepEqual([r.outcome, r.code, empty.server], ["conflict", "revision_conflict", null], "no state on the server: conflict, nothing created");
});

test("EXREPO-05 an operationId replay on a cold instance returns the ORIGINAL result and writes no second operation", async () => {
  const w = await applied();
  const n = rtdbNode(w.server, null);
  const r = await runEntryExceptionTxn(cmd({ action: "set", reasonCode: "closure", expectedRevision: 0, operationId: "op-set" }), n.db);
  assert.deepEqual([r.outcome, r.revision, Object.keys(n.server.operations)], ["replayed", 1, ["op-set"]]);
});

test("EXREPO-06 the fresh-node path is unchanged: set on an absent node commits in one run", async () => {
  const n = rtdbNode(null, null);
  const r = await runEntryExceptionTxn(cmd({ action: "set", reasonCode: "closure", expectedRevision: 0, operationId: "op-fresh" }), n.db);
  assert.deepEqual([r.outcome, r.revision, n.runs, n.writes], ["applied", 1, 1, 1]);
});
