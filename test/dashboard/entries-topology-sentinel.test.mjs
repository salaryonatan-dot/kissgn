// P0-DATA-01 R10 — GATE 3 TOPOLOGY SENTINEL SUITE.
//
// PURPOSE: prove that the test remote is genuinely partitioned by the exact pair
// [tenantId, key] (key === `biz:${bizId}:entries`), so that every destination-transition
// assertion in the concurrency and clear-all matrices rests on real remote routing
// rather than on one aliased global node.
//
// This suite FAILS BY CONSTRUCTION against the former single-node harness, in which
// `transact(tenantId, key, txnFn)` recorded `key` but read and wrote a single global
// `state.node` with a single global `state.version` and one global listener list.
// Under that topology TS-02 … TS-13 cannot pass: a write addressed at (T1, biz:A:entries)
// would also change what (T1, biz:B:entries) and (T2, biz:A:entries) read back.
//
// ANTI-ALIASING: the three seeded destinations deliberately overlap on business date
// while differing in immutable id, financial value, row ORDER and unknown fields, so a
// shared node cannot false-green any equality check. TS-13 additionally proves the
// partition key cannot be forged by delimiter concatenation.
//
// Every assertion is COMPLETE deep equality over the whole three-destination snapshot
// — never counts, subsets or selected fields.
//
// Run: node --test test/dashboard/entries-topology-sentinel.test.mjs

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  plain, tick, settleAll, mkId, COMMITTED, entriesKey,
  makeRemoteService, makeClient, drainLiveRigs,
} from "../support/cross-writer-harness.mjs";

afterEach(drainLiveRigs);

// ── Three deliberately DISTINCT authoritative states ─────────────────────────
// Distinct ids, overlapping dates, distinct values, non-sorted order, distinct
// unknown fields. Any aliasing between destinations is therefore observable.
const S_T1A = () => [
  { id: mkId("t1a-02"), date: "2026-08-02", sales: 1002, deliveries: 0, other_income: 0, note_t1a: "alpha" },
  { id: mkId("t1a-01"), date: "2026-08-01", sales: 1001, deliveries: 7, other_income: 0 },
];
const S_T1B = () => [
  { id: mkId("t1b-01"), date: "2026-08-01", sales: 2001, deliveries: 0, other_income: 3, tag_t1b: { k: "beta" } },
  { id: mkId("t1b-09"), date: "2026-08-09", sales: 2009, deliveries: 0, other_income: 0 },
  { id: mkId("t1b-05"), date: "2026-08-05", sales: 2005, deliveries: 0, other_income: 0 },
];
const S_T2A = () => [
  { id: mkId("t2a-03"), date: "2026-08-03", sales: 3003, deliveries: 0, other_income: 0, legacy_t2a: 42 },
];

function seededService() {
  const svc = makeRemoteService();
  svc.at("T1", "A").seed(S_T1A());
  svc.at("T1", "B").seed(S_T1B());
  svc.at("T2", "A").seed(S_T2A());
  return svc;
}
// COMPLETE three-destination equality, including tenant, key, row order and ids.
const expectAll = (svc, t1a, t1b, t2a, msg) => assert.deepEqual(plain(svc.snapshot()), plain([
  { tenantId: "T1", key: "biz:A:entries", rows: t1a },
  { tenantId: "T1", key: "biz:B:entries", rows: t1b },
  { tenantId: "T2", key: "biz:A:entries", rows: t2a },
]), msg);

test("[topology] TS-01: three destinations hold three independent, exactly distinct nodes", async () => {
  const svc = seededService();
  expectAll(svc, S_T1A(), S_T1B(), S_T2A(), "each [tenantId,key] pair has its own node");
  assert.deepEqual(plain(svc.destinations()), [
    { tenantId: "T1", key: "biz:A:entries" },
    { tenantId: "T1", key: "biz:B:entries" },
    { tenantId: "T2", key: "biz:A:entries" },
  ]);
  // Same bizId under different tenants, and same tenant with different bizIds, are
  // different physical nodes — never the same object.
  assert.notEqual(svc.at("T1", "A").raw, svc.at("T2", "A").raw, "(T1,A) and (T2,A) are distinct destinations");
  assert.notEqual(svc.at("T1", "A").raw, svc.at("T1", "B").raw, "(T1,A) and (T1,B) are distinct destinations");
});

