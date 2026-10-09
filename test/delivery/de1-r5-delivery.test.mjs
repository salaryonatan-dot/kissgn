// Daily Email delivery R5 — the owner decisions of 2026-10-09 (delivery-contract resolution): G4 (a registered business
// without a name), G10 (manual POST refusals before any provider hand-off), control characters in identities, and the
// receipt-path alignment with the approved M1 R5 predicates. The REAL route api/daily-snapshot/run.ts, the REAL builder pin
// of this tree, the REAL lib/sendEmail.js + lib/emailDelivery.js run in the sandbox of test/support/daily-email-harness.mjs;
// only the database, the token verifier and the SMTP provider are replaced. No network, no real e-mail. LOCAL behaviour only.
//
//   DR5-01  identity rules: receiptPath's tenant slot = isValidId (`:` permitted), business slot = isRegistryBizId (`:` refused),
//           both refuse RTDB control characters; no trimming / aliasing; every previously accepted identity keeps its exact path
//   DR5-02  the REAL Admin SDK (offline): every path receiptPath returns is a valid Reference; every control-character path the
//           SDK refuses is refused by receiptPath first (before any Reference is built)
//   DR5-03  a `:` tenant is delivered with a receipt at its own path; a repeat run is already_accepted (one provider call)
//   DR5-04  a registry business id with a control character is a failed `invalid_business_identity` row: no send, no receipt,
//           no node under that identity; the run is completed_with_failures
//   DR5-05  manual POST refusals (G10): 400 / 404 / 422 / 503 with bounded bodies, zero provider calls, no raw error text or
//           registry bytes in body or log; the provider classes 502 / 504 are unchanged and reached only after the gate
//   DR5-06  G4 on the manual path with the REAL builder: a missing / blank / non-string name is 422 business_name_unavailable
//           (no send); a business genuinely named "Unknown" is sent; no placeholder name appears anywhere
//   DR5-07  G4 on the scheduled path, route gate with a STUBBED builder output (the builder pin of this tree drops a nameless
//           business before the route sees it — the end-to-end scheduled case is PENDING the carried Builder): a failed
//           business_name_unavailable row, no send, no receipt, the owner notice recorded and counted across runs, the other
//           business delivered; the notice is removed once the name is present again
//   DR5-08  the owner notice: read only through the owner-authorized POST (action: "notice"); a viewer, a manager and another
//           tenant's owner are refused by the unchanged authorization; the notice carries no address and no financial figure
//   DR5-09  unknown outcomes stay held and are never re-sent; an existing accepted receipt at the unchanged path is honoured
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, writeFileSync, renameSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, runManual, mkRes, captureConsole, RECEIPTS, T, B, B2, T2, B3 } from "../support/daily-email-harness.mjs";
import * as D from "../../lib/emailDelivery.js";
import { isValidId } from "../../lib/securityContext.js";
import { isRegistryBizId } from "../../lib/businessRegistry.js";

const { route, dir: SANDBOX } = await buildSandbox();
const AT = Date.UTC(2026, 8, 8, 4, 5), DATE = "2026-09-08", LEASE = 10 * 60 * 1000;
const at = async (ms, fn) => { const u = freezeClock(ms); try { return await fn(); } finally { u(); } };
const cron = (r = route, ms = AT) => at(ms, () => runCron(r));
const env = (v) => ({ _v: JSON.stringify(v) });
const NOTICES = D.DELIVERY_NOTICE_ROOT;
const HE = D.MISSING_NAME_NOTICE_HE;
const SECRET_NAME = "Secret Cafe", SECRET_ADDR = "private@example.test";
const leaks = (l) => l.includes(SECRET_NAME) || l.includes(SECRET_ADDR) || l.includes("is not valid JSON");
const seedTenant = (db, t, b, name) => {
  db.seed(`tenants/${t}/biz:${b}:entries`, db.read(`tenants/${T}/biz:${B}:entries`));
  db.seed(`tenants/${t}/biz:${b}:config`, env({ businessName: name }));
  db.seed(`tenants/${t}/biz:${b}:fixed`, env([]));
  db.seed(`tenants/${t}/app/business`, env([{ id: b, name }]));
  db.seed(`tenants/${t}/app/users`, db.read(`tenants/${T}/app/users`));
};
/** a POST with an explicit body (action) as the authenticated user */
async function post(r, body, { uid = "u_owner_a", email = "owner-a@example.test" } = {}) {
  process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "fixture-app-password-not-real";
  globalThis.__DE = { requireAuth: async () => ({ uid, email }) };
  const res = mkRes();
  await r({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body }, res);
  return res;
}
const rowOf = (r, t, b) => (r.body.results || []).find((x) => x.tenantId === t && x.bizId === b);

