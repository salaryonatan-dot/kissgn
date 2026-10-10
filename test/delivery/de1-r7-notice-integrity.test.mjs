// DE1 R7 — G10 error attribution and owner-notice read / clear integrity (LOCAL author candidate; pending independent
// Codex review). Answers the independent review of the R5 owner-decisions candidate (2026-10-09):
//   OD-01  a SyntaxError raised while the snapshot DATA is read, with a valid registry, was 422 registry_unreadable: the
//          route inferred the SOURCE of a failure from the exception class. R7 classifies by the operation that failed: the
//          registry is read and resolved by the route's own gate before the builder runs; a builder throw is the code the
//          builder itself attributed (contract §3: Error(<code>), message equal to the code) or else snapshot_build_failed.
//   OD-02  a failed notice read was reported as a synthesized `runs: 0` notice with HTTP 200, and a failed notice removal
//          as HTTP 200 / notice: null while the notice stayed stored. R7 reports the business / name state, the notice
//          STORE state and the clear state distinctly; a store that cannot be read or cleared is 503 `status: "unavailable"`;
//          nothing is manufactured and "cleared" is claimed only once the removal is acknowledged.
//
//   DR7-01  G10 attribution through the real route: the reviewer's case (SyntaxError from the entries read, valid registry)
//           is 503 snapshot_build_failed; any unattributed class is 503; a builder-attributed bounded code is mapped as such
//           whatever the class; a near-miss message, an empty message and a throwing `message` getter are 503; zero provider
//           calls; no raw text in the body or the log
//   DR7-02  notice READ failure (the reviewer's case): 503 unavailable, no synthesized notice, business state still reported,
//           the stored record untouched; a retry once the store reads again returns the stored record (runs preserved)
//   DR7-03  notice CLEAR failure (the reviewer's case): 503 unavailable, clearState failed, noticeState stale, the record is
//           still stored and is returned as stored; a retry once the store writes again clears it (acknowledged), and the
//           next read is none / not_needed
//   DR7-04  a read failure while the name is present: nothing is removed (no clear is attempted on an unknown store state)
//   DR7-05  nothing stored, name missing: 200, deliverable false, noticeState none, notice null — no manufactured record
//           (no message, no runs: 0); nothing stored, name present: none / not_needed, nothing written
//   DR7-06  authorization and tenant isolation are unchanged on the failure paths: a viewer, a manager and another tenant's
//           owner are refused before the store is touched (zero notice-path reads), even when the store is broken
//   DR7-07  the registry cannot be read: 503 registry_unavailable with deliverable null; the store is not consulted
//   DR7-08  a stored notice for a business that is no longer in the missing-name state but is not deliverable either
//           (not registered): reported stale, not cleared, not manufactured
//   DR7-09  the scheduled path is unchanged: a missing name still records the notice; a notice read failure on a later owner
//           read never hides it, and the stored record is what a successful read returns
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, writeFileSync, renameSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSandbox, installSmtp, SMTP, seedWorld, freezeClock, runCron, mkRes, captureConsole, T, B, B2, T2, B3 } from "../support/daily-email-harness.mjs";
import * as D from "../../lib/emailDelivery.js";

