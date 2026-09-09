// P0-DATA-01 R10 — GATE 3 CLEAR-ALL EXACT-STATE MATRIX.
//
// Completes the clear-all half of Gate 3. Clear-all is a DEDICATED typed destructive
// operation (`submitClearAll`) carrying the content fingerprint of the COMPLETE node
// the operator confirmed. It cannot be reached by an options boolean, an object
// spread, or an ordinary collection submission — R10 has no generic full-node writer.
//
// Authoritative inventory source:
//   artifacts/p0-data-01-r10/_STATUS_CHANGES_STILL_REQUIRED.md → "Remaining blockers"
//   item 3 (Gate 3, partial): "the full clear-all matrix (unsorted, duplicate dates,
//   identical rows/different ids, reorder, added field, inserted/deleted row, stale
//   owner/generation, degraded listener, malformed, missing/malformed/duplicate id,
//   valid unchanged confirmation)" — plus the Gate 3 assignment's required orderings:
//   clear-all against a stable state, racing a create, racing an edit, racing a retry,
//   delayed transaction completion, listener delivery before and after acknowledgement,
//   stale client state, owner/business/generation transition, and failure, abort,
//   rejection or exhaustion.
//
// EXPECTED RESULTS COME FROM THE CONTRACT, never from execution order: a confirmed
// clear commits ONLY while the complete confirmed content still matches; anything that
// changed after confirmation aborts the whole operation with zero mutation.
//
// Every assertion is exact deep equality against the authoritative node — including
// row ids and values. No row counts, date checks, subset checks or "contains" checks
// are used where complete equality can be asserted.
//
// Run: node --test test/dashboard/entries-clear-all-matrix.test.mjs

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ML, plain, tick, settleAll, uuid4, mkId, day, COMMITTED, entriesKey,
  makeRemote, makeRemoteService, makeClient, drainLiveRigs,
} from "../support/cross-writer-harness.mjs";

afterEach(drainLiveRigs);

const history = () => [day("2026-08-01", 100), day("2026-08-02", 200), day("2026-08-03", 300)];
const ID1 = mkId("d2026-08-01"), ID2 = mkId("d2026-08-02"), ID3 = mkId("d2026-08-03");
const exact = (remote, expected, msg) => assert.deepEqual(plain(remote.rows()), plain(expected), msg);
const NOT_COMMITTED = (r, msg) => {
  assert.notEqual(r.status, "committed", msg + " — never ordinary success");
  assert.notEqual(r.status, "committed_idempotent", msg + " — never idempotent success");
};

// ═══════════════════════════════════════════════════════════════════════════
// K-01 … K-09 — FINGERPRINT IS THE COMPLETE CONFIRMED CONTENT
// Each cell captures the fingerprint of exactly what the operator confirmed, then
// asserts whether the clear may proceed against the node as it actually is.
// ═══════════════════════════════════════════════════════════════════════════

// Node shapes that are perfectly legal and, when UNCHANGED, must clear successfully.
const LEGAL_SHAPES = [
  { id: "K-01", label: "unsorted node (rows not in date order)",
    rows: () => [day("2026-08-03", 300), day("2026-08-01", 100), day("2026-08-02", 200)] },
  { id: "K-02", label: "duplicate business DATES with distinct ids",
    rows: () => [day("2026-08-01", 100), { ...day("2026-08-01", 100), id: mkId("dupK02") }, day("2026-08-02", 200)] },
  { id: "K-03", label: "IDENTICAL row content under different ids",
    rows: () => [{ id: mkId("same-a"), date: "2026-08-01", sales: 100, deliveries: 0, other_income: 0 },
                 { id: mkId("same-b"), date: "2026-08-01", sales: 100, deliveries: 0, other_income: 0 }] },
  { id: "K-09", label: "valid unchanged confirmation over ordinary history",
    rows: () => history() },
];
for (const shape of LEGAL_SHAPES) {
  test(`[clear-all] ${shape.id}: ${shape.label} — an UNCHANGED confirmation clears to exactly []`, async () => {
    const remote = makeRemote(shape.rows());
    const A = makeClient(remote, "A").attach().pull();
    const confirmed = A.fingerprint();
    assert.equal(typeof confirmed, "string", "a real full-node hydration yields a confirmable fingerprint");
    const r = await A.clearAll({ expectedNodeFingerprint: confirmed });
    await settleAll();
    assert.equal(r.status, "committed", `the confirmed clear committed (${r.status})`);
    assert.equal(r.destructive, true, "and it is reported as the destructive operation it is");
    exact(remote, [], "the node is exactly empty — never a subset, never a partial clear");
    assert.deepEqual(plain(A.view()), [], "the local state converged on the committed empty node");
  });
}