// ── DR5-01 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CTRL = /[\u0000-\u001f\u007f]/;
const CORPUS = (() => {
  const out = ["acme", "acme:il", "a:b:c", " acme", "acme ", "t|x", "x|y", "מסעדה", "biz_1759000000000", "x".repeat(128), "x".repeat(129), "", "a.b", "a#b", "a$b", "a[b", "a]b", "a/b", "null", "0"];
  for (let c = 0x20; c < 0x7f; c++) out.push("a" + String.fromCharCode(c) + "b");
  for (const c of [0x00, 0x01, 0x09, 0x0a, 0x0d, 0x1f, 0x7f]) out.push("a" + String.fromCharCode(c) + "b", String.fromCharCode(c) + "ab", "ab" + String.fromCharCode(c));
  return out;
})();
test("DR5-01 identity rules: the approved predicates per slot plus RTDB key safety; no trimming; exact paths preserved", () => {
  for (const v of CORPUS) {
    const label = JSON.stringify(v);
    assert.equal(D.isTenantKey(v), isValidId(v) && !CTRL.test(v), "tenant rule " + label);
    assert.equal(D.isBusinessKey(v), isRegistryBizId(v) && !CTRL.test(v), "business rule " + label);
    assert.equal(D.receiptPath("daily_snapshot", v, "b", DATE) !== null, D.isTenantKey(v), "tenant slot " + label);
    assert.equal(D.receiptPath("daily_snapshot", "t", v, DATE) !== null, D.isBusinessKey(v), "business slot " + label);
  }
  // the owner decisions, stated
  assert.equal(D.receiptPath("daily_snapshot", "acme:il", "bizX", DATE), `${RECEIPTS}/acme:il/bizX/${DATE}`, "`:` is permitted in the tenant slot");
  assert.equal(D.receiptPath("daily_snapshot", "acme", "b:c", DATE), null, "`:` is refused in the business slot (the per-business keys)");
  for (const c of ["\u0000", "\u0001", "\n", "\u001f", "\u007f"]) {
    assert.equal(D.receiptPath("daily_snapshot", "t" + c, "b", DATE), null, "control character in the tenant slot");
    assert.equal(D.receiptPath("daily_snapshot", "t", "b" + c, DATE), null, "control character in the business slot");
  }
  // identity is exact: a padded id is its own identity (the approved rule registers it as such), never trimmed into another
  assert.equal(D.receiptPath("daily_snapshot", " acme", "bizA", DATE), `${RECEIPTS}/ acme/bizA/${DATE}`);
  assert.notEqual(D.receiptPath("daily_snapshot", " acme", "bizA", DATE), D.receiptPath("daily_snapshot", "acme", "bizA", DATE));
  // every identity accepted before this change keeps its exact node (the R4 rule: no `. # $ [ ] / :` in either slot, 1..128)
  const R4_SAFE = /^[^.#$\[\]\/:]{1,128}$/;
  for (const t of CORPUS) for (const b of ["bizA", "x|y", " b", "מסעדה"]) {
    if (R4_SAFE.test(t) && R4_SAFE.test(b) && !CTRL.test(t)) assert.equal(D.receiptPath("daily_snapshot", t, b, DATE), `${RECEIPTS}/${t}/${b}/${DATE}`, JSON.stringify([t, b]));
  }
  assert.equal(D.receiptPath("daily_snapshot", "tR", "bR", "2026-10-05"), `${RECEIPTS}/tR/bR/2026-10-05`, "the emulator gate identities");
  assert.equal(D.receiptPath("Daily", "t", "b", DATE), null); assert.equal(D.receiptPath("daily_snapshot", "t", "b", "2026-9-8"), null);
});

// ── DR5-02 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR5-02 the real Admin SDK (offline): every returned receipt / notice path is a valid Reference; SDK-refused keys never reach it", async () => {
  const require = createRequire(join(SANDBOX, "package.json"));
  const admin = require("firebase-admin");
  const app = admin.initializeApp({ databaseURL: "https://offline-de1-r5.firebaseio.com", projectId: "offline-de1-r5" }, "de1-r5-" + process.pid);
  const rtdb = admin.database(app);
  rtdb.goOffline();
  try {
    let accepted = 0, refusedFirst = 0;
    for (const t of CORPUS) for (const b of ["bizA", "b:c", "a\u0001b", " b"]) {
      const p = D.receiptPath("daily_snapshot", t, b, DATE), n = D.deliveryNoticePath(t, b);
      const raw = `${RECEIPTS}/${t}/${b}/${DATE}`;
      let sdkOk = true; try { rtdb.ref(raw); } catch { sdkOk = false; }
      if (p !== null) { assert.equal(p, raw); assert.doesNotThrow(() => rtdb.ref(p), "SDK accepts " + JSON.stringify([t, b])); assert.doesNotThrow(() => rtdb.ref(n)); accepted++; }
      if (!sdkOk) { assert.equal(p, null, "receiptPath refuses what the SDK refuses: " + JSON.stringify([t, b])); assert.equal(n, null); refusedFirst++; }
    }
    assert.ok(accepted > 50 && refusedFirst > 20, `${accepted} accepted, ${refusedFirst} SDK-refused`);
    // through deliverWithReceipt with the real SDK object: a control-character identity is refused before any Reference exists
    let sent = 0;
    const r = await D.deliverWithReceipt({ db: rtdb, tenantId: T, bizId: "biz\u0001c", businessDate: DATE, recipient: "o@example.test", send: async () => { sent++; } });
    assert.deepEqual([r.outcome, r.code, r.receipt, sent], ["failed", "invalid_delivery_scope", "not_written", 0]);
    assert.equal(await D.recordMissingNameNotice(rtdb, { tenantId: T, bizId: "biz\u0001c", businessDate: DATE }), "not_recorded");
  } finally { await app.delete(); }
});

