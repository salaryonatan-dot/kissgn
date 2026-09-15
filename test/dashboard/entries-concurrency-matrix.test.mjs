// P0-DATA-01 R10 — GATE 3 INDEPENDENT-WRITER CONCURRENCY MATRIX.
//
// Completes the concurrency half of Gate 3. The accepted 23-test suite
// `entries-remote-atomic.test.mjs` (R10-1 … R10-22) is the BASELINE and is left
// byte-unchanged; this file adds every remaining documented schedule.
//
// Authoritative inventory sources:
//   • artifacts/p0-data-01-r10/_STATUS_CHANGES_STILL_REQUIRED.md → "Remaining blockers"
//     item 3 (Gate 3, partial): date-edit vs revenue and vs food-cost in BOTH orders,
//     two conflicting date edits, date-edit vs delete, callback re-execution for date
//     edits, owner invalidation during a date mutation.
//   • The Gate 3 assignment categories: independent creates; independent edits to
//     different rows; independent edits to different fields of the same row;
//     conflicting edits to the same field; edit vs delete/clear; retries; listener
//     echoes; delayed transaction completion; stale bases; rebase after a conflict;
//     owner/business/generation changes; successful, aborted, rejected and exhausted
//     operations; cross-writer ordering permutations.
//
// Cells already proven by the baseline are NOT duplicated here; the mapping is
// recorded in artifacts/p0-data-01-r10/GATE3_CONCURRENCY_AND_CLEAR_ALL_MATRIX.md.
//
// Every test drives the ACTUAL production transformer, remote-atomic mutator and
// coordinator vm-extracted from index.html. Two or more fully independent clients
// share NOTHING except the remote RTDB stub.
//
// Run: node --test test/dashboard/entries-concurrency-matrix.test.mjs

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ML, plain, tick, settleAll, uuid4, mkId, day, nextTestId, COMMITTED, entriesKey,
  valueAt, rowById, supAt, makeRemote, makeRemoteService, makeClient, drainLiveRigs,
} from "../support/cross-writer-harness.mjs";

afterEach(drainLiveRigs);

const history = () => [day("2026-08-01", 100), day("2026-08-02", 200), day("2026-08-03", 300)];
const ID1 = mkId("d2026-08-01"), ID2 = mkId("d2026-08-02"), ID3 = mkId("d2026-08-03");
const ORDERS = ["A_then_B", "B_then_A"];
// Exact-state helper: full deep equality against the authoritative node.
const exact = (remote, expected, msg) => assert.deepEqual(plain(remote.rows()), plain(expected), msg);

// ═══════════════════════════════════════════════════════════════════════════
// C-01 … C-05 — INDEPENDENT CREATES
// ═══════════════════════════════════════════════════════════════════════════

for (const order of ORDERS) {
  test(`[concurrency] C-01 (${order}): two independent CREATES for different dates — both rows exist, history intact`, async () => {
    const remote = makeRemote(history());
    const A = makeClient(remote, "A").attach().pull();
    const B = makeClient(remote, "B").attach().pull();
    const rowA = { id: mkId("newA"), date: "2026-08-04", sales: 400, deliveries: 0, other_income: 0 };
    const rowB = { id: mkId("newB"), date: "2026-08-05", sales: 500, deliveries: 0, other_income: 0 };
    let ra, rb;
    if (order === "A_then_B") { ra = await A.create(rowA); rb = await B.create(rowB); }
    else { rb = await B.create(rowB); ra = await A.create(rowA); }
    await settleAll();
    assert.ok(COMMITTED(ra.status), `A create committed (${ra.status})`);
    assert.ok(COMMITTED(rb.status), `B create committed (${rb.status})`);
    const expected = order === "A_then_B" ? [...history(), rowA, rowB] : [...history(), rowB, rowA];
    exact(remote, expected, "both creates appended in commit order; nothing else touched");
    assert.equal(remote.rows().length, 5, "no duplicate physical row");
  });
}

for (const order of ORDERS) {
  test(`[concurrency] C-02 (${order}): two independent CREATES for the SAME date with different ids — both survive as distinct records`, async () => {
    const remote = makeRemote(history());
    const A = makeClient(remote, "A").attach().pull();
    const B = makeClient(remote, "B").attach().pull();
    const rowA = { id: mkId("dupA"), date: "2026-08-04", sales: 401, deliveries: 0, other_income: 0 };
    const rowB = { id: mkId("dupB"), date: "2026-08-04", sales: 402, deliveries: 0, other_income: 0 };
    let ra, rb;
    if (order === "A_then_B") { ra = await A.create(rowA); rb = await B.create(rowB); }
    else { rb = await B.create(rowB); ra = await A.create(rowA); }
    await settleAll();
    assert.ok(COMMITTED(ra.status) && COMMITTED(rb.status), "duplicate business DATES are valid when ids differ");
    const expected = order === "A_then_B" ? [...history(), rowA, rowB] : [...history(), rowB, rowA];
    exact(remote, expected, "both physical rows persisted verbatim");
    // Independently addressable afterwards.
    A.pull();
    const rEdit = await A.upsert("2026-08-04", { sales: 999 }, { byId: rowB.id });
    await settleAll();
    assert.ok(COMMITTED(rEdit.status));
    assert.equal(rowById(remote.rows(), rowA.id).sales, 401, "the sibling duplicate is untouched");
    assert.equal(rowById(remote.rows(), rowB.id).sales, 999, "only the addressed id changed");
  });
}

