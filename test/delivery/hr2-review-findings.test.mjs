import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, captureConsole, sdkTransactions,
  releasedHoldRecord, HOLD_PATH, T, B } from "../support/daily-email-harness.mjs";
import * as E from "../../lib/emailDelivery.js";
import * as Tool from "../../tools/daily-delivery/hold.mjs";

const DAY = Date.parse("2026-09-08T04:05:00Z"), D = "2026-09-08";
let sb, restore;
before(async () => { sb = await buildSandbox(); restore = freezeClock(DAY); });
after(() => restore?.());
const world = () => { const db = seedWorld(); sdkTransactions(db, "delivery_control"); sdkTransactions(db, E.MANUAL_ATTEMPT_ROOT); return db; };
const held = () => ({ ...releasedHoldRecord(), state: "held", version: 3, log: { ...releasedHoldRecord().log,
  v000000003: { action: "hold", state: "held", version: 3, prevVersion: 2, actor: "review", reason: "local incident", at: DAY - 1000 } } });
const cron = () => captureConsole(() => runCron(sb.route)).then((x) => x.value);

test("HR1-R-01: failed marker and abandoned acknowledgement cannot allow same-day automatic catch-up", async () => {
  for (const failure of ["throw", "pending"]) {
    const db = world(); db.seed(HOLD_PATH, held());
    const ref = db.ref;
    db.ref = (path, query) => {
      const r = ref(path, query);
      return String(path).startsWith(E.HELD_DATES_ROOT) ? { ...r, transaction: () => failure === "throw" ? Promise.reject(new Error("marker down")) : new Promise(() => {}) } : r;
    };
    const smtp = installSmtp([SMTP.accept()]);
    if (failure === "throw") {
      const refused = await cron();
      assert.equal(refused.statusCode, 503);
      assert.equal(refused.body.heldDate, "not_recorded");
    } else {
      const pending = cron();
      assert.equal(await Promise.race([pending.then(() => false), new Promise((resolve) => setTimeout(() => resolve(true), 40))]), true);
    }
    assert.equal(db.read(E.heldDatePath(D)), null);
    db.ref = ref;
    assert.equal((await E.changeDeliveryHold(db, { action: "release", actor: "review", reason: "resume after incident", expectVersion: 3,
      nowMs: DAY + 1 })).ok, true);
    const again = await cron();
    assert.deepEqual([again.statusCode, again.body.code, smtp.calls.length], [503, "held_day", 0]);
    assert.equal(db.read(HOLD_PATH).excludedThrough, D);
  }
});

test("HR1-R-01: release fence is Israel-calendar based and survives G0/G3 refusal and duplicate invocation", async () => {
  const beforeMidnight = Date.parse("2026-12-31T21:59:00Z"); // 23:59 in Israel
  const afterMidnight = Date.parse("2026-12-31T22:01:00Z");  // 00:01 on 2027-01-01 in Israel
  const db = world(); db.seed(HOLD_PATH, held());
  const ref = db.ref;
  db.ref = (path, query) => String(path).startsWith(E.HELD_DATES_ROOT)
    ? { ...ref(path, query), transaction: async () => { throw new Error("marker down"); } } : ref(path, query);
  for (const stage of ["g1", "g0", "g3"]) assert.equal((await E.makeDailyDeliveryGate(db, "2026-12-31") (stage)).open, false);
  db.ref = ref;
  assert.equal((await E.changeDeliveryHold(db, { action: "release", actor: "review", reason: "calendar release", expectVersion: 3,
    nowMs: beforeMidnight })).ok, true);
  assert.equal((await E.readDailyDeliveryGate(db, "2026-12-31")).code, "held_day");
  assert.equal((await E.readDailyDeliveryGate(db, "2027-01-01")).open, true);
  assert.equal((await E.changeDeliveryHold(db, { action: "hold", actor: "review", reason: "new hold", expectVersion: 4, nowMs: afterMidnight })).ok, true);
  assert.equal((await E.changeDeliveryHold(db, { action: "release", actor: "review", reason: "new release", expectVersion: 5, nowMs: afterMidnight })).ok, true);
  assert.equal(db.read(HOLD_PATH).excludedThrough, "2027-01-01");
  assert.equal((await E.readDailyDeliveryGate(db, "2027-01-01")).code, "held_day");
  assert.equal((await E.readDailyDeliveryGate(db, "2027-01-02")).open, true);
});

test("HR1-R-01: an applied release whose acknowledgement is lost still carries the exclusion", async () => {
  const db = world(); db.seed(HOLD_PATH, held()); const ref = db.ref;
  db.ref = (path, query) => path === HOLD_PATH ? { ...ref(path, query), transaction: async (update) => {
    await ref(path, query).transaction(update);
    throw new Error("acknowledgement lost");
  } } : ref(path, query);
  const result = await E.changeDeliveryHold(db, { action: "release", actor: "review", reason: "release with lost acknowledgement", expectVersion: 3, nowMs: DAY });
  assert.equal(result.code, "transaction_failed");
  db.ref = ref;
  assert.equal(db.read(HOLD_PATH).excludedThrough, D);
  assert.equal((await E.readDailyDeliveryGate(db, D)).code, "held_day");
});

