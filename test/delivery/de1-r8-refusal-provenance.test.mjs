// DE1 R8 — the builder refusal's provenance marker on the manual path (LOCAL author candidate; pending independent Codex
// review). Answers the independent review of the Builder carry-forward R5 (CF5-01, 2026-10-09): the R7 route attributed a
// manual builder throw by MESSAGE EQUALITY alone, so an unrelated error escaping the financial loader with a message equal to
// a bounded code (e.g. Error("registry_unreadable") from the entries read) reached the owner as a malformed registry although
// the route's own gate had found the registry valid. The Builder successor 690a07d9 makes a genuine refusal observable without
// exporting its class: an Error with `name === "SnapshotIdentityRefusal"`, an OWN `code` equal to its `message`, the message
// in the six-code §3 set. R8 requires all three (every read guarded) and maps everything else to 503 snapshot_build_failed.
//
//   DR8-01  the marker matrix through the real route (builder seam): the six genuine codes carry the owner's statuses whatever
//           the Error subclass; a plain Error(code), SyntaxError(code), TypeError(code), a record { name, code, message } that
//           is not an Error, a name-only marker, a code-only marker, an inherited (prototype) code, a code ≠ message, a message
//           outside the set, a wrong-case / padded name, a code equal to the message only by coercion (a number, a String
//           object, an object whose toString is the message), a marked SyntaxError carrier with a message outside the set or
//           a code ≠ message, a throwing `name` / `code` / `message` accessor, a Proxy whose own-property check throws, a
//           revoked Proxy — each 503 snapshot_build_failed; zero provider calls; bounded bodies;
//           class-only log; no raw text
//   DR8-02  the reviewer's cases through the real pinned builder: a valid registry + a SyntaxError from the entries read, and a
//           valid registry + Error("registry_unreadable") / Error("business_name_unavailable") from the entries read, are 503
//           snapshot_build_failed with zero provider calls and NO change to the registry gate's own refusals (the gate still
//           answers 400 / 404 / 422 / 503 itself before the builder runs)
//   DR8-03  privacy: nothing of a marker-shaped or unmarked throw (secret text in message / code / name) reaches the body or
//           the log; the log carries only the bounded class
//   DR8-04  the notice action never reaches the builder: a notice read on a business whose builder would throw a marker makes
//           zero builder calls and zero provider calls (the R7 contract is untouched)
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, writeFileSync, renameSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, mkRes, captureConsole, T, B } from "../support/daily-email-harness.mjs";

const { route, dir: SANDBOX } = await buildSandbox();
const AT = Date.UTC(2026, 8, 8, 4, 5);
const at = async (ms, fn) => { const u = freezeClock(ms); try { return await fn(); } finally { u(); } };
const env = (v) => ({ _v: JSON.stringify(v) });
const SECRET = "private-loader-detail-7f3a";
const leaks = (l) => l.includes(SECRET) || l.includes("is not valid JSON");
const MARKER = "SnapshotIdentityRefusal";
const CODES = [["invalid_business_identity", 400], ["business_not_registered", 404], ["ambiguous_business_identity", 422], ["registry_unreadable", 422], ["business_name_unavailable", 422], ["registry_unavailable", 503]];
async function post(r, body, { uid = "u_owner_a", email = "owner-a@example.test" } = {}) {
  process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "fixture-app-password-not-real";
  globalThis.__DE = { requireAuth: async () => ({ uid, email }) };
  const res = mkRes();
  await r({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body }, res);
  return res;
}
/** a genuine marker as the Builder successor produces it: own non-enumerable `code`, `name` set on the instance */
const refusal = (code, Base = Error) => { const e = new Base(code); e.name = MARKER; Object.defineProperty(e, "code", { value: code, enumerable: false, writable: false, configurable: false }); return e; };

