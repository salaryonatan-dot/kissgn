// Builder–Delivery ACCEPTANCE fixture (preparation; review-only). It asserts the contract as WRITTEN today:
//   docs/BUILDER_DELIVERY_CONTRACT.md (Builder R3 b9e4e6e7: G1–G9, X1–X3) and the delivery route's run-outcome contract
//   (api/daily-snapshot/run.ts, Email R4 cdb74e4d: settle(), completed / completed_with_failures / incomplete).
// It invents NO HTTP mapping, retry policy, recipient fallback or reconciliation authority: where the contract leaves a
// decision open the assertion is the weakest statement every admissible decision satisfies, and the scenario is tagged
// [DECISION-<id>] (see UNRESOLVED_DECISIONS.md).
//
// It drives the REAL route → REAL builder → REAL sender → REAL receipt module through test/support/daily-email-harness.mjs.
// Only the terminal seams are replaced (in-memory RTDB, token verifier, a scripted fake SMTP provider). Failure injection is
// done at the DATA layer (a refused read of one business's entries / of the tenant list / of the registry node) and at the
// PROVIDER (scripted nodemailer outcome); the route-to-builder accounting path is never mocked.
//
// Running it on an EXISTING tree shows the CURRENT behaviour: on Email R4 alone (lossy buildSnapshotForAll) and on the
// review-only harness (Builder R3 + Email R4 files, route unchanged) the build-failure scenarios FAIL — that is the evidence
// for the open gates DR1-C1 / X1–X3 / G1–G10. Those runs are preparation evidence; they approve nothing.
//   S1  one business build fails, the other succeeds                       (X1, G1, G3, G6)
//   S2  every business build fails                                         (X2, G1, G3)
//   S3  registry discovery fails (tenant list unreadable; index unreadable) (X3, G2)
//   S4  provider accepted, the receipt read-back / finalization fails       (delivery contract D1; unchanged by integration)
//   S5  manual POST targets an ambiguous business                           (G10)  [DECISION-G10]
//   S6  manual POST meets unreadable registry data                          (G10)  [DECISION-G10]
//   S7  two colliding tenant/business pairs stay isolated                   (M1 R4 blocker class; builder R3 pair key)
//   S8  provider acceptance unknown after sending began                     (delivery E1; unchanged)
//   S9  a later invocation cannot resend an unresolved send                 (delivery D1/E1; unchanged)
//   S10 a build-failed business is distinguished from an unknown send       (G3 + delivery)
//   C0  controls: clean two-business run; clean zero-eligible run           (contract "may complete")
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, captureConsole, RECEIPTS, T, B, B2 } from "../support/daily-email-harness.mjs";