// ── DR5-03 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR5-03 a `:` tenant is delivered with its own receipt; a repeat run is already_accepted with no second provider call", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  seedTenant(db, "acme:il", "bizX", "קפה נקודתיים");
  const r1 = await cron();
  assert.equal(r1.statusCode, 200, JSON.stringify(r1.body));
  assert.deepEqual([r1.body.status, r1.body.results.length, smtp.calls.length], ["completed", 2, 2]);
  assert.deepEqual([rowOf(r1, "acme:il", "bizX").settlement, rowOf(r1, "acme:il", "bizX").receipt], ["delivered", "recorded"]);
  assert.equal(db.read(`${RECEIPTS}/acme:il/bizX/${DATE}`).state, "accepted", "the receipt lives at the unchanged path format");
  assert.equal(db.read(`${RECEIPTS}/${T}/${B}/${DATE}`).state, "accepted");
  const r2 = await cron(route, AT + 2 * LEASE);
  assert.deepEqual([r2.statusCode, rowOf(r2, "acme:il", "bizX").code, smtp.calls.length], [200, "already_accepted", 2], "no re-send");
});

// ── DR5-04 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR5-04 a registry business id with a control character: failed invalid_business_identity, no send, no receipt, no node", async () => {
  for (const bad of ["biz\u0001c", "biz\u007fc", "b:c"]) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    seedTenant(db, T2, bad, "Ctrl Biz");
    const { value: r, lines } = await captureConsole(() => cron());
    assert.equal(r.statusCode, 500, JSON.stringify(r.body));
    const row = rowOf(r, T2, bad);
    assert.deepEqual([r.body.status, row.outcome, row.code, row.settlement, row.receipt], ["completed_with_failures", "failed", "invalid_business_identity", "failed", "not_written"], JSON.stringify(bad));
    assert.deepEqual([rowOf(r, T, B).settlement, smtp.calls.length], ["delivered", 1], "the valid business is delivered");
    assert.equal(db.read(`${RECEIPTS}/${T2}`), null, "no receipt under the refused identity");
    assert.equal(db.read(NOTICES), null, "no notice for an identity refusal");
    assert.ok(lines.some((l) => l.includes("business not deliverable") && l.includes("invalid_business_identity")));
  }
});