// Every way the node can differ from what was confirmed. All must ABORT with zero
// mutation — the operator confirmed content, not an intention.
const DIVERGENCES = [
  { id: "K-04", label: "row REORDER (identical content, different order)",
    mutate: (remote) => remote.setRowsDirect([day("2026-08-02", 200), day("2026-08-01", 100), day("2026-08-03", 300)]),
    after: () => [day("2026-08-02", 200), day("2026-08-01", 100), day("2026-08-03", 300)] },
  { id: "K-05", label: "an ADDED FIELD on one row",
    mutate: (remote) => remote.setRowsDirect([{ ...day("2026-08-01", 100), payroll: "80" }, day("2026-08-02", 200), day("2026-08-03", 300)]),
    after: () => [{ ...day("2026-08-01", 100), payroll: "80" }, day("2026-08-02", 200), day("2026-08-03", 300)] },
  { id: "K-06", label: "an INSERTED row",
    mutate: (remote) => remote.setRowsDirect([...history(), day("2026-08-04", 400)]),
    after: () => [...history(), day("2026-08-04", 400)] },
  { id: "K-07", label: "a DELETED row",
    mutate: (remote) => remote.setRowsDirect([day("2026-08-01", 100), day("2026-08-03", 300)]),
    after: () => [day("2026-08-01", 100), day("2026-08-03", 300)] },
  { id: "K-08", label: "a CHANGED VALUE",
    mutate: (remote) => remote.setRowsDirect([{ ...day("2026-08-01", 100), sales: 101 }, day("2026-08-02", 200), day("2026-08-03", 300)]),
    after: () => [{ ...day("2026-08-01", 100), sales: 101 }, day("2026-08-02", 200), day("2026-08-03", 300)] },
];
for (const d of DIVERGENCES) {
  test(`[clear-all] ${d.id}: ${d.label} after confirmation — the clear ABORTS with zero mutation`, async () => {
    const remote = makeRemote(history());
    const A = makeClient(remote, "A").attach().pull();
    const confirmed = A.fingerprint();                       // what the operator saw and confirmed
    d.mutate(remote);                                        // the node moves underneath
    const r = await A.clearAll({ expectedNodeFingerprint: confirmed });
    await settleAll();
    NOT_COMMITTED(r, "a confirmation that no longer describes the node");
    assert.equal(r.status, "blocked");
    assert.equal(r.reason, "precondition_failed", "the operator confirmed CONTENT, not an intention");
    exact(remote, d.after(), "the authoritative node is byte-intact — no partial clear, no mutation");
  });
}

test("[clear-all] K-09b: an unchanged confirmation over an ALREADY EMPTY node is idempotent and writes nothing", async () => {
  const remote = makeRemote([]);
  const A = makeClient(remote, "A").attach().pull();
  const v0 = remote.version();
  const r = await A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await settleAll();
  assert.equal(r.status, "committed_idempotent");
  assert.equal(r.reason, "already_empty", "idempotent success names the exact condition that made it a no-op");
  assert.equal(remote.version(), v0, "no remote write was performed");
  exact(remote, [], "still exactly empty");
});

// ═══════════════════════════════════════════════════════════════════════════
// K-10 … K-13 — NODE-STATE FAIL-CLOSED
// ═══════════════════════════════════════════════════════════════════════════

test("[clear-all] K-10: a MISSING id anywhere in the node blocks clear-all at the lane, before any transaction", async () => {
  const rows = [{ date: "2026-08-01", sales: 100 }, day("2026-08-02", 200)];
  const remote = makeRemote(rows);
  const A = makeClient(remote, "A").attach().pull();
  assert.equal(A.lane._state().identityRequired, true);
  const r = await A.clearAll();
  await settleAll();
  assert.equal(r.status, "blocked_entry_identity_required");
  assert.equal(remote.allLogs().length, 0, "NO transaction was dispatched at ANY destination");
  exact(remote, rows, "zero mutation, and no automatic identity adoption or repair");
});

test("[clear-all] K-11: a MALFORMED id in the node fails the transaction closed with zero mutation", async () => {
  const rows = [{ id: "not-a-uuid", date: "2026-08-01", sales: 100 }, day("2026-08-02", 200)];
  const remote = makeRemote(rows);
  const A = makeClient(remote, "A").attach().pull();
  const r = await A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await settleAll();
  NOT_COMMITTED(r, "a node with an invalid id");
  assert.equal(r.status, "blocked");
  assert.equal(r.reason, "malformed_remote");
  exact(remote, rows, "zero mutation — the node is not silently repaired");
});