const { route, import: imp } = await buildSandbox();
const SB = await imp("src/snapshot/snapshotBuilder.js");
const HAS_RUN = typeof SB.buildSnapshotRun === "function";          // Builder R3 trees expose the structured result; Email R4 alone does not
const AT = Date.UTC(2026, 8, 8, 4, 5);
const DATE = "2026-09-08";
const LEASE = 10 * 60 * 1000;
// INTEGRATION I1 fixture correction (TEST_CONTRACT_TRANSITION.md): the in-memory store's read() returns null for EVERY absent
// path (tools/storage-v2/reader-sandbox.mjs makeDb getAt, unchanged since 875fe9c); the preparation fixture compared absence
// with `undefined`, a value read() can never return, so its no-receipt assertions (S1, S2, S10) were unreachable on the trees
// it was written against (they failed earlier). Absence is now asserted as `null`: any receipt node still fails them.
const receipt = (t, b) => globalThis.__DB.read(`${RECEIPTS}/${t}/${b}/${DATE}`);
async function at(ms, fn) { const u = freezeClock(ms); try { return await fn(); } finally { u(); } }
const cron = (ms = AT) => at(ms, () => runCron(route));
const rows = (r) => Object.fromEntries(r.body.results.map((x) => [x.tenantId + "/" + x.bizId, x]));
const SECRET = "private@example.test";                                  // a would-be leak marker inside injected errors
/** refuse the read of one business's authoritative entries (the build of that business fails; nothing else is touched) */
const failEntries = (db, t, b) => { const r = db.ref; db.ref = (p, q) => { const x = r(p, q); return p === `tenants/${t}/biz:${b}:entries` ? { ...x, once: async () => { throw new Error(SECRET); } } : x; }; };
const failPath = (db, path) => { const r = db.ref; db.ref = (p, q) => { const x = r(p, q); return p === path ? { ...x, once: async () => { throw new Error(SECRET); } } : x; }; };
function assertPrivate(text, label) {
  assert.ok(!text.includes(SECRET), label + ": injected error text never reaches a response or log");
  assert.ok(!/owner-[ab]@example\.test|viewer-a@example\.test/.test(text), label + ": no recipient address in a response or log");
}
/** every failed-build row of the contract (G3): outcome failed, a bounded code, settlement failed, no receipt */
function assertFailedBuildRow(row, label) {
  assert.ok(row, label + ": the failed business is accounted for as a row");
  assert.deepEqual([row.outcome, row.settlement], ["failed", "failed"], label + ": failed / failed");
  assert.match(String(row.code), /^[a-z][a-z0-9_]{0,63}$/, label + ": bounded code");
  assert.ok(["snapshot_build_failed", "business_name_unavailable", "ambiguous_business_identity"].includes(row.code), label + ": a builder failure code");
  assert.equal(row.businessDate, DATE, label + ": the run business date (G6)");
}

