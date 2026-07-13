// Deterministic structural + logic tests for the legacy `biz:{bizId}:entries`
// business-isolation fix (Option A — $dataKey path derivation). This is NOT an
// Emulator run: it (1) asserts the rules string carries the intended structure,
// and (2) exercises a JS mirror of the rule predicate against the acceptance
// matrix. The Firebase Emulator matrix remains the next dedicated phase.
//   Run: node test/security/entries-isolation.test.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULES = JSON.parse(readFileSync(join(REPO, "database.rules.json"), "utf8"));
const dk = RULES.rules.tenants.$tenantId.$dataKey;

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log("PASS " + n); pass++; } catch (e) { console.log("FAIL " + n + " — " + (e && e.message)); fail++; } };

// ── (1) structural assertions on the deployed rule string ──
T("RULE read+write branch on the exact entries key pattern", () => {
  assert.ok(dk[".read"].includes("$dataKey.matches(/^biz:[^:]+:entries$/)"));
  assert.ok(dk[".write"].includes("$dataKey.matches(/^biz:[^:]+:entries$/)"));
});
T("RULE entries write requires manager AND biz_access (not member-only)", () => {
  assert.ok(dk[".write"].includes("=== 'manager' && root.child('tenants').child($tenantId).child('biz_access')"));
  assert.ok(dk[".write"].includes("$dataKey.replace('biz:','').replace(':entries','')"));
});
T("RULE entries read requires biz_access (owner/super_owner implicit)", () => {
  assert.ok(dk[".read"].includes("biz_access").valueOf());
  assert.ok(dk[".read"].includes("$dataKey.replace('biz:','').replace(':entries','')"));
});

// ── (2) JS mirror of the intended rule predicate ──
const isEntriesKey = (key) => /^biz:[^:]+:entries$/.test(key);
const bizIdFromKey = (key) => key.replace("biz:", "").replace(":entries", "");
// ctx: { auth, uid, role, member, biz: Set of `${bizId}:${uid}` grants }
const grant = (bizId, uid) => `${bizId}:${uid}`;
function canRead(ctx) {
  if (!ctx.auth) return false;
  if (!ctx.member) return false;
  if (isEntriesKey(ctx.key)) {
    if (ctx.role === "super_owner" || ctx.role === "owner") return true;
    return ctx.biz.has(grant(bizIdFromKey(ctx.key), ctx.uid));
  }
  return true;
}
function canWrite(ctx) {
  if (!ctx.auth) return false;
  if (isEntriesKey(ctx.key)) {
    if (ctx.role === "super_owner" || ctx.role === "owner") return true;
    if (ctx.role === "manager") return ctx.biz.has(grant(bizIdFromKey(ctx.key), ctx.uid));
    return false; // viewer / shift_manager / member-only → denied
  }
  return ctx.member || ["super_owner", "owner", "manager"].includes(ctx.role);
}
const base = (o) => ({ auth: true, uid: "u1", member: true, biz: new Set(), key: "biz:A:entries", ...o });

// Acceptance matrix
T("viewer cannot write entries", () => assert.strictEqual(canWrite(base({ role: "viewer", biz: new Set([grant("A", "u1")]) })), false));
T("shift_manager cannot write entries", () => assert.strictEqual(canWrite(base({ role: "shift_manager", biz: new Set([grant("A", "u1")]) })), false));
T("manager WITHOUT biz_access cannot write entries", () => assert.strictEqual(canWrite(base({ role: "manager", biz: new Set() })), false));
T("manager WITH biz_access can write entries", () => assert.strictEqual(canWrite(base({ role: "manager", biz: new Set([grant("A", "u1")]) })), true));
T("owner can write entries (implicit, no biz_access)", () => assert.strictEqual(canWrite(base({ role: "owner", biz: new Set() })), true));
T("super_owner can write entries (implicit)", () => assert.strictEqual(canWrite(base({ role: "super_owner", biz: new Set() })), true));
T("business-A manager cannot write business-B entries (key binding, no spoof)", () => {
  const ctx = base({ role: "manager", biz: new Set([grant("A", "u1")]), key: "biz:B:entries" });
  assert.strictEqual(bizIdFromKey(ctx.key), "B");
  assert.strictEqual(canWrite(ctx), false);
});
T("business-A viewer cannot READ business-B entries", () => {
  assert.strictEqual(canRead(base({ role: "viewer", biz: new Set([grant("A", "u1")]), key: "biz:B:entries" })), false);
});
T("business-A manager CAN read/write its own business-A entries (legitimate flow intact)", () => {
  assert.strictEqual(canWrite(base({ role: "manager", biz: new Set([grant("A", "u1")]), key: "biz:A:entries" })), true);
  assert.strictEqual(canRead(base({ role: "manager", biz: new Set([grant("A", "u1")]), key: "biz:A:entries" })), true);
});
T("unauthenticated denied", () => assert.strictEqual(canWrite(base({ auth: false, role: "owner" })), false));
T("key/business binding cannot be spoofed via a crafted key", () => {
  // a key that is not the exact entries pattern is NOT treated as entries (falls to generic branch)
  assert.strictEqual(isEntriesKey("biz:A:entries:evil"), false);
  assert.strictEqual(isEntriesKey("biz::entries"), false);
  assert.strictEqual(isEntriesKey("biz:A:B:entries"), false); // colon in "bizId" rejected by [^:]+
});
T("non-entries biz key unchanged: member may still write (e.g. config)", () => {
  assert.strictEqual(canWrite(base({ role: "viewer", member: true, key: "biz:A:config" })), true);
});
T("bizId extraction is exact", () => { assert.strictEqual(bizIdFromKey("biz:XYZ-123:entries"), "XYZ-123"); });

console.log(`\nTotal: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