test("[concurrency] C-03: two independent CREATES reusing the SAME id with different content — second is a fail-closed collision", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const shared = mkId("collide");
  const ra = await A.create({ id: shared, date: "2026-08-04", sales: 400, deliveries: 0, other_income: 0 });
  const rb = await B.create({ id: shared, date: "2026-08-04", sales: 777, deliveries: 0, other_income: 0 });
  await settleAll();
  assert.ok(COMMITTED(ra.status), "the first create committed");
  assert.equal(rb.status, "blocked", "the colliding create fails closed");
  assert.equal(rb.reason, "invalid_identity");
  assert.equal(rb.detail, "id_collision", "the precise classification reaches the caller");
  assert.notEqual(rb.status, "committed", "never ordinary success");
  assert.notEqual(rb.status, "committed_idempotent", "never idempotent success");
  exact(remote, [...history(), { id: shared, date: "2026-08-04", sales: 400, deliveries: 0, other_income: 0 }],
    "zero unintended remote mutation — the committed content is byte-intact");
  assert.equal(remote.rows().filter(r => r.id === shared).length, 1, "no duplicate physical row for the id");
});

test("[concurrency] C-04: the SAME create id with IDENTICAL content is a semantic retry — idempotent, exactly one row", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const shared = mkId("retry");
  const row = { id: shared, date: "2026-08-04", sales: 400, deliveries: 0, other_income: 0 };
  const ra = await A.create({ ...row });
  const versionAfterFirst = remote.version();
  const rb = await B.create({ ...row });
  await settleAll();
  assert.equal(ra.status, "committed");
  assert.equal(rb.status, "committed_idempotent", "idempotent success requires the EXACT intended operation to already be present");
  assert.equal(rb.rows, undefined, "an idempotent no-op returns no committed rows");
  exact(remote, [...history(), row], "exactly one physical row for the reused id");
  assert.equal(remote.version(), versionAfterFirst, "the idempotent replay performed no remote write");
});

for (const order of ORDERS) {
  test(`[concurrency] C-05 (${order}): a CREATE racing an EDIT of an existing row — both land, nothing else moves`, async () => {
    const remote = makeRemote(history());
    const A = makeClient(remote, "A").attach().pull();
    const B = makeClient(remote, "B").attach().pull();
    const rowA = { id: mkId("c05"), date: "2026-08-04", sales: 400, deliveries: 0, other_income: 0 };
    let ra, rb;
    if (order === "A_then_B") { ra = await A.create(rowA); rb = await B.upsert("2026-08-02", { sales: 222 }); }
    else { rb = await B.upsert("2026-08-02", { sales: 222 }); ra = await A.create(rowA); }
    await settleAll();
    assert.ok(COMMITTED(ra.status) && COMMITTED(rb.status));
    exact(remote, [day("2026-08-01", 100), { ...day("2026-08-02", 200), sales: 222 }, day("2026-08-03", 300), rowA],
      "the create appends and the edit patches in place; row order preserved");
  });
}

test("[concurrency] C-05b: two independent creates against a genuinely ABSENT node — neither erases the other", async () => {
  const remote = makeRemote(undefined);
  const A = makeClient(remote, "A").attach().bootstrapAbsent();
  const B = makeClient(remote, "B").attach().bootstrapAbsent();
  const rowA = { id: mkId("absA"), date: "2026-08-01", sales: 1, deliveries: 0, other_income: 0 };
  const rowB = { id: mkId("absB"), date: "2026-08-02", sales: 2, deliveries: 0, other_income: 0 };
  const ra = await A.create(rowA);
  const rb = await B.create(rowB);
  await settleAll();
  assert.ok(COMMITTED(ra.status) && COMMITTED(rb.status));
  exact(remote, [rowA, rowB], "an absent-node bootstrap cannot erase a row another client just created");
});

// ═══════════════════════════════════════════════════════════════════════════
// C-06 … C-12 — DATE EDITS (the explicit Gate 3 remainder)
// A date change is an ORDINARY PATCHED FIELD (R10-GATE-003): identity is the id,
// never the date, so a date edit is exactly as concurrent-safe as any other field.
// ═══════════════════════════════════════════════════════════════════════════

for (const order of ORDERS) {
  test(`[concurrency] C-06 (${order}): DATE-EDIT vs REVENUE edit on DIFFERENT rows — both survive`, async () => {
    const remote = makeRemote(history());
    const A = makeClient(remote, "A").attach().pull();
    const B = makeClient(remote, "B").attach().pull();
    let ra, rb;
    if (order === "A_then_B") { ra = await A.upsert("2026-08-01", {}, { byId: ID1, newDate: "2026-08-09" }); rb = await B.upsert("2026-08-02", { sales: 222 }, { byId: ID2 }); }
    else { rb = await B.upsert("2026-08-02", { sales: 222 }, { byId: ID2 }); ra = await A.upsert("2026-08-01", {}, { byId: ID1, newDate: "2026-08-09" }); }
    await settleAll();
    assert.ok(COMMITTED(ra.status), `date edit committed (${ra.status})`);
    assert.ok(COMMITTED(rb.status), `revenue edit committed (${rb.status})`);
    exact(remote, [{ ...day("2026-08-01", 100), date: "2026-08-09" }, { ...day("2026-08-02", 200), sales: 222 }, day("2026-08-03", 300)],
      "the moved row keeps its id and position; the other row keeps its date");
    assert.equal(rowById(remote.rows(), ID1).id, ID1, "identity is never rewritten by a date change");
  });
}