const { route, dir: SANDBOX } = await buildSandbox();
const AT = Date.UTC(2026, 8, 8, 4, 5), DATE = "2026-09-08", LEASE = 10 * 60 * 1000;
const at = async (ms, fn) => { const u = freezeClock(ms); try { return await fn(); } finally { u(); } };
const env = (v) => ({ _v: JSON.stringify(v) });
const NOTICES = D.DELIVERY_NOTICE_ROOT;
const HE = D.MISSING_NAME_NOTICE_HE;
const SECRET_NAME = "Secret Cafe", SECRET_ADDR = "private@example.test", SECRET_TEXT = "disk sector 0xDEAD";
const leaks = (l) => l.includes(SECRET_NAME) || l.includes(SECRET_ADDR) || l.includes(SECRET_TEXT) || l.includes("is not valid JSON");
const noticePath = (t = T, b = B) => `${NOTICES}/${t}/${b}`;
/** a POST with an explicit body (action) as the authenticated user */
async function post(r, body, { uid = "u_owner_a", email = "owner-a@example.test" } = {}) {
  process.env.SMTP_EMAIL = "sender@example.test"; process.env.SMTP_APP_PASSWORD = "fixture-app-password-not-real";
  globalThis.__DE = { requireAuth: async () => ({ uid, email }) };
  const res = mkRes();
  await r({ method: "POST", headers: { authorization: "Bearer user-token" }, query: {}, body }, res);
  return res;
}
const notice = (r, body, who) => post(r, { tenantId: T, bizId: B, action: "notice", ...body }, who);
/** Fault injection on ONE path of the in-memory RTDB: `once` and / or `remove` throw; every other path is untouched. */
function breakPath(db, path, { read = false, remove = false } = {}) {
  const ref = db.ref; const touched = { reads: 0, removes: 0 };
  db.ref = (p, q) => {
    const x = ref(p, q);
    if (p !== path) return x;
    return { ...x,
      once: async (...a) => { touched.reads++; if (read) throw new Error(SECRET_TEXT); return x.once(...a); },
      remove: async (...a) => { touched.removes++; if (remove) throw new Error(SECRET_TEXT); return x.remove(...a); } };
  };
  const restore = () => { db.ref = ref; };
  return { touched, restore };
}
const storedNotice = (runs = 4, message = HE) => ({ code: "business_name_unavailable", message, tenantId: T, bizId: B, businessDate: DATE, firstSeenAt: AT - LEASE, lastSeenAt: AT, runs });
const bodyKeys = (r) => Object.keys(r.body).sort();
const OK_KEYS = ["bizId", "clearState", "code", "deliverable", "notice", "noticeState", "status", "tenantId"];
const UNAVAILABLE_KEYS = [...OK_KEYS, "error"].sort();

// A copy of the compiled sandbox whose manual builder throws what the test states (the route only ever sees the thrown value).
async function throwingBuilderRoute() {
  const dir = mkdtempSync(join(tmpdir(), "de1-r7-throw-"));
  cpSync(SANDBOX, dir, { recursive: true, verbatimSymlinks: true });
  const sb = join(dir, "src", "snapshot");
  renameSync(join(sb, "snapshotBuilder.js"), join(sb, "snapshotBuilder.real.js"));
  writeFileSync(join(sb, "snapshotBuilder.js"),
    `import * as real from "./snapshotBuilder.real.js";\n` +
    `export const buildSnapshotForAll = real.buildSnapshotForAll;\n` +
    `export async function buildSnapshotForBiz(t, b, o) { if (globalThis.__STUB_THROW) throw globalThis.__STUB_THROW(); return real.buildSnapshotForBiz(t, b, o); }\n`);
  return (await import(pathToFileURL(join(dir, "api", "daily-snapshot", "run.js")).href)).default;
}

