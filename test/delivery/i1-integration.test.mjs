// Agent/Daily integration I1 — the integrated acceptance of the delivery route with the carried Builder (LOCAL author candidate;
// pending independent Codex review). Every case drives the REAL route → REAL builder (690a07d9, via the approved financial
// source and the B2 e-mail presenter) → REAL receipt module → fake provider through test/support/daily-email-harness.mjs.
// Faults are injected ONLY at the boundaries the acceptance fixture permits: a refused DATA read (one business's entries, the
// tenant list, the index, the registry node), the scripted PROVIDER, and — for G7 and the gate's defence in depth only — the
// builder module seam (a copy of the compiled sandbox whose builder module wraps the real one).
//   I1-01  X1 / G1 / G3 / G6: one build fails — a FAILED row with the run date, no receipt, no claim; the other delivered once
//   I1-02  X2: every build fails — every expected identity is a failed row; zero provider calls; zero receipts
//   I1-03  X3 / G2: discovery fails (tenant list, index) — completed_with_failures even with zero rows; the discovery accounting
//          is reported verbatim; an unrelated malformed registry entry beside a valid target keeps the run incomplete
//   I1-04  scheduled G4 END TO END (D-G4): a registered business without a name is a failed build `business_name_unavailable`
//          with the owner notice recorded; the named business is delivered; the owner reads the notice (zero provider calls,
//          the builder never called); the name is repaired through the registry (identity preserved); the next read clears the
//          notice (acknowledged); the next run delivers it once; a business genuinely named "Unknown" is delivered
//   I1-05  G5: legitimate exclusions (explicit inactive, legacy self) are reported as rows + a count and never block completion
//   I1-06  G7: a throw from the builder run (its accounting invariant) fails the WHOLE run before any delivery: 500, the fixed
//          body, zero provider calls, zero receipts, the class only in the log
//   I1-07  G10 on the integrated route (D-G10): the exact manual statuses — 400 / 404 / 422 / 422 / 503 — with zero provider calls
//   I1-07b the manual gate refuses BEFORE the builder runs: with a (stale) builder that would build anything, an ambiguous,
//          unreadable or nameless registry is still refused with its D-G10 status and nothing is sent; control: it does send
//   I1-08  the route gate stays defence in depth: a snapshot whose registry record lost its name between the build and the gate
//          is a failed row with the notice recorded, never a send; an identity with a control character injected into the run
//          is a failed row `invalid_business_identity`; a failed-build code is bounded (an unbounded value is reported as
//          `invalid_code`, never echoed)
//   I1-09  identity: both duplicate-record orders and a padded twin are ambiguous failed builds (never a send); a valid `:`
//          tenant and a valid padded id are delivered with their own exact receipt paths
//   I1-10  receipts and claims: the D-RECEIPT path format and the stored record shape are unchanged; a repeat run is
//          already_accepted (no second provider call); an unknown send stays held across the integration
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, writeFileSync, renameSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, mkRes, captureConsole, RECEIPTS, T, B, B2, T2, B3, SUBSCRIPTIONS, enabledSubscriptionRecord } from "../support/daily-email-harness.mjs";
import * as D from "../../lib/emailDelivery.js";