for (const order of ORDERS) {
  test(`[concurrency] C-07 (${order}): DATE-EDIT vs REVENUE edit on the SAME row (disjoint paths) — both survive`, async () => {
    const remote = makeRemote(history());
    const A = makeClient(remote, "A").attach().pull();
    const B = makeClient(remote, "B").attach().pull();
    let ra, rb;
    if (order === "A_then_B") { ra = await A.upsert("2026-08-01", {}, { byId: ID1, newDate: "2026-08-09" }); rb = await B.upsert("2026-08-01", { sales: 150 }, { byId: ID1 }); }
    else { rb = await B.upsert("2026-08-01", { sales: 150 }, { byId: ID1 }); ra = await A.upsert("2026-08-01", {}, { byId: ID1, newDate: "2026-08-09" }); }
    await settleAll();
    assert.ok(COMMITTED(ra.status) && COMMITTED(rb.status), `both disjoint-path edits committed (${ra.status}/${rb.status})`);
    exact(remote, [{ ...day("2026-08-01", 100), date: "2026-08-09", sales: 150 }, day("2026-08-02", 200), day("2026-08-03", 300)],
      "date and sales are independent absolute paths on one physical row");
  });
}

for (const order of ORDERS) {
  test(`[concurrency] C-08 (${order}): DATE-EDIT vs FOOD-COST edit on the SAME row — both survive`, async () => {
    const remote = makeRemote(history());
    const A = makeClient(remote, "A").attach().pull();
    const B = makeClient(remote, "B").attach().pull();
    let ra, rb;
    if (order === "A_then_B") { ra = await A.upsert("2026-08-01", {}, { byId: ID1, newDate: "2026-08-09" }); rb = await B.supplier("2026-08-01", "sup-1", "870.34", { byId: ID1 }); }
    else { rb = await B.supplier("2026-08-01", "sup-1", "870.34", { byId: ID1 }); ra = await A.upsert("2026-08-01", {}, { byId: ID1, newDate: "2026-08-09" }); }
    await settleAll();
    assert.ok(COMMITTED(ra.status) && COMMITTED(rb.status), `${ra.status}/${rb.status}`);
    exact(remote, [{ ...day("2026-08-01", 100), date: "2026-08-09", supplier_payments: { "sup-1": "870.34" } }, day("2026-08-02", 200), day("2026-08-03", 300)],
      "a revenue-date move and a food-cost entry on one row never clobber each other");
  });
}

test("[concurrency] C-09: two conflicting DATE edits from the same base — second conflicts, then commits only after a genuine rebase", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  // SIMULTANEOUS submission: both intents are built from the same hydrated base
  // BEFORE either transaction can commit — the schedule that used to lose an edit.
  const pa = A.upsert("2026-08-01", {}, { byId: ID1, newDate: "2026-08-09" });
  const pb = B.upsert("2026-08-01", {}, { byId: ID1, newDate: "2026-08-10" });
  const [ra, rb] = await Promise.all([pa, pb]);
  await settleAll();
  assert.ok(COMMITTED(ra.status), "A's date edit committed");
  assert.equal(rb.status, "conflict", "B's stale-base date edit fails closed");
  assert.deepEqual(plain(rb.conflictPaths), ["date"], "the exact conflicting path is reported");
  exact(remote, [{ ...day("2026-08-01", 100), date: "2026-08-09" }, day("2026-08-02", 200), day("2026-08-03", 300)],
    "A's committed date is byte-intact — no stale overwrite");
  // Rebase against authoritative state, then the same intent commits.
  B.pull();
  const rb2 = await B.upsert("2026-08-09", {}, { byId: ID1, newDate: "2026-08-10" });
  await settleAll();
  assert.ok(COMMITTED(rb2.status), `the re-based edit committed (${rb2.status})`);
  exact(remote, [{ ...day("2026-08-01", 100), date: "2026-08-10" }, day("2026-08-02", 200), day("2026-08-03", 300)],
    "the rebase moved the same physical row; identity and every other field unchanged");
});

test("[concurrency] C-10a: DELETE lands first, then a DATE edit — target_not_found, no resurrection", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const pDel = B.del("2026-08-01", { byId: ID1 });
  const pEdit = A.upsert("2026-08-01", {}, { byId: ID1, newDate: "2026-08-09" });
  const [rDel, rEdit] = await Promise.all([pDel, pEdit]);
  await settleAll();
  assert.ok(COMMITTED(rDel.status), "the delete committed");
  assert.equal(rEdit.status, "blocked");
  assert.equal(rEdit.reason, "target_not_found", "an edit cannot resurrect a deleted record");
  exact(remote, [day("2026-08-02", 200), day("2026-08-03", 300)], "exactly the two surviving rows");
});

test("[concurrency] C-10b: DATE edit lands first, then a DELETE whose declared base includes the date — conflict, row preserved", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const pEdit = A.upsert("2026-08-01", {}, { byId: ID1, newDate: "2026-08-09" });
  const pDel = B.del("2026-08-01", { byId: ID1, baseFields: (prev) => ({ sales: prev.sales, date: prev.date }) });
  const [rEdit, rDel] = await Promise.all([pEdit, pDel]);
  await settleAll();
  assert.ok(COMMITTED(rEdit.status), "the date edit committed");
  assert.equal(rDel.status, "conflict", "a stale delete must not remove a record edited after the user's base version");
  assert.deepEqual(plain(rDel.conflictPaths), ["date"]);
  exact(remote, [{ ...day("2026-08-01", 100), date: "2026-08-09" }, day("2026-08-02", 200), day("2026-08-03", 300)],
    "the record survives the stale delete verbatim");
});

