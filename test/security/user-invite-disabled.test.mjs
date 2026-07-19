// Blocker-2 regression: the unauthorized `send-user-invite` admin action is REMOVED
// and fails closed. Any request (authenticated or not) receives a stable
// unsupported-action response and NO email is ever sent. Legitimate invite flows
// (create-user, super_owner-gated resend-invite) remain intact.
// Run: node test/security/user-invite-disabled.test.mjs
// NO network / Firebase / SMTP: the disabled branch returns before any auth/email.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const adminSrc = readFileSync(join(REPO, "api", "admin.js"), "utf8");
const indexHtml = readFileSync(join(REPO, "index.html"), "utf8");
const landingHtml = readFileSync(join(REPO, "landing.html"), "utf8");

let pass = 0, fail = 0;
// Async-aware runner: awaits the callback so a returned promise, async body,
// thrown error, or rejected promise is captured as a real PASS/FAIL — a test can
// never report success before its assertions finish.
const T = async (n, fn) => { try { await fn(); console.log("PASS " + n); pass++; }
  catch (e) { console.log("FAIL " + n + " — " + (e && e.message)); fail++; } };
// Any promise rejection that still escapes a test fails the whole run.
process.on("unhandledRejection", (e) => { console.log("FAIL unhandledRejection — " + (e && e.message)); fail++; process.exitCode = 1; });
process.on("uncaughtException", (e) => { console.log("FAIL uncaughtException — " + (e && e.message)); fail++; process.exitCode = 1; });

function mkRes() {
  return { statusCode: null, body: null, ended: false, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.ended = true; return this; },
    end() { this.ended = true; return this; } };
}
const mkReq = (body, headers = {}) =>
  ({ method: "POST", query: { action: "send-user-invite" }, headers, body });

// Tripwire: if the email helper is ever reached, importing SMTP would throw; but we
// also assert the response never signals delivery, and that no env is required.
delete process.env.SMTP_EMAIL; delete process.env.SMTP_APP_PASSWORD;

const mod = await import(join(REPO, "api", "admin.js"));
const handler = mod.default;

// ── Behavioral: dispatch-level fail-closed (offline) ────────────────────────
  // 1. Unauthenticated request (no Authorization header) is rejected, not delivered.
  await T("1: unauthenticated send-user-invite → 410 unsupported_action, no delivery", async () => {
    const res = mkRes();
    await handler(mkReq({ email: "a@evil.test", username: "u", tempPass: "SECRET" }), res);
    assert.strictEqual(res.statusCode, 410);
    assert.strictEqual(res.body.error, "unsupported_action");
    assert.ok(!("emailSent" in res.body), "must not report emailSent");
    assert.ok(!res.body.ok, "must not return ok:true");
  });
  // 2. Ordinary 'authenticated-looking' request with a bearer header → same 410.
  await T("2: authenticated-looking request → identical 410 (no privileged path)", async () => {
    const res = mkRes();
    await handler(mkReq({ email: "a@evil.test", username: "u", tempPass: "SECRET" },
      { authorization: "Bearer fake.jwt.token" }), res);
    assert.strictEqual(res.statusCode, 410);
    assert.strictEqual(res.body.error, "unsupported_action");
  });
  // 3. Caller-supplied arbitrary recipient / credential / link / branded body cannot be delivered.
  await T("3: attacker-controlled recipient/tempPass/inviteLink/bizName never delivered", async () => {
    const res = mkRes();
    await handler(mkReq({ email: "victim@target.test", username: "victim",
      tempPass: "PLANTED-CREDENTIAL", bizName: "<b>Spoofed Bank</b>",
      inviteLink: "https://phishing.evil.test/steal" }), res);
    assert.strictEqual(res.statusCode, 410);
    assert.ok(!res.body.emailSent && !res.body.ok);
    // response must not echo the attacker-supplied sensitive fields
    const blob = JSON.stringify(res.body);
    assert.ok(!/PLANTED-CREDENTIAL|phishing\.evil\.test|victim@target\.test/.test(blob),
      "response must not echo attacker-supplied sensitive fields");
  });
  // 4. Cross-tenant/scope body is irrelevant — still fails closed.
  await T("4: cross-tenant/extra scope fields → still 410", async () => {
    const res = mkRes();
    await handler(mkReq({ email: "a@evil.test", username: "u", tempPass: "x",
      tenantId: "other-tenant", bizId: "other-biz" }), res);
    assert.strictEqual(res.statusCode, 410);
    assert.strictEqual(res.body.error, "unsupported_action");
  });

// ── Source guarantees ───────────────────────────────────────────────────────
await T("5: handleSendUserInvite function is removed entirely", () => {
  assert.ok(!/function\s+handleSendUserInvite/.test(adminSrc), "handler must be gone");
});
await T("6: send-user-invite no longer routes to any handler", () => {
  assert.ok(!/action === "send-user-invite"\)\s*return handle/.test(adminSrc));
  assert.ok(/action === "send-user-invite"[\s\S]{0,200}unsupported_action/.test(adminSrc),
    "must fail closed with unsupported_action");
});
await T("7: the fail-closed branch returns before any auth/email call", () => {
  const i = adminSrc.indexOf('action === "send-user-invite"');
  const branch = adminSrc.slice(i, i + 260);
  assert.ok(/return;/.test(branch));
  assert.ok(!/sendEmail|requireAuth|buildInviteEmailHtml/.test(branch),
    "disabled branch must not reach auth or email helpers");
});
await T("8: no frontend/runtime caller references send-user-invite", () => {
  assert.ok(!/send-user-invite/.test(indexHtml));
  assert.ok(!/send-user-invite/.test(landingHtml));
});
await T("9: legitimate resend-invite remains super_owner-gated (unchanged)", () => {
  assert.ok(/function handleResendInvite/.test(adminSrc));
  const i = adminSrc.indexOf("function handleResendInvite");
  const body = adminSrc.slice(i, i + 1400);
  assert.ok(/super_owner/.test(body), "resend-invite still requires super_owner");
});
await T("10: create-user invite flow still present (server-derived)", () => {
  assert.ok(/function handleCreateUser/.test(adminSrc));
});

console.log("Total: " + (pass + fail) + "  Passed: " + pass + "  Failed: " + fail);
process.exit(fail > 0 ? 1 : 0);