// ── DR7-01 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR7-01 G10 attribution: the source of a failure is the operation that failed, never the exception class", async () => {
  // the reviewer's case: a valid registry, a SyntaxError raised while the snapshot data (entries) is read
  {
    const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    const ref = db.ref; db.ref = (p, q) => { const x = ref(p, q); return p === `tenants/${T}/biz:${B}:entries` ? { ...x, once: async () => { throw new SyntaxError("unrelated entries decoder " + SECRET_NAME); } } : x; };
    const { value: r, lines } = await captureConsole(() => at(AT, () => post(route, { tenantId: T, bizId: B })));
    assert.deepEqual([r.statusCode, r.body.code, r.body.error, smtp.calls.length], [503, "snapshot_build_failed", "Snapshot could not be built; email not sent", 0], JSON.stringify(r.body));
    assert.deepEqual(bodyKeys(r), ["bizId", "code", "error", "tenantId"]);
    assert.deepEqual(lines.filter(leaks), []); assert.ok(lines.some((l) => /manual build failed \(SyntaxError\)$/.test(l)), "the class is logged, never the message");
    assert.ok(lines.some((l) => l.includes("manual send refused") && l.includes('"code":"snapshot_build_failed"')) || lines.some((l) => l.includes("manual send refused") && l.includes("snapshot_build_failed")));
    assert.deepEqual(db.read(`tenants/${T}/app/business`), env([{ id: B, name: "מסעדה א" }]), "the registry was valid throughout");
  }
  // every thrown value the builder does not attribute is a build failure, whatever its class or shape
  const stub = await throwingBuilderRoute();
  const unattributed = [
    ["SyntaxError (JSON.parse)", () => { try { JSON.parse(SECRET_NAME); } catch (e) { return e; } }, "SyntaxError"],
    ["TypeError", () => new TypeError(SECRET_TEXT), "TypeError"],
    ["RangeError", () => new RangeError("Invalid array length"), "RangeError"],
    ["Error with a near-miss message", () => new Error("registry_unreadable: " + SECRET_TEXT), "Error"],
    ["Error with an upper-cased code", () => new Error("REGISTRY_UNREADABLE"), "Error"],
    ["Error with a padded code", () => new Error(" registry_unreadable"), "Error"],
    ["Error with the build-failure word itself", () => new Error("snapshot_build_failed"), "Error"],
    ["empty message", () => new Error(""), "Error"],
    ["a string (no message property)", () => "registry_unreadable", "OTHER"],
    ["null", () => null, "OTHER"],
    ["a non-string message", () => Object.assign(new Error("x"), { message: ["registry_unreadable"] }), "Error"],
    ["a throwing `message` getter", () => Object.defineProperty(new Error("x"), "message", { get() { throw new Error(SECRET_TEXT); } }), "Error"],
  ];
  for (const [label, make, cls] of unattributed) {
    seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
    globalThis.__STUB_THROW = make;
    const { value: r, lines } = await captureConsole(() => at(AT, () => post(stub, { tenantId: T, bizId: B })));
    assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length], [503, "snapshot_build_failed", 0], label + ": " + JSON.stringify(r.body));
    assert.deepEqual(lines.filter(leaks), [], label + ": no raw text in the log");
    assert.ok(!JSON.stringify(r.body).includes(SECRET_TEXT) && !JSON.stringify(r.body).includes(SECRET_NAME), label + ": no raw text in the body");
    assert.ok(lines.some((l) => l.endsWith(`manual build failed (${cls})`)), label + ": class logged\n" + lines.join("\n"));
  }
  // R8 (test-contract transition, review finding CF5-01): the builder's own attribution is its PROVENANCE MARKER — an Error named
  // "SnapshotIdentityRefusal" whose own `code` equals its message, the message in the bounded set (contract §3 as refined by the
  // Builder successor 690a07d9). The R7 assertion attributed a plain Error(code) / SyntaxError(code) / a record by message alone;
  // those are now build failures (DR8-01 holds the full matrix). The six genuine codes map to the owner's statuses whatever the
  // Error subclass that carries the marker.
  const attributed = [["invalid_business_identity", 400], ["business_not_registered", 404], ["ambiguous_business_identity", 422],
    ["registry_unreadable", 422], ["business_name_unavailable", 422], ["registry_unavailable", 503]];
  const refusal = (code, Base = Error) => { const e = new Base(code); e.name = "SnapshotIdentityRefusal"; Object.defineProperty(e, "code", { value: code, enumerable: false, writable: false, configurable: false }); return e; };
  for (const [code, status] of attributed) {
    for (const [cls, make] of [["Error marker", () => refusal(code)], ["SyntaxError marker", () => refusal(code, SyntaxError)], ["TypeError marker", () => refusal(code, TypeError)]]) {
      seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
      globalThis.__STUB_THROW = make;
      const { value: r, lines } = await captureConsole(() => at(AT, () => post(stub, { tenantId: T, bizId: B })));
      assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length], [status, code, 0], `${cls}(${code}): ` + JSON.stringify(r.body));
      assert.ok(r.body.error.endsWith("email not sent") && lines.filter(leaks).length === 0, `${cls}(${code})`);
    }
    // the same text WITHOUT the marker is a build failure (CF5-01)
    for (const [cls, make] of [["plain Error", () => new Error(code)], ["SyntaxError", () => new SyntaxError(code)], ["record", () => ({ message: code, name: "BuilderFailure" })]]) {
      seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
      globalThis.__STUB_THROW = make;
      const r = await at(AT, () => post(stub, { tenantId: T, bizId: B }));
      assert.deepEqual([r.statusCode, r.body.code, smtp.calls.length], [503, "snapshot_build_failed", 0], `${cls}(${code}) without the marker: ` + JSON.stringify(r.body));
    }
  }
  globalThis.__STUB_THROW = null;
  // control: with nothing thrown the stub route sends exactly like the real one
  seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  const ok = await at(AT, () => post(stub, { tenantId: T, bizId: B }));
  assert.deepEqual([ok.statusCode, ok.body.status, smtp.calls.length], [200, "success", 1]);
});