test("[clear-all] K-12: a DUPLICATE id in the node fails the transaction closed with zero mutation", async () => {
  const shared = mkId("dupe-id");
  const rows = [{ ...day("2026-08-01", 100), id: shared }, { ...day("2026-08-02", 200), id: shared }];
  const remote = makeRemote(rows);
  const A = makeClient(remote, "A").attach().pull();
  const r = await A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await settleAll();
  NOT_COMMITTED(r, "a node with duplicate ids");
  assert.equal(r.status, "blocked");
  assert.equal(r.reason, "duplicate_id");
  exact(remote, rows, "zero mutation");
});

test("[clear-all] K-13: a MALFORMED node (not an array of rows) fails closed and is never rewritten", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const confirmed = A.fingerprint();
  remote.state.node = { _v: JSON.stringify({ notAnArray: true }) };   // corruption arrives after confirmation
  remote.state.version++;
  const r = await A.clearAll({ expectedNodeFingerprint: confirmed });
  await settleAll();
  NOT_COMMITTED(r, "a malformed node");
  assert.equal(r.status, "blocked");
  assert.equal(r.reason, "malformed_remote");
  assert.deepEqual(plain(JSON.parse(remote.state.node._v)), { notAnArray: true }, "the corrupt node is left exactly as found");
});

test("[clear-all] K-13b: a non-object row inside the node fails closed with zero mutation", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const confirmed = A.fingerprint();
  remote.setRowsDirect([day("2026-08-01", 100), "corrupt", day("2026-08-03", 300)]);
  const r = await A.clearAll({ expectedNodeFingerprint: confirmed });
  await settleAll();
  NOT_COMMITTED(r, "a node containing a non-object row");
  assert.equal(r.reason, "malformed_remote");
  exact(remote, [day("2026-08-01", 100), "corrupt", day("2026-08-03", 300)], "zero mutation");
});

// ═══════════════════════════════════════════════════════════════════════════
// K-14 … K-18 — READINESS AND PRECONDITION GATES (all before any transaction)
// ═══════════════════════════════════════════════════════════════════════════

test("[clear-all] K-14: clear-all BEFORE hydration is blocked and dispatches nothing", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach();                 // attached but no value delivered yet
  const r = await A.clearAll({ expectedNodeFingerprint: "f0l2" });
  await settleAll();
  assert.equal(r.status, "blocked_unhydrated");
  assert.equal(remote.allLogs().length, 0, "NO transaction dispatched at ANY destination");
  exact(remote, history(), "zero mutation");
});

test("[clear-all] K-15: an ABSENT-node bootstrap can never authorise a destructive clear", async () => {
  const remote = makeRemote(undefined);
  const A = makeClient(remote, "A").attach().bootstrapAbsent();
  assert.equal(A.lane.isReady(), true, "the lane is ready enough to CREATE");
  assert.equal(A.lane.isHydrated(), false, "but it has never seen a real full-node value");
  const r = await A.clearAll({ expectedNodeFingerprint: "f0l2" });
  await settleAll();
  assert.equal(r.status, "blocked_unhydrated");
  assert.equal(r.reason, "clear_all_requires_full_hydration");
  assert.equal(remote.allLogs().length, 0, "NO transaction dispatched at ANY destination");
  assert.equal(remote.rows(), null, "the node is still genuinely absent — nothing was created or cleared");
});

test("[clear-all] K-16: a MISSING or empty fingerprint is refused before any transaction", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  for (const fp of [undefined, null, "", 0]) {
    const r = await A.clearAll({ expectedNodeFingerprint: fp });
    assert.equal(r.status, "blocked_precondition_missing", `fingerprint ${JSON.stringify(fp)} is refused`);
  }
  await settleAll();
  assert.equal(remote.allLogs().length, 0, "NO transaction dispatched at ANY destination for any of them");
  exact(remote, history(), "zero mutation");
});

test("[clear-all] K-17: a MISSING confirmation token is refused before any transaction", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const r = await A.clearAll({ confirmToken: undefined });
  await settleAll();
  assert.equal(r.status, "blocked_unconfirmed");
  assert.equal(remote.allLogs().length, 0, "NO transaction dispatched at ANY destination");
  exact(remote, history(), "zero mutation");
});