test("HR1-R-02: every audit entry and progression is required before scheduled or manual transport", async () => {
  const good = releasedHoldRecord();
  const bad = [
    { schema: 1, state: "released", version: 1, log: { v000000001: { action: "release", state: "released", version: 1 } } },
    ...["actor", "reason", "at", "prevVersion"].map((field) => {
      const copy = structuredClone(good); delete copy.log.v000000002[field]; return copy;
    }),
    { ...good, log: { ...good.log, v000000001: { ...good.log.v000000001, action: "hold" } } },
  ];
  for (const record of bad) {
    assert.equal(E.classifyHoldRecord(record).code, "delivery_hold_unreadable");
    const db = world(); db.seed(HOLD_PATH, record); const smtp = installSmtp([SMTP.accept()]);
    assert.equal((await cron()).statusCode, 503);
    assert.equal((await captureConsole(() => runManual(sb.route))).value.statusCode, 503);
    assert.equal(smtp.calls.length, 0);
  }
});

test("HR1-R-03: malformed drain containers and states abort; C2b needs explicit invocation-receipt cross-check", () => {
  const full = { holdRaw: held(), receiptsRaw: null, manualRaw: null, nowMs: DAY + 3_600_000, maxDurationMs: 300_000,
    inventoryAttested: true, logsAttested: true, invocationReceiptAttested: true, providerAttested: true };
  assert.equal(Tool.drainEvidence(full).verdict, "EVIDENCE_COMPLETE_FOR_OWNER_REVIEW");
  for (const over of [{ receiptsRaw: "bad" }, { receiptsRaw: { tenant: [] } }, { manualRaw: { tenant: { biz: [] } } },
    { manualRaw: { tenant: { biz: { attempt: { state: "lost" } } } } }, { receiptsRaw: { tenant: { biz: { day: { state: "accepted" } } } } }]) {
    const r = Tool.drainEvidence({ ...full, ...over });
    assert.equal(r.verdict, "ABORT_D");
    assert.ok(r.unreadable.receipts.length + r.unreadable.manual.length > 0);
  }
  assert.equal(Tool.drainEvidence({ ...full, invocationReceiptAttested: false }).criteria.C2b_invocations_explained_by_receipts, "not_evaluable");
  assert.equal(Tool.drainEvidence({ ...full, invocationReceiptAttested: false }).verdict, "ABORT_D");
});

test("HR1-R-04: held G1 keeps structured builder failures and discovery without provider or notice writes", async () => {
  for (const path of ["tenants", `tenants/${T}/biz:${B}:entries`]) {
    const db = world(); db.seed(HOLD_PATH, held()); const ref = db.ref;
    db.ref = (p, q) => p === path ? { ...ref(p, q), once: async () => { throw new Error("local read unavailable"); } } : ref(p, q);
    const smtp = installSmtp([SMTP.accept()]); const r = await cron();
    assert.equal(r.statusCode, 500);
    assert.equal(r.body.status, "completed_with_failures");
    assert.ok(r.body.failureCount > 0 || r.body.discovery.status === "failed");
    assert.equal(r.body.results.length, r.body.expectedBusinesses);
    assert.equal(smtp.calls.length, 0);
    assert.equal(db.read("email_delivery/daily_snapshot_notices"), null);
  }
});

test("HR1-R-05: target validation rejects missing, conflicting and named databases before access", () => {
  const project = "demo-marjin-rules", url = `https://${project}.firebaseio.com/`;
  const app = { options: { projectId: project, databaseURL: url } };
  const args = { project, databaseUrl: url, emulatorHost: "127.0.0.1:9000" };
  assert.deepEqual(Tool.verifyTarget(app, args), { ok: false, code: "emulator_env_with_hosted_url" }, "HR2-R-02: the SDK redirects this URL, so the hosted-shaped target must refuse");
  for (const [candidate, options] of [
    [{ options: { projectId: project } }, args],
    [app, { ...args, databaseUrl: null }],
    [{ options: { ...app.options, databaseURL: "https://other-project.firebaseio.com/" } }, args],
    [{ options: { ...app.options, credential: { projectId: "other-project" } } }, args],
    [{ options: { ...app.options, databaseURL: `https://${project}-named.firebaseio.com/` } }, { ...args, databaseUrl: `https://${project}-named.firebaseio.com/` }],
  ]) assert.equal(Tool.verifyTarget(candidate, options).ok, false);
  assert.equal(Tool.verifyTarget(app, { ...args, emulatorHost: null }).ok, false, "hosted mode needs verified credential identity");
  assert.equal(Tool.parseArgs(["--project=demo-one", "--project=demo-two"]).ambiguousTarget, true);
  assert.equal(Tool.parseArgs([`--database-url=${url}`, `--database-url=${url}`]).ambiguousTarget, true);
});