test("[concurrency] C-10c: DATE edit lands first, then a DELETE built from the pre-edit row — the delete is refused", async () => {
  // R10.1-GATE-017. This cell previously documented the OPPOSITE: the guard was
  // evaluated only over the paths a call site happened to declare, so a delete
  // declaring `sales` alone was not invalidated by a concurrent `date` change and
  // committed. Codex reproduced the general form of that hole (a concurrent
  // `supplier_payments` change erased with the row). The precondition is now the
  // complete canonical row, so the same schedule aborts and the edited record lives.
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const pEdit = A.upsert("2026-08-01", {}, { byId: ID1, newDate: "2026-08-09" });
  const pDel = B.del("2026-08-01", { byId: ID1 });
  const [rEdit, rDel] = await Promise.all([pEdit, pDel]);
  await settleAll();
  assert.ok(COMMITTED(rEdit.status), "the date edit committed");
  assert.equal(rDel.status, "conflict", "the delete is refused — its base row no longer matches what is stored");
  assert.deepEqual(plain(rDel.conflictPaths), ["date"], "and it names exactly what moved");
  exact(remote, [{ ...day("2026-08-01", 100), date: "2026-08-09" }, day("2026-08-02", 200), day("2026-08-03", 300)],
    "every row survives");
});

test("[concurrency] C-11: transaction-callback RE-EXECUTION for a date edit — rebased on the fresher value, no duplicate effect", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  // Another writer lands mid-transaction, forcing a genuine CAS re-run.
  remote.interleave(() => remote.setRowsDirect([day("2026-08-01", 100), { ...day("2026-08-02", 200), sales: 222 }, day("2026-08-03", 300)]));
  const ra = await A.upsert("2026-08-01", {}, { newDate: "2026-08-09" });
  await settleAll();
  assert.ok(COMMITTED(ra.status), `the date edit committed after re-execution (${ra.status})`);
  assert.ok(ra.runs >= 2, `the callback genuinely re-executed (runs=${ra.runs})`);
  exact(remote, [{ ...day("2026-08-01", 100), date: "2026-08-09" }, { ...day("2026-08-02", 200), sales: 222 }, day("2026-08-03", 300)],
    "the interleaved writer's edit survived and the date edit applied exactly once");
  assert.equal(remote.rows().length, 3, "no duplicate physical row from the re-execution");
});

// ── Three physically distinct destinations for the transition cells ──────────
// Distinct ids, overlapping dates, distinct values, non-sorted order and distinct
// unknown fields, so aliasing between destinations cannot false-green any equality.
const D_T1A = () => [
  { id: mkId("x-t1a-02"), date: "2026-08-02", sales: 1002, deliveries: 0, other_income: 0, note_t1a: "alpha" },
  { id: mkId("x-t1a-01"), date: "2026-08-01", sales: 1001, deliveries: 7, other_income: 0 },
];
const D_T1B = () => [
  { id: mkId("x-t1b-01"), date: "2026-08-01", sales: 2001, deliveries: 0, other_income: 3, tag_t1b: { k: "beta" } },
  { id: mkId("x-t1b-09"), date: "2026-08-09", sales: 2009, deliveries: 0, other_income: 0 },
];
const D_T2A = () => [
  { id: mkId("x-t2a-03"), date: "2026-08-03", sales: 3003, deliveries: 0, other_income: 0, legacy_t2a: 42 },
];
const D_T2B = () => [
  { id: mkId("x-t2b-07"), date: "2026-08-07", sales: 4007, deliveries: 1, other_income: 0 },
  { id: mkId("x-t2b-04"), date: "2026-08-04", sales: 4004, deliveries: 0, other_income: 0, extra_t2b: ["z"] },
];
// All FOUR destinations the transition cells can address, each seeded with a distinct
// exact state so any aliasing between them is observable.
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
const ROW_T1A_01 = mkId("x-t1a-01");
// T1/A after the in-flight date edit lands (in place, order preserved).
const D_T1A_AFTER = () => [D_T1A()[0], { ...D_T1A()[1], date: "2026-08-19" }];