// ── DR7-02 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR7-02 notice read failure: 503 unavailable, nothing manufactured, the stored record untouched; a retry reads it", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, env([{ id: B }]));
  db.seed(noticePath(), storedNotice(4));
  const { touched, restore } = breakPath(db, noticePath(), { read: true });
  const { value: r, lines } = await captureConsole(() => at(AT, () => notice(route)));
  assert.deepEqual([r.statusCode, r.body.status, r.body.deliverable, r.body.code, r.body.notice, r.body.noticeState, r.body.clearState],
    [503, "unavailable", false, "business_name_unavailable", null, "unavailable", "not_attempted"], JSON.stringify(r.body));
  assert.equal(r.body.error, "Daily notice store temporarily unavailable; notice state unknown");
  assert.deepEqual(bodyKeys(r), UNAVAILABLE_KEYS);
  assert.ok(!JSON.stringify(r.body).includes(HE) && !JSON.stringify(r.body).includes('"runs"'), "no synthesized notice: no message, no runs");
  assert.deepEqual([touched.reads, touched.removes, smtp.calls.length], [1, 0, 0], "one read attempted, nothing removed, nothing sent");
  assert.deepEqual(db.read(noticePath()), storedNotice(4), "the stored record is untouched");
  assert.deepEqual(lines.filter(leaks), [], "nothing of the store error is logged");
  assert.ok(lines.some((l) => l.includes("notice state unavailable")), "a bounded log line");
  // retry: the store reads again → the STORED record, its run count preserved — never a reset
  restore();
  const r2 = await at(AT, () => notice(route));
  assert.deepEqual([r2.statusCode, r2.body.status, r2.body.deliverable, r2.body.code, r2.body.noticeState, r2.body.clearState, r2.body.notice.runs, r2.body.notice.message],
    [200, "ok", false, "business_name_unavailable", "active", "not_applicable", 4, HE]);
  assert.deepEqual(bodyKeys(r2), OK_KEYS);
  assert.deepEqual(r2.body.notice, storedNotice(4));
});