test("S1 one business build fails while the other succeeds: incomplete run, the failed pair accounted, the other delivered once", async () => {
  const db = seedWorld({ withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  failEntries(db, T, B2);
  const { value: r, lines } = await captureConsole(() => cron());
  assert.notEqual(r.statusCode, 200, "a failed build is never a clean run (DR1-C1)");
  assert.equal(r.statusCode, 500, "a failed row ⇒ completed_with_failures (route contract)");
  assert.equal(r.body.status, "completed_with_failures");
  const x = rows(r);
  assert.deepEqual([x[`${T}/${B}`]?.settlement, x[`${T}/${B}`]?.outcome], ["delivered", "accepted"], "the healthy business is delivered");
  assertFailedBuildRow(x[`${T}/${B2}`], "S1");
  assert.equal(x[`${T}/${B2}`].code, "snapshot_build_failed");
  assert.equal(smtp.calls.length, 1, "exactly one provider call (nothing is sent for the failed build)");
  assert.equal(receipt(T, B)?.state, "accepted");
  assert.equal(receipt(T, B2), null, "no receipt is created for a failed build (G6)");
  assert.equal(r.body.failureCount, 1);
  assertPrivate(JSON.stringify(r.body) + lines.join("\n"), "S1");
  // the stale snapshot keeps its own date; the failure row carries the run date
  assert.equal(x[`${T}/${B}`].businessDate, DATE);
});

test("S2 every business build fails: incomplete run, every pair accounted, no provider call, no receipt", async () => {
  const db = seedWorld({ withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  failEntries(db, T, B); failEntries(db, T, B2);
  const { value: r, lines } = await captureConsole(() => cron());
  assert.equal(r.statusCode, 500); assert.equal(r.body.status, "completed_with_failures");
  const x = rows(r);
  assertFailedBuildRow(x[`${T}/${B}`], "S2 bizA"); assertFailedBuildRow(x[`${T}/${B2}`], "S2 bizB");
  assert.equal(r.body.results.length, 2, "both expected identities are rows");
  assert.equal(smtp.calls.length, 0);
  assert.equal(receipt(T, B), null); assert.equal(receipt(T, B2), null);
  assertPrivate(JSON.stringify(r.body) + lines.join("\n"), "S2");
});

test("S3 registry discovery fails: incomplete run even with zero known businesses (G2), no provider call", async () => {
  for (const [label, path] of [["tenant list unreadable", "tenants"], ["index unreadable", "proactive_biz_index"]]) {
    const db = seedWorld({ withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    failPath(db, path);
    const { value: r, lines } = await captureConsole(() => cron());
    assert.notEqual(r.statusCode, 200, label + ": a failed discovery is never a clean run");
    assert.equal(r.statusCode, 500, label + ": completed_with_failures (G2)");
    assert.equal(r.body.status, "completed_with_failures", label);
    assert.ok(r.body.discovery && r.body.discovery.status === "failed", label + ": the response carries the builder's discovery status (G2)");
    assert.ok(Array.isArray(r.body.discovery.failures) && r.body.discovery.failures.length > 0, label + ": discovery failures are listed");
    if (path === "tenants") { assert.equal(r.body.results.length, 0, label + ": zero expected identities"); assert.equal(smtp.calls.length, 0, label); }
    else assert.equal(smtp.calls.length, r.body.results.filter((x) => x.settlement === "delivered").length, label + ": the registry-known businesses may still be delivered; the run stays incomplete");
    assertPrivate(JSON.stringify(r.body) + lines.join("\n"), "S3 " + label);
  }
});

test("S4 the provider accepted but the receipt read-back / finalization failed: never completed, never re-sent (delivery D1)", async () => {
  // interpretation: "daily summary read-back" = the receipt finalization after the provider answered (DE-09 / DR1-04); see
  // UNRESOLVED_DECISIONS.md N1 for the alternative reading
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  // injection: the finalization transaction (the receipt is in state "sending") fails once; the store is healthy afterwards
  const ref = db.ref; let failFinal = true;
  db.ref = (p, q) => { const x = ref(p, q); return p.startsWith(RECEIPTS) ? { ...x, transaction: async (fn) => { if (failFinal && db.read(p)?.state === "sending") throw new Error(SECRET); return x.transaction(fn); } } : x; };
  const { value: r1, lines } = await captureConsole(() => cron());
  assert.equal(smtp.calls.length, 1);
  assert.equal(r1.statusCode, 500, "unrecorded acceptance ⇒ completed_with_failures");
  assert.equal(rows(r1)[`${T}/${B}`].settlement, "unrecorded");
  failFinal = false;                                              // the store is healthy again
  const r2 = await cron(AT + 60_000);                             // within the lease: the claim is still held
  assert.equal(r2.statusCode, 503); assert.equal(rows(r2)[`${T}/${B}`].settlement, "pending");
  const r3 = await cron(AT + 2 * LEASE);                          // after the lease: unknown, never re-sent
  assert.equal(r3.statusCode, 500); assert.equal(rows(r3)[`${T}/${B}`].settlement, "unknown");
  assert.equal(smtp.calls.length, 1, "exactly one provider hand-off across three invocations");
  assertPrivate(JSON.stringify([r1.body, r2.body, r3.body]) + lines.join("\n"), "S4");
});

test("S5 manual POST targets an ambiguous business: no send, no financial figures, a bounded refusal [DECISION-G10: exact status]", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, { _v: JSON.stringify([{ id: B, name: "מסעדה א" }, { id: B, name: "מסעדה א (twin)" }]) });
  const { value: r, lines } = await captureConsole(() => runManual(route));
  assert.ok(r.statusCode >= 400, "never a success");
  assert.equal(smtp.calls.length, 0, "no provider call for an ambiguous identity");
  assert.equal(r.body.snapshot, undefined, "no financial figures are returned");
  assert.ok(!JSON.stringify(r.body).includes("SyntaxError") && !JSON.stringify(r.body).includes(" at "), "no raw error text");
  // the open decision (G10): the contract asks for a BOUNDED, DOCUMENTED refusal naming the builder's reason; today's generic
  // 500 is not that. Recorded, not asserted: see UNRESOLVED_DECISIONS.md
  globalThis.__OBSERVED = { ...(globalThis.__OBSERVED || {}), S5: { http: r.statusCode, body: r.body } };
  assert.ok(typeof r.body.code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(r.body.code), "G10: the refusal names a bounded builder code (ambiguous_business_identity)");
  assertPrivate(JSON.stringify(r.body) + lines.join("\n"), "S5");
});

test("S6 manual POST meets unreadable registry data: no send, no figures, a bounded refusal [DECISION-G10: exact status]", async () => {
  for (const [label, node] of [["raw array", [{ id: B, name: "x" }]], ["undecodable envelope", { _v: "[{\"id\":\"bizA\",\"name\":\"Secret Cafe\"" }], ["present scalar", 0]]) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    db.seed(`tenants/${T}/app/business`, node);
    const { value: r, lines } = await captureConsole(() => runManual(route));
    assert.ok(r.statusCode >= 400, label + ": never a success");
    assert.equal(smtp.calls.length, 0, label + ": no provider call");
    assert.equal(r.body.snapshot, undefined, label);
    assert.ok(!JSON.stringify(r.body).includes("Secret Cafe"), label + ": registry bytes never reach the response");
    assert.ok(typeof r.body.code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(r.body.code), label + ": G10: a bounded refusal code");
    assertPrivate(JSON.stringify(r.body) + lines.join("\n"), "S6 " + label);
  }
});

test("S7 two colliding tenant/business pairs are isolated: both built, both delivered, receipts at distinct paths, both orders", async () => {
  const env = (v) => ({ _v: JSON.stringify(v) });
  const day = (date, n) => ({ id: `de000000-0000-4000-8000-${String(n).padStart(12, "0")}`, date, sales: "1000", supplier_payments: { s1: "300" }, payroll: "200" });
  const days = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"];
  const P1 = ["t|x", "y", "Pipe Tenant"], P2 = ["t", "x|y", "Pipe Business"];
  for (const [label, order] of [["P1 first", [P1, P2]], ["P2 first", [P2, P1]]]) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false });
    db.seed(`tenants/${T}/app/business`, env([]));              // the harness business is out of the way
    for (const [t, b, name] of order) {
      db.seed(`tenants/${t}/biz:${b}:entries`, env(days.map((d, i) => day(d, i + 1)))); db.seed(`tenants/${t}/biz:${b}:config`, env({ businessName: name })); db.seed(`tenants/${t}/biz:${b}:fixed`, env([]));
      db.seed(`tenants/${t}/app/business`, env([{ id: b, name }]));
      db.seed(`tenants/${t}/app/users`, env([{ id: 1, name: "Owner", email: "owner-a@example.test", role: "owner", firebaseUid: "u_owner_a" }]));
    }
    const smtp = installSmtp([SMTP.accept()]);
    const { value: r, lines } = await captureConsole(() => cron());
    const x = rows(r);
    assert.ok(x["t|x/y"] && x["t/x|y"], label + ": both colliding pairs are rows");
    assert.deepEqual([x["t|x/y"].settlement, x["t/x|y"].settlement], ["delivered", "delivered"], label);
    assert.equal(smtp.calls.length, 2, label + ": one provider call per pair");
    assert.deepEqual([globalThis.__DB.read(`${RECEIPTS}/t|x/y/${DATE}`)?.state, globalThis.__DB.read(`${RECEIPTS}/t/x|y/${DATE}`)?.state], ["accepted", "accepted"], label + ": two receipts at distinct paths");
    assert.equal(r.statusCode, 200, label);
    assertPrivate(JSON.stringify(r.body) + lines.join("\n"), "S7 " + label);
  }
});

