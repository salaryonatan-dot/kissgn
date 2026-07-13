// Commit 2 — "security: close remaining checklist and analytics gaps"
//
// Static-source security regression tests. These assert the SHAPE of the
// Firebase Security Rules and the server alert reader. They intentionally do
// NOT claim to prove runtime Rules enforcement — that requires the Firebase
// Emulator, which is out of scope for the canonical toolchain. Where a test
// depends on Rules semantics it asserts the exact rule expression that the
// (unrun) emulator would evaluate.
//
// Run: node --test test/security/checklist-template-analytics.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const rulesRaw = readFileSync(join(ROOT, "database.rules.json"), "utf8");
const rules = JSON.parse(rulesRaw);
const checkers = readFileSync(join(ROOT, "src", "alerts", "checkers.ts"), "utf8");
const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");

// The wildcard $dataKey read/write expressions under tenants/$tenantId.
function dataKeyRule(kind) {
  const node = rules.rules.tenants.$tenantId.$dataKey;
  assert.ok(node, "tenants/$tenantId/$dataKey node exists");
  const expr = node[kind];
  assert.equal(typeof expr, "string", kind + " is a string expression");
  return expr;
}

// -- Blocker 1: checklist_template (SINGULAR) is a recognised fixed key --------

test("rules: database.rules.json is valid JSON", () => {
  assert.doesNotThrow(() => JSON.parse(rulesRaw));
});

test("read: checklist_template (singular) has an explicit fixed-key branch", () => {
  const r = dataKeyRule(".read");
  assert.match(r, /\$dataKey\.matches\(\/\^biz:\[\^:\]\+:checklist_template\$\/\)/,
    "singular checklist_template read branch present");
});

test("write: checklist_template (singular) has an explicit fixed-key branch", () => {
  const w = dataKeyRule(".write");
  assert.match(w, /\$dataKey\.matches\(\/\^biz:\[\^:\]\+:checklist_template\$\/\)/,
    "singular checklist_template write branch present");
});

test("checklist_template is NOT swallowed by the unknown-biz deny fallthrough", () => {
  for (const kind of [".read", ".write"]) {
    const expr = dataKeyRule(kind);
    const tmplIdx = expr.indexOf(":checklist_template$/)");
    const denyIdx = expr.indexOf("beginsWith('biz:') ? false");
    assert.ok(tmplIdx > -1 && denyIdx > -1, kind + ": both branches found");
    assert.ok(tmplIdx < denyIdx,
      kind + ": checklist_template branch precedes the unknown-biz deny");
  }
});

test("read: checklist_template requires viewer-plus membership + biz_access (or owner)", () => {
  const r = dataKeyRule(".read");
  const m = r.match(/checklist_template\$\/\)\s*\?\s*\(([^?]*?)\)\s*:/);
  assert.ok(m, "singular read consequent isolated");
  const body = m[1];
  assert.match(body, /members'\)\.child\(auth\.uid\)\.val\(\) === true/, "requires membership");
  assert.match(body, /=== 'owner' \|\|[\s\S]*=== 'super_owner'/, "owner/super_owner allowed");
  assert.match(body, /biz_access'\)\.child\(\$dataKey\.replace\('biz:',''\)\.replace\(':checklist_template',''\)\)/,
    "falls back to structured biz_access for the exact suffix");
});

test("write: checklist_template allows owner/super_owner OR manager+biz_access, and NOT shift_manager", () => {
  const w = dataKeyRule(".write");
  const m = w.match(/checklist_template\$\/\)\s*\?\s*\(([^?]*?)\)\s*:/);
  assert.ok(m, "singular write consequent isolated");
  const body = m[1];
  assert.match(body, /=== 'owner' \|\|[\s\S]*=== 'super_owner'/, "owner/super_owner allowed");
  assert.match(body, /=== 'manager' &&[\s\S]*biz_access/, "manager requires biz_access");
  assert.doesNotMatch(body, /shift_manager/,
    "shift_manager is NOT granted checklist_template write");
});