// a copy of the compiled sandbox whose manual builder throws what the test states (the route only ever sees the thrown value)
async function throwingBuilderRoute() {
  const dir = mkdtempSync(join(tmpdir(), "de1-r8-throw-"));
  cpSync(SANDBOX, dir, { recursive: true, verbatimSymlinks: true });
  const sb = join(dir, "src", "snapshot");
  renameSync(join(sb, "snapshotBuilder.js"), join(sb, "snapshotBuilder.real.js"));
  writeFileSync(join(sb, "snapshotBuilder.js"),
    `import * as real from "./snapshotBuilder.real.js";\n` +
    `export const buildSnapshotForAll = real.buildSnapshotForAll;\n` +
    `export async function buildSnapshotForBiz(t, b, o) { globalThis.__STUB_CALLS = (globalThis.__STUB_CALLS || 0) + 1; if (globalThis.__STUB_THROW) throw globalThis.__STUB_THROW(); return real.buildSnapshotForBiz(t, b, o); }\n`);
  return (await import(pathToFileURL(join(dir, "api", "daily-snapshot", "run.js")).href)).default;
}
const stub = await throwingBuilderRoute();
async function manualWith(make) {
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  globalThis.__STUB_THROW = make;
  const { value: r, lines } = await captureConsole(() => at(AT, () => post(stub, { tenantId: T, bizId: B })));
  globalThis.__STUB_THROW = null;
  return { r, lines, smtp };
}