test("[clear-all] K-18: a DEGRADED listener blocks clear-all until a fresh authoritative value arrives", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const confirmed = A.fingerprint();
  remote.failListener(new Error("permission_denied"));
  assert.equal(A.lane._state().degraded, true);
  const r = await A.clearAll({ expectedNodeFingerprint: confirmed });
  assert.equal(r.status, "blocked_listener_degraded");
  assert.equal(remote.allLogs().length, 0, "NO transaction dispatched at ANY destination while the client is not receiving updates");
  // A fresh authoritative value clears the degraded state and the clear may proceed.
  A.pull();
  assert.equal(A.lane._state().degraded, false);
  const r2 = await A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await settleAll();
  assert.equal(r2.status, "committed");
  exact(remote, [], "and only then is the node cleared");
});

// ═══════════════════════════════════════════════════════════════════════════
// K-20 … K-26 — RACES AGAINST INDEPENDENT WRITERS
// ═══════════════════════════════════════════════════════════════════════════

test("[clear-all] K-20: a CREATE lands before the clear — the clear aborts and the new row is preserved exactly", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const confirmed = A.fingerprint();
  const newRow = { id: mkId("k20"), date: "2026-08-04", sales: 400, deliveries: 0, other_income: 0 };
  const rb = await B.create(newRow);
  await settleAll();
  assert.ok(COMMITTED(rb.status));
  const r = await A.clearAll({ expectedNodeFingerprint: confirmed });
  await settleAll();
  assert.equal(r.status, "blocked");
  assert.equal(r.reason, "precondition_failed");
  exact(remote, [...history(), newRow], "no deletion of a concurrent write the accepted ordering preserves");
});

test("[clear-all] K-21: the clear lands first, then an independent CREATE — exactly the new row survives", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const r = await A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await settleAll();
  assert.equal(r.status, "committed");
  exact(remote, [], "the confirmed clear removed every row it authoritatively covered");
  const newRow = { id: mkId("k21"), date: "2026-08-04", sales: 400, deliveries: 0, other_income: 0 };
  const rb = await B.create(newRow);
  await settleAll();
  assert.ok(COMMITTED(rb.status));
  exact(remote, [newRow], "a write issued after the clear is not swallowed by it");
});

test("[clear-all] K-22: an EDIT lands before the clear — the clear aborts and the edit is preserved exactly", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const confirmed = A.fingerprint();
  const rb = await B.upsert("2026-08-02", { sales: 222 }, { byId: ID2 });
  await settleAll();
  assert.ok(COMMITTED(rb.status));
  const r = await A.clearAll({ expectedNodeFingerprint: confirmed });
  await settleAll();
  assert.equal(r.reason, "precondition_failed");
  exact(remote, [day("2026-08-01", 100), { ...day("2026-08-02", 200), sales: 222 }, day("2026-08-03", 300)],
    "the concurrent edit survives untouched");
});

test("[clear-all] K-23: the clear lands first — a concurrent EDIT cannot resurrect a cleared row", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  // SIMULTANEOUS: B's intent is built from its pre-clear view.
  const pClear = A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  const pEdit = B.upsert("2026-08-02", { sales: 222 }, { byId: ID2 });
  const [rClear, rEdit] = await Promise.all([pClear, pEdit]);
  await settleAll();
  assert.equal(rClear.status, "committed");
  NOT_COMMITTED(rEdit, "an edit addressed at a cleared row");
  assert.equal(rEdit.reason, "target_not_found", "no resurrection from a stale local snapshot");
  exact(remote, [], "exactly empty");
  assert.deepEqual(plain(B.view()), [], "B's local state converged on the authoritative empty node");
});

test("[clear-all] K-24: the clear lands between a failed write and its RETRY — the retry cannot resurrect", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  // The SAME semantic intent is replayed; a retry is not a fresh edit recomputed
  // against changed state.
  const retryIntent = B.buildUpsert("2026-08-02", { sales: 222 }, { byId: ID2 });
  remote.failNextTransports(1);
  const rFirst = await B.submit(retryIntent);
  await settleAll();
  assert.equal(rFirst.status, "failed");
  exact(remote, history(), "the rejected transport mutated nothing");
  const rClear = await A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await settleAll();
  assert.equal(rClear.status, "committed");
  const rRetry = await B.submit(retryIntent);
  await settleAll();
  NOT_COMMITTED(rRetry, "a replayed intent after an authoritative clear");
  assert.equal(rRetry.reason, "target_not_found");
  exact(remote, [], "exactly empty — the retry resurrected nothing");
});