test("S8 provider acceptance unknown after sending began: unknown, held, one hand-off (delivery E1; unchanged by integration)", async () => {
  for (const [label, ans] of [["socket timeout after DATA", SMTP.socketTimeout()], ["connection closed after DATA", SMTP.closedAfterData()], ["resolved result with an empty envelope", async (m) => ({ messageId: m.messageId, accepted: [m.to], rejected: [], response: "250 2.0.0 OK", envelope: { to: [] } })]]) {
    seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([ans, SMTP.accept()]);
    const r = await cron();
    assert.equal(r.statusCode, 500, label); assert.equal(rows(r)[`${T}/${B}`].settlement, "unknown", label);
    assert.equal(receipt(T, B)?.state, "unknown", label); assert.equal(smtp.calls.length, 1, label);
  }
});

test("S9 a subsequent invocation cannot resend an unresolved send (delivery D1/E1; unchanged by integration)", async () => {
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.socketTimeout(), SMTP.accept()]);
  const r1 = await cron(); const r2 = await cron(AT + 2 * LEASE); const r3 = await cron(AT + 4 * LEASE);
  assert.deepEqual([r1.statusCode, r2.statusCode, r3.statusCode], [500, 500, 500]);
  assert.deepEqual([rows(r2)[`${T}/${B}`].code, rows(r3)[`${T}/${B}`].code], ["unknown_requires_reconciliation", "unknown_requires_reconciliation"]);
  assert.equal(smtp.calls.length, 1, "no automatic resend of an unresolved send, ever");
  assert.equal(receipt(T, B).state, "unknown");
});

