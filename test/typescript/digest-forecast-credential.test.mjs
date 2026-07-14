// Part 2 (digest date helper reuse), Part 5 (admin credential path), Part 6
// (forecast business-id fail-closed). digestBuilder/forecastService/runProactiveJob
// are TypeScript (compiled by the canonical tsc gate); here we assert the exact
// integration and mirror the pure business-id guard predicate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// ── Part 2: reuse the canonical daysAgoIso (no new/duplicate date helper) ──────
test("digestBuilder imports the canonical daysAgoIso from utils/dates", () => {
  const src = read("src/agent/proactive/digestBuilder.ts");
  assert.match(src, /import \{ todayIso, daysAgoIso \} from "\.\.\/\.\.\/utils\/dates\.js"/);
  assert.match(src, /daysAgoIso\(7\)/);
  // no locally-defined duplicate date function was introduced
  assert.doesNotMatch(src, /function daysAgoIso/);
});
test("utils/dates.daysAgoIso keeps its UTC/tz business-date semantics", () => {
  const src = read("src/utils/dates.ts");
  assert.match(src, /export function daysAgoIso\(days: number, tz = "Asia\/Jerusalem"\): string/);
  assert.match(src, /toLocaleDateString\("en-CA", \{ timeZone: tz \}\)/);
});

// ── Part 5: admin credential via getFirebaseAdmin (typed admin.app.App) ────────
test("runProactiveJob acquires the token via the admin App credential, not getDb().app", () => {
  const src = read("src/agent/proactive/runProactiveJob.ts");
  assert.match(src, /const \{ getFirebaseAdmin \} = await import\("\.\.\/\.\.\/firebase\/admin\.js"\)/);
  assert.match(src, /const app = getFirebaseAdmin\(\);/);
  assert.match(src, /app\.options\.credential\?\.getAccessToken\(\)/, "fail-safe optional-chained credential access");
  // the old, untyped getDb().app credential access is gone
  assert.doesNotMatch(src, /const app = getDb\(\)\.app;\s*\n\s*const token = await app\.options\.credential/);
});
test("getFirebaseAdmin returns the admin.app.App (typed credential source)", () => {
  const src = read("src/firebase/admin.ts");
  assert.match(src, /export function getFirebaseAdmin\(\): admin\.app\.App/);
  assert.match(src, /return admin\.app\(\);/);
});

// Fail-safe token→URL behavior mirror (pure): missing credential => plain url.
function buildAuthUrl(url, token) {
  return token ? `${url}${url.includes("?") ? "&" : "?"}access_token=${token.access_token}` : url;
}
test("missing credential/token yields the plain URL (fail-safe)", () => {
  assert.equal(buildAuthUrl("https://db/x.json", undefined), "https://db/x.json");
  assert.equal(buildAuthUrl("https://db/x.json?a=1", { access_token: "T" }), "https://db/x.json?a=1&access_token=T");
});

// ── Part 6: forecast business-id fail-closed (no "main", no cross-business) ────
test("forecastService validates business/branch id and fails closed to null", () => {
  const src = read("src/services/forecastService.ts");
  // guard exists and returns null before any getDailyMetrics call
  const guardIdx = src.indexOf('typeof branchId !== "string" || branchId.trim() === ""');
  const callIdx = src.indexOf("getDailyMetrics(tenantId, monthStart, today, branchId)");
  assert.ok(guardIdx > -1, "business-id guard present");
  assert.ok(callIdx > -1 && guardIdx < callIdx, "guard precedes getDailyMetrics");
  assert.match(src.slice(guardIdx, guardIdx + 200), /return null;/);
  // never defaults to a hardcoded business and never infers another business:
  // no `branchId || "..."` fallback and no `= "main"` assignment in code.
  assert.doesNotMatch(src, /branchId\s*\|\|/);
  assert.doesNotMatch(src, /=\s*"main"/);
});

// Pure mirror of the guard predicate for the required cases.
function forecastAllowed(branchId) {
  return !(typeof branchId !== "string" || branchId.trim() === "");
}
test("business-id predicate: valid proceeds; missing/empty are rejected; no fallback", () => {
  assert.equal(forecastAllowed("biz-42"), true);     // valid → proceed
  assert.equal(forecastAllowed(undefined), false);   // missing → null
  assert.equal(forecastAllowed(""), false);          // empty → null
  assert.equal(forecastAllowed("   "), false);       // whitespace → null
  // rejection is independent of any other business id (no inference)
  assert.equal(forecastAllowed(null), false);
});