test("[clear-all] K-25: DELAYED transaction completion — the clear re-executes against the fresher value and aborts", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const confirmed = A.fingerprint();
  // Another writer lands inside the clear's transaction window, forcing a CAS re-run.
  remote.interleave(() => remote.setRowsDirect([...history(), day("2026-08-04", 400)]));
  const r = await A.clearAll({ expectedNodeFingerprint: confirmed });
  await settleAll();
  assert.ok(r.runs >= 2, `the transaction callback genuinely re-executed (runs=${r.runs})`);
  NOT_COMMITTED(r, "a clear whose confirmation was invalidated mid-transaction");
  assert.equal(r.reason, "precondition_failed");
  exact(remote, [...history(), day("2026-08-04", 400)], "the interleaved write survives; nothing was cleared");
});

test("[clear-all] K-26: two clients clear from the SAME confirmation — one commits, the other aborts, then converges", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const pA = A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  const pB = B.clearAll({ expectedNodeFingerprint: B.fingerprint() });
  const [ra, rb] = await Promise.all([pA, pB]);
  await settleAll();
  assert.equal(ra.status, "committed", "exactly one clear performed the removal");
  assert.equal(rb.status, "blocked");
  assert.equal(rb.reason, "precondition_failed", "the second confirmation no longer described the node");
  exact(remote, [], "exactly empty");
  // Re-confirmed against the authoritative empty node, B's clear is idempotent.
  B.pull();
  const rb2 = await B.clearAll({ expectedNodeFingerprint: B.fingerprint() });
  await settleAll();
  assert.equal(rb2.status, "committed_idempotent");
  assert.equal(rb2.reason, "already_empty");
  exact(remote, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// K-27 … K-29 — LISTENER TIMING, STALE CLIENTS, OWNER TRANSITIONS
// ═══════════════════════════════════════════════════════════════════════════

test("[clear-all] K-27: listener delivery BEFORE acknowledgement is deferred; the post-commit own echo is ignored", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const confirmed = A.fingerprint();
  const gate = remote.holdNext("clear-inflight");
  const p = A.clearAll({ expectedNodeFingerprint: confirmed });
  await tick();
  // A payload arriving before the ack is retained, never consumed as our own and never
  // applied over pending local intent.
  const pre = A.lane.onListenerEcho([day("2026-08-01", 100)], A.ctrl.current());
  assert.equal(pre.status, "deferred_pending_local");
  assert.equal(pre.deferredStored, true);
  assert.deepEqual(plain(A.view()), plain(history()), "NO success state is rendered before authoritative commitment");
  gate.release();
  const r = await p;
  await settleAll();
  assert.equal(r.status, "committed");
  exact(remote, [], "exactly empty");
  assert.deepEqual(plain(A.view()), [], "and only now does the local state show the cleared node");
  assert.equal(A.lane.onListenerEcho([], A.ctrl.current()).status, "ignored_own_echo", "the post-commit own echo is suppressed");
  assert.deepEqual(plain(B.view()), [], "the other client converged on the authoritative empty node via its listener");
});

test("[clear-all] K-28: a STALE client's confirmation cannot clear, and its stale rows are never resurrected", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  A.detach();                                                  // A stops receiving updates
  const staleConfirmation = A.fingerprint();                   // fingerprint of the OLD content
  const rb = await B.upsert("2026-08-01", { sales: 111 }, { byId: ID1 });
  await settleAll();
  assert.ok(COMMITTED(rb.status));
  const r = await A.clearAll({ expectedNodeFingerprint: staleConfirmation });
  await settleAll();
  NOT_COMMITTED(r, "a stale client's confirmation");
  assert.equal(r.reason, "precondition_failed");
  exact(remote, [{ ...day("2026-08-01", 100), sales: 111 }, day("2026-08-02", 200), day("2026-08-03", 300)],
    "the stale client neither cleared the node nor wrote its stale snapshot back");
});

// ── Three physically distinct destinations for the clear-all transition cells ──
const D_T1A = () => [
  { id: mkId("k-t1a-02"), date: "2026-08-02", sales: 1002, deliveries: 0, other_income: 0, note_t1a: "alpha" },
  { id: mkId("k-t1a-01"), date: "2026-08-01", sales: 1001, deliveries: 7, other_income: 0 },
];
const D_T1B = () => [
  { id: mkId("k-t1b-01"), date: "2026-08-01", sales: 2001, deliveries: 0, other_income: 3, tag_t1b: { k: "beta" } },
  { id: mkId("k-t1b-09"), date: "2026-08-09", sales: 2009, deliveries: 0, other_income: 0 },
];
const D_T2A = () => [
  { id: mkId("k-t2a-03"), date: "2026-08-03", sales: 3003, deliveries: 0, other_income: 0, legacy_t2a: 42 },
];
const D_T2B = () => [
  { id: mkId("k-t2b-07"), date: "2026-08-07", sales: 4007, deliveries: 1, other_income: 0 },
  { id: mkId("k-t2b-04"), date: "2026-08-04", sales: 4004, deliveries: 0, other_income: 0, extra_t2b: ["z"] },
];
function fourDestinations() {
  const svc = makeRemoteService();
  svc.at("T1", "A").seed(D_T1A());
  svc.at("T1", "B").seed(D_T1B());
  svc.at("T2", "A").seed(D_T2A());
  svc.at("T2", "B").seed(D_T2B());
  return svc;
}
const expect4 = (svc, t1a, t1b, t2a, t2b, msg) => assert.deepEqual(plain(svc.snapshot()), plain([
  { tenantId: "T1", key: "biz:A:entries", rows: t1a },
  { tenantId: "T1", key: "biz:B:entries", rows: t1b },
  { tenantId: "T2", key: "biz:A:entries", rows: t2a },
  { tenantId: "T2", key: "biz:B:entries", rows: t2b },
]), msg);