// ── DR7-03 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR7-03 notice clear failure: 503, clearState failed, the record still stored and reported stale; a retry clears it", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  db.seed(noticePath(), storedNotice(1));                              // the name is present (seedWorld): the stored notice is stale
  const { touched, restore } = breakPath(db, noticePath(), { remove: true });
  const { value: r, lines } = await captureConsole(() => at(AT, () => notice(route)));
  assert.deepEqual([r.statusCode, r.body.status, r.body.deliverable, r.body.code, r.body.noticeState, r.body.clearState],
    [503, "unavailable", true, null, "stale", "failed"], JSON.stringify(r.body));
  assert.equal(r.body.error, "Daily notice could not be cleared; notice still stored");
  assert.deepEqual(r.body.notice, storedNotice(1), "the record is reported as stored — never as cleared");
  assert.deepEqual(bodyKeys(r), UNAVAILABLE_KEYS);
  assert.deepEqual([touched.reads, touched.removes, smtp.calls.length], [1, 1, 0]);
  assert.deepEqual(db.read(noticePath()), storedNotice(1), "still stored");
  assert.deepEqual(lines.filter(leaks), []);
  // retry: the store writes again → cleared is claimed only now, after the acknowledged removal
  restore();
  const r2 = await at(AT, () => notice(route));
  assert.deepEqual([r2.statusCode, r2.body.status, r2.body.deliverable, r2.body.code, r2.body.notice, r2.body.noticeState, r2.body.clearState], [200, "ok", true, null, null, "none", "cleared"]);
  assert.equal(db.read(noticePath()), null, "removed");
  // and the next read finds nothing to clear
  const r3 = await at(AT, () => notice(route));
  assert.deepEqual([r3.statusCode, r3.body.noticeState, r3.body.clearState, r3.body.notice], [200, "none", "not_needed", null]);
  assert.equal(smtp.calls.length, 0, "the notice action never sends");
});

// ── DR7-04 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR7-04 a read failure while the name is present: no removal is attempted on an unknown store state", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); installSmtp([SMTP.accept()]);
  db.seed(noticePath(), storedNotice(2));
  const { touched, restore } = breakPath(db, noticePath(), { read: true });
  const r = await at(AT, () => notice(route));
  assert.deepEqual([r.statusCode, r.body.status, r.body.deliverable, r.body.code, r.body.notice, r.body.noticeState, r.body.clearState],
    [503, "unavailable", true, null, null, "unavailable", "not_attempted"], JSON.stringify(r.body));
  assert.deepEqual([touched.reads, touched.removes], [1, 0], "nothing removed");
  assert.deepEqual(db.read(noticePath()), storedNotice(2));
  restore();
  const r2 = await at(AT, () => notice(route));
  assert.deepEqual([r2.statusCode, r2.body.noticeState, r2.body.clearState, db.read(noticePath())], [200, "none", "cleared", null]);
});

// ── DR7-05 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR7-05 nothing stored: the business state alone is reported; no notice is manufactured; nothing is written", async () => {
  // name missing, no scheduled run yet
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "   " }]));
  const r = await at(AT, () => notice(route));
  assert.deepEqual([r.statusCode, r.body.status, r.body.deliverable, r.body.code, r.body.notice, r.body.noticeState, r.body.clearState],
    [200, "ok", false, "business_name_unavailable", null, "none", "not_applicable"], JSON.stringify(r.body));
  assert.deepEqual(bodyKeys(r), OK_KEYS);
  assert.ok(!JSON.stringify(r.body).includes(HE) && !JSON.stringify(r.body).includes("runs"), "no manufactured record");
  assert.equal(db.read(NOTICES), null, "the read never writes");
  // name present, nothing stored
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "Unknown" }]));                     // "Unknown" is a name (D-G4)
  const r2 = await at(AT, () => notice(route));
  assert.deepEqual([r2.statusCode, r2.body.deliverable, r2.body.code, r2.body.notice, r2.body.noticeState, r2.body.clearState], [200, true, null, null, "none", "not_needed"]);
  assert.equal(db.read(NOTICES), null); assert.equal(smtp.calls.length, 0);
  // a foreign node under the notice path (not a notice): present but not a record; cleared when the name is present
  db.seed(noticePath(), { something: "else" });
  const r3 = await at(AT, () => notice(route));
  assert.deepEqual([r3.statusCode, r3.body.notice, r3.body.noticeState, r3.body.clearState, db.read(noticePath())], [200, null, "none", "cleared", null]);
});