const { route, dir: SANDBOX } = await buildSandbox();
const AT = Date.UTC(2026, 8, 8, 4, 5), DATE = "2026-09-08", LEASE = 10 * 60 * 1000;
const at = async (ms, fn) => { const u = freezeClock(ms); try { return await fn(); } finally { u(); } };
const cron = (r = route, ms = AT) => at(ms, () => runCron(r));
const env = (v) => ({ _v: JSON.stringify(v) });
const NOTICES = D.DELIVERY_NOTICE_ROOT, HE = D.MISSING_NAME_NOTICE_HE;
const SECRET = "private@example.test";
const receipt = (t, b) => globalThis.__DB.read(`${RECEIPTS}/${t}/${b}/${DATE}`);
const rowOf = (r, t, b) => (r.body.results || []).find((x) => x.tenantId === t && x.bizId === b);
const failRead = (db, path) => { const r = db.ref; db.ref = (p, q) => { const x = r(p, q); return p === path ? { ...x, once: async () => { throw new Error(SECRET); } } : x; }; };
const failEntries = (db, t, b) => failRead(db, `tenants/${t}/biz:${b}:entries`);
const noLeak = (r, lines, label) => assert.ok(!(JSON.stringify(r.body) + lines.join("\n")).includes(SECRET), label + ": injected text never reaches a response or a log");
async function post(r, body, { uid = "u_owner_a", email = "owner-a@example.test" } = {}) {
  process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "fixture-app-password-not-real";
  globalThis.__DE = { requireAuth: async () => ({ uid, email }) };
  const res = mkRes();
  await r({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body }, res);
  return res;
}
const seedTenant = (db, t, b, name) => {
  process.env.MARJIN_DAILY_RECIPIENTS_JSON = JSON.stringify([...JSON.parse(process.env.MARJIN_DAILY_RECIPIENTS_JSON),[t,b,"owner-a@example.test"]]);
  db.seed(`${SUBSCRIPTIONS}/${t}/${b}`, enabledSubscriptionRecord());
  db.seed(`tenants/${t}/biz:${b}:entries`, db.read(`tenants/${T}/biz:${B}:entries`));
  db.seed(`tenants/${t}/biz:${b}:config`, env({ businessName: name }));
  db.seed(`tenants/${t}/biz:${b}:fixed`, env([]));
  db.seed(`tenants/${t}/app/business`, env([{ id: b, name }]));
  db.seed(`tenants/${t}/app/users`, db.read(`tenants/${T}/app/users`));
};
/** a copy of the compiled sandbox whose builder module wraps the real one (`wrap` is the source of buildSnapshotRun) */
async function builderSeamRoute(wrap, wrapBiz = "return real.buildSnapshotForBiz(t, b, o);") {
  const dir = mkdtempSync(join(tmpdir(), "i1-seam-"));
  cpSync(SANDBOX, dir, { recursive: true, verbatimSymlinks: true });
  const sb = join(dir, "src", "snapshot");
  renameSync(join(sb, "snapshotBuilder.js"), join(sb, "snapshotBuilder.real.js"));
  writeFileSync(join(sb, "snapshotBuilder.js"), `import * as real from "./snapshotBuilder.real.js";\nexport async function buildSnapshotForBiz(t, b, o) { globalThis.__SEAM_BIZ_CALLS = (globalThis.__SEAM_BIZ_CALLS || 0) + 1; ${wrapBiz} }\nexport const buildSnapshotForAll = real.buildSnapshotForAll;\nexport async function buildSnapshotRun(o) { globalThis.__SEAM_CALLS = (globalThis.__SEAM_CALLS || 0) + 1; ${wrap} }\n`);
  return (await import(pathToFileURL(join(dir, "api", "daily-snapshot", "run.js")).href)).default;
}

