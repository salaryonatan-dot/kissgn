// S0 scope guard — LAYER B mutation proofs (R1: exact-content identity pin).
//
// The server-reader authorization (test/support/server-reader-authorized-delta.mjs) pins
// each of five protected files to the git blob SHA-1 of its REVIEWED bytes. This suite takes
// the REAL inputs from this working tree (positive control I) and proves the verdict fails
// for every way the authorization could be abused — each mutation is applied to the ACTUAL
// approved source text and hashed exactly as the guard hashes the working tree:
//   A. approved declaration moved after its first use (Codex SR-F2 — a runtime ReferenceError)
//   B. a helper/function block moved elsewhere
//   C. same tokens, reordered statements
//   D. an extra harmless-looking statement
//   E. a financial formula changed
//   F. part of the reader change reverted
//   G. an unapproved protected sibling changed
//   H. directory / glob allowlist attempted
//   I. exact approved tree → PASS
//
// Run: node --test test/finance/s0-guard-server-reader-mutations.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SERVER_READER_APPROVED_BLOBS, SERVER_READER_AUTHORIZED_FILES, SERVER_READER_BASE,
  collectServerReaderScopeInputs, serverReaderScopeVerdict, blobSha, isPlainAuthorizedFile, isProtectedPath,
} from "../support/server-reader-authorized-delta.mjs";
import { gitIn } from "../support/git-context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL = collectServerReaderScopeInputs(ROOT);
const DB = "src/analytics/dailyBuilder.ts", DM = "src/repositories/analytics/dailyMetricsRepo.ts", SB = "src/snapshot/snapshotBuilder.ts";
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");
const clone = (o) => JSON.parse(JSON.stringify(o));
/** Verdict for the real tree with ONE file's bytes replaced by `text`. */
const withText = (rel, text) => { const i = clone(REAL); i.blobs[rel] = blobSha(text); return i; };
const mustFail = (inputs, reason, m) => { const v = serverReaderScopeVerdict(inputs); assert.equal(v.ok, false, m + ": must fail"); assert.equal(v.reason, reason, m + ": " + JSON.stringify(v.detail)); return v; };
const mutate = (rel, fn, m) => { const before = src(rel); const after = fn(before); assert.notEqual(after, before, m + ": mutation applied"); return withText(rel, after); };
const line = (text, needle) => { const l = text.split("\n").find((x) => x.includes(needle)); assert.ok(l, "line: " + needle); return l; };

test("I. positive control: the exact approved tree passes; five plain files; pins are reviewed changes on top of the core; git agrees on the identity", () => {
  assert.equal(SERVER_READER_BASE, "8cac71c1248ad5cc49dfa1a727bf292398ae74e8");
  assert.deepEqual(serverReaderScopeVerdict(REAL), { ok: true });
  assert.deepEqual([...SERVER_READER_AUTHORIZED_FILES].sort(), [DB, DM, "src/repositories/analytics/laborRepo.ts", "src/repositories/analytics/purchasesRepo.ts", SB]);
  for (const f of SERVER_READER_AUTHORIZED_FILES) {
    assert.ok(isPlainAuthorizedFile(f) && isProtectedPath(f), f);
    assert.match(SERVER_READER_APPROVED_BLOBS[f], /^[0-9a-f]{40}$/, f);
    assert.equal(REAL.blobs[f], SERVER_READER_APPROVED_BLOBS[f], f + " working tree IS the reviewed version");
    assert.notEqual(REAL.baseBlobs[f], SERVER_READER_APPROVED_BLOBS[f], f + " differs from the approved core");
    const g = gitIn(ROOT, ["hash-object", f]); assert.equal(g.status, 0, g.stderr);
    assert.equal(g.stdout.trim(), SERVER_READER_APPROVED_BLOBS[f], f + ": git hash-object agrees with the pin");
  }
});