// ── DR8-01 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR8-01 the provenance marker decides: all three fields, or a build failure", async () => {
  for (const [code, status] of CODES) {
    for (const [cls, make] of [["Error", () => refusal(code)], ["SyntaxError", () => refusal(code, SyntaxError)], ["TypeError", () => refusal(code, TypeError)],
      ["enumerable writable code", () => Object.assign(new Error(code), { name: MARKER, code })],
      ["Error subclass", () => { class R extends Error { constructor(c) { super(c); this.name = MARKER; this.code = c; } } return new R(code); }]]) {
      const { r, lines, smtp } = await manualWith(make);
      assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length], [status, code, 0], `${cls}(${code}): ` + JSON.stringify(r.body));
      assert.deepEqual(Object.keys(r.body).sort(), ["bizId", "code", "error", "tenantId"], `${cls}(${code}): bounded body`);
      assert.ok(r.body.error.endsWith("email not sent"), cls);
      assert.ok(lines.some((l) => /manual build failed \((Error|OTHER|SyntaxError|TypeError)\)$/.test(l)), `${cls}(${code}): class-only log (the marker's name is never logged)\n` + lines.join("\n"));
      assert.ok(!lines.some((l) => l.includes(MARKER)), `${cls}(${code}): the marker name itself is not logged`);
    }
  }
  const code = "registry_unreadable";
  const unattributed = [
    ["plain Error(code)", () => new Error(code)],
    ["SyntaxError(code)", () => new SyntaxError(code)],
    ["TypeError(code)", () => new TypeError(code)],
    ["record with all three fields but not an Error", () => ({ name: MARKER, code, message: code })],
    ["name only", () => Object.assign(new Error(code), { name: MARKER })],
    ["code only (name Error)", () => Object.assign(new Error(code), { code })],
    ["inherited code (prototype)", () => { const e = new Error(code); e.name = MARKER; Object.setPrototypeOf(e, Object.assign(Object.create(Error.prototype), { code })); return e; }],
    ["code ≠ message", () => Object.assign(new Error(code), { name: MARKER, code: "business_not_registered" })],
    ["code equal, message outside the set", () => Object.assign(new Error("snapshot_build_failed"), { name: MARKER, code: "snapshot_build_failed" })],
    ["code equal, message a near miss", () => Object.assign(new Error(code + ":" + SECRET), { name: MARKER, code: code + ":" + SECRET })],
    ["wrong-case name", () => Object.assign(new Error(code), { name: "snapshotidentityrefusal", code })],
    ["padded name", () => Object.assign(new Error(code), { name: MARKER + " ", code })],
    ["non-string code equal by coercion", () => Object.assign(new Error("5"), { name: MARKER, code: 5, message: "5" })],
    ["String-object code equal by coercion, message in the set", () => Object.assign(new Error(code), { name: MARKER, code: new String(code) })],
    ["object code whose toString is the message", () => Object.assign(new Error(code), { name: MARKER, code: { toString: () => code } })],
    ["marked SyntaxError, message outside the set", () => Object.assign(new SyntaxError("snapshot_build_failed"), { name: MARKER, code: "snapshot_build_failed" })],
    ["marked SyntaxError, message a near miss", () => Object.assign(new SyntaxError(code + ":" + SECRET), { name: MARKER, code: code + ":" + SECRET })],
    ["marked SyntaxError, code ≠ message", () => Object.assign(new SyntaxError(code), { name: MARKER, code: "business_not_registered" })],
    ["throwing name getter", () => Object.defineProperty(Object.assign(new Error(code), { code }), "name", { get() { throw new Error(SECRET); } })],
    ["throwing code getter", () => Object.defineProperty(Object.assign(new Error(code), { name: MARKER }), "code", { get() { throw new Error(SECRET); } })],
    ["throwing message getter", () => Object.defineProperty(Object.assign(new Error(code), { name: MARKER, code }), "message", { get() { throw new Error(SECRET); } })],
    ["Proxy whose own-property check throws", () => new Proxy(refusal(code), { getOwnPropertyDescriptor() { throw new Error(SECRET); } })],
    ["Proxy whose name read throws", () => new Proxy(refusal(code), { get(t, k) { if (k === "name") throw new Error(SECRET); return Reflect.get(t, k); } })],
    ["revoked Proxy", () => { const p = Proxy.revocable(refusal(code), {}); p.revoke(); return p.proxy; }],
    ["a string", () => code], ["null", () => null], ["undefined", () => undefined], ["a number", () => 422],
  ];
  for (const [label, make] of unattributed) {
    const { r, lines, smtp } = await manualWith(make);
    assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length], [503, "snapshot_build_failed", 0], label + ": " + JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body).sort(), ["bizId", "code", "error", "tenantId"], label + ": bounded body");
    assert.ok(!JSON.stringify(r.body).includes(SECRET) && lines.filter(leaks).length === 0, label + ": no raw text");
    assert.ok(lines.some((l) => /manual build failed \((Error|OTHER|SyntaxError|TypeError|RangeError)\)$/.test(l)), label + ": class-only log\n" + lines.join("\n"));
  }
  // control: nothing thrown → the stub route sends exactly like the real one
  const { r: ok, smtp } = await manualWith(null);
  assert.deepEqual([ok.statusCode, ok.body.status, smtp.calls.length], [200, "success", 1]);
});