test("I1-01 X1 / G1 / G3 / G6: one build fails — a failed row with the run date, no receipt; the other is delivered once", async () => {
  const db = seedWorld({ withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  failEntries(db, T, B2);
  const { value: r, lines } = await captureConsole(() => cron());
  assert.deepEqual([r.statusCode, r.body.status], [500, "completed_with_failures"]);
  assert.deepEqual(rowOf(r, T, B2), { tenantId: T, bizId: B2, businessDate: DATE, outcome: "failed", code: "snapshot_build_failed", settlement: "failed", receipt: "not_written" }, "the exact G3 row");
  assert.deepEqual([rowOf(r, T, B).settlement, rowOf(r, T, B).businessDate, smtp.calls.length], ["delivered", DATE, 1]);
  assert.deepEqual([r.body.businessDate, r.body.expectedBusinesses, r.body.totalSnapshots, r.body.failedBuildCount, r.body.failureCount, r.body.results.length], [DATE, 2, 1, 1, 1, 2], "every expected business is exactly one row");
  assert.deepEqual(r.body.discovery, { status: "complete", failures: [] });
  assert.equal(receipt(T, B).state, "accepted"); assert.equal(receipt(T, B2), null, "G6: no receipt for a failed build");
  assert.equal(db.read(NOTICES), null, "a build failure is not a missing-name notice");
  noLeak(r, lines, "I1-01");
  // the next run: the delivered business is already_accepted; the failed build is simply attempted again (no receipt bars it)
  const r2 = await cron(route, AT + 2 * LEASE);
  assert.deepEqual([r2.statusCode, rowOf(r2, T, B).code, rowOf(r2, T, B2).code, smtp.calls.length, receipt(T, B2)], [500, "already_accepted", "snapshot_build_failed", 1, null]);
});

test("I1-02 X2: every build fails — every expected identity is a failed row; zero provider calls; zero receipts", async () => {
  const db = seedWorld(); const smtp = installSmtp([SMTP.accept()]);
  for (const [t, b] of [[T, B], [T, B2], [T2, B3]]) failEntries(db, t, b);
  const { value: r, lines } = await captureConsole(() => cron());
  assert.deepEqual([r.statusCode, r.body.status, r.body.expectedBusinesses, r.body.totalSnapshots, r.body.failedBuildCount, smtp.calls.length], [500, "completed_with_failures", 3, 0, 3, 0]);
  for (const [t, b] of [[T, B], [T, B2], [T2, B3]]) {
    assert.deepEqual([rowOf(r, t, b).outcome, rowOf(r, t, b).code, rowOf(r, t, b).settlement, rowOf(r, t, b).businessDate], ["failed", "snapshot_build_failed", "failed", DATE], `${t}/${b}`);
    assert.equal(receipt(t, b), null);
  }
  noLeak(r, lines, "I1-02");
});

test("I1-03 X3 / G2: discovery fails — never a clean run, reported verbatim; an unrelated malformed entry keeps the run incomplete", async () => {
  // the tenant list cannot be read: zero expected businesses, still completed_with_failures (G2)
  let db = seedWorld(); let smtp = installSmtp([SMTP.accept()]);
  failRead(db, "tenants");
  let { value: r, lines } = await captureConsole(() => cron());
  assert.deepEqual([r.statusCode, r.body.status, r.body.results.length, r.body.expectedBusinesses, smtp.calls.length], [500, "completed_with_failures", 0, 0, 0]);
  assert.deepEqual(r.body.discovery, { status: "failed", failures: [{ source: "app_business", code: "read_failed" }] });
  noLeak(r, lines, "I1-03 tenants");
  // the index cannot be read: the registry-known businesses are still built and delivered, the run is not clean
  db = seedWorld({ withSecondTenant: false }); smtp = installSmtp([SMTP.accept()]);
  failRead(db, "proactive_biz_index");
  r = await cron();
  assert.deepEqual([r.statusCode, r.body.status, rowOf(r, T, B).settlement, rowOf(r, T, B2).settlement, smtp.calls.length], [500, "completed_with_failures", "delivered", "delivered", 2]);
  assert.deepEqual(r.body.discovery, { status: "failed", failures: [{ source: "proactive_biz_index", code: "read_failed" }] });
  // an unrelated malformed entry (a numeric id) beside a valid target: the target is delivered; the run stays incomplete
  db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "מסעדה א" }, { id: 7, name: "x" }]));
  r = await cron();
  assert.deepEqual([r.statusCode, rowOf(r, T, B).settlement, smtp.calls.length], [500, "delivered", 1]);
  assert.deepEqual(r.body.discovery, { status: "failed", failures: [{ source: "app_business", code: "malformed_entry" }] });
  // a clean zero-eligible registry completes (contract: "may complete")
  db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); smtp = installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, { _v: "[]" });
  r = await cron();
  assert.deepEqual([r.statusCode, r.body.status, r.body.results.length, r.body.discovery.status, smtp.calls.length], [200, "completed", 0, "complete", 0]);
});

