// S0 scope guard — LAYER B mutation proofs. The server-reader authorization
// (test/support/server-reader-authorized-delta.mjs) pins the exact normalized delta of
// five protected files against the approved Storage V2 core. This suite takes the REAL
// inputs from git for this working tree (positive control) and proves the verdict
// fails for every way the authorization could be abused:
//   A. another protected file is modified
//   B. one of the five files receives an extra unrelated change
//   C. a revenue / VAT expression in one of the five files is modified
//   D. the approved delta is partially reverted while the expected tokens remain
//   E. an extra parser / transformation is inserted
//   F. the allowlist is widened from a file to a directory or pattern
//
// Run: node --test test/finance/s0-guard-server-reader-mutations.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SERVER_READER_AUTHORIZED_DELTA, SERVER_READER_AUTHORIZED_FILES, SERVER_READER_BASE,
  collectServerReaderScopeInputs, serverReaderScopeVerdict, normalizeUnifiedDiff, isPlainAuthorizedFile, isProtectedPath,
} from "../support/server-reader-authorized-delta.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL = collectServerReaderScopeInputs(ROOT);
const DB = "src/analytics/dailyBuilder.ts", DM = "src/repositories/analytics/dailyMetricsRepo.ts";
const clone = (o) => JSON.parse(JSON.stringify(o));
const withDelta = (file, fn) => { const i = clone(REAL); i.deltas[file] = fn(i.deltas[file]); return i; };
const fails = (inputs, reason, m) => { const v = serverReaderScopeVerdict(inputs); assert.equal(v.ok, false, m + ": must fail"); assert.equal(v.reason, reason, m + ": " + JSON.stringify(v.detail)); return v; };

test("positive control: the real working tree passes; exactly five plain files are authorized; the base is the approved core", () => {
  assert.equal(SERVER_READER_BASE, "8cac71c1248ad5cc49dfa1a727bf292398ae74e8");
  assert.deepEqual(serverReaderScopeVerdict(REAL), { ok: true });
  assert.equal(SERVER_READER_AUTHORIZED_FILES.length, 5);
  for (const f of SERVER_READER_AUTHORIZED_FILES) { assert.ok(isPlainAuthorizedFile(f), f); assert.ok(isProtectedPath(f), f); assert.ok(SERVER_READER_AUTHORIZED_DELTA[f].length > 0, f); }
  // the pinned delta is literal content, and the real diffs are non-trivial
  for (const f of SERVER_READER_AUTHORIZED_FILES) assert.deepEqual(normalizeUnifiedDiff(REAL.deltas[f]), SERVER_READER_AUTHORIZED_DELTA[f], f);
  assert.ok(SERVER_READER_AUTHORIZED_DELTA[DB].some((l) => l.includes("requireRowForDate(")), "the D1 line is part of the pinned delta");
});

test("A. another protected file modified → unauthorized_protected_path (same directory gives no cover)", () => {
  for (const extra of ["src/analytics/regionResolver.ts", "src/repositories/analytics/productRepo.ts", "src/snapshot/index.ts", "src/agent/proactive/runProactiveJob.ts", "src/forecast/x.ts", "vercel.json", "package.json", "database.rules.json", "scripts/backfill.mjs"]) {
    const i = clone(REAL); i.changedProtectedPaths.push(extra);
    const v = fails(i, "unauthorized_protected_path", extra);
    assert.deepEqual(v.detail, [extra]);
  }
});

test("B. an extra unrelated change inside an approved file → authorized_delta_mismatch", () => {
  const v = fails(withDelta(DB, (d) => d + "\n+  console.log(\"debug\", bizId);\n"), "authorized_delta_mismatch", "extra added line");
  assert.equal(v.detail.file, DB); assert.equal(v.detail.expected, null); assert.match(v.detail.actual, /console\.log/);
  fails(withDelta(DM, (d) => d + "\n-  transactionCount: 0, // not available in manual entries\n+  transactionCount: 1,\n"), "authorized_delta_mismatch", "extra removed+added pair");
  // whitespace-only reformatting of a pinned line is tolerated (it is not a change) …
  assert.deepEqual(serverReaderScopeVerdict(withDelta(DB, (d) => d.replace("const readerCtx = { tenantId, bizId, site: \"dailyBuilder\" };", "const   readerCtx   =   { tenantId,   bizId, site: \"dailyBuilder\" };"))), { ok: true });
  // … a token change is not
  fails(withDelta(DB, (d) => d.replace("site: \"dailyBuilder\" };", "site: \"dailyBuilder\", debug: true };")), "authorized_delta_mismatch", "token change on a pinned line");
});

