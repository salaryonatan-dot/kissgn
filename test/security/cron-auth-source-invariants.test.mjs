// SYS-P0-001 — Cron authorization source invariants (regression guards).
//
// Complements the executable proof in cron-auth-hardening.test.mjs. Confirms
// no production runtime file still trusts the spoofable x-vercel-cron header in
// a CODE condition, that each hardened route routes scheduled auth through the
// centralized requireCron, and that the previously-hardened alerts route/core
// are unchanged. Run: node --test test/security/cron-auth-source-invariants.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(REPO, rel), "utf8");
// Strip block + line comments so we only assert on executable CODE.
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

const ROUTES = [
  "api/analytics/daily-builder.ts",
  "api/daily-snapshot/run.ts",
  "api/proactive/run.ts",
];

// Walk api/, lib/, src/ collecting runtime source files.
function walk(rel, acc) {
  const abs = join(REPO, rel);
  let entries;
  try { entries = readdirSync(abs); } catch { return acc; }
  for (const name of entries) {
    if (name === "node_modules") continue;
    const childRel = join(rel, name);
    const st = statSync(join(REPO, childRel));
    if (st.isDirectory()) walk(childRel, acc);
    else if (/\.(ts|js|mjs|cjs)$/.test(name) && !/\.d\.ts$/.test(name)) acc.push(childRel);
  }
  return acc;
}

test("no production runtime file trusts x-vercel-cron in a code condition", () => {
  const files = [...walk("api", []), ...walk("lib", []), ...walk("src", [])];
  const offenders = [];
  for (const rel of files) {
    const code = codeOnly(read(rel));
    if (/x-vercel-cron/i.test(code)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], "x-vercel-cron must not appear in any runtime code condition: " + offenders.join(", "));
});

for (const rel of ROUTES) {
  test(`${rel}: routes scheduled auth through requireCron, no verifyAuth, no x-vercel-cron code`, () => {
    const raw = read(rel);
    const code = codeOnly(raw);
    assert.ok(/requireCron\s*\(/.test(code), rel + " must call requireCron");
    assert.ok(/from\s+["']\.\.\/\.\.\/lib\/securityContext\.js["']/.test(raw), rel + " must import from lib/securityContext.js");
    assert.ok(!/function\s+verifyAuth/.test(code), rel + " must not define a local verifyAuth");
    assert.ok(!/x-vercel-cron/i.test(code), rel + " must not reference x-vercel-cron in code");
  });
}

test("daily-snapshot + proactive manual flows require owner/super_owner", () => {
  // I6 test-contract transition (T-I6-TEST-P0; P0 / proactive owners): the proactive manual scan calls the registered variant of
  // the shared gate (requireBizContext + the authoritative registration); the Daily manual send keeps requireBizContext (its
  // delivery receipt applies the same registry rule itself)
  for (const [rel, gate] of [["api/daily-snapshot/run.ts", /requireBizContext\s*\(/], ["api/proactive/run.ts", /requireRegisteredBizContext\s*\(/]]) {
    const code = codeOnly(read(rel));
    assert.ok(gate.test(code), rel + " must call " + gate.source.split("\\")[0] + " for manual flow");
    assert.ok(/"owner"/.test(code) && /"super_owner"/.test(code), rel + " must gate on owner/super_owner");
  }
});

test("alerts route + core remain hardened (requireCron, no x-vercel-cron)", () => {
  const wrapper = read("api/alerts/run.ts");
  const core = read("lib/alertsCore.js");
  assert.ok(/requireCron/.test(wrapper), "alerts wrapper injects requireCron");
  assert.ok(/requireCron\(req\)/.test(core), "alerts core uses requireCron");
  assert.ok(!/x-vercel-cron/.test(codeOnly(wrapper)), "alerts wrapper code has no x-vercel-cron");
  assert.ok(!/x-vercel-cron/.test(codeOnly(core)), "alerts core code has no x-vercel-cron");
});

test("requireCron in lib/securityContext.js ignores x-vercel-cron entirely", () => {
  const code = codeOnly(read("lib/securityContext.js"));
  assert.ok(!/x-vercel-cron/.test(code), "securityContext code must not read x-vercel-cron");
  assert.ok(/export function requireCron/.test(code), "requireCron export present");
});