test("I1-04 scheduled G4 end to end: a nameless business fails visibly with the owner notice; repair → cleared → delivered", async () => {
  const db = seedWorld({ withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "מסעדה א" }, { id: B2 }]));            // B2 is registered without a name
  let entriesReads = 0; const ref = db.ref;
  db.ref = (p, q) => { if (p === `tenants/${T}/biz:${B2}:entries`) entriesReads++; return ref(p, q); };
  const { value: r1, lines } = await captureConsole(() => cron());
  assert.deepEqual([r1.statusCode, r1.body.status], [500, "completed_with_failures"]);
  assert.deepEqual(rowOf(r1, T, B2), { tenantId: T, bizId: B2, businessDate: DATE, outcome: "failed", code: "business_name_unavailable", settlement: "failed", receipt: "not_written", notice: "recorded" });
  assert.equal(entriesReads, 0, "the builder fails a nameless business BEFORE any financial read (BDC §1.1)");
  assert.deepEqual([rowOf(r1, T, B).settlement, smtp.calls.length, r1.body.skippedCount, r1.body.failureCount], ["delivered", 1, 0, 1], "the named business is delivered; nothing is a silent no-send");
  assert.equal(receipt(T, B2), null, "no receipt, no claim for the nameless business");
  const n1 = db.read(`${NOTICES}/${T}/${B2}`);
  assert.deepEqual([n1.code, n1.message, n1.tenantId, n1.bizId, n1.businessDate, n1.runs, n1.firstSeenAt, n1.lastSeenAt], ["business_name_unavailable", HE, T, B2, DATE, 1, AT, AT]);
  assert.ok(!smtp.calls.some((c) => /Unknown/.test(c.subject)), "no placeholder name anywhere");
  assert.ok(lines.some((l) => l.includes("business not deliverable") && l.includes("business_name_unavailable")));
  // a second run counts the notice (first seen preserved); the named business is already_accepted
  const r2 = await cron(route, AT + 2 * LEASE);
  assert.deepEqual([rowOf(r2, T, B2).code, rowOf(r2, T, B).code, smtp.calls.length, db.read(`${NOTICES}/${T}/${B2}`).runs, db.read(`${NOTICES}/${T}/${B2}`).firstSeenAt], ["business_name_unavailable", "already_accepted", 1, 2, AT]);
  // the owner reads the notice through the authorized route: zero provider calls, the builder never runs
  const seam = await builderSeamRoute("return real.buildSnapshotRun(o);");
  globalThis.__SEAM_CALLS = 0;
  const read1 = await at(AT, () => post(seam, { tenantId: T, bizId: B2, action: "notice" }));
  assert.deepEqual([read1.statusCode, read1.body.status, read1.body.deliverable, read1.body.code, read1.body.noticeState, read1.body.clearState, read1.body.notice.runs, smtp.calls.length, globalThis.__SEAM_CALLS],
    [200, "ok", false, "business_name_unavailable", "active", "not_applicable", 2, 1, 0]);
  // a viewer and another tenant's owner are refused before the store is read
  assert.equal((await at(AT, () => post(route, { tenantId: T, bizId: B2, action: "notice" }, { uid: "u_viewer_a", email: "viewer-a@example.test" }))).statusCode, 403);
  // the owner repairs the name through the authorized registry path (same record identity, nothing else changes)
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "מסעדה א" }, { id: B2, name: "מסעדה ב" }]));
  const read2 = await at(AT, () => post(route, { tenantId: T, bizId: B2, action: "notice" }));
  assert.deepEqual([read2.statusCode, read2.body.deliverable, read2.body.noticeState, read2.body.clearState, read2.body.notice, db.read(`${NOTICES}/${T}/${B2}`)], [200, true, "none", "cleared", null, null]);
  // the next scheduled run delivers the repaired business once, with its real name
  const r3 = await cron(route, AT + 4 * LEASE);
  assert.deepEqual([r3.statusCode, rowOf(r3, T, B2).settlement, smtp.calls.length], [200, "delivered", 2]);
  assert.ok(smtp.calls[1].subject.includes("מסעדה ב"), "the repaired name is the one the owner sees");
  // a business genuinely named "Unknown" is a valid name: built and delivered, no notice
  const db2 = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp2 = installSmtp([SMTP.accept()]);
  db2.seed(`tenants/${T}/app/business`, env([{ id: B, name: "Unknown" }]));
  const r4 = await cron();
  assert.deepEqual([r4.statusCode, rowOf(r4, T, B).settlement, smtp2.calls.length, db2.read(NOTICES)], [200, "delivered", 1, null]);
  // a non-string name is not a name (D-G4 "usable name"): scheduled failed row + notice; the owner's read reports it blocked
  const db5 = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp5 = installSmtp([SMTP.accept()]);
  db5.seed(`tenants/${T}/app/business`, env([{ id: B, name: 42 }]));
  const r5 = await cron();
  assert.deepEqual([r5.statusCode, rowOf(r5, T, B).code, rowOf(r5, T, B).notice, smtp5.calls.length], [500, "business_name_unavailable", "recorded", 0]);
  const read5 = await at(AT, () => post(route, { tenantId: T, bizId: B, action: "notice" }));
  assert.deepEqual([read5.statusCode, read5.body.deliverable, read5.body.code, read5.body.noticeState, db5.read(`${NOTICES}/${T}/${B}`).runs], [200, false, "business_name_unavailable", "active", 1], "a numeric name is never deliverable");
  // the manual path keeps D-G4 too: 422 business_name_unavailable, no send
  const db3 = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp3 = installSmtp([SMTP.accept()]);
  db3.seed(`tenants/${T}/app/business`, env([{ id: B, name: "  " }]));
  const m = await at(AT, () => runManual(route));
  assert.deepEqual([m.statusCode, m.body.code, smtp3.calls.length], [422, "business_name_unavailable", 0]);
});