// C-12 changes BOTH tenant and business, so it is a physical destination transition
// and is asserted as one. (Owner alone is not an RTDB storage axis; the storage axes
// are tenantId and the `biz:${bizId}:entries` key.)
const DEST_TRANSITIONS = [
  { id: "C-12", label: "OWNER change that is also a TENANT+BUSINESS change (T1/A → T2/B)",
    to: { tenantId: "T2", bizId: "B" }, toRows: D_T2B,
    others: [["T1", "B"], ["T2", "A"]] },
  { id: "C-17", label: "BUSINESS change (T1/A → T1/B)",
    to: { tenantId: "T1", bizId: "B" }, toRows: D_T1B,
    others: [["T2", "A"], ["T2", "B"]] },
  { id: "C-18", label: "TENANT change (T1/A → T2/A)",
    to: { tenantId: "T2", bizId: "A" }, toRows: D_T2A,
    others: [["T1", "B"], ["T2", "B"]] },
];
for (const t of DEST_TRANSITIONS) {
  test(`[concurrency] ${t.id}: ${t.label} during an in-flight DATE mutation — the write stays bound to its CAPTURED destination`, async () => {
    const svc = fourDestinations();
    const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
    const oldCtx = A.listenerCtx;
    const genBefore = A.lane._state().gen;
    // Exact initial state of the old, the new and the sentinel destinations.
    expect4(svc, D_T1A(), D_T1B(), D_T2A(), D_T2B(), "exact initial four-destination state");
    assert.deepEqual(plain(A.desired()), plain(D_T1A()), "the client hydrated its OWN destination exactly");

    const gate = svc.at("T1", "A").holdNext(`${t.id}-inflight`);
    const p = A.upsert("2026-08-01", {}, { byId: ROW_T1A_01, newDate: "2026-08-19" });
    await tick();
    const appliedBefore = A.applied.length;
    A.switchTo(t.to.tenantId, t.to.bizId, { attach: false });   // retire lane, drop the old listener
    assert.notEqual(A.lane._state().gen, genBefore, "a new lane generation was installed");
    assert.deepEqual(plain(A.destination()), { tenantId: t.to.tenantId, key: entriesKey(t.to.bizId) },
      "the client now addresses the NEW physical destination");
    gate.release();
    const r = await p;
    await settleAll();

    assert.ok(COMMITTED(r.status), `the held write completed against its captured destination (${r.status})`);
    // The transaction captured the OLD tenant/key and used only that destination.
    assert.deepEqual(plain(svc.at("T1", "A").log()),
      [{ tenantId: "T1", key: "biz:A:entries", runs: 1, committed: true }],
      "the transaction log records the exact captured tenantId and key");
    assert.deepEqual(plain(svc.at(t.to.tenantId, t.to.bizId).log()), [], "no transaction was attempted at the NEW destination");
    t.others.forEach(([tn, bz]) => assert.deepEqual(plain(svc.at(tn, bz).log()), [], `no transaction was attempted at ${tn}/${bz}`));
    assert.equal(svc.allLogs().length, 1, "exactly one transaction across the whole service");
    // Exact final state of ALL destinations: only the captured one moved.
    expect4(svc, D_T1A_AFTER(), D_T1B(), D_T2A(), D_T2B(),
      "only the CAPTURED destination was mutated; the new and sentinel destinations are byte-intact");

    // The old acknowledgement did not enter the new lane.
    assert.equal(A.applied.length, appliedBefore, "the old result applied no rows into the new selection");
    assert.equal(A.lane._state().desired, null, "the new lane is fresh");
    assert.equal(A.lane.isHydrated(), false, "and unhydrated before its own listener");
    assert.equal(A.lane._state().ownPending, 0, "no own-echo marker from the old destination survived the transition");

    // An old-destination listener payload is rejected as stale and applies nothing.
    const stale = A.lane.onListenerEcho(D_T1A_AFTER(), oldCtx);
    assert.equal(stale.status, "stale", "the old listener payload cannot mutate the new destination");
    assert.equal(A.applied.length, appliedBefore, "and it applied nothing");
    assert.equal(A.lane.isHydrated(), false, "the new lane is still unhydrated");
    assert.equal(A.lane._state().desired, null);

    // The NEW destination's own listener then hydrates it with exactly its own value.
    A.attach(); A.pull();
    assert.equal(A.lane.isHydrated(), true, "the new destination hydrated from its OWN listener");
    assert.deepEqual(plain(A.desired()), plain(t.toRows()), "with exactly its own authoritative value");
    assert.notDeepEqual(plain(A.desired()), plain(D_T1A_AFTER()), "no old-destination payload was consumed");
    expect4(svc, D_T1A_AFTER(), D_T1B(), D_T2A(), D_T2B(), "hydrating the new destination mutated nothing");
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// C-13 … C-16 — CONFLICT, REBASE, RETRY, ABORT, REJECTION, EXHAUSTION
// ═══════════════════════════════════════════════════════════════════════════

test("[concurrency] C-13: rebase after a conflict — only a genuine rebase against authoritative state may commit", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  B.detach();                                                   // B's screen has not received the update
  const pa = A.upsert("2026-08-01", { sales: 111 }, { byId: ID1 });
  const pb = B.upsert("2026-08-01", { sales: 222 }, { byId: ID1 });
  const [ra, rb] = await Promise.all([pa, pb]);
  await settleAll();
  assert.ok(COMMITTED(ra.status));
  assert.equal(rb.status, "conflict");
  assert.deepEqual(plain(rb.conflictPaths), ["sales"]);
  exact(remote, [{ ...day("2026-08-01", 100), sales: 111 }, day("2026-08-02", 200), day("2026-08-03", 300)]);
  // Re-submitting WITHOUT rebasing must conflict again — a retry is not a rebase.
  const rbAgain = await B.upsert("2026-08-01", { sales: 222 }, { byId: ID1 });
  await settleAll();
  assert.equal(rbAgain.status, "conflict", "a blind retry of a stale-base edit still fails closed");
  assert.equal(valueAt(remote.rows(), "2026-08-01"), 111, "still no overwrite");
  // Now rebase against authoritative state.
  B.pull();
  const rbRebased = await B.upsert("2026-08-01", { sales: 222 }, { byId: ID1 });
  await settleAll();
  assert.ok(COMMITTED(rbRebased.status), `the re-based edit committed (${rbRebased.status})`);
  exact(remote, [{ ...day("2026-08-01", 100), sales: 222 }, day("2026-08-02", 200), day("2026-08-03", 300)]);
});

test("[concurrency] C-14: retries EXHAUSTED under permanent contention — fails closed, never a false success", async () => {
  const remote = makeRemote(history());
  remote.state.maxRetries = 3;
  const A = makeClient(remote, "A").attach().pull();
  let bump = 0;
  // A different writer lands on EVERY attempt, so the CAS check never succeeds.
  remote.interleaveOnEveryAttempt(() => { bump++; remote.setRowsDirect([day("2026-08-01", 100), day("2026-08-02", 200), { ...day("2026-08-03", 300), sales: 300 + bump }]); });
  const ra = await A.upsert("2026-08-01", { sales: 111 });
  await settleAll();
  remote.interleaveOnEveryAttempt(null);
  assert.equal(ra.status, "failed", "exhausted retries surface as a failure");
  assert.notEqual(ra.status, "committed", "never ordinary success");
  assert.notEqual(ra.status, "committed_idempotent", "never idempotent success");
  assert.equal(ra.error, "not_committed", "the transport reported a non-commit, not a phantom write");
  assert.equal(valueAt(remote.rows(), "2026-08-01"), 100, "ZERO unintended remote mutation from the exhausted operation");
  assert.equal(remote.rows().length, 3, "no row added or lost");
});

test("[concurrency] C-15: transport REJECTION — failed, zero mutation, and a later retry commits normally", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  remote.failNextTransports(1);
  const ra = await A.upsert("2026-08-01", { sales: 111 });
  await settleAll();
  assert.equal(ra.status, "failed");
  assert.equal(ra.error, "transport_failed");
  exact(remote, history(), "a rejected transport mutates nothing");
  // Another client commits in between; A's retry must rebase, not overwrite.
  const rb = await B.upsert("2026-08-02", { sales: 222 });
  await settleAll();
  assert.ok(COMMITTED(rb.status));
  const raRetry = await A.upsert("2026-08-01", { sales: 111 });
  await settleAll();
  assert.ok(COMMITTED(raRetry.status), `the retry committed (${raRetry.status})`);
  exact(remote, [{ ...day("2026-08-01", 100), sales: 111 }, { ...day("2026-08-02", 200), sales: 222 }, day("2026-08-03", 300)],
    "the retry preserved the other client's acknowledged write");
});

test("[concurrency] C-16: convergent edits ABORT as idempotent, not as conflicts, and perform no remote write", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  A.detach();                                                   // A keeps its stale view
  const rb = await B.upsert("2026-08-01", { sales: 555 }, { byId: ID1 });
  await settleAll();
  assert.ok(COMMITTED(rb.status));
  const versionAfterB = remote.version();
  // A edits the same field to the SAME value from a stale base: the desired state is
  // already present, so this is idempotent — not a conflict and not a write.
  const ra = await A.upsert("2026-08-01", { sales: 555 }, { byId: ID1 });
  await settleAll();
  assert.equal(ra.status, "committed_idempotent", "already-at-desired-value is idempotent success");
  assert.equal(ra.reason, "already_applied", "and it reports precisely why");
  assert.equal(remote.version(), versionAfterB, "no remote write was performed");
  exact(remote, [{ ...day("2026-08-01", 100), sales: 555 }, day("2026-08-02", 200), day("2026-08-03", 300)]);
});