test("S10 a build-failed business is distinguished from a business whose send outcome is unknown", async () => {
  const db = seedWorld({ withSecondTenant: false }); const smtp = installSmtp([SMTP.socketTimeout(), SMTP.accept()]);
  failEntries(db, T, B2);                                           // bizB cannot be built; bizA is sent but the outcome is unknown
  const r1 = await cron(); const x1 = rows(r1);
  assert.equal(r1.statusCode, 500);
  assert.deepEqual([x1[`${T}/${B}`].settlement, x1[`${T}/${B}`].outcome], ["unknown", "unknown"], "bizA: an unknown SEND outcome");
  assert.equal(x1[`${T}/${B}`].receipt, "recorded", "bizA: its unknown is durably recorded");
  assertFailedBuildRow(x1[`${T}/${B2}`], "S10 bizB");
  assert.equal(x1[`${T}/${B2}`].code, "snapshot_build_failed", "bizB: a BUILD failure, never a send outcome");
  assert.notEqual(x1[`${T}/${B}`].code, x1[`${T}/${B2}`].code, "the two causes carry different bounded codes");
  assert.deepEqual([r1.body.unknownCount, r1.body.failureCount], [1, 1]);
  assert.equal(receipt(T, B)?.state, "unknown"); assert.equal(receipt(T, B2), null, "a build failure writes no receipt");
  // a later invocation: the unknown send stays held; the failed build is simply attempted again (no receipt bars it)
  const r2 = await cron(AT + 2 * LEASE); const x2 = rows(r2);
  assert.equal(x2[`${T}/${B}`].code, "unknown_requires_reconciliation");
  assertFailedBuildRow(x2[`${T}/${B2}`], "S10 bizB (repeat)");
  assert.equal(smtp.calls.length, 1, "still one provider call in total");
});

test("C0 controls: a clean two-business run completes; a clean zero-eligible run completes with zero rows", async () => {
  seedWorld({ withSecondTenant: false }); let smtp = installSmtp([SMTP.accept()]);
  let r = await cron();
  assert.deepEqual([r.statusCode, r.body.status, smtp.calls.length], [200, "completed", 2]);
  assert.deepEqual(Object.values(rows(r)).map((x) => x.settlement), ["delivered", "delivered"]);
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, { _v: "[]" });
  r = await cron();
  assert.deepEqual([r.statusCode, r.body.status, r.body.results.length, smtp.calls.length], [200, "completed", 0, 0]);
  if (HAS_RUN) assert.ok(!r.body.discovery || r.body.discovery.status === "complete", "a clean empty registry is a complete discovery");
});