// ── DR5-05 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR5-05 manual POST refusals before any provider hand-off (G10); the provider classes are unchanged after the gate", async () => {
  const refusals = [
    ["control character in the business id", { tenantId: T, bizId: "biz\u0001c" }, (db) => seedTenant(db, T, "biz\u0001c", "Ctrl"), 400, "invalid_business_identity"],
    ["`:` in the business id", { tenantId: T, bizId: "b:c" }, (db) => seedTenant(db, T, "b:c", "Colon"), 400, "invalid_business_identity"],
    ["control character in the tenant id", { tenantId: "ten\u0001ant", bizId: B }, (db) => seedTenant(db, "ten\u0001ant", B, "Ctrl T"), 400, "invalid_business_identity"],
    ["not registered", { tenantId: T, bizId: B }, (db) => db.seed(`tenants/${T}/app/business`, env([{ id: "other", name: "Other" }])), 404, "business_not_registered"],
    ["duplicate record", { tenantId: T, bizId: B }, (db) => db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "A" }, { id: B, name: "A twin" }])), 422, "ambiguous_business_identity"],
    ["padded twin", { tenantId: T, bizId: B }, (db) => db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "A" }, { id: " " + B, name: SECRET_NAME }])), 422, "ambiguous_business_identity"],
    ["raw array (not the envelope)", { tenantId: T, bizId: B }, (db) => db.seed(`tenants/${T}/app/business`, [{ id: B, name: SECRET_NAME }]), 422, "registry_unreadable"],
    ["invalid JSON", { tenantId: T, bizId: B }, (db) => db.seed(`tenants/${T}/app/business`, { _v: `[{"id":"${B}","name":"${SECRET_NAME}"` }), 422, "registry_unreadable"],
    ["scalar node", { tenantId: T, bizId: B }, (db) => db.seed(`tenants/${T}/app/business`, 0), 422, "registry_unreadable"],
    ["absent registry", { tenantId: T, bizId: B }, (db) => db.seed(`tenants/${T}/app/business`, null), 422, "registry_unreadable"],
    ["missing name", { tenantId: T, bizId: B }, (db) => db.seed(`tenants/${T}/app/business`, env([{ id: B }])), 422, "business_name_unavailable"],
  ];
  for (const [label, body, setup, status, code] of refusals) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    setup(db);
    // the owner's membership of a `:`/control tenant is not seeded: those cases are refused by the gate only if the
    // authorization lets them through, so they run as the owner of the authorized tenant with a refused business id
    const { value: r, lines } = await captureConsole(() => at(AT, () => post(route, body)));
    if (body.tenantId !== T) { assert.ok([400, 401, 403].includes(r.statusCode), label); assert.equal(smtp.calls.length, 0); continue; }
    assert.deepEqual([r.statusCode, r.body.code, r.body.tenantId, r.body.bizId], [status, code, body.tenantId, body.bizId], label + ": " + JSON.stringify(r.body));
    assert.equal(typeof r.body.error, "string"); assert.ok(r.body.error.endsWith("email not sent"), label);
    assert.deepEqual(Object.keys(r.body).sort(), ["bizId", "code", "error", "tenantId"], label + ": bounded body");
    assert.equal(smtp.calls.length, 0, label + ": no provider call");
    assert.deepEqual(lines.filter(leaks), [], label + ": no registry bytes in the log");
    assert.ok(!JSON.stringify(r.body).includes(SECRET_NAME) && !JSON.stringify(r.body).includes("is not valid JSON"), label + ": no registry bytes in the body");
    assert.ok(lines.some((l) => l.includes("manual send refused") && l.includes(`"code":"${code}"`)), label + ": bounded log");
  }
  // 503: the registry read fails (transport) / the build fails after the gate
  for (const [label, path, status, code, logRe] of [["registry read failure", `tenants/${T}/app/business`, 503, "registry_unavailable", /manual send refused/],
    ["build failure", `tenants/${T}/biz:${B}:entries`, 503, "snapshot_build_failed", /manual build failed \((Error|OTHER)\)$/]]) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    const ref = db.ref; db.ref = (p, q) => { const x = ref(p, q); return p === path ? { ...x, once: async () => { throw new Error(SECRET_ADDR); } } : x; };
    const { value: r, lines } = await captureConsole(() => at(AT, () => post(route, { tenantId: T, bizId: B })));
    assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length], [status, code, 0], label);
    assert.deepEqual(lines.filter(leaks), [], label); assert.ok(lines.some((l) => logRe.test(l)), label + "\n" + lines.join("\n"));
  }
  // a builder SyntaxError is a malformed registry (422), never a build failure and never its message
  {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    const ref = db.ref; db.ref = (p, q) => { const x = ref(p, q); return p === `tenants/${T}/biz:${B}:entries` ? { ...x, once: async () => { JSON.parse(SECRET_NAME); } } : x; };
    const { value: r, lines } = await captureConsole(() => at(AT, () => post(route, { tenantId: T, bizId: B })));
    assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length], [422, "registry_unreadable", 0]);
    assert.deepEqual(lines.filter(leaks), []); assert.ok(!JSON.stringify(r.body).includes(SECRET_NAME));
  }
  // the provider classes, reached only after the gate: 502 refused (one hand-off), 504 unknown (one hand-off)
  for (const [script, status, error] of [[SMTP.rejectRecipient(), 502, "email_not_sent"], [SMTP.socketTimeout(), 504, "email_outcome_unknown"]]) {
    seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([script]);
    const r = await at(AT, () => post(route, { tenantId: T, bizId: B }));
    assert.deepEqual([r.statusCode, r.body.error, smtp.calls.length], [status, error, 1]);
    assert.ok(typeof r.body.code === "string" && !["invalid_business_identity", "business_not_registered", "ambiguous_business_identity", "registry_unreadable", "registry_unavailable", "snapshot_build_failed", "business_name_unavailable"].includes(r.body.code), "a provider code, never a gate code");
  }
  // an unknown action is refused before anything else
  { seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    const r = await at(AT, () => post(route, { tenantId: T, bizId: B, action: "send-twice" }));
    assert.deepEqual([r.statusCode, r.body, smtp.calls.length], [400, { error: "invalid_action" }, 0]); }
});