// ── DR8-02 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR8-02 the reviewer's cases through the real pinned builder: the registry gate refuses itself; a loader throw is a build failure", async () => {
  for (const [label, make] of [["SyntaxError from the entries read", () => { try { JSON.parse(SECRET); } catch (e) { return e; } }],
    ["Error('registry_unreadable') from the entries read", () => new Error("registry_unreadable")],
    ["Error('business_name_unavailable') from the entries read", () => new Error("business_name_unavailable")],
    ["Error('registry_unavailable') with a code property", () => Object.assign(new Error("registry_unavailable"), { code: "registry_unavailable" })]]) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    const ref = db.ref; db.ref = (p, q) => { const x = ref(p, q); return p === `tenants/${T}/biz:${B}:entries` ? { ...x, once: async () => { throw make(); }, get: async () => { throw make(); } } : x; };
    const { value: r, lines } = await captureConsole(() => at(AT, () => post(route, { tenantId: T, bizId: B })));
    assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length], [503, "snapshot_build_failed", 0], label + ": " + JSON.stringify(r.body));
    assert.deepEqual(lines.filter(leaks), [], label);
    assert.deepEqual(db.read(`tenants/${T}/app/business`), env([{ id: B, name: "מסעדה א" }]), label + ": the registry was valid throughout");
  }
  // the gate's own refusals are untouched (they never reach the builder): a sample of each status
  for (const [label, setup, status, code] of [
    ["`:` in the business id", null, 400, "invalid_business_identity"],
    ["not registered", (db) => db.seed(`tenants/${T}/app/business`, env([{ id: "other", name: "Other" }])), 404, "business_not_registered"],
    ["duplicate record", (db) => db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "A" }, { id: B, name: "A twin" }])), 422, "ambiguous_business_identity"],
    ["invalid JSON", (db) => db.seed(`tenants/${T}/app/business`, { _v: "[{" }), 422, "registry_unreadable"],
    ["missing name", (db) => db.seed(`tenants/${T}/app/business`, env([{ id: B }])), 422, "business_name_unavailable"]]) {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    if (setup) setup(db);
    globalThis.__STUB_CALLS = 0;
    const r = await at(AT, () => post(stub, { tenantId: T, bizId: label === "`:` in the business id" ? "b:c" : B }));
    assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length, globalThis.__STUB_CALLS], [status, code, 0, 0], label + ": refused by the gate, the builder never called: " + JSON.stringify(r.body));
  }
  // a registry read failure: 503 registry_unavailable from the gate, builder never called
  { const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    const ref = db.ref; db.ref = (p, q) => { const x = ref(p, q); return p === `tenants/${T}/app/business` ? { ...x, once: async () => { throw new Error(SECRET); } } : x; };
    globalThis.__STUB_CALLS = 0;
    const r = await at(AT, () => post(stub, { tenantId: T, bizId: B }));
    assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length, globalThis.__STUB_CALLS], [503, "registry_unavailable", 0, 0]); }
});

// ── DR8-03 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR8-03 privacy: nothing of a marker-shaped or unmarked throw reaches the body or the log", async () => {
  for (const [label, make] of [
    ["secret in the message of a marked Error", () => Object.assign(new Error(SECRET), { name: MARKER, code: SECRET })],
    ["secret in the name", () => Object.assign(new Error("registry_unreadable"), { name: MARKER + SECRET, code: "registry_unreadable" })],
    ["secret in a stack-only error", () => { const e = refusal("registry_unreadable"); e.stack = SECRET; return e; }],
    ["secret in an extra property of a genuine marker", () => Object.assign(refusal("registry_unreadable"), { detail: SECRET })]]) {
    const { r, lines } = await manualWith(make);
    assert.ok(!JSON.stringify(r.body).includes(SECRET), label + ": body");
    assert.deepEqual(lines.filter(leaks), [], label + ": log");
    assert.ok(["bizId", "code", "error", "tenantId"].every((k) => k in r.body) && Object.keys(r.body).length === 4, label + ": bounded body");
  }
});

// ── DR8-04 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR8-04 the notice action never reaches the builder or the provider", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  globalThis.__STUB_THROW = () => refusal("registry_unreadable"); globalThis.__STUB_CALLS = 0;
  const r = await at(AT, () => post(stub, { tenantId: T, bizId: B, action: "notice" }));
  globalThis.__STUB_THROW = null;
  assert.deepEqual([r.statusCode, r.body.status, r.body.deliverable, r.body.noticeState, r.body.clearState, smtp.calls.length, globalThis.__STUB_CALLS], [200, "ok", true, "none", "not_needed", 0, 0], JSON.stringify(r.body));
  db.seed(`tenants/${T}/app/business`, env([{ id: B }]));
  const r2 = await at(AT, () => post(stub, { tenantId: T, bizId: B, action: "notice" }));
  assert.deepEqual([r2.statusCode, r2.body.deliverable, r2.body.code, r2.body.noticeState, smtp.calls.length, globalThis.__STUB_CALLS], [200, false, "business_name_unavailable", "none", 0, 0]);
});