// ── DR7-06 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR7-06 authorization and tenant isolation are unchanged on the failure paths: refused before the store is touched", async () => {
  const db = seedWorld(); installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "" }, { id: B2, name: "מסעדה ב" }]));
  db.seed(`tenants/${T}/members/u_manager_a`, true); db.seed(`tenants/${T}/roles/u_manager_a`, "manager");
  db.seed(`tenants/${T}/biz_access/${B}/u_viewer_a`, true); db.seed(`tenants/${T}/biz_access/${B}/u_manager_a`, true);
  db.seed(noticePath(), storedNotice(3));
  const { touched } = breakPath(db, noticePath(), { read: true, remove: true });     // the store is broken: an authorized read would be 503
  for (const [uid, email, error] of [["u_viewer_a", "viewer-a@example.test", "insufficient role"], ["u_manager_a", "manager-a@example.test", "owner_role_required"]]) {
    const r = await at(AT, () => notice(route, {}, { uid, email }));
    assert.deepEqual([r.statusCode, r.body], [403, { error }], uid);
  }
  const other = await at(AT, () => notice(route, {}, { uid: "u_owner_b", email: "owner-b@example.test" }));
  assert.ok([401, 403].includes(other.statusCode) && other.body.noticeState === undefined && other.body.notice === undefined, "another tenant's owner: " + JSON.stringify(other.body));
  const foreign = await at(AT, () => notice(route, { tenantId: T2, bizId: B3 }));
  assert.ok([401, 403].includes(foreign.statusCode) && foreign.body.noticeState === undefined, "the owner of A asking about tenant B: " + JSON.stringify(foreign.body));
  assert.deepEqual([touched.reads, touched.removes], [0, 0], "the store was never touched for an unauthorized caller");
  // the authorized owner on the same broken store: 503, state unknown, the record untouched
  const owner = await at(AT, () => notice(route));
  assert.deepEqual([owner.statusCode, owner.body.status, owner.body.deliverable, owner.body.code, owner.body.noticeState], [503, "unavailable", false, "business_name_unavailable", "unavailable"]);
  assert.deepEqual([touched.reads, touched.removes, db.read(noticePath())], [1, 0, storedNotice(3)]);
});

// ── DR7-07 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR7-07 the registry cannot be read: 503 registry_unavailable, deliverable unknown (null), the store is not consulted", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  db.seed(noticePath(), storedNotice(2));
  const { touched } = breakPath(db, noticePath());
  const ref = db.ref; db.ref = (p, q) => { const x = ref(p, q); return p === `tenants/${T}/app/business` ? { ...x, once: async () => { throw new Error(SECRET_ADDR); } } : x; };
  const { value: r, lines } = await captureConsole(() => at(AT, () => notice(route)));
  assert.deepEqual([r.statusCode, r.body.status, r.body.deliverable, r.body.code, r.body.notice, r.body.noticeState, r.body.clearState],
    [503, "unavailable", null, "registry_unavailable", null, "unavailable", "not_attempted"], JSON.stringify(r.body));
  assert.equal(r.body.error, "Business registry temporarily unavailable; notice state unknown");
  assert.deepEqual(bodyKeys(r), UNAVAILABLE_KEYS);
  assert.deepEqual([touched.reads, touched.removes, smtp.calls.length], [0, 0, 0], "the notice store is not consulted when the business state is unknown");
  assert.deepEqual(lines.filter(leaks), []);
  assert.deepEqual(db.read(noticePath()), storedNotice(2));
});

// ── DR7-08 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR7-08 a stored notice for a business that is not deliverable for another reason: reported stale, not cleared, not manufactured", async () => {
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); installSmtp([SMTP.accept()]);
  db.seed(noticePath(), storedNotice(5));
  for (const [label, raw, code] of [["not registered", env([{ id: "other", name: "Other" }]), "business_not_registered"],
    ["duplicate record", env([{ id: B, name: "A" }, { id: B, name: "A twin" }]), "ambiguous_business_identity"],
    ["malformed registry", { _v: "[{" }, "registry_unreadable"]]) {
    db.seed(`tenants/${T}/app/business`, raw);
    const r = await at(AT, () => notice(route));
    assert.deepEqual([r.statusCode, r.body.status, r.body.deliverable, r.body.code, r.body.noticeState, r.body.clearState], [200, "ok", false, code, "stale", "not_applicable"], label + ": " + JSON.stringify(r.body));
    assert.deepEqual(r.body.notice, storedNotice(5), label + ": the stored record, as stored");
    assert.deepEqual(db.read(noticePath()), storedNotice(5), label + ": not cleared — no healthy state was confirmed");
  }
  // and with nothing stored: none, nothing manufactured
  db.seed(noticePath(), null);
  const r = await at(AT, () => notice(route));
  assert.deepEqual([r.statusCode, r.body.code, r.body.notice, r.body.noticeState, r.body.clearState], [200, "registry_unreadable", null, "none", "not_applicable"]);
});