// ── DR5-06 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR5-06 G4 on the manual path with the real builder: a missing name is refused, a business named \"Unknown\" is sent", async () => {
  for (const [label, record] of [["empty", { id: B, name: "" }], ["missing", { id: B }], ["whitespace", { id: B, name: "   " }], ["numeric", { id: B, name: 42 }], ["null", { id: B, name: null }]]) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    db.seed(`tenants/${T}/app/business`, env([record]));
    const { value: r, lines } = await captureConsole(() => at(AT, () => post(route, { tenantId: T, bizId: B })));
    assert.deepEqual([r.statusCode, r.body.code, r.body.error, smtp.calls.length], [422, "business_name_unavailable", "Unknown business snapshot; email not sent", 0], label);
    assert.ok(!lines.some((l) => /"bizName"|placeholder/.test(l)), label);
  }
  for (const name of ["Unknown", "unknown", "לא ידוע", "Unknown Cafe"]) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    db.seed(`tenants/${T}/app/business`, env([{ id: B, name }]));
    const r = await at(AT, () => post(route, { tenantId: T, bizId: B }));
    assert.deepEqual([r.statusCode, r.body.status, r.body.snapshot.bizName, smtp.calls.length], [200, "success", name, 1], name);
    assert.ok(smtp.calls[0].subject.includes(name), "the real name is the one the owner sees: " + smtp.calls[0].subject);
  }
});

// ── DR5-07 / DR5-08: the scheduled path with a STUBBED builder output ─────────────────────────────────────────────────────
// The builder pin of this tree (buildSnapshotForAll) drops a nameless business and a business named "Unknown" before the
// route sees them, so the scheduled G4 case cannot be exercised end to end here: it is PENDING the carried Builder (R4), which
// reports the business as a failed build. What IS exercised is the route's gate on the builder's output shape: a copy of
// the compiled sandbox whose builder module returns the snapshots the test seeds (otherwise the real route, sender, receipts).
// The stub keeps the REAL builder for every snapshot it returns: buildSnapshotForAll = the real discovery + the businesses
// listed in globalThis.__STUB_EXTRA built by the REAL buildSnapshotForBiz, with the builder's own name field replaced by
// the value the test states (the old pin's placeholder "Unknown", or a real name) — i.e. exactly the rows the pin filters out.
async function stubbedRoute() {
  const dir = mkdtempSync(join(tmpdir(), "de1-r5-stub-"));
  cpSync(SANDBOX, dir, { recursive: true, verbatimSymlinks: true });
  const sb = join(dir, "src", "snapshot");
  renameSync(join(sb, "snapshotBuilder.js"), join(sb, "snapshotBuilder.real.js"));
  writeFileSync(join(sb, "snapshotBuilder.js"),
    `import * as real from "./snapshotBuilder.real.js";\n` +
    `export const buildSnapshotForBiz = real.buildSnapshotForBiz;\n` +
    `export async function buildSnapshotForAll() { const all = await real.buildSnapshotForAll();\n` +
    `  for (const [t, b, bizName] of globalThis.__STUB_EXTRA || []) { const s = await real.buildSnapshotForBiz(t, b); all.push({ ...s, bizName }); }\n` +
    `  return all; }\n`);
  return (await import(pathToFileURL(join(dir, "api", "daily-snapshot", "run.js")).href)).default;
}
const stub = await stubbedRoute();