test("C. a revenue / VAT expression modified in an approved file → authorized_delta_mismatch", () => {
  const vat = withDelta(DM, (d) => d + "\n-  const revenue = num(e.sales) + num(e.deliveries) + num(e.other_income);\n+  const revenue = (num(e.sales) + num(e.deliveries) + num(e.other_income)) / 1.18;\n");
  const v = fails(vat, "authorized_delta_mismatch", "VAT division inserted");
  assert.equal(v.detail.file, DM); assert.match(v.detail.actual, /revenue/);
  fails(withDelta("src/snapshot/snapshotBuilder.ts", (d) => d + "\n-    totalSales += num(e.sales);\n+    totalSales += num(e.sales) * 1.18;\n"), "authorized_delta_mismatch", "gross-up inserted in snapshot");
  fails(withDelta(DB, (d) => d + "\n-      food_cost: foodCost,\n+      food_cost: foodCost * 0.9,\n"), "authorized_delta_mismatch", "food cost factor inserted in dailyBuilder");
});

test("D. partial revert with the expected tokens still present → authorized_delta_mismatch", () => {
  // keep the import (token present) but restore the silent `.find` winner
  const i = withDelta(DB, (d) => d.split("\n").filter((l) => !l.includes("const todayEntry = (requireRowForDate(") && !l.includes("const todayEntry = entries.find(")).join("\n"));
  const v = fails(i, "authorized_delta_mismatch", "D1 line reverted, import kept");
  assert.match(String(v.detail.expected), /requireRowForDate|todayEntry/);
  // drop just the removed-line evidence of the old parser (as if parseV were re-added)
  fails(withDelta(DM, (d) => d.split("\n").filter((l) => !l.startsWith("-function parseV(")).join("\n")), "authorized_delta_mismatch", "old parser silently restored");
  // an approved file with NO change at all (full revert of one file) also fails
  fails(withDelta("src/repositories/analytics/laborRepo.ts", () => ""), "authorized_delta_mismatch", "one file fully reverted");
});

test("E. an extra parser / transformation inserted → authorized_delta_mismatch", () => {
  fails(withDelta(DB, (d) => d + "\n+  const legacyRows = JSON.parse((entriesSnap.val() || {})._v || \"[]\");\n"), "authorized_delta_mismatch", "`_v` parser inserted");
  fails(withDelta("src/repositories/analytics/purchasesRepo.ts", (d) => d + "\n+  const rows2 = rows.map((r) => ({ ...r, supplier_payments: normalizePayments(r.supplier_payments) }));\n"), "authorized_delta_mismatch", "transformation inserted");
  fails(withDelta(DM, (d) => d.replace("+  return requireEntriesRows(snapshot.val(), { tenantId, bizId, site }) as unknown as RawEntry[];", "+  return dedupeByDate(requireEntriesRows(snapshot.val(), { tenantId, bizId, site })) as unknown as RawEntry[];")), "authorized_delta_mismatch", "silent dedupe wrapped around the reader");
});

test("F. widening the allowlist from a file to a directory or pattern → invalid_allowlist_entry", () => {
  const widen = (key) => { const a = clone(SERVER_READER_AUTHORIZED_DELTA); a[key] = a[DB]; return { ...clone(REAL), authorized: a }; };
  for (const bad of ["src/analytics/", "src/analytics", "src/analytics/**", "src/analytics/*.ts", "src/repositories/**/*.ts", "^src/snapshot/", "src/analytics/../forecast/x.ts", "/src/analytics/dailyBuilder.ts", "src/agent/proactive/runProactiveJob.ts", "src/analytics/dailyBuilder.js"]) {
    const v = serverReaderScopeVerdict(widen(bad));
    assert.equal(v.ok, false, bad);
    assert.equal(v.reason, "invalid_allowlist_entry", bad); assert.equal(v.detail, bad);
  }
  // an allowlist entry with no pinned content, or an empty allowlist, is rejected too
  const a = clone(SERVER_READER_AUTHORIZED_DELTA); a[DB] = [];
  assert.equal(serverReaderScopeVerdict({ ...clone(REAL), authorized: a }).reason, "invalid_pinned_delta");
  assert.equal(serverReaderScopeVerdict({ ...clone(REAL), authorized: {} }).reason, "empty_allowlist");
  // and a directory-style entry does not pass even when the file's delta matches exactly
  const dir = clone(SERVER_READER_AUTHORIZED_DELTA); delete dir[DB]; dir["src/analytics/"] = SERVER_READER_AUTHORIZED_DELTA[DB];
  assert.equal(serverReaderScopeVerdict({ ...clone(REAL), authorized: dir }).reason, "invalid_allowlist_entry");
});