const CLEAR_DEST_TRANSITIONS = [
  { id: "K-29a", label: "BUSINESS change (T1/A → T1/B)", to: { tenantId: "T1", bizId: "B" }, toRows: D_T1B,
    others: [["T2", "A"], ["T2", "B"]] },
  { id: "K-29b", label: "TENANT change (T1/A → T2/A)", to: { tenantId: "T2", bizId: "A" }, toRows: D_T2A,
    others: [["T1", "B"], ["T2", "B"]] },
];
for (const t of CLEAR_DEST_TRANSITIONS) {
  test(`[clear-all] ${t.id}: ${t.label} during an in-flight clear — the clear stays bound to its CONFIRMED destination`, async () => {
    const svc = fourDestinations();
    const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
    const oldCtx = A.listenerCtx;
    const confirmed = A.fingerprint();                       // confirmation of T1/A's content
    expect4(svc, D_T1A(), D_T1B(), D_T2A(), D_T2B(), "exact initial four-destination state");

    const gate = svc.at("T1", "A").holdNext(`${t.id}-clear`);
    const p = A.clearAll({ expectedNodeFingerprint: confirmed });
    await tick();
    const appliedBefore = A.applied.length;
    A.switchTo(t.to.tenantId, t.to.bizId, { attach: false });
    assert.deepEqual(plain(A.destination()), { tenantId: t.to.tenantId, key: entriesKey(t.to.bizId) });
    gate.release();
    const r = await p;
    await settleAll();

    assert.equal(r.status, "committed", "the clear completed against its CONFIRMED destination");
    assert.equal(r.destructive, true);
    // It could clear ONLY the destination it captured.
    expect4(svc, [], D_T1B(), D_T2A(), D_T2B(),
      "T1/A is exactly empty; the new and sentinel destinations are byte-intact");
    assert.deepEqual(plain(svc.at("T1", "A").log()), [{ tenantId: "T1", key: "biz:A:entries", runs: 1, committed: true }],
      "the transaction log records the exact captured tenantId and key");
    assert.deepEqual(plain(svc.at(t.to.tenantId, t.to.bizId).log()), [], "no transaction was attempted at the NEW destination");
    t.others.forEach(([tn, bz]) => assert.deepEqual(plain(svc.at(tn, bz).log()), [], `nor at sentinel ${tn}/${bz}`));
    assert.equal(svc.allLogs().length, 1, "exactly one transaction across the whole service");
    // It could not mark the new destination as cleared, nor hydrate it with old data.
    assert.equal(A.applied.length, appliedBefore, "the clear's acknowledgement applied nothing into the new selection");
    assert.equal(A.lane._state().desired, null, "the new lane is fresh");
    assert.equal(A.lane.isHydrated(), false, "and unhydrated before its own listener");
    assert.equal(A.lane._state().ownPending, 0, "no own-echo marker from the cleared destination survived");
    const stale = A.lane.onListenerEcho([], oldCtx);
    assert.equal(stale.status, "stale", "the old destination's cleared payload cannot hydrate the new lane");
    assert.equal(A.applied.length, appliedBefore, "and it applied nothing");
    assert.equal(A.lane._state().desired, null, "the new destination is NOT marked cleared");

    // The new destination's own listener hydrates it with exactly its own value.
    A.attach(); A.pull();
    assert.equal(A.lane.isHydrated(), true);
    assert.deepEqual(plain(A.desired()), plain(t.toRows()), "exactly its own authoritative value, not the cleared one");
    assert.notDeepEqual(plain(A.desired()), [], "the new destination was never emptied");

    // The old confirmation cannot be reused against the new destination.
    const reuse = await A.clearAll({ expectedNodeFingerprint: confirmed });
    await settleAll();
    assert.equal(reuse.status, "blocked");
    assert.equal(reuse.reason, "precondition_failed", "a confirmation taken at one destination never describes another");
    expect4(svc, [], D_T1B(), D_T2A(), D_T2B(), "the reuse attempt mutated nothing anywhere");
    assert.notEqual(A.fingerprint(), confirmed, "the new destination's fingerprint is its own");
  });
}