test("DR5-07 G4 scheduled (route gate, stubbed builder output): failed row, no send, no receipt, notice recorded and counted; cleared when named", async () => {
  const db = seedWorld({ withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "מסעדה א" }, { id: B2 }]));            // B2 has no name
  globalThis.__STUB_EXTRA = [[T, B2, "Unknown"]];                                                 // the builder's placeholder for a nameless record, as the old pin emits it
  const { value: r1, lines } = await captureConsole(() => cron(stub));
  assert.equal(r1.statusCode, 500, JSON.stringify(r1.body));
  const row = rowOf(r1, T, B2);
  assert.deepEqual([r1.body.status, row.outcome, row.code, row.settlement, row.receipt, row.notice], ["completed_with_failures", "failed", "business_name_unavailable", "failed", "not_written", "recorded"]);
  assert.deepEqual([rowOf(r1, T, B).settlement, smtp.calls.length, r1.body.skippedCount, r1.body.failureCount], ["delivered", 1, 0, 1], "the named business is delivered; nothing is a silent no-send");
  assert.equal(db.read(`${RECEIPTS}/${T}/${B2}`), null, "no receipt for the refused business");
  const n1 = db.read(`${NOTICES}/${T}/${B2}`);
  assert.deepEqual([n1.code, n1.message, n1.tenantId, n1.bizId, n1.businessDate, n1.runs, n1.firstSeenAt, n1.lastSeenAt], ["business_name_unavailable", HE, T, B2, DATE, 1, AT, AT]);
  assert.deepEqual(Object.keys(n1).sort(), ["bizId", "businessDate", "code", "firstSeenAt", "lastSeenAt", "message", "runs", "tenantId"], "no financial figure, no address, no name in the notice");
  assert.ok(!smtp.calls.some((c) => c.subject.includes("Unknown")), "no e-mail carries the placeholder");
  assert.ok(lines.some((l) => l.includes("business not deliverable") && l.includes("business_name_unavailable")));
  // the next run: still refused, counted, first-seen preserved; the delivered business is already_accepted (one provider call in total)
  const r2 = await cron(stub, AT + 2 * LEASE);
  const n2 = db.read(`${NOTICES}/${T}/${B2}`);
  assert.deepEqual([r2.statusCode, rowOf(r2, T, B2).code, rowOf(r2, T, B).code, smtp.calls.length, n2.runs, n2.firstSeenAt, n2.lastSeenAt], [500, "business_name_unavailable", "already_accepted", 1, 2, AT, AT + 2 * LEASE]);
  // the owner reads the notice (action: "notice") — the same authorization as a manual send; nothing is sent
  const read1 = await at(AT, () => post(stub, { tenantId: T, bizId: B2, action: "notice" }));
  assert.deepEqual([read1.statusCode, read1.body.deliverable, read1.body.code, read1.body.notice.message, read1.body.notice.runs, smtp.calls.length], [200, false, "business_name_unavailable", HE, 2, 1]);
  // the owner repairs the name through the authorized path (the registry record keeps its identity); the notice is cleared on read
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "מסעדה א" }, { id: B2, name: "מסעדה ב" }]));
  const read2 = await at(AT, () => post(stub, { tenantId: T, bizId: B2, action: "notice" }));
  assert.deepEqual([read2.statusCode, read2.body.deliverable, read2.body.notice, db.read(`${NOTICES}/${T}/${B2}`)], [200, true, null, null]);
  // and the next run delivers it with its real name
  globalThis.__STUB_EXTRA = [];                                                                   // the real discovery now includes the named B2
  const r3 = await cron(stub, AT + 4 * LEASE);
  assert.deepEqual([r3.statusCode, rowOf(r3, T, B2).settlement, smtp.calls.length], [200, "delivered", 2]);
  // a business genuinely named "Unknown" on the scheduled path is delivered (route gate; end-to-end pending the carried Builder)
  const db2 = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp2 = installSmtp([SMTP.accept()]);
  db2.seed(`tenants/${T}/app/business`, env([{ id: B, name: "Unknown" }]));
  globalThis.__STUB_EXTRA = [[T, B, "Unknown"]];                                                   // the pin drops it; the gate sees a named business
  const r4 = await cron(stub);
  assert.deepEqual([r4.statusCode, rowOf(r4, T, B).settlement, smtp2.calls.length, db2.read(NOTICES)], [200, "delivered", 1, null]);
  // a notice read before any scheduled run: the same notice, not yet counted
  const db3 = seedWorld({ withSecondBiz: false, withSecondTenant: false }); installSmtp([SMTP.accept()]);
  db3.seed(`tenants/${T}/app/business`, env([{ id: B, name: "" }]));
  const read3 = await at(AT, () => post(route, { tenantId: T, bizId: B, action: "notice" }));
  assert.deepEqual([read3.statusCode, read3.body.deliverable, read3.body.notice.message, read3.body.notice.runs], [200, false, HE, 0]);
});