test("I1-05 G5: legitimate exclusions are rows + a count and never block completion", async () => {
  const db = seedWorld({ withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "מסעדה א" }, { id: B2, name: "מסעדה ב", active: false }]));
  db.seed(`tenants/${T2}/app/business`, env([{ id: T2, name: "legacy self" }]));
  const r = await cron();
  assert.deepEqual([r.statusCode, r.body.status, r.body.results.length, smtp.calls.length, r.body.exclusionCount], [200, "completed", 1, 1, 2]);
  assert.deepEqual(r.body.exclusions.map((x) => [x.tenantId, x.bizId, x.businessDate, x.reason]).sort(), [[T, B2, DATE, "explicit_inactive"], [T2, T2, DATE, "legacy_self"]].sort());
  assert.equal(rowOf(r, T, B2), undefined, "an exclusion is never a result row");
  assert.equal(receipt(T, B2), null);
});

test("I1-06 G7: a throw from the builder run fails the whole run before any delivery", async () => {
  const seam = await builderSeamRoute('throw new Error("snapshot_accounting_invariant");');
  seedWorld({ withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  const { value: r, lines } = await captureConsole(() => cron(seam));
  assert.deepEqual([r.statusCode, r.body, smtp.calls.length, globalThis.__DB.read(RECEIPTS)], [500, { error: "Internal server error" }, 0, null]);
  assert.ok(lines.some((l) => l.endsWith("run failed (Error)")) && !lines.some((l) => l.includes("snapshot_accounting_invariant")), "the class only is logged");
  // never an empty success: the real builder's invariant is a throw too (checked against the builder's own source below)
  const real = await builderSeamRoute("const run = await real.buildSnapshotRun(o); return { ...run, snapshots: [] };");
  // a run whose snapshots vanished but whose expected identities remain: every identity is still a failed row, never a clean run
  const r2 = await cron(real);
  assert.deepEqual([r2.statusCode, r2.body.status, r2.body.results.every((x) => x.settlement === "failed"), smtp.calls.length], [500, "completed_with_failures", true, 0]);
});

test("I1-07 G10 on the integrated route: the exact manual statuses, zero provider calls (D-G10)", async () => {
  const cases = [
    ["not registered", (db) => db.seed(`tenants/${T}/app/business`, env([{ id: "other", name: "Other" }])), { tenantId: T, bizId: B }, 404, "business_not_registered"],
    ["ambiguous (duplicate record)", (db) => db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "א" }, { id: B, name: "א (twin)" }])), { tenantId: T, bizId: B }, 422, "ambiguous_business_identity"],
    ["raw array registry", (db) => db.seed(`tenants/${T}/app/business`, [{ id: B, name: "x" }]), { tenantId: T, bizId: B }, 422, "registry_unreadable"],
    ["undecodable envelope", (db) => db.seed(`tenants/${T}/app/business`, { _v: "[{\"id\":\"bizA\",\"name\":\"Secret Cafe\"" }), { tenantId: T, bizId: B }, 422, "registry_unreadable"],
    ["missing name", (db) => db.seed(`tenants/${T}/app/business`, env([{ id: B }])), { tenantId: T, bizId: B }, 422, "business_name_unavailable"],
    ["registry read failure", (db) => failRead(db, `tenants/${T}/app/business`), { tenantId: T, bizId: B }, 503, "registry_unavailable"],
    ["snapshot build failure", (db) => failEntries(db, T, B), { tenantId: T, bizId: B }, 503, "snapshot_build_failed"],
  ];
  for (const [label, prep, body, status, code] of cases) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    prep(db);
    const { value: r, lines } = await captureConsole(() => at(AT, () => post(route, body)));
    assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length, r.body.snapshot], [status, code, 0, undefined], label);
    assert.ok(!JSON.stringify(r.body).includes("Secret Cafe") && !JSON.stringify(r.body).includes("is not valid JSON"), label + ": no registry bytes, no parser text");
    noLeak(r, lines, label);
  }
});

