// Deterministic tests for the server-mediated parameterized-business-data actions
// (checklist_* + analytics/insights). NOT an Emulator/HTTP run: (1) mirrors the
// handler authorization (requireTenantAccess + requireBizAccess) against the policy
// matrix; (2) validation via the real domain validators; (3) static assertions on
// api/admin.js and the client cutover in index.html.
//   Run: node test/security/biz-data-actions.test.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidBusinessDate, dateRangeDays, MAX_LIST_RANGE_DAYS } from "../../lib/entryExceptions.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const admin = readFileSync(join(REPO, "api", "admin.js"), "utf8");
const idx = readFileSync(join(REPO, "index.html"), "utf8");
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log("PASS " + n); pass++; } catch (e) { console.log("FAIL " + n + " — " + (e && e.message)); fail++; } };

// ── (1) authorization predicate mirror ──
const RANK = { super_owner: 5, owner: 4, manager: 3, shift_manager: 2, viewer: 1 };
const isOwnerLvl = (r) => r === "owner" || r === "super_owner";
const hasRole = (r, min) => (RANK[r] || 0) >= (RANK[min] || 999);
const bizAllowed = (role, hasBA) => isOwnerLvl(role) || hasBA; // requireBizAccess: owner/so implicit, else biz_access (fail-closed)
function canRead(ctx) { // viewer+ within authorized business
  if (!ctx.auth || !ctx.member) return false;
  if (!hasRole(ctx.role, "viewer")) return false;
  return bizAllowed(ctx.role, ctx.hasBA);
}
function canWrite(minRole, ctx) {
  if (!ctx.auth || !ctx.member) return false;
  if (!hasRole(ctx.role, minRole)) return false;
  return bizAllowed(ctx.role, ctx.hasBA);
}
const c = (o) => ({ auth: true, member: true, hasBA: false, role: "viewer", ...o });

T("READ (viewer+): unauth/non-member/missing-biz_access denied; viewer+biz_access allowed", () => {
  assert.strictEqual(canRead(c({ auth: false })), false);
  assert.strictEqual(canRead(c({ member: false, role: "manager", hasBA: true })), false);
  assert.strictEqual(canRead(c({ role: "viewer", hasBA: false })), false);   // missing biz_access
  assert.strictEqual(canRead(c({ role: "viewer", hasBA: true })), true);
  assert.strictEqual(canRead(c({ role: "owner", hasBA: false })), true);     // implicit
});
T("READ cross-business denied (biz_access is per-business)", () => {
  // request bizB while only holding biz_access for bizA ⇒ hasBA=false for bizB
  assert.strictEqual(canRead(c({ role: "manager", hasBA: false })), false);
});
T("WRITE template-items = manager+ & biz_access; shift_manager/viewer denied", () => {
  assert.strictEqual(canWrite("manager", c({ role: "viewer", hasBA: true })), false);
  assert.strictEqual(canWrite("manager", c({ role: "shift_manager", hasBA: true })), false);
  assert.strictEqual(canWrite("manager", c({ role: "manager", hasBA: false })), false); // missing biz_access
  assert.strictEqual(canWrite("manager", c({ role: "manager", hasBA: true })), true);
  assert.strictEqual(canWrite("manager", c({ role: "owner", hasBA: false })), true);
  assert.strictEqual(canWrite("manager", c({ role: "super_owner", hasBA: false })), true);
});
T("WRITE checklist run / simple-run = shift_manager+ & biz_access; viewer denied", () => {
  for (const min of ["shift_manager"]) {
    assert.strictEqual(canWrite(min, c({ role: "viewer", hasBA: true })), false);
    assert.strictEqual(canWrite(min, c({ role: "shift_manager", hasBA: false })), false); // missing biz_access
    assert.strictEqual(canWrite(min, c({ role: "shift_manager", hasBA: true })), true);
    assert.strictEqual(canWrite(min, c({ role: "manager", hasBA: true })), true);
    assert.strictEqual(canWrite(min, c({ role: "owner", hasBA: false })), true);
  }
});

// ── (2) validation ──
const validTpl = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
T("validation: templateId format + length", () => {
  assert.ok(validTpl("tpl_123-abc"));
  assert.ok(!validTpl("bad/id"));
  assert.ok(!validTpl("has:colon"));
  assert.ok(!validTpl(""));
  assert.ok(!validTpl("x".repeat(129)));
});
T("validation: businessDate + range", () => {
  assert.ok(isValidBusinessDate("2026-07-13"));
  assert.ok(!isValidBusinessDate("2026-7-13"));
  assert.ok(dateRangeDays("2026-07-11", "2026-07-01") < 0);        // reversed
  assert.ok(dateRangeDays("2026-01-01", "2027-02-06") > MAX_LIST_RANGE_DAYS); // oversized
});

// ── (3) static: server actions + role tiers + constructed paths ──
T("dispatcher wires all 8 parameterized-data actions", () => {
  for (const a of ["get-checklist-template-items","set-checklist-template-items","get-checklist-run","set-checklist-run","get-checklist-simple-run","set-checklist-simple-run","get-analytics-daily","get-insights-daily"])
    assert.ok(admin.includes(`action === "${a}"`), a);
});
T("write role tiers: template-items manager, run/simple-run shift_manager", () => {
  assert.ok(admin.includes('bizDataAuthWrite(req, res, "manager")'));
  assert.ok((admin.match(/bizDataAuthWrite\(req, res, "shift_manager"\)/g) || []).length >= 2);
});
T("reads use requireTenantAccess viewer + requireBizAccess (fail-closed)", () => {
  assert.ok(admin.includes('requireTenantAccess(claims.uid, tenantId, "viewer")'));
  assert.ok(admin.includes("requireBizAccess(db, tenantId, bizId, claims.uid, role)"));
});
T("no generic read/write-business-key endpoint; paths CONSTRUCTED from validated ids", () => {
  assert.ok(!/action === "(get|set)-business-key"/.test(admin));
  assert.ok(admin.includes("`checklist_template_items:${templateId}`"));
  assert.ok(admin.includes("`checklist_runs:${businessDate}`"));
  assert.ok(admin.includes("`checklist_simple_runs:${businessDate}:${templateId}`"));
});
T("derived analytics/insights: read-only server action, bounded range; no client write action", () => {
  assert.ok(admin.includes('bizDailyRangeGet(req, res, "analytics")'));
  assert.ok(admin.includes('bizDailyRangeGet(req, res, "insights")'));
  assert.ok(!admin.includes('action === "set-analytics-daily"'));
  assert.ok(!admin.includes('action === "set-insights-daily"'));
});

// ── (4) client cutover ──
T("client no longer directly reads/writes parameterized RTDB keys", () => {
  assert.ok(!/storage\.set\(`biz:\$\{bizId\}:checklist_(runs|template_items|simple_runs)/.test(idx));
  assert.ok(!/readChecklistDoc\(`biz:\$\{[a-zA-Z]+\}:(checklist_runs|checklist_template_items|checklist_simple_runs|analytics:daily|insights:daily)/.test(idx));
});
T("client uses the server-mediated helpers", () => {
  assert.ok(idx.includes("apiGetChecklistDoc("));
  assert.ok(idx.includes("apiSetChecklistDoc("));
  assert.ok(idx.includes('apiGetDailyRange("analytics"'));
  assert.ok(idx.includes('apiGetDailyRange("insights"'));
});
T("client business-switch stale-guard retained (cancellation on effect cleanup)", () => {
  assert.ok(idx.includes("return () => { cancelled = true; };"));
});

console.log(`\nTotal: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