test("DR5-08 the notice is owner-only and tenant-isolated: viewer, manager and another tenant's owner are refused by the unchanged authorization", async () => {
  const db = seedWorld(); installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "" }, { id: B2, name: "מסעדה ב" }]));
  db.seed(`tenants/${T}/members/u_manager_a`, true); db.seed(`tenants/${T}/roles/u_manager_a`, "manager");
  db.seed(`tenants/${T}/biz_access/${B}/u_viewer_a`, true); db.seed(`tenants/${T}/biz_access/${B}/u_manager_a`, true);
  const owner = await at(AT, () => post(route, { tenantId: T, bizId: B, action: "notice" }));
  assert.deepEqual([owner.statusCode, owner.body.notice.message], [200, HE]);
  for (const [uid, email, error] of [["u_viewer_a", "viewer-a@example.test", "insufficient role"], ["u_manager_a", "manager-a@example.test", "owner_role_required"]]) {
    const r = await at(AT, () => post(route, { tenantId: T, bizId: B, action: "notice" }, { uid, email }));
    assert.deepEqual([r.statusCode, r.body], [403, { error }], uid + " (the unchanged write-mode floor, then the route's owner gate)");
  }
  const other = await at(AT, () => post(route, { tenantId: T, bizId: B, action: "notice" }, { uid: "u_owner_b", email: "owner-b@example.test" }));
  assert.ok([401, 403].includes(other.statusCode) && other.body.notice === undefined, "another tenant's owner: " + JSON.stringify(other.body));
  const foreign = await at(AT, () => post(route, { tenantId: T2, bizId: B3, action: "notice" }));
  assert.ok([401, 403].includes(foreign.statusCode) && foreign.body.notice === undefined, "the owner of A asking about tenant B: " + JSON.stringify(foreign.body));
  // the notice node lives under the top-level email_delivery root: the Rules have no rule for it (`$other` denies every client)
  const rules = JSON.parse(readFileSync(new URL("../../database.rules.json", import.meta.url), "utf8")).rules;
  assert.equal(rules.email_delivery, undefined); assert.deepEqual(rules.$other, { ".read": false, ".write": false });
});

// ── DR5-09 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR5-09 unknown outcomes stay held and are never re-sent; an accepted receipt at the unchanged path is honoured", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.socketTimeout(), SMTP.accept()]);
  const r1 = await cron();
  assert.deepEqual([r1.statusCode, rowOf(r1, T, B).settlement, smtp.calls.length], [500, "unknown", 1]);
  const r2 = await cron(route, AT + 2 * LEASE);
  assert.deepEqual([r2.statusCode, rowOf(r2, T, B).code, rowOf(r2, T, B).settlement, smtp.calls.length], [500, "unknown_requires_reconciliation", "unknown", 1], "held, never re-sent");
  // a receipt written before this change (the same path format) is honoured: no provider call
  const db2 = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp2 = installSmtp([SMTP.accept()]);
  db2.seed(`${RECEIPTS}/${T}/${B}/${DATE}`, { v: D.RECEIPT_VERSION, state: "accepted", attempts: 1, updatedAt: AT - LEASE });
  const r3 = await cron();
  assert.deepEqual([r3.statusCode, rowOf(r3, T, B).code, smtp2.calls.length], [200, "already_accepted", 0]);
});