// I3 (test-contract transition T-I3-TEST, Builder coordination contract §2.3): the control-character identity of this case moved
// from the delivery gate to the shared requireBizContext — still 400, still zero provider calls, now before any registry read.
test("I1-07c D-CTRL on the integrated route: a control-character identity is a 400 from the shared predicate, before any read or send", async () => {
  // I6 (test-contract transition T-I6-TEST-DAILY; delivery + M1 identity owners — independent I5 review I5-R-02): the business ":"
  // case of I1-07 moved here too — the shared gate judges the business slot by the approved business predicate (400 invalid bizId,
  // before any registry read or send). It was the delivery gate's 400 invalid_business_identity.
  for (const [body, msg] of [[{ tenantId: T, bizId: "biz\u0001c" }, "invalid bizId"], [{ tenantId: "t\u001fx", bizId: B }, "invalid tenantId"], [{ tenantId: T, bizId: "biz\u007f" }, "invalid bizId"], [{ tenantId: T, bizId: "b:c" }, "invalid bizId"]]) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    seedTenant(db, T, "biz\u0001c", "Ctrl");
    const refs = []; const ref0 = db.ref; db.ref = (p, q) => { refs.push(p); return ref0(p, q); };
    const { value: r, lines } = await captureConsole(() => at(AT, () => post(route, body)));
    assert.deepEqual([r.statusCode, r.body, smtp.calls.length], [400, { error: msg }, 0], JSON.stringify(body));
    assert.deepEqual(refs.filter((p) => /[\u0000-\u001f\u007f]/.test(p) || p.includes("b:c")), [], "no reference carries a control character or the refused business id");
    noLeak(r, lines, JSON.stringify(body));
  }
});