test("write: manager WITHOUT biz_access is not blanket-allowed on checklist_template", () => {
  const w = dataKeyRule(".write");
  const m = w.match(/checklist_template\$\/\)\s*\?\s*\(([^?]*?)\)\s*:/);
  const body = m[1];
  assert.match(body, /=== 'manager' && root[\s\S]*biz_access/,
    "every manager grant is gated by biz_access");
});

// -- Blocker 2: legacy tenant-wide analytics/daily lockdown --------------------

test("rules: legacy named 'analytics' node denies client read AND write", () => {
  const a = rules.rules.tenants.$tenantId.analytics;
  assert.ok(a, "analytics named node exists");
  assert.equal(a[".read"], false, "analytics .read === false");
  assert.equal(a[".write"], false, "analytics .write === false");
});

test("rules: no descendant of analytics re-grants read/write (cascade stays closed)", () => {
  const a = rules.rules.tenants.$tenantId.analytics;
  const json = JSON.stringify(a);
  assert.doesNotMatch(json, /"\.read":\s*true/, "no descendant .read:true");
  assert.doesNotMatch(json, /"\.write":\s*true/, "no descendant .write:true");
});

test("rules: parameterized analytics:daily biz key denies client read+write", () => {
  for (const kind of [".read", ".write"]) {
    const expr = dataKeyRule(kind);
    assert.match(
      expr,
      /\$dataKey\.matches\(\/\^biz:\[\^:\]\+:analytics:daily:\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$\/\)\s*\?\s*false/,
      kind + ": analytics:daily:{date} => false"
    );
  }
});

test("client (index.html) never reads/writes tenant-wide analytics/daily", () => {
  const lines = indexHtml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/analytics\/daily/.test(l)) {
      assert.ok(
        /api\/analytics\/daily-builder/.test(l) || /^\s*\/\//.test(l) || /dailyBuilder/.test(l),
        "index.html:" + (i + 1) + " analytics/daily reference must be the server endpoint or a comment, got: " + l.trim()
      );
    }
  }
});

// -- Blocker 2: alert reader uses the authorized per-business source -----------

test("checkers.ts: no remaining read of tenant-wide analytics/daily", () => {
  assert.doesNotMatch(
    checkers,
    /db\.ref\(`tenants\/\$\{tenantId\}\/analytics\/daily`\)/,
    "legacy tenant-wide analytics/daily reader removed"
  );
});

test("checkers.ts: reads the authorized flat per-business analytics source", () => {
  assert.match(
    checkers,
    /db\.ref\(`tenants\/\$\{tenantId\}\/biz:\$\{bizId\}:analytics:daily:\$\{k\}`\)/,
    "reads biz:{bizId}:analytics:daily:{date}"
  );
});

test("checkers.ts: helper maps AnalyticsDoc.revenue fields to legacy shape", () => {
  assert.match(checkers, /revenue: Number\(rev\.total\) \|\| 0/, "total -> revenue");
  assert.match(checkers, /laborCost: Number\(rev\.payroll\) \|\| 0/, "payroll -> laborCost");
  assert.match(checkers, /foodCost: Number\(rev\.food_cost\) \|\| 0/, "food_cost -> foodCost");
});

test("checkers.ts: all five daily checkers route through readLegacyShapedDaily", () => {
  const calls = checkers.match(/readLegacyShapedDaily\(db, tenantId, bizId,/g) || [];
  assert.equal(calls.length, 5,
    "expected 5 readLegacyShapedDaily call sites, found " + calls.length);
});

test("checkers.ts: helper scopes every read to the caller's bizId (no cross-business)", () => {
  const refs = checkers.match(/db\.ref\(`tenants\/\$\{tenantId\}\/[^`]*analytics[^`]*`\)/g) || [];
  assert.ok(refs.length >= 1, "at least one analytics ref exists");
  for (const r of refs) {
    assert.match(r, /biz:\$\{bizId\}:/, "analytics ref must be biz-scoped: " + r);
  }
});

test("checkers.ts: entries readers (non-analytics) are left intact", () => {
  const entryReads = checkers.match(/db\.ref\(`tenants\/\$\{tenantId\}\/biz:\$\{bizId\}:entries`\)/g) || [];
  assert.equal(entryReads.length, 2, "both raw entries readers preserved");
});