const MUTATION_CELLS = [
  { id: "TS-02", tenantId: "T1", bizId: "A", label: "T1/A" },
  { id: "TS-03", tenantId: "T1", bizId: "B", label: "T1/B" },
  { id: "TS-04", tenantId: "T2", bizId: "A", label: "T2/A" },
];
for (const cell of MUTATION_CELLS) {
  test(`[topology] ${cell.id}: a committed mutation at ${cell.label} changes ONLY ${cell.label}`, async () => {
    const svc = seededService();
    const C = makeClient(svc, "C", { tenantId: cell.tenantId, bizId: cell.bizId }).attach().pull();
    const before = plain(svc.snapshot());
    const newRow = { id: mkId(`ts-new-${cell.id}`), date: "2026-08-20", sales: 999, deliveries: 0, other_income: 0 };
    const r = await C.create(newRow);
    await settleAll();
    assert.ok(COMMITTED(r.status), `the write committed (${r.status})`);
    // Exactly one destination changed, and it is the addressed one.
    const after = plain(svc.snapshot());
    after.forEach((d, i) => {
      const isTarget = d.tenantId === cell.tenantId && d.key === entriesKey(cell.bizId);
      if (isTarget) assert.deepEqual(d.rows, plain([...before[i].rows, newRow]), `${cell.label} received exactly the new row`);
      else assert.deepEqual(d.rows, before[i].rows, `${d.tenantId}/${d.key} is byte-intact`);
    });
    // The client's converged local state is its OWN destination, exactly.
    assert.deepEqual(plain(C.desired()), plain([...before.find(d => d.tenantId === cell.tenantId && d.key === entriesKey(cell.bizId)).rows, newRow]));
  });
}

test("[topology] TS-05: a listener receives ONLY its registered destination's value", async () => {
  const svc = seededService();
  const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
  const B = makeClient(svc, "B", { tenantId: "T1", bizId: "B" }).attach().pull();
  const T = makeClient(svc, "T", { tenantId: "T2", bizId: "A" }).attach().pull();
  assert.deepEqual(plain(A.desired()), plain(S_T1A()));
  assert.deepEqual(plain(B.desired()), plain(S_T1B()));
  assert.deepEqual(plain(T.desired()), plain(S_T2A()));
  const counts = [A.applied.length, B.applied.length, T.applied.length];
  // Emit at T1/B only.
  const t1bNext = [...S_T1B(), { id: mkId("t1b-emit"), date: "2026-08-11", sales: 2011, deliveries: 0, other_income: 0 }];
  svc.at("T1", "B").setRowsDirect(t1bNext);
  svc.at("T1", "B").emitAll();
  assert.equal(A.applied.length, counts[0], "T1/A's listener did not fire");
  assert.equal(T.applied.length, counts[2], "T2/A's listener did not fire");
  assert.equal(B.applied.length, counts[1] + 1, "only T1/B's listener fired");
  assert.deepEqual(plain(B.desired()), plain(t1bNext));
  assert.deepEqual(plain(A.desired()), plain(S_T1A()), "T1/A's local state is untouched");
  assert.deepEqual(plain(T.desired()), plain(S_T2A()), "T2/A's local state is untouched");
  expectAll(svc, S_T1A(), t1bNext, S_T2A(), "only T1/B's node changed");
});

test("[topology] TS-06: a pull returns ONLY the requested destination", async () => {
  const svc = seededService();
  const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).pull();
  const B = makeClient(svc, "B", { tenantId: "T1", bizId: "B" }).pull();
  const T = makeClient(svc, "T", { tenantId: "T2", bizId: "A" }).pull();
  assert.deepEqual(plain(A.desired()), plain(S_T1A()));
  assert.deepEqual(plain(B.desired()), plain(S_T1B()));
  assert.deepEqual(plain(T.desired()), plain(S_T2A()));
  assert.deepEqual(plain(A.destination()), { tenantId: "T1", key: "biz:A:entries" });
  assert.deepEqual(plain(B.destination()), { tenantId: "T1", key: "biz:B:entries" });
  assert.deepEqual(plain(T.destination()), { tenantId: "T2", key: "biz:A:entries" });
  // Cross-check: no client's view is any other client's node.
  assert.notDeepEqual(plain(A.desired()), plain(S_T1B()));
  assert.notDeepEqual(plain(A.desired()), plain(S_T2A()));
  assert.notDeepEqual(plain(B.desired()), plain(S_T2A()));
});