test("I1-07b the manual gate refuses BEFORE the builder runs: with a builder that would not refuse, nothing is sent", async () => {
  // a stale builder that builds whatever it is asked (it rebuilds on a clean named registry): only the route's own gate stands
  const stale = await builderSeamRoute("return real.buildSnapshotRun(o);", `const p = "tenants/" + t + "/app/business"; const db = globalThis.__DB; const saved = db.read(p); db.seed(p, { _v: JSON.stringify([{ id: b, name: "Stale Name" }]) }); try { return await real.buildSnapshotForBiz(t, b, o); } finally { db.seed(p, saved); }`);
  for (const [label, node, status, code] of [["ambiguous", env([{ id: B, name: "א" }, { id: B, name: "ב" }]), 422, "ambiguous_business_identity"], ["raw array", [{ id: B, name: "x" }], 422, "registry_unreadable"], ["nameless", env([{ id: B }]), 422, "business_name_unavailable"]]) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    db.seed(`tenants/${T}/app/business`, node);
    globalThis.__SEAM_BIZ_CALLS = 0;
    const r = await at(AT, () => runManual(stale));
    assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length, globalThis.__SEAM_BIZ_CALLS], [status, code, 0, 0], label + ": refused by the gate, the builder never called");
    assert.ok(!smtp.calls.some((c) => c.subject.includes("Stale Name")), label + ": no placeholder / stale name is ever sent");
  }
  // control: the stale builder does send when the registry is healthy (so the refusals above are the gate's)
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  const ok = await at(AT, () => runManual(stale));
  assert.deepEqual([ok.statusCode, smtp.calls.length], [200, 1]);
});

test("I1-08 the route gate stays defence in depth on the scheduled path", async () => {
  // the registry record loses its name between the builder's read and the route's gate: a failed row + notice, never a send
  const seam = await builderSeamRoute(`const run = await real.buildSnapshotRun(o); globalThis.__DB.seed("tenants/${T}/app/business", { _v: JSON.stringify([{ id: "${B}" }]) }); return run;`);
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  const r = await cron(seam);
  assert.deepEqual([r.statusCode, rowOf(r, T, B).code, rowOf(r, T, B).notice, rowOf(r, T, B).receipt, smtp.calls.length, receipt(T, B)], [500, "business_name_unavailable", "recorded", "not_written", 0, null]);
  assert.equal(db.read(`${NOTICES}/${T}/${B}`).code, "business_name_unavailable");
  // an identity the builder should never have produced (a control character) is refused by the gate: a failed row with the
  // identity code, no send, no receipt node, no notice
  const ctrl = await builderSeamRoute('const run = await real.buildSnapshotRun(o); const s = run.snapshots[0]; const bad = { ...s, bizId: "biz\\u0001c" }; return { ...run, expectedBusinesses: [...run.expectedBusinesses, { tenantId: s.tenantId, bizId: bad.bizId, businessDate: run.businessDate }], snapshots: [...run.snapshots, bad] };');
  const db3 = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp3 = installSmtp([SMTP.accept()]);
  const r3 = await cron(ctrl);
  const bad = (r3.body.results || []).find((x) => x.bizId === "biz\u0001c");
  assert.deepEqual([r3.statusCode, bad.outcome, bad.code, bad.receipt, rowOf(r3, T, B).settlement, smtp3.calls.length, db3.read(NOTICES)], [500, "failed", "invalid_business_identity", "not_written", "delivered", 1, null]);
  // a failed-build code is bounded before it reaches a row, a log or the response (a raw value never travels)
  const raw = await builderSeamRoute(`const run = await real.buildSnapshotRun(o); return { ...run, snapshots: [], failedBuilds: run.expectedBusinesses.map((x) => ({ ...x, code: "Error: ${SECRET}" })) };`);
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp2 = installSmtp([SMTP.accept()]);
  const { value: r2, lines } = await captureConsole(() => cron(raw));
  assert.deepEqual([r2.statusCode, rowOf(r2, T, B).outcome, rowOf(r2, T, B).code, smtp2.calls.length], [500, "failed", "invalid_code", 0]);
  noLeak(r2, lines, "I1-08 unbounded code");
});