test("[concurrency] C-16b: an EMPTY patch (nothing actually changed) aborts as idempotent with zero remote write", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const v0 = remote.version();
  const ra = await A.upsert("2026-08-01", { sales: 100 }, { byId: ID1 });   // identical to the hydrated value
  await settleAll();
  assert.equal(ra.status, "committed_idempotent");
  // R10-GATE-011: `empty_patch` (the client computed no diff) and `already_applied`
  // (the remote genuinely holds the desired value) are materially different meanings
  // of "nothing to write". Collapsing them is exactly how the R9 date-edit bug
  // reported success while nothing moved, so the caller must be able to tell them
  // apart.
  assert.equal(ra.reason, "empty_patch");
  assert.equal(remote.version(), v0, "no remote write");
  exact(remote, history(), "the node is byte-identical");
});

test("[negative-control] C-16c: an ORDINARY commit carries no idempotency reason — the classification is not fabricated", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const ra = await A.upsert("2026-08-01", { sales: 111 }, { byId: ID1 });
  await settleAll();
  assert.equal(ra.status, "committed", "a genuine write is not idempotent success");
  assert.equal(ra.reason, undefined, "no idempotency reason is invented for a real commit");
  assert.ok(Array.isArray(ra.rows), "a real commit returns the committed rows");
  assert.deepEqual(plain(remote.allLogs()), [{ tenantId: "T1", key: "biz:A:entries", runs: 1, committed: true }],
    "exactly one committing transaction, at the declared destination");
});

// ═══════════════════════════════════════════════════════════════════════════
// C-17 … C-19 — OWNER / BUSINESS / GENERATION TRANSITIONS
// ═══════════════════════════════════════════════════════════════════════════