test("[topology] TS-07: version advances ONLY for the mutated destination", async () => {
  const svc = seededService();
  const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
  const v = { t1a: svc.at("T1", "A").version(), t1b: svc.at("T1", "B").version(), t2a: svc.at("T2", "A").version() };
  const r = await A.upsert("2026-08-01", { sales: 1111 }, { byId: mkId("t1a-01") });
  await settleAll();
  assert.ok(COMMITTED(r.status));
  assert.equal(svc.at("T1", "A").version(), v.t1a + 1, "T1/A advanced exactly once");
  assert.equal(svc.at("T1", "B").version(), v.t1b, "T1/B did not advance");
  assert.equal(svc.at("T2", "A").version(), v.t2a, "T2/A did not advance");
  expectAll(svc,
    [S_T1A()[0], { ...S_T1A()[1], sales: 1111 }],
    S_T1B(), S_T2A(), "only T1/A's node changed, in place, order preserved");
});

test("[topology] TS-08: the transaction log records the exact CAPTURED tenantId and key", async () => {
  const svc = seededService();
  const B = makeClient(svc, "B", { tenantId: "T1", bizId: "B" }).attach().pull();
  const r = await B.upsert("2026-08-05", { sales: 2222 }, { byId: mkId("t1b-05") });
  await settleAll();
  assert.ok(COMMITTED(r.status));
  assert.deepEqual(plain(svc.at("T1", "B").log()), [{ tenantId: "T1", key: "biz:B:entries", runs: 1, committed: true }]);
  assert.deepEqual(plain(svc.at("T1", "A").log()), [], "no transaction was attempted at T1/A");
  assert.deepEqual(plain(svc.at("T2", "A").log()), [], "no transaction was attempted at T2/A");
  assert.equal(svc.allLogs().length, 1, "exactly one transaction across the whole service");
  expectAll(svc, S_T1A(), [S_T1B()[0], S_T1B()[1], { ...S_T1B()[2], sales: 2222 }], S_T2A());
});

test("[topology] TS-09: a REJECTED transport leaves all three destinations byte-intact", async () => {
  const svc = seededService();
  const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
  svc.at("T1", "A").failNextTransports(1);
  const r = await A.upsert("2026-08-01", { sales: 1111 }, { byId: mkId("t1a-01") });
  await settleAll();
  assert.equal(r.status, "failed");
  assert.equal(r.error, "transport_failed");
  expectAll(svc, S_T1A(), S_T1B(), S_T2A(), "zero mutation anywhere in the service");
  assert.equal(svc.allLogs().length, 0, "the rejected transport never reached a destination");
});

test("[topology] TS-10: retry EXHAUSTION leaves all three destinations byte-intact", async () => {
  const svc = seededService();
  const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
  svc.at("T1", "A").setMaxRetries(3);
  // Identical content rewritten on every attempt: only the CAS check can fail, so the
  // final content of T1/A is exactly its seeded state.
  svc.at("T1", "A").interleaveOnEveryAttempt(() => svc.at("T1", "A").setRowsDirect(S_T1A()));
  const r = await A.upsert("2026-08-01", { sales: 1111 }, { byId: mkId("t1a-01") });
  await settleAll();
  svc.at("T1", "A").interleaveOnEveryAttempt(null);
  assert.equal(r.status, "failed");
  assert.equal(r.error, "not_committed");
  expectAll(svc, S_T1A(), S_T1B(), S_T2A(), "the exhausted operation mutated nothing anywhere");
});

test("[topology] TS-11: the SAME bizId under different tenants is a different physical node", async () => {
  const svc = seededService();
  const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
  const T = makeClient(svc, "T", { tenantId: "T2", bizId: "A" }).attach().pull();
  // Both clients address key `biz:A:entries`; only the tenant differs.
  assert.equal(A.destination().key, T.destination().key, "identical key");
  assert.notEqual(A.destination().tenantId, T.destination().tenantId, "different tenant");
  const rowA = { id: mkId("ts11-a"), date: "2026-08-30", sales: 1, deliveries: 0, other_income: 0 };
  const rowT = { id: mkId("ts11-t"), date: "2026-08-30", sales: 2, deliveries: 0, other_income: 0 };
  const ra = await A.create(rowA);
  const rt = await T.create(rowT);
  await settleAll();
  assert.ok(COMMITTED(ra.status) && COMMITTED(rt.status));
  expectAll(svc, [...S_T1A(), rowA], S_T1B(), [...S_T2A(), rowT],
    "each tenant's biz:A:entries received exactly its own row");
  assert.deepEqual(plain(svc.at("T1", "A").log()), [{ tenantId: "T1", key: "biz:A:entries", runs: 1, committed: true }]);
  assert.deepEqual(plain(svc.at("T2", "A").log()), [{ tenantId: "T2", key: "biz:A:entries", runs: 1, committed: true }]);
});