test("A. approved declaration relocated after its first use (Codex SR-F2) → approved_content_mismatch, and the mutant really throws ReferenceError", async () => {
  const actual = src(DB);
  const decl = line(actual, "const todayEntry = (requireRowForDate(");
  const use = "  const sales = num(todayEntry?.sales);";
  assert.ok(actual.includes(use), "first financial use present");
  const mutated = actual.replace(decl + "\n", "").replace(use, use + "\n" + decl);
  const v = mustFail(withText(DB, mutated), "approved_content_mismatch", "relocated declaration");
  assert.equal(v.detail.file, DB); assert.equal(v.detail.expected, SERVER_READER_APPROVED_BLOBS[DB]); assert.notEqual(v.detail.actual, v.detail.expected);
  // the same +/- lines in the same order — the R0 normalized-delta model could not see this; identity does
  const same = (t) => t.split("\n").filter((l) => l.includes("requireRowForDate(") || l.includes("requireEntriesRows(")).join("|");
  assert.equal(same(mutated), same(actual), "token-level content is unchanged");
  // prove the semantic damage: compile the mutant and run it against a healthy business
  const ts = (await import(pathToFileURL(join(ROOT, "node_modules", "typescript", "lib", "typescript.js")).href)).default;
  const H = await import("../support/server-reader-harness.mjs");
  H.offlineFetch(); const srv = H.compileServer();
  const db = H.installDb(H.makeDb()); H.seedBusiness(db, { entries: { _v: JSON.stringify([{ id: "11111111-1111-4111-8111-111111111111", date: "2026-09-23", sales: 100 }]) } });
  const ok = await (await srv.import("src/analytics/dailyBuilder.js")).buildAnalyticsForBiz(H.T, H.B, "2026-09-23"); assert.equal(ok.revenue.sales, 100, "approved file works");
  const dest = join(srv.dir, "src", "analytics", "dailyBuilder.__relocated__.js");
  writeFileSync(dest, ts.transpileModule(mutated, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  await assert.rejects(() => import(pathToFileURL(dest).href).then((m) => m.buildAnalyticsForBiz(H.T, H.B, "2026-09-23")), (e) => e.name === "ReferenceError", "the relocated mutant fails at runtime");
});

test("B. helper / function block moved elsewhere → approved_content_mismatch", () => {
  // move the whole `rowComponents` helper below `aggregateByDate`
  mustFail(mutate(DM, (t) => {
    const start = t.indexOf("// Per-row additive components"), end = t.indexOf("// One DailyMetric per business date");
    assert.ok(start > 0 && end > start); const block = t.slice(start, end);
    const rest = t.slice(0, start) + t.slice(end);
    const anchor = "export async function getDailyMetrics("; return rest.replace(anchor, block + anchor);
  }, "helper block moved"), "approved_content_mismatch", "helper block moved");
  // move `num` after its callers in snapshotBuilder-like fashion: swap two top-level helpers in dailyMetricsRepo
  mustFail(mutate(DM, (t) => {
    const a = t.indexOf("function num("), b = t.indexOf("function sumObj("), c = t.indexOf("// Per-row additive components");
    assert.ok(a > 0 && b > a && c > b); return t.slice(0, a) + t.slice(b, c) + t.slice(a, b) + t.slice(c);
  }, "helpers swapped"), "approved_content_mismatch", "helpers swapped");
});

test("C. same tokens, reordered statements → approved_content_mismatch", () => {
  mustFail(mutate(DM, (t) => {
    const l1 = "      acc.revenue += c.revenue;", l2 = "      acc.laborCost += c.laborCost;";
    assert.ok(t.includes(l1 + "\n" + l2)); return t.replace(l1 + "\n" + l2, l2 + "\n" + l1);
  }, "two accumulator statements swapped"), "approved_content_mismatch", "statements reordered");
  mustFail(mutate(DB, (t) => {
    const l1 = line(t, 'const readerCtx = { tenantId, bizId, site: "dailyBuilder" };'), l2 = line(t, "const rows = requireEntriesRows(entriesSnap.val(), readerCtx)");
    assert.ok(t.includes(l1 + "\n" + l2)); return t.replace(l1 + "\n" + l2, l2 + "\n" + l1);
  }, "readerCtx/rows swapped (use before declaration)"), "approved_content_mismatch", "declaration order swapped");
});

test("D. an extra harmless-looking statement → approved_content_mismatch (comments and whitespace included)", () => {
  mustFail(mutate(DB, (t) => t.replace("  const readerCtx = { tenantId, bizId, site: \"dailyBuilder\" };", "  const readerCtx = { tenantId, bizId, site: \"dailyBuilder\" };\n  void 0;"), "void statement"), "approved_content_mismatch", "extra statement");
  mustFail(mutate(SB, (t) => t + "\nexport const __probe = 1;\n", "extra export"), "approved_content_mismatch", "extra export");
  mustFail(mutate(DM, (t) => t.replace("function num(", "// harmless comment\nfunction num("), "comment"), "approved_content_mismatch", "comment added");
  mustFail(mutate(DM, (t) => t.replace("function num(v: unknown): number {", "function num(v: unknown): number  {"), "whitespace"), "approved_content_mismatch", "whitespace-only change (strict policy)");
});

test("E. financial formula changed → approved_content_mismatch", () => {
  mustFail(mutate(DM, (t) => t.replace("const revenue = num(e.sales) + num(e.deliveries) + num(e.other_income);", "const revenue = (num(e.sales) + num(e.deliveries) + num(e.other_income)) / 1.18;"), "VAT division"), "approved_content_mismatch", "VAT division inserted");
  mustFail(mutate(DM, (t) => t.replace("laborPct: t.revenue > 0 ? (t.laborCost / t.revenue) * 100 : 0,", "laborPct: t.revenue > 0 ? (t.laborCost / t.revenue) * 100 : 100,"), "ratio default"), "approved_content_mismatch", "ratio default changed");
  mustFail(mutate(SB, (t) => { const l = line(t, "totalSales +="); return t.replace(l, l.replace(";", " * 1.18;")); }, "snapshot gross-up"), "approved_content_mismatch", "snapshot sales grossed up");
});

test("F. part of the reader change reverted (tokens still present elsewhere) → approved_content_mismatch", () => {
  mustFail(mutate(DB, (t) => t.replace(line(t, "const todayEntry = (requireRowForDate("), "  const todayEntry = rows.find((e) => e.date === date);"), "D1 line reverted, import kept"), "approved_content_mismatch", "todayEntry reverted");
  mustFail(mutate(DM, (t) => t.replace("  return aggregateByDate(\n", "  return rows.map((e) => ({ date: e.date, ...rowComponents(e), laborPct: 0, foodCostPct: 0, transactionCount: 0, avgTicket: 0 })).sort((a, b) => a.date.localeCompare(b.date)); //\n  return aggregateByDate(\n"), "aggregation bypassed"), "approved_content_mismatch", "aggregation bypassed");
  // a full revert of one file to the approved core is also a mismatch (and would be flagged as pin ≠ base anyway)
  const base = gitIn(ROOT, ["show", `${SERVER_READER_BASE}:${DM}`]); assert.equal(base.status, 0);
  const v = mustFail(withText(DM, base.stdout), "approved_content_mismatch", "full revert to core");
  assert.equal(v.detail.actual, REAL.baseBlobs[DM]);
  // and a file missing from the tree
  const gone = clone(REAL); gone.blobs[DB] = null; mustFail(gone, "approved_content_mismatch", "file absent");
});

test("G. an unapproved protected sibling changed → unauthorized_protected_path (same directory gives no cover)", () => {
  for (const extra of ["src/analytics/regionResolver.ts", "src/repositories/analytics/productRepo.ts", "src/snapshot/index.ts",
                       "src/agent/proactive/detectors/detectDailyRevenueUnderperformance.ts", "src/agent/proactive/runProactiveJob.ts", "src/forecast/x.ts",
                       "vercel.json", "package.json", "database.rules.json", "scripts/backfill.mjs"]) {
    const i = clone(REAL); i.changedProtectedPaths.push(extra);
    const v = mustFail(i, "unauthorized_protected_path", extra); assert.deepEqual(v.detail, [extra]);
  }
  // a sibling change is rejected even when every approved file is intact and the sibling is listed FIRST
  const i = clone(REAL); i.changedProtectedPaths.unshift("src/agent/proactive/detectors/detectDailyRevenueUnderperformance.ts");
  mustFail(i, "unauthorized_protected_path", "detector not authorized in R1");
});

test("H. directory / glob allowlist attempted → invalid_allowlist_entry; bad or base-equal pins rejected", () => {
  const widen = (key) => { const a = clone(SERVER_READER_APPROVED_BLOBS); a[key] = a[DB]; return { ...clone(REAL), authorized: a }; };
  for (const bad of ["src/analytics/", "src/analytics", "src/analytics/**", "src/analytics/*.ts", "src/repositories/**/*.ts", "^src/snapshot/",
                     "src/analytics/../forecast/x.ts", "/src/analytics/dailyBuilder.ts", "src/agent/proactive/detectors/detectDailyRevenueUnderperformance.ts",
                     "src/agent/", "src/forecast/x.ts", "src/analytics/dailyBuilder.js"]) {
    const v = serverReaderScopeVerdict(widen(bad)); assert.equal(v.ok, false, bad); assert.equal(v.reason, "invalid_allowlist_entry", bad); assert.equal(v.detail, bad);
  }
  // a directory entry does not pass even when it carries the exact approved blob and the file entry is removed
  const dir = clone(SERVER_READER_APPROVED_BLOBS); delete dir[DB]; dir["src/analytics/"] = SERVER_READER_APPROVED_BLOBS[DB];
  assert.equal(serverReaderScopeVerdict({ ...clone(REAL), authorized: dir }).reason, "invalid_allowlist_entry");
  // pins must be blob shas; an empty table is rejected; a pin equal to the core blob is rejected (not a reviewed change)
  const notSha = clone(SERVER_READER_APPROVED_BLOBS); notSha[DB] = "*"; assert.equal(serverReaderScopeVerdict({ ...clone(REAL), authorized: notSha }).reason, "invalid_pin");
  const empty = clone(SERVER_READER_APPROVED_BLOBS); empty[DB] = ""; assert.equal(serverReaderScopeVerdict({ ...clone(REAL), authorized: empty }).reason, "invalid_pin");
  assert.equal(serverReaderScopeVerdict({ ...clone(REAL), authorized: {} }).reason, "empty_allowlist");
  const baseEq = clone(SERVER_READER_APPROVED_BLOBS); baseEq[DM] = REAL.baseBlobs[DM];
  const i = clone(REAL); i.blobs[DM] = REAL.baseBlobs[DM];
  assert.equal(serverReaderScopeVerdict({ ...i, authorized: baseEq }).reason, "pin_equals_base");
});