test("I1-09 identity on the integrated tree: duplicate orders and padded twins never send; valid `:` tenants and padded ids keep their own receipts", async () => {
  for (const [label, list] of [["canonical first", [{ id: B, name: "א" }, { id: B, name: "ב" }]], ["twin first", [{ id: B, name: "ב" }, { id: B, name: "א" }]],
                              ["padded twin after", [{ id: B, name: "א" }, { id: " " + B, name: "ב" }]], ["padded twin before", [{ id: " " + B, name: "ב" }, { id: B, name: "א" }]]]) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    db.seed(`tenants/${T}/app/business`, env(list));
    const r = await cron();
    assert.equal(r.statusCode, 500, label);
    assert.equal(smtp.calls.length, 0, label + ": never a send for an ambiguous identity");
    assert.ok(r.body.results.some((x) => x.bizId === B && x.outcome === "failed" && x.code === "ambiguous_business_identity"), label + ": " + JSON.stringify(r.body.results));
    assert.equal(receipt(T, B), null, label);
  }
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, env([]));
  seedTenant(db, "acme:il", "bizX", "Colon Tenant"); seedTenant(db, "padded", " bizP", "Padded Biz");
  const r = await cron();
  assert.deepEqual([r.statusCode, rowOf(r, "acme:il", "bizX").settlement, rowOf(r, "padded", " bizP").settlement, smtp.calls.length], [200, "delivered", "delivered", 2], JSON.stringify(r.body.results));
  assert.equal(db.read(`${RECEIPTS}/acme:il/bizX/${DATE}`).state, "accepted");
  assert.equal(db.read(`${RECEIPTS}/padded/ bizP/${DATE}`).state, "accepted");
});

test("I1-10 receipts and claims are unchanged by the integration: path format, record shape, no resend, unknown held", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  const r1 = await cron();
  assert.deepEqual([r1.statusCode, smtp.calls.length], [200, 1]);
  assert.equal(D.receiptPath(D.DAILY_SNAPSHOT_KIND, T, B, DATE), `${RECEIPTS}/${T}/${B}/${DATE}`, "D-RECEIPT: the path format is unchanged");
  const rec = receipt(T, B);
  // the stored record keeps exactly the DE1 R1 field set (DR1 ALLOWED): no new field, no identity change, no raw provider text
  assert.deepEqual(Object.keys(rec).sort(), ["v", "kind", "tenantId", "bizId", "businessDate", "state", "claimId", "attempt", "claimedAt", "recipientHash", "updatedAt", "history", "sendingAt", "messageIdHeader", "messageId", "providerIdEcho", "responseCode", "finishedAt"].sort());
  assert.deepEqual([rec.tenantId, rec.bizId, rec.businessDate, rec.kind], [T, B, DATE, D.DAILY_SNAPSHOT_KIND]);
  assert.equal(rec.state, "accepted");
  const r2 = await cron(route, AT + 2 * LEASE);
  assert.deepEqual([r2.statusCode, rowOf(r2, T, B).code, smtp.calls.length], [200, "already_accepted", 1], "no resend");
  // an unknown send is held across runs and never re-sent
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp2 = installSmtp([SMTP.socketTimeout(), SMTP.accept()]);
  const u1 = await cron(); const u2 = await cron(route, AT + 2 * LEASE);
  assert.deepEqual([u1.statusCode, rowOf(u1, T, B).settlement, u2.statusCode, rowOf(u2, T, B).code, smtp2.calls.length, receipt(T, B).state], [500, "unknown", 500, "unknown_requires_reconciliation", 1, "unknown"]);
});