// ── DR7-09 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("DR7-09 the scheduled path still records the notice; an owner read that fails never hides it; a successful read returns it as stored", async () => {
  // the route gate on the scheduled path with a stubbed builder output (the pin of this tree drops a nameless business): as DR5-07
  const dir = mkdtempSync(join(tmpdir(), "de1-r7-stub-"));
  cpSync(SANDBOX, dir, { recursive: true, verbatimSymlinks: true });
  const sb = join(dir, "src", "snapshot");
  renameSync(join(sb, "snapshotBuilder.js"), join(sb, "snapshotBuilder.real.js"));
  writeFileSync(join(sb, "snapshotBuilder.js"),
    `import * as real from "./snapshotBuilder.real.js";\nexport const buildSnapshotForBiz = real.buildSnapshotForBiz;\n` +
    `export async function buildSnapshotForAll() { const all = await real.buildSnapshotForAll(); for (const [t, b, bizName] of globalThis.__STUB_EXTRA || []) { const s = await real.buildSnapshotForBiz(t, b); all.push({ ...s, bizName }); } return all; }\n`);
  const stub = (await import(pathToFileURL(join(dir, "api", "daily-snapshot", "run.js")).href)).default;
  const db = seedWorld({ withSecondBiz: false, withSecondTenant: false }); const smtp = installSmtp([SMTP.accept()]);
  db.seed(`tenants/${T}/app/business`, env([{ id: B }]));
  globalThis.__STUB_EXTRA = [[T, B, "Unknown"]];
  const r1 = await at(AT, () => runCron(stub));
  const row = (r1.body.results || []).find((x) => x.tenantId === T && x.bizId === B);
  assert.deepEqual([r1.statusCode, row.code, row.notice, smtp.calls.length], [500, "business_name_unavailable", "recorded", 0]);
  const stored = db.read(noticePath());
  assert.deepEqual([stored.runs, stored.message, stored.businessDate], [1, HE, DATE]);
  // the owner's read fails: 503, the business state is still reported as blocked, the record is untouched
  const { touched, restore } = breakPath(db, noticePath(), { read: true });
  const r2 = await at(AT, () => notice(stub));
  assert.deepEqual([r2.statusCode, r2.body.deliverable, r2.body.code, r2.body.noticeState, r2.body.notice], [503, false, "business_name_unavailable", "unavailable", null]);
  assert.deepEqual([touched.removes, db.read(noticePath())], [0, stored]);
  // a successful read returns the stored record exactly
  restore();
  const r3 = await at(AT, () => notice(stub));
  assert.deepEqual([r3.statusCode, r3.body.noticeState, r3.body.notice], [200, "active", stored]);
  // the owner repairs the name: the next read clears it (acknowledged) and the next run delivers
  db.seed(`tenants/${T}/app/business`, env([{ id: B, name: "מסעדה א" }]));
  const r4 = await at(AT, () => notice(stub));
  assert.deepEqual([r4.statusCode, r4.body.deliverable, r4.body.noticeState, r4.body.clearState, db.read(noticePath())], [200, true, "none", "cleared", null]);
  globalThis.__STUB_EXTRA = [];
  const r5 = await at(AT + 2 * LEASE, () => runCron(stub));
  assert.deepEqual([r5.statusCode, (r5.body.results || []).find((x) => x.bizId === B).settlement, smtp.calls.length], [200, "delivered", 1]);
});