// K-29c is a SAME-DESTINATION case: a new generation of (T1, biz:A:entries). Generation
// is a local ownership device, not an RTDB storage axis.
test("[clear-all] K-29c: GENERATION change on the SAME destination during an in-flight clear — lane isolation only", async () => {
  const svc = fourDestinations();
  const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
  const oldCtx = A.listenerCtx;
  const confirmed = A.fingerprint();
  const gate = svc.at("T1", "A").holdNext("K-29c-clear");
  const p = A.clearAll({ expectedNodeFingerprint: confirmed });
  await tick();
  const appliedBefore = A.applied.length;
  A.switchTo("T1", "A", { attach: false });                  // same physical destination, new generation
  assert.deepEqual(plain(A.destination()), { tenantId: "T1", key: "biz:A:entries" },
    "the physical destination is UNCHANGED — only the generation moved");
  gate.release();
  const r = await p;
  await settleAll();
  assert.equal(r.status, "committed");
  expect4(svc, [], D_T1B(), D_T2A(), D_T2B(), "the same destination was cleared; the others are byte-intact");
  assert.equal(A.applied.length, appliedBefore, "the retired generation's result never touched the new generation's UI");
  assert.equal(A.lane._state().desired, null, "the new-generation lane is fresh");
  assert.equal(A.lane.isHydrated(), false);
  assert.equal(A.lane.onListenerEcho([], oldCtx).status, "stale", "the retired generation's callback is stale");
  // The new generation hydrates from the SAME node — which is now genuinely empty.
  A.attach(); A.pull();
  assert.equal(A.lane.isHydrated(), true);
  assert.deepEqual(plain(A.desired()), [], "hydrated with the same destination's current (cleared) value");
});

test("[clear-all] K-29d: an in-flight clear that is REJECTED during a destination transition mutates nothing anywhere", async () => {
  const svc = fourDestinations();
  const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
  const confirmed = A.fingerprint();
  svc.at("T1", "A").failNextTransports(1);
  const p = A.clearAll({ expectedNodeFingerprint: confirmed });
  A.switchTo("T1", "B", { attach: false });
  const r = await p;
  await settleAll();
  NOT_COMMITTED(r, "a rejected clear");
  assert.equal(r.status, "failed");
  expect4(svc, D_T1A(), D_T1B(), D_T2A(), D_T2B(), "zero mutation across ALL destinations");
  assert.equal(svc.allLogs().length, 0, "the rejected transport never reached any destination");
  assert.equal(A.lane._state().desired, null, "and the new destination was not marked cleared");
});

test("[clear-all] K-29e: an in-flight clear whose retries are EXHAUSTED during a transition mutates nothing anywhere", async () => {
  const svc = fourDestinations();
  const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
  const confirmed = A.fingerprint();
  svc.at("T1", "A").setMaxRetries(3);
  svc.at("T1", "A").interleaveOnEveryAttempt(() => svc.at("T1", "A").setRowsDirect(D_T1A()));
  const p = A.clearAll({ expectedNodeFingerprint: confirmed });
  A.switchTo("T2", "A", { attach: false });
  const r = await p;
  await settleAll();
  svc.at("T1", "A").interleaveOnEveryAttempt(null);
  NOT_COMMITTED(r, "an exhausted clear");
  assert.equal(r.status, "failed");
  assert.equal(r.error, "not_committed", "never a phantom or partial clear");
  expect4(svc, D_T1A(), D_T1B(), D_T2A(), D_T2B(), "every row at every destination survives");
  assert.equal(A.lane._state().desired, null, "the new destination was not marked cleared");
});

// ═══════════════════════════════════════════════════════════════════════════
// K-30 … K-32 — FAILURE, EXHAUSTION, AND NO-PREMATURE-SUCCESS
// ═══════════════════════════════════════════════════════════════════════════