test("[topology] TS-12: a committed CLEAR-ALL empties ONLY its own destination", async () => {
  const svc = seededService();
  const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
  const r = await A.clearAll({ expectedNodeFingerprint: A.fingerprint() });
  await settleAll();
  assert.equal(r.status, "committed");
  expectAll(svc, [], S_T1B(), S_T2A(), "T1/A is exactly empty; T1/B and T2/A are byte-intact");
  assert.deepEqual(plain(A.desired()), [], "the clearing client converged on its own empty node");
});

test("[topology] TS-13: the partition key cannot be forged by delimiter concatenation", async () => {
  const svc = makeRemoteService();
  // Pairs that collide under naive `tenantId + delim + key` encoding for the delimiters
  // that appear in real values (":" and "|"), plus the empty-delimiter case.
  const rowReal = { id: mkId("ts13-real"), date: "2026-08-01", sales: 1, deliveries: 0, other_income: 0 };
  svc.atKey("T1", "biz:A:entries").seed([rowReal]);
  const FORGERIES = [
    ["T1:biz", "A:entries"],        // ":" concatenation → "T1:biz:A:entries"
    ["T1|biz", "A:entries"],        // "|" concatenation → "T1|biz:A:entries"
    ["T1b", "iz:A:entries"],        // empty concatenation → "T1biz:A:entries"
    ["T1", "biz:A:entries "],       // trailing space
    ["T1 ", "biz:A:entries"],       // leading-adjacent space
  ];
  for (const [t, k] of FORGERIES) {
    assert.equal(svc.atKey(t, k).rows(), null, `(${JSON.stringify(t)}, ${JSON.stringify(k)}) is a DIFFERENT, absent destination`);
    assert.notEqual(svc.atKey(t, k).raw, svc.atKey("T1", "biz:A:entries").raw);
  }
  // Writing to a forgery must not touch the real destination, and vice versa.
  await svc.transact("T1:biz", "A:entries", () => ({ _v: JSON.stringify([{ id: mkId("ts13-forged"), date: "2026-08-02", sales: 9, deliveries: 0, other_income: 0 }]) }));
  assert.deepEqual(plain(svc.atKey("T1", "biz:A:entries").rows()), plain([rowReal]), "the real destination is byte-intact");
  assert.deepEqual(plain(svc.atKey("T1:biz", "A:entries").rows()),
    plain([{ id: mkId("ts13-forged"), date: "2026-08-02", sales: 9, deliveries: 0, other_income: 0 }]),
    "the forgery wrote only to its own destination");
  assert.deepEqual(plain(svc.allLogs()), [{ tenantId: "T1:biz", key: "A:entries", runs: 1, committed: true }],
    "the log records the exact captured pair, unencoded");
});

test("[topology] TS-14: an in-flight transaction keeps its CAPTURED destination across a selection change", async () => {
  const svc = seededService();
  const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
  const gate = svc.at("T1", "A").holdNext("ts14");
  const newRow = { id: mkId("ts14"), date: "2026-08-25", sales: 77, deliveries: 0, other_income: 0 };
  const p = A.create(newRow);
  await tick();
  A.switchTo("T2", "A");                       // move to a DIFFERENT physical destination
  assert.deepEqual(plain(A.destination()), { tenantId: "T2", key: "biz:A:entries" });
  gate.release();
  const r = await p;
  await settleAll();
  assert.ok(COMMITTED(r.status), `the held write completed (${r.status})`);
  expectAll(svc, [...S_T1A(), newRow], S_T1B(), S_T2A(),
    "the write landed at the destination it CAPTURED, and the newly selected one is byte-intact");
  assert.deepEqual(plain(svc.at("T1", "A").log()), [{ tenantId: "T1", key: "biz:A:entries", runs: 1, committed: true }]);
  assert.deepEqual(plain(svc.at("T2", "A").log()), [], "no transaction was attempted at the new destination");
});