// C-19 is a SAME-DESTINATION case: a new generation of (T1, biz:A:entries). Generation
// is a LOCAL ordering/ownership device, not an RTDB storage axis, so this cell proves
// lane and generation isolation WITHOUT pretending a new node exists.
test("[concurrency] C-19: GENERATION change on the SAME destination — lane isolation without a new physical node", async () => {
  const svc = fourDestinations();
  const A = makeClient(svc, "A", { tenantId: "T1", bizId: "A" }).attach().pull();
  const oldCtx = A.listenerCtx;
  const genBefore = A.lane._state().gen;
  const gate = svc.at("T1", "A").holdNext("C-19-inflight");
  const p = A.upsert("2026-08-01", { sales: 1111 }, { byId: ROW_T1A_01 });
  await tick();
  const appliedBefore = A.applied.length;
  A.switchTo("T1", "A", { attach: false });                    // same tenant AND business, new generation
  assert.notEqual(A.lane._state().gen, genBefore, "a new lane generation was installed");
  assert.deepEqual(plain(A.destination()), { tenantId: "T1", key: "biz:A:entries" },
    "the physical destination is UNCHANGED — only the generation moved");
  gate.release();
  const r = await p;
  await settleAll();
  assert.ok(COMMITTED(r.status), `the old-generation write settled (${r.status})`);
  const afterRows = [D_T1A()[0], { ...D_T1A()[1], sales: 1111 }];
  expect4(svc, afterRows, D_T1B(), D_T2A(), D_T2B(), "the same destination received the write; the others are byte-intact");
  assert.deepEqual(plain(svc.at("T1", "A").log()), [{ tenantId: "T1", key: "biz:A:entries", runs: 1, committed: true }]);
  // Local isolation: the retired generation's result cannot populate the new lane.
  assert.equal(A.applied.length, appliedBefore, "the old-generation result never touched the new generation's UI");
  assert.equal(A.lane._state().desired, null, "the new-generation lane state is fresh");
  assert.equal(A.lane.isHydrated(), false, "the new generation must hydrate for itself");
  assert.equal(A.lane._state().ownPending, 0, "the retired generation's marker did not survive");
  assert.equal(A.lane.onListenerEcho(afterRows, oldCtx).status, "stale",
    "a callback carrying the retired generation's context cannot mutate the active lane");
  // The new generation hydrates from the SAME node, and that is the whole difference.
  A.attach(); A.pull();
  assert.equal(A.lane.isHydrated(), true);
  assert.deepEqual(plain(A.desired()), plain(afterRows), "hydrated with the same destination's current value");
});

// ═══════════════════════════════════════════════════════════════════════════
// C-20 … C-22 — ORDERING PERMUTATIONS AND MULTI-WRITER SCHEDULES
// ═══════════════════════════════════════════════════════════════════════════

for (const order of ORDERS) {
  test(`[concurrency] C-20 (${order}): same-field conflicting edits — exactly one commits and the value that stands is the one that landed first`, async () => {
    const remote = makeRemote(history());
    const A = makeClient(remote, "A").attach().pull();
    const B = makeClient(remote, "B").attach().pull();
    // Both intents are built from the same hydrated base; submission order alone
    // decides which transaction reaches the node first.
    let pFirst, pSecond, firstVal;
    if (order === "A_then_B") { pFirst = A.upsert("2026-08-01", { sales: 111 }, { byId: ID1 }); firstVal = 111; pSecond = B.upsert("2026-08-01", { sales: 222 }, { byId: ID1 }); }
    else { pFirst = B.upsert("2026-08-01", { sales: 222 }, { byId: ID1 }); firstVal = 222; pSecond = A.upsert("2026-08-01", { sales: 111 }, { byId: ID1 }); }
    const [first, second] = await Promise.all([pFirst, pSecond]);
    await settleAll();
    assert.ok(COMMITTED(first.status), "exactly one edit committed");
    assert.equal(second.status, "conflict", "the other fails closed — no last-writer-wins");
    assert.deepEqual(plain(second.conflictPaths), ["sales"]);
    assert.equal(second.rows, undefined, "a conflict returns no committed rows");
    exact(remote, [{ ...day("2026-08-01", 100), sales: firstVal }, day("2026-08-02", 200), day("2026-08-03", 300)],
      "the committed value is exactly the one that landed first");
  });
}

test("[concurrency] C-21: three independent writers on DISJOINT fields of ONE row — all three survive", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const C = makeClient(remote, "C").attach().pull();
  const ra = await A.upsert("2026-08-01", { sales: 111 });
  const rb = await B.supplier("2026-08-01", "sup-1", "50");
  const rc = await C.upsert("2026-08-01", { payroll: "80" });
  await settleAll();
  assert.ok(COMMITTED(ra.status) && COMMITTED(rb.status) && COMMITTED(rc.status), `${ra.status}/${rb.status}/${rc.status}`);
  exact(remote, [{ ...day("2026-08-01", 100), sales: 111, supplier_payments: { "sup-1": "50" }, payroll: "80" },
                 day("2026-08-02", 200), day("2026-08-03", 300)],
    "revenue, food cost and labour are three independent absolute paths on one row");
});

test("[concurrency] C-22: a listener echo interleaved between two independent writers cannot regress the authoritative node", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const B = makeClient(remote, "B").attach().pull();
  const ra = await A.upsert("2026-08-01", { sales: 111 });
  await settleAll();
  // B receives A's committed value as an ordinary remote payload (B has no pending
  // local work), then edits a different row from that fresh base.
  B.pull();
  assert.equal(valueAt(B.lane._state().desired, "2026-08-01"), 111, "B converged on A's committed value");
  const rb = await B.upsert("2026-08-02", { sales: 222 });
  await settleAll();
  assert.ok(COMMITTED(ra.status) && COMMITTED(rb.status));
  exact(remote, [{ ...day("2026-08-01", 100), sales: 111 }, { ...day("2026-08-02", 200), sales: 222 }, day("2026-08-03", 300)]);
  assert.deepEqual(plain(A.view()), plain(remote.rows()), "A's local converged state equals the authoritative node");
  assert.deepEqual(plain(B.view()), plain(remote.rows()), "B's local converged state equals the authoritative node");
});

test("[concurrency] C-23: a write that fails cannot apply its financial value locally", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const before = plain(A.view());
  remote.failNextTransports(1);
  const ra = await A.upsert("2026-08-01", { sales: 999999 });
  await settleAll();
  assert.equal(ra.status, "failed");
  assert.deepEqual(plain(A.view()), before, "no un-committed financial value was ever rendered");
  exact(remote, history(), "and nothing was written");
});