test("[clear-all] K-30a: a REJECTED transport leaves the node intact and the operation recoverable", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  remote.failNextTransports(1);
  const r = await A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await settleAll();
  NOT_COMMITTED(r, "a rejected transport");
  assert.equal(r.status, "failed");
  assert.equal(r.error, "transport_failed");
  exact(remote, history(), "zero mutation — no partial clear");
  assert.deepEqual(plain(A.view()), plain(history()), "and no success state was rendered");
  // Recoverable: the same confirmation still describes the node, so a retry commits.
  const r2 = await A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await settleAll();
  assert.equal(r2.status, "committed");
  exact(remote, []);
});

test("[clear-all] K-30b: retries EXHAUSTED under permanent contention — fails closed, never a partial or false clear", async () => {
  const remote = makeRemote(history());
  remote.state.maxRetries = 3;
  const A = makeClient(remote, "A").attach().pull();
  // The node is rewritten with IDENTICAL content on every attempt: the confirmation
  // still matches, so only the CAS check can fail — isolating exhaustion from
  // precondition failure.
  remote.interleaveOnEveryAttempt(() => remote.setRowsDirect(history()));
  const r = await A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await settleAll();
  remote.interleaveOnEveryAttempt(null);
  NOT_COMMITTED(r, "an exhausted clear");
  assert.equal(r.status, "failed");
  assert.equal(r.error, "not_committed", "the transport reported a non-commit, not a phantom clear");
  exact(remote, history(), "every row survives — no partial clear reported as complete");
});

test("[clear-all] K-31: a committed clear removes EVERY row it covered, including duplicates and identical siblings", async () => {
  const rows = [day("2026-08-01", 100), { ...day("2026-08-01", 100), id: mkId("k31-dup") },
                { id: mkId("k31-a"), date: "2026-08-02", sales: 5, deliveries: 0, other_income: 0 },
                { id: mkId("k31-b"), date: "2026-08-02", sales: 5, deliveries: 0, other_income: 0 }];
  const remote = makeRemote(rows);
  const A = makeClient(remote, "A").attach().pull();
  assert.equal(A.lane._state().desired.length, 4, "all four physical rows hydrated");
  const r = await A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await settleAll();
  assert.equal(r.status, "committed");
  exact(remote, [], "no row survives a committed clear — never a subset");
});

test("[clear-all] K-32: no success state exists before authoritative commitment", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const gate = remote.holdNext("k32");
  const p = A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await tick();
  assert.deepEqual(plain(A.view()), plain(history()), "the rendered state still shows every row");
  assert.deepEqual(plain(A.lane._state().desired), plain(history()), "and so does the lane's authoritative view");
  exact(remote, history(), "the node is untouched while the transaction is in flight");
  gate.release();
  const r = await p;
  await settleAll();
  assert.equal(r.status, "committed");
  assert.deepEqual(plain(A.view()), [], "the empty state appears only after the commit");
  exact(remote, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// NEGATIVE CONTROLS — no generic full-collection writer may exist
// ═══════════════════════════════════════════════════════════════════════════

test("[negative-control] K-N1: a collection is not a mutation intent — no ordinary submission can empty the node", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  for (const notAnIntent of [[], history(), { rows: [] }, { rows: [], allowDrop: true }, null, "clear"]) {
    const r = await A.submit(notAnIntent);
    assert.equal(r.status, "blocked_invalid_intent", `${JSON.stringify(notAnIntent)} is not a submittable intent`);
  }
  await settleAll();
  assert.equal(remote.allLogs().length, 0, "NO transaction was dispatched at ANY destination for any of them");
  exact(remote, history(), "zero mutation — R10 has no generic full-collection snapshot writer");
});

test("[negative-control] K-N2: an unsupported or malformed typed intent cannot clear the node", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const rUnsupported = await A.submit({ type: "replace_all", rows: [] });
  await settleAll();
  NOT_COMMITTED(rUnsupported, "an unsupported intent type");
  assert.equal(rUnsupported.reason, "unsupported_intent");
  // A clear_all intent smuggled through submitIntent still needs the full precondition.
  const rSmuggled = await A.submit({ type: "clear_all" });
  await settleAll();
  assert.equal(rSmuggled.status, "blocked_precondition_missing", "the destructive precondition cannot be bypassed");
  exact(remote, history(), "zero mutation");
});

test("[negative-control] K-N3: the watchdog reports a clear left physically in flight", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const gate = remote.holdNext("clear-deliberately-held");
  const p = A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await assert.rejects(() => p, /never settled after 60 deterministic ticks[\s\S]*clear-deliberately-held/,
    "an un-released clear fails ITS OWN test deterministically instead of hanging");
  gate.release();
  await settleAll();
});

test("[negative-control] K-N4: a sentinel schedule after the deliberately stranded clear still executes", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const r = await A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await settleAll();
  assert.equal(r.status, "committed");
  exact(remote, []);
});
