import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as E from "../../lib/emailDelivery.js";
import * as Tool from "../../tools/daily-delivery/hold.mjs";
import { seedWorld, releasedHoldRecord, sdkTransactions, buildSandbox, freezeClock, installSmtp, SMTP, runCron, captureConsole, HOLD_PATH, T, B } from "../support/daily-email-harness.mjs";
const DAY = Date.parse("2026-09-08T04:05:00Z"), D = "2026-09-08";
const held = () => ({ ...releasedHoldRecord(), state: "held", version: 3, log: { ...releasedHoldRecord().log,
  v000000003: { action: "hold", state: "held", version: 3, prevVersion: 2, actor: "review", reason: "local incident", at: DAY - 1000 } } });
const full = () => ({ holdRaw: held(), receiptsRaw: null, manualRaw: null, nowMs: DAY + 3600000, maxDurationMs: 300000,
  inventoryAttested: true, logsAttested: true, invocationReceiptAttested: true, providerAttested: true });
let sb, restore;
before(async () => { sb = await buildSandbox(); restore = freezeClock(DAY); });
after(() => restore?.());

test("HR3-N3-X06 malformed legacy fence remains unreadable", () => {
  assert.equal(E.classifyHoldRecord({ ...releasedHoldRecord(), excludedThrough: "2026-99-99" }).code, "delivery_hold_unreadable");
});
test("HR3-N3-X10 audit final state must equal record state", () => {
  assert.equal(E.classifyHoldRecord({ ...releasedHoldRecord(), state: "held" }).code, "delivery_hold_unreadable");
});
test("HR3-N3-X11 an extra log key makes the record unreadable", () => {
  const r = releasedHoldRecord(); r.log.extra = { ...r.log.v000000002 };
  assert.equal(E.classifyHoldRecord(r).code, "delivery_hold_unreadable");
});
test("HR3-N3-X13 a complete receipt leaf with unknown state or sending without lease is unreadable", () => {
  const leaf = { v: "MARJIN_EMAIL_RECEIPT/1", kind: "daily_snapshot", tenantId: "t", bizId: "b", businessDate: D, attempt: 1,
    claimId: "claim", recipientHash: "0".repeat(64), history: [], state: "lost" };
  for (const x of [leaf, { ...leaf, state: "sending" }, { ...leaf, state: "accepted", v: "wrong", attempt: 0 }]) {
    const r = Tool.drainEvidence({ ...full(), receiptsRaw: { t: { b: { [D]: x } } } });
    assert.equal(r.verdict, "ABORT_D"); assert.deepEqual(r.unreadable.receipts, [`t/b/${D}`]);
  }
});
test("HR3-N3-X14 a complete manual leaf with unknown state is unreadable", () => {
  const r = Tool.drainEvidence({ ...full(), manualRaw: { t: { b: { attempt: { v: "MARJIN_MANUAL_ATTEMPT/1", kind: "daily_snapshot",
    tenantId: "t", bizId: "b", attemptId: "attempt", state: "lost", startedAt: DAY, settledAt: DAY + 1, messageIdHeader: "local" } } } } });
  assert.equal(r.verdict, "ABORT_D"); assert.deepEqual(r.unreadable.manual, ["t/b/attempt"]);
});
test("HR3-N1/X16 status and every evidence read fail or time out as typed ABORT_D", { timeout: 3000 }, async () => {
  const args = { "inventory-attested": true, "logs-attested": true, "provider-attested": true, "invocation-receipt-attested": true, "max-duration-ms": "300000" };
  for (const command of ["status", "evidence"]) for (const path of command === "status" ? [HOLD_PATH, E.HELD_DATES_ROOT] : [HOLD_PATH, `${E.RECEIPT_ROOT}/daily_snapshot`, E.MANUAL_ATTEMPT_ROOT]) for (const mode of ["throw", "hang"]) {
    const db = seedWorld(); db.seed(HOLD_PATH, held()); const original = db.ref;
    db.ref = (p, q) => p === path ? { ...original(p, q), once: () => mode === "throw" ? Promise.reject(new Error("not evidence")) : new Promise(() => {}) } : original(p, q);
    const r = await Tool.runCommand(db, command, args, { project: "demo", nowMs: DAY + 3600000, readTimeoutMs: 20 });
    assert.equal(r.exitCode, Tool.EXIT.ABORT_D); assert.equal(r.result.verdict, "ABORT_D");
    assert.equal(r.result.error, `${command}_read_unavailable`);
  }
});
test("HR3-N3-X18 held G1's 500 retains the failed business row and the other held rows", async () => {
  const db = seedWorld(); sdkTransactions(db, "delivery_control"); db.seed(HOLD_PATH, held()); const ref = db.ref;
  db.ref = (p, q) => p === `tenants/${T}/biz:${B}:entries` ? { ...ref(p, q), once: async () => { throw new Error("build input unavailable"); } } : ref(p, q);
  const smtp = installSmtp([SMTP.accept()]); const r = (await captureConsole(() => runCron(sb.route))).value;
  assert.equal(r.statusCode, 500);
  assert.equal(r.body.results.find((x) => x.bizId === B).outcome, "failed");
  assert.equal(r.body.results.find((x) => x.bizId === B).code, "snapshot_build_failed");
  assert.ok(r.body.results.filter((x) => x.bizId !== B).every((x) => x.outcome === "held"));
  assert.equal(smtp.calls.length, 0); assert.equal(db.read(`${E.RECEIPT_ROOT}/daily_snapshot`), null);
});
test("HR3-R02/X19/X20 the effective SDK host and namespace must match flags, configuration and environment", () => {
  const project = "demo-marjin-rules", emulatorHost = "127.0.0.1:9000", url = `http://${emulatorHost}?ns=${project}-default-rtdb`;
  const app = { options: { projectId: project, databaseURL: url } }, args = { project, databaseUrl: url, emulatorHost };
  assert.deepEqual(Tool.verifyTarget(app, args).resolvedInstance, { mode: "emulator", host: emulatorHost, namespace: `${project}-default-rtdb` });
  for (const badUrl of [`http://${emulatorHost}?ns=demo-other`, `http://127.0.0.1:9001?ns=${project}`, `https://${project}.firebaseio.com/`, `https://${project}-default-rtdb.firebaseio.com/`]) {
    const r = Tool.verifyTarget({ options: { ...app.options, databaseURL: badUrl } }, { ...args, databaseUrl: badUrl });
    assert.equal(r.ok, false); if (badUrl.startsWith("https:")) assert.equal(r.code, "emulator_env_with_hosted_url");
  }
  assert.equal(Tool.verifyTarget(app, { ...args, databaseUrl: `http://${emulatorHost}?ns=${project}` }).ok, false, "configured URL is independently compared to flag");
  assert.equal(Tool.verifyTarget(app, { ...args, emulatorHost: null }).ok, false, "http URL without emulator environment refuses");
  const oldA = process.env.GCLOUD_PROJECT, oldB = process.env.GOOGLE_CLOUD_PROJECT;
  try {
    process.env.GCLOUD_PROJECT = "demo-other"; process.env.GOOGLE_CLOUD_PROJECT = project;
    assert.equal(Tool.verifyTarget(app, args).ok, false, "environment project disagreement refuses");
  } finally {
    if (oldA === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = oldA;
    if (oldB === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = oldB;
  }
  const hosted = `https://${project}.firebaseio.com/`;
  assert.equal(Tool.verifyTarget({ options: { projectId: project, databaseURL: hosted, credential: { projectId: project } } }, { project, databaseUrl: hosted, emulatorHost: null }).ok, true);
});


test("HR3-N3-X02 a backward local clock cannot change the refused business date", async () => {
 const db=seedWorld();sdkTransactions(db,"delivery_control");db.seed(HOLD_PATH,held());
 await E.makeDailyDeliveryGate(db,D,{clock:()=>DAY-86400000})("g0");
 assert.ok(db.read(HOLD_PATH).refusedDates[D]);assert.equal(db.read(HOLD_PATH).refusedDates["2026-09-07"],undefined);
});
test("HR3-N3-X03 exact refusal proofs survive a new generation without sealing intervening dates", async () => {
 const db=seedWorld();sdkTransactions(db,"delivery_control");db.seed(HOLD_PATH,held());await E.makeDailyDeliveryGate(db,D)("g1");
 const r=db.read(HOLD_PATH);r.state="released";r.version=4;r.log.v000000004={action:"release",state:"released",version:4,prevVersion:3,actor:"review",reason:"fixture only",at:DAY};db.seed(HOLD_PATH,r);
 assert.equal((await E.changeDeliveryHold(db,{action:"hold",actor:"review",reason:"generation check",expectVersion:4,nowMs:DAY-86400000})).ok,true);
 assert.ok(db.read(HOLD_PATH).refusedDates[D]);assert.notEqual(E.classifyHoldRecord(db.read(HOLD_PATH)).version,null);
 assert.equal(db.read(HOLD_PATH).refusedDates["2026-09-07"],undefined);
});
