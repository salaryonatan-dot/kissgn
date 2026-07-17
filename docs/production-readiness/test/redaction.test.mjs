// Tests for the shared sanitizer (PR-003 error hardening, PR-004 report labels).
// Synthetic identifiers only. No Firebase, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeString, sanitizeValue, sanitizeError, formatSafeError, scanForSecrets } from "../lib/redaction.mjs";

// Synthetic sensitive markers (NOT real).
const SECRETS = {
  email: "alice.tester@acme-synthetic.example.io",
  fbHost: "acme-synthetic-prod.firebaseio.com",
  dbInstance: "acme-synthetic-prod-default-rtdb.firebasedatabase.app",
  rtdb: "tenants/acmeSyntheticTenant42/biz:acmeBiz99:entries",
  fsPath: "/Users/synthetic/Desktop/secret dir/report.txt",
  aiza: "AIzaSyASYNTHETIC_key_000111222333",
  bearer: "Bearer synthTOKENabcdef0123456789",
  jwt: "eyJhbGciOiJSUZI1NiJ9.eyJzdWIiOiJzeW50aCJ9.abcDEFghijKLMnop",
  uid: "AbCdEf0123456789Ghijkl6789ZZ", // 28-char synthetic uid
  sa: '"private_key":"-----BEGIN PRIVATE KEY-----\\nSYNTH\\n-----END PRIVATE KEY-----"',
};
const raw = Object.values(SECRETS);
function assertNoRaw(s) { for (const v of raw) assert.ok(!s.includes(v), `leaked: ${v.slice(0, 8)}…`); }

test("sanitizeString redacts each sensitive category", () => {
  for (const v of raw) {
    const out = sanitizeString(v);
    assert.notEqual(out, v, `not redacted: ${v.slice(0, 10)}`);
    assert.ok(!out.includes(v), "raw remained");
  }
});

test("nested values, arrays, and object KEYS are sanitized", () => {
  const input = {
    ok: "harmless",
    nested: { deep: SECRETS.email, arr: [SECRETS.rtdb, { host: SECRETS.fbHost }] },
    [SECRETS.email]: "value-under-sensitive-key", // sensitive value used as a KEY
    password: "should-be-dropped",
    token: SECRETS.bearer,
  };
  const out = sanitizeValue(input);
  const blob = JSON.stringify(out);
  assertNoRaw(blob);
  assert.equal(out.password, "<redacted>");   // sensitive key name dropped
  assert.ok(!Object.keys(out).some((k) => k.includes(SECRETS.email))); // key redacted
});

test("Firebase project host + database-instance labels are redacted", () => {
  assert.match(sanitizeString(SECRETS.fbHost), /<redacted-firebase-host>/);
  assert.match(sanitizeString(SECRETS.dbInstance), /<redacted-firebase-host>/);
});

test("Firebase project/instance JSON labels (no domain) are redacted", () => {
  const summary = [
    '  "productionProject": "acme-synthetic-1227b",',
    '  "productionInstance": "acme-synthetic-1227b-default-rtdb",',
    '  "databaseInstance": "another-synthetic-default-rtdb",'
  ].join("\n");
  const out = sanitizeString(summary);
  assert.match(out, /"productionProject":\s*"<redacted-firebase-project>"/);
  assert.match(out, /"productionInstance":\s*"<redacted-firebase-instance>"/);
  assert.doesNotMatch(out, /acme-synthetic-1227b/);
  assert.doesNotMatch(out, /-default-rtdb/);
});

test("bare RTDB instance name (…-default-rtdb) is redacted anywhere", () => {
  assert.match(sanitizeString("using acme-synthetic-default-rtdb here"), /<redacted-firebase-instance>/);
  assert.doesNotMatch(sanitizeString("using acme-synthetic-default-rtdb here"), /acme-synthetic/);
});

test("concrete RTDB path redacted; tenant-N alias preserved", () => {
  assert.match(sanitizeString(SECRETS.rtdb), /tenants\/<redacted-id>/);
  assert.equal(sanitizeString("tenants/tenant-3/members"), "tenants/tenant-3/members"); // alias kept
  assert.equal(sanitizeString("tenants/{tenantId}/roles"), "tenants/{tenantId}/roles"); // placeholder kept
});

test("absolute filesystem paths redacted", () => {
  assert.match(sanitizeString(SECRETS.fsPath), /<redacted-path>/);
  assert.match(sanitizeString("at Object.<anonymous> (/sessions/x/y/audit.mjs:12:5)"), /<redacted-path>/);
});

test("email, api key, bearer/JWT, uid redacted", () => {
  assert.match(sanitizeString(SECRETS.email), /<redacted-email>/);
  assert.match(sanitizeString(SECRETS.aiza), /<redacted-api-key>/);
  assert.match(sanitizeString(SECRETS.bearer), /Bearer <redacted-token>/);
  assert.match(sanitizeString(SECRETS.jwt), /<redacted-jwt>/);
  assert.match(sanitizeString(SECRETS.uid), /<redacted-uid>/);
});

test("ordinary error message is sanitized; safe metadata preserved", () => {
  const e = new Error(`read failed for ${SECRETS.rtdb} on ${SECRETS.fbHost} (${SECRETS.email})`);
  e.code = "PERMISSION_DENIED";
  const s = sanitizeError(e);
  assert.equal(s.errorClass, "Error");
  assert.equal(s.code, "PERMISSION_DENIED");
  assert.equal(s.category, "permission");
  assertNoRaw(JSON.stringify(s));
});

test("stack-like string is sanitized", () => {
  const stack = `Error: boom\n    at main (${SECRETS.fsPath}:3:1)\n    at ${SECRETS.rtdb}`;
  assertNoRaw(sanitizeString(stack));
});

test("failure-path: audit catch/error formatting leaks no sensitive marker", () => {
  // Mirrors the CLI catch: main().catch(e => console.error(formatSafeError(e)))
  const e = new Error(`ECONNREFUSED to ${SECRETS.dbInstance}; sa ${SECRETS.email}; ${SECRETS.bearer}`);
  const line = formatSafeError(e);
  assertNoRaw(line);
  assert.match(line, /AUDIT_FAILED/);
});

test("unstringifiable/empty error -> generic AUDIT_FAILED_REDACTED marker", () => {
  const s = sanitizeError({ message: "" });
  assert.equal(s.message, "AUDIT_FAILED_REDACTED");
});

test("scanForSecrets counts matches without returning values", () => {
  const r = scanForSecrets(raw.join("\n"));
  assert.ok(r.total >= raw.length - 1);
  for (const v of Object.values(r.counts)) assert.equal(typeof v, "number");
});

test("clean text passes the scanner with zero matches", () => {
  const clean = 'tenant-1 biz_ab12cd34ef56 category=READY dataAgeDays=2 maxDataAgeDays=3';
  assert.equal(scanForSecrets(clean).total, 0);
});