// ═══════════════════════════════════════════════════════════════════════════
// NEGATIVE CONTROLS — the harness must be able to observe the failures it claims
// ═══════════════════════════════════════════════════════════════════════════

test("[negative-control] C-N1: an id-less row in the authoritative node fails EVERY ordinary mutation closed", async () => {
  const remote = makeRemote([{ date: "2026-08-01", sales: 100 }, day("2026-08-02", 200)]);
  const A = makeClient(remote, "A").attach().pull();
  assert.equal(A.lane._state().identityRequired, true, "the lane refuses to write against an id-less node");
  const r = await A.upsert("2026-08-02", { sales: 222 });
  await settleAll();
  assert.equal(r.status, "blocked_entry_identity_required");
  assert.equal(remote.allLogs().length, 0, "NO transaction was dispatched at ANY destination");
  exact(remote, [{ date: "2026-08-01", sales: 100 }, day("2026-08-02", 200)], "zero mutation, and no automatic identity adoption");
});

test("[negative-control] C-N2: identity is never derived from date, position, content or fingerprint", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  // Two rows share a business date; a date-addressed edit is structurally impossible,
  // so an intent must carry the id of exactly ONE of them.
  const twin = { id: mkId("twin"), date: "2026-08-01", sales: 100, deliveries: 0, other_income: 0 };
  await A.create(twin); await settleAll(); A.pull();
  const rAmbiguous = await A.submit({ type: "upsert_entry", target: { id: "2026-08-01" },
    patch: { fields: { sales: 1 } }, base: { fields: { sales: 100 } } });
  await settleAll();
  assert.equal(rAmbiguous.status, "blocked");
  assert.equal(rAmbiguous.reason, "invalid_identity", "a date is not an identity");
  exact(remote, [...history(), twin], "zero mutation");
  // Identical content, different ids: the fingerprint cannot select a target either.
  const r1 = await A.upsert("2026-08-01", { sales: 7 }, { byId: ID1 });
  await settleAll();
  assert.ok(COMMITTED(r1.status));
  assert.equal(rowById(remote.rows(), twin.id).sales, 100, "the identical-content sibling was NOT touched");
  assert.equal(rowById(remote.rows(), ID1).sales, 7);
});

test("[negative-control] C-N5: an intent that tries to rewrite `id` is refused — one physical row, one immutable identity", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const r = await A.submit({ type: "upsert_entry", target: { id: ID1 },
    patch: { fields: { id: mkId("hijack") } }, base: { fields: { id: ID1 } } });
  await settleAll();
  assert.equal(r.status, "blocked");
  assert.equal(r.reason, "invalid_identity");
  assert.equal(r.detail, "id_is_immutable", "the precise reason reaches the caller");
  exact(remote, history(), "zero mutation — an id can never be reused or rewritten by an ordinary edit");
  // And a legitimate edit on the same row leaves the id exactly as it was.
  const ok = await A.upsert("2026-08-01", { sales: 111 }, { byId: ID1 });
  await settleAll();
  assert.ok(COMMITTED(ok.status));
  assert.equal(rowById(remote.rows(), ID1).id, ID1);
});

test("[negative-control] C-N6: malformed and duplicate ids in the authoritative node fail EVERY ordinary mutation closed", async () => {
  // malformed id
  const bad = [{ id: "not-a-uuid", date: "2026-08-01", sales: 100 }, day("2026-08-02", 200)];
  const remoteA = makeRemote(bad);
  const A = makeClient(remoteA, "A").attach().pull();
  const rA = await A.upsert("2026-08-02", { sales: 222 }, { byId: ID2 });
  await settleAll();
  assert.equal(rA.status, "blocked");
  assert.equal(rA.reason, "malformed_remote");
  exact(remoteA, bad, "zero mutation, and no silent repair of the malformed id");
  // duplicate id
  const shared = mkId("dupC");
  const dupes = [{ ...day("2026-08-01", 100), id: shared }, { ...day("2026-08-02", 200), id: shared }];
  const remoteB = makeRemote(dupes);
  const B = makeClient(remoteB, "B").attach().pull();
  const rB = await B.upsert("2026-08-01", { sales: 111 }, { byId: shared });
  await settleAll();
  assert.equal(rB.status, "blocked");
  assert.equal(rB.reason, "duplicate_id");
  exact(remoteB, dupes, "zero mutation, and no ambiguous first-match resolution");
});

test("[negative-control] C-N3: the watchdog reports an operation left physically in flight", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const gate = remote.holdNext("deliberately-held");
  const p = A.upsert("2026-08-01", { sales: 111 });
  await assert.rejects(() => p, /never settled after 60 deterministic ticks[\s\S]*deliberately-held/,
    "an un-released transaction fails ITS OWN test deterministically instead of hanging");
  gate.release();
  await settleAll();
});

test("[negative-control] C-N4: a sentinel schedule after the deliberately stranded one still executes", async () => {
  const remote = makeRemote(history());
  const A = makeClient(remote, "A").attach().pull();
  const r = await A.upsert("2026-08-01", { sales: 111 });
  await settleAll();
  assert.ok(COMMITTED(r.status), "the cancellation cascade cannot recur silently");
  exact(remote, [{ ...day("2026-08-01", 100), sales: 111 }, day("2026-08-02", 200), day("2026-08-03", 300)]);
});
