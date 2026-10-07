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
  SERVER_READER_APPROVED_BLOBS as APPROVED_LITERAL, SERVER_READER_EFFECTIVE_BLOBS, SERVER_READER_AUTHORIZED_FILES, SERVER_READER_BASE,
  collectServerReaderScopeInputs, serverReaderScopeVerdict, blobSha, isPlainAuthorizedFile, isProtectedPath,
} from "../support/server-reader-authorized-delta.mjs";
import { isM1R2Tree, M1_R2_PINS } from "../support/m1-r2-remediation.mjs";
import { isM1R3Tree, M1_R3_PINS } from "../support/m1-r3-remediation.mjs";
// The pin table holding the tree under test: the approved pins — on an M1 R2 tree with the ONE R2 candidate pin of
// src/analytics/dailyBuilder.ts overlaid (pending independent review). Every mutation class below runs against it.
const SERVER_READER_APPROVED_BLOBS = SERVER_READER_EFFECTIVE_BLOBS;
import { gitIn } from "../support/git-context.mjs";
import { authorizedVersionFenceRulesDelta } from "../support/rules-authorized-delta.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// VERSION FENCE: database.rules.json changed after the core by the exact reviewed fence
// delta. The reader layer still treats it as PROTECTED (the raw collector reports it);
// the caller validates the fence delta FIRST and projects out only that one validated
// change — exactly as test/finance/vat-invariant.test.mjs does.
const RAW = collectServerReaderScopeInputs(ROOT);
const CORE_RULES = JSON.parse(gitIn(ROOT, ["show", `${SERVER_READER_BASE}:database.rules.json`]).stdout);
const FENCE_OK = authorizedVersionFenceRulesDelta(CORE_RULES, JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"))).ok === true;
const REAL = { ...RAW, changedProtectedPaths: RAW.changedProtectedPaths.filter((rel) => !(FENCE_OK && rel === "database.rules.json")) };
const DB = "src/analytics/dailyBuilder.ts", DM = "src/repositories/analytics/dailyMetricsRepo.ts", SB = "src/snapshot/snapshotBuilder.ts", SE = "src/snapshot/snapshotEmail.ts";
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");
const clone = (o) => JSON.parse(JSON.stringify(o));
/** Verdict for the real tree with ONE file's bytes replaced by `text`. */
const withText = (rel, text) => { const i = clone(REAL); i.blobs[rel] = blobSha(text); return i; };
const mustFail = (inputs, reason, m) => { const v = serverReaderScopeVerdict(inputs); assert.equal(v.ok, false, m + ": must fail"); assert.equal(v.reason, reason, m + ": " + JSON.stringify(v.detail)); return v; };
const mutate = (rel, fn, m) => { const before = src(rel); const after = fn(before); assert.notEqual(after, before, m + ": mutation applied"); return withText(rel, after); };
const line = (text, needle) => { const l = text.split("\n").find((x) => x.includes(needle)); assert.ok(l, "line: " + needle); return l; };

test("I. positive control: the exact approved tree passes; six plain files (B2 adds the e-mail presenter); pins are reviewed changes on top of the core; git agrees on the identity", () => {
  assert.equal(SERVER_READER_BASE, "8cac71c1248ad5cc49dfa1a727bf292398ae74e8");
  assert.deepEqual(serverReaderScopeVerdict(REAL), { ok: true });
  // the reader layer itself still rejects the Rules change: only the validated fence projection admits it
  assert.equal(FENCE_OK, true);
  assert.ok(RAW.changedProtectedPaths.includes("database.rules.json"));
  assert.deepEqual(serverReaderScopeVerdict(RAW), { ok: false, reason: "unauthorized_protected_path", detail: ["database.rules.json"] }, "unprojected: Rules remain a protected path for the reader layer");
  assert.deepEqual([...SERVER_READER_AUTHORIZED_FILES].sort(), [DB, DM, "src/repositories/analytics/laborRepo.ts", "src/repositories/analytics/purchasesRepo.ts", SB, SE]);
  if (isM1R2Tree(ROOT)) {
    if (isM1R3Tree(ROOT)) assert.equal(SERVER_READER_APPROVED_BLOBS[DB], M1_R3_PINS[DB], "R3 tree: dailyBuilder is held to its literal R3 candidate pin");
    else assert.equal(SERVER_READER_APPROVED_BLOBS[DB], M1_R2_PINS[DB], "R2 tree: dailyBuilder is held to its literal R2 candidate pin");
    assert.equal(APPROVED_LITERAL[DB], "6b70d03c245d163264f1bad2cefa71c0d85ff761", "the approved B1 R1 pin itself is unchanged");
    for (const f of SERVER_READER_AUTHORIZED_FILES) if (f !== DB) assert.equal(SERVER_READER_APPROVED_BLOBS[f], APPROVED_LITERAL[f], f + ": approved pin");
  } else assert.equal(SERVER_READER_APPROVED_BLOBS, APPROVED_LITERAL);
  for (const f of SERVER_READER_AUTHORIZED_FILES) {
    assert.ok(isPlainAuthorizedFile(f) && isProtectedPath(f), f);
    assert.match(SERVER_READER_APPROVED_BLOBS[f], /^[0-9a-f]{40}$/, f);
    assert.equal(REAL.blobs[f], SERVER_READER_APPROVED_BLOBS[f], f + " working tree IS the reviewed version");
    assert.notEqual(REAL.baseBlobs[f], SERVER_READER_APPROVED_BLOBS[f], f + " differs from the approved core");
    const g = gitIn(ROOT, ["hash-object", f]); assert.equal(g.status, 0, g.stderr);
    assert.equal(g.stdout.trim(), SERVER_READER_APPROVED_BLOBS[f], f + ": git hash-object agrees with the pin");
  }
});

// Financial Core B1: the mutation needles are anchored to the B1 bytes of the pinned files
// (the four reader files now serve financial values through src/finance-server/*); every
// mutation class A–F is kept.
const PR = "src/repositories/analytics/purchasesRepo.ts";
const B1_BASE = "213fb350019c3e212156eb032e34f4da8c179d6f";

test("A. approved declaration relocated after its first use (Codex SR-F2) → approved_content_mismatch, and the mutant really throws ReferenceError", async () => {
  const actual = src(DB);
  const decl = line(actual, "const record = canonicalDayRecord(");
  const use = line(actual, "const { revenue, fin } = toAnalyticsFinancials(record);");
  const mutated = actual.replace(decl + "\n", "").replace(use, use + "\n" + decl);
  const v = mustFail(withText(DB, mutated), "approved_content_mismatch", "relocated declaration");
  assert.equal(v.detail.file, DB); assert.equal(v.detail.expected, SERVER_READER_APPROVED_BLOBS[DB]); assert.notEqual(v.detail.actual, v.detail.expected);
  // the same +/- lines in the same order — the R0 normalized-delta model could not see this; identity does
  const same = (t) => t.split("\n").filter((l) => l.includes("canonicalDayRecord(") || l.includes("loadCanonicalInputs(")).join("|");
  assert.equal(same(mutated), same(actual), "token-level content is unchanged");
  // prove the semantic damage: compile the mutant and run it against a healthy business
  const ts = (await import(pathToFileURL(join(ROOT, "node_modules", "typescript", "lib", "typescript.js")).href)).default;
  const H = await import("../support/server-reader-harness.mjs");
  H.offlineFetch(); const srv = H.compileServer();
  const db = H.installDb(H.makeDb()); H.seedBusiness(db, { entries: { _v: JSON.stringify([{ id: "11111111-1111-4111-8111-111111111111", date: "2026-09-23", sales: 100 }]) } });
  const NOW = Date.UTC(2026, 8, 29, 9);
  const ok = await (await srv.import("src/analytics/dailyBuilder.js")).buildAnalyticsForBiz(H.T, H.B, "2026-09-23", { nowMs: NOW }); assert.equal(ok.revenue.sales, 100, "approved file works");
  const dest = join(srv.dir, "src", "analytics", "dailyBuilder.__relocated__.js");
  writeFileSync(dest, ts.transpileModule(mutated, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  await assert.rejects(() => import(pathToFileURL(dest).href).then((m) => m.buildAnalyticsForBiz(H.T, H.B, "2026-09-23", { nowMs: NOW })), (e) => e.name === "ReferenceError", "the relocated mutant fails at runtime");
});

test("B. helper / function block moved elsewhere → approved_content_mismatch", () => {
  // move the whole `parseLegacyListEnvelope` helper below `getPurchaseMetrics`
  mustFail(mutate(PR, (t) => {
    const start = t.indexOf("// The SUPPLIERS list is a legacy"), end = t.indexOf("export async function getPurchaseMetrics(");
    assert.ok(start > 0 && end > start); const block = t.slice(start, end);
    return t.slice(0, start) + t.slice(end) + "\n" + block;
  }, "helper block moved"), "approved_content_mismatch", "helper block moved");
  // swap the two exported functions of dailyMetricsRepo
  mustFail(mutate(DM, (t) => {
    const a = t.indexOf("export async function getDailyMetrics("), b = t.indexOf("export async function getLatestDailyDate(");
    assert.ok(a > 0 && b > a); return t.slice(0, a) + t.slice(b).trimEnd() + "\n\n" + t.slice(a, b).trimEnd() + "\n";
  }, "functions swapped"), "approved_content_mismatch", "functions swapped");
});

test("C. same tokens, reordered statements → approved_content_mismatch", () => {
  mustFail(mutate(DB, (t) => {
    const l1 = line(t, "const exceptionRows = dateRows.filter("), l2 = line(t, "const explicitNonException = dateRows.some(");
    assert.ok(t.includes(l1 + "\n" + l2)); return t.replace(l1 + "\n" + l2, l2 + "\n" + l1);
  }, "two independent statements swapped"), "approved_content_mismatch", "statements reordered");
  mustFail(mutate(DB, (t) => {
    const l1 = line(t, "const dateRows = (inputs.rows as EntryExceptionFields[])"), l2 = line(t, "const exceptionRows = dateRows.filter(");
    assert.ok(t.includes(l1 + "\n" + l2)); return t.replace(l1 + "\n" + l2, l2 + "\n" + l1);
  }, "dateRows/exceptionRows swapped (use before declaration)"), "approved_content_mismatch", "declaration order swapped");
});

test("D. an extra harmless-looking statement → approved_content_mismatch (comments and whitespace included)", () => {
  mustFail(mutate(DB, (t) => t.replace(line(t, "const record = canonicalDayRecord("), line(t, "const record = canonicalDayRecord(") + "\n  void 0;"), "void statement"), "approved_content_mismatch", "extra statement");
  mustFail(mutate(SB, (t) => t + "\nexport const __probe = 1;\n", "extra export"), "approved_content_mismatch", "extra export");
  mustFail(mutate(DM, (t) => t.replace("export async function getLatestDailyDate(", "// harmless comment\nexport async function getLatestDailyDate("), "comment"), "approved_content_mismatch", "comment added");
  mustFail(mutate(DM, (t) => t.replace("export async function getLatestDailyDate(tenantId: string, bizId: string)", "export async function getLatestDailyDate(tenantId: string,  bizId: string)"), "whitespace"), "approved_content_mismatch", "whitespace-only change (strict policy)");
});

test("E. financial formula changed → approved_content_mismatch", () => {
  mustFail(mutate(DB, (t) => t.replace("    revenue,\n    fin,", "    revenue: { ...revenue, total: (revenue.total ?? 0) / 1.18 },\n    fin,"), "VAT division"), "approved_content_mismatch", "VAT division inserted");
  mustFail(mutate(DB, (t) => t.replace("  const hadEntry = revenue.had_entry;", "  const hadEntry = (revenue.total ?? 0) > 0;"), "presence rule"), "approved_content_mismatch", "presence rule changed");
  mustFail(mutate(DM, (t) => t.replace('{ site: "dailyMetricsRepo.getDailyMetrics", need: { config: true, fixed: false, exceptions: false } }', '{ site: "dailyMetricsRepo.getDailyMetrics", need: { config: false, fixed: false, exceptions: false } }'), "global labor source dropped"), "approved_content_mismatch", "config read dropped (global employer cost unknown)");
  // B2: needles re-anchored to the B2 snapshot bytes (every mutation class kept)
  mustFail(mutate(SB, (t) => { const l = line(t, "totalSales: complete(f.amounts.revenue),"); return t.replace(l, l.replace("complete(f.amounts.revenue),", "(complete(f.amounts.revenue) ?? 0) * 1.18,")); }, "snapshot gross-up"), "approved_content_mismatch", "snapshot sales grossed up");
  mustFail(mutate(SB, (t) => t.replace('const complete = (a: { readonly state: string; readonly number: number | null }): number | null => (a.state === "complete" ? a.number : null);', "const complete = (a: { readonly state: string; readonly number: number | null }): number | null => a.number;"), "legacy partial leak"), "approved_content_mismatch", "snapshot legacy fields leak a partial value as a plain number");
  mustFail(mutate(SE, (t) => t.replace("revenueShare: shareOfRevenue(amounts.revenue, amounts.revenue),", 'revenueShare: Object.freeze({ exact: "100", number: 100, state: "value" as const, reason: null }),'), "B2-R02 forced 100%"), "approved_content_mismatch", "e-mail forces a 100% revenue share");
  mustFail(mutate(SE, (t) => t.replace("if (c.missing.length > 0) parts.push(", "if (false) parts.push("), "CDA-18 warning dropped"), "approved_content_mismatch", "e-mail drops the dated missing-revenue warning");
  mustFail(mutate(SB, (t) => t.replace("need: { config: true, fixed: true, exceptions: true }", "need: { config: true, fixed: true, exceptions: false }"), "snapshot exceptions dropped"), "approved_content_mismatch", "snapshot exception history dropped");
  mustFail(mutate(SE, (t) => { const l = line(t, "if (a.state === \"unavailable\" || a.exact === null) return NOT_AVAILABLE;"); return t.replace(l, "  if (a.exact === null) return formatShekel(\"0\");"); }, "e-mail missing ⇒ ₪0"), "approved_content_mismatch", "e-mail renders a missing value as ₪0");
});

test("F. part of the reader change reverted (tokens still present elsewhere) → approved_content_mismatch", () => {
  mustFail(mutate(DB, (t) => t.replace(line(t, "const legacyEntry: EntryExceptionFields | undefined ="), "  const legacyEntry: EntryExceptionFields | undefined = dateRows[0];"), "winner row restored, import kept"), "approved_content_mismatch", "legacy winner row restored");
  mustFail(mutate(DM, (t) => t.replace("  return canonicalDailySeries(inputs, { from: startDate, to: endDate }).days;", "  return canonicalDailySeries(inputs, { from: startDate, to: endDate }).days.filter((d) => d.revenue > 0);"), "presence bypassed"), "approved_content_mismatch", "explicit-zero days dropped");
  mustFail(mutate("src/repositories/analytics/laborRepo.ts", (t) => t.replace("return canonicalLaborRecords(inputs, { from: startDate, to: endDate });", "return canonicalLaborRecords(inputs, { from: startDate, to: endDate }).map((r) => ({ ...r, totalCost: r.hourlyEmployerCost ?? 0 }));"), "global allocation dropped"), "approved_content_mismatch", "labor contract bypassed");
  // a full revert of one file to the approved core is also a mismatch (and would be flagged as pin ≠ base anyway)
  const base = gitIn(ROOT, ["show", `${SERVER_READER_BASE}:${DM}`]); assert.equal(base.status, 0);
  const v = mustFail(withText(DM, base.stdout), "approved_content_mismatch", "full revert to core");
  assert.equal(v.detail.actual, REAL.baseBlobs[DM]);
  // the R1 (c46c2727) bytes of dailyMetricsRepo remain denied
  const r1 = gitIn(ROOT, ["show", `c46c27278966e517a02a91e7adc0911084012b20:${DM}`]); assert.equal(r1.status, 0, r1.stderr);
  const r1v = mustFail(withText(DM, r1.stdout), "approved_content_mismatch", "R1 (c46c2727) dailyMetricsRepo bytes");
  assert.equal(r1v.detail.actual, blobSha(r1.stdout)); assert.notEqual(r1v.detail.actual, r1v.detail.expected);
  // B1 re-pin: the PREVIOUSLY approved (P0-DATA-01 R2, at the B1 base) bytes of the four reader
  // files are no longer the approved version — reverting any one of them to those bytes is denied
  for (const f of [DB, DM, "src/repositories/analytics/laborRepo.ts", PR]) {
    const prev = gitIn(ROOT, ["show", `${B1_BASE}:${f}`]); assert.equal(prev.status, 0, prev.stderr);
    const pv = mustFail(withText(f, prev.stdout), "approved_content_mismatch", f + " pre-B1 bytes");
    assert.equal(pv.detail.file, f); assert.notEqual(pv.detail.actual, SERVER_READER_APPROVED_BLOBS[f]);
  }
  // B1 R1 re-pin: the B1 (658cd05) bytes of the four reader files — before the explicit
  // `need.exceptions:false` — are no longer the approved version either
  for (const f of [DB, DM, "src/repositories/analytics/laborRepo.ts", PR]) {
    const b1 = gitIn(ROOT, ["show", `658cd05bdae7d236ece221203c0700523e188c9e:${f}`]); assert.equal(b1.status, 0, b1.stderr);
    const bv = mustFail(withText(f, b1.stdout), "approved_content_mismatch", f + " B1 658cd05 bytes");
    assert.equal(bv.detail.file, f); assert.notEqual(bv.detail.actual, SERVER_READER_APPROVED_BLOBS[f]);
  }
  // B2 re-pin: the snapshot bytes of every earlier approved state (c46c2727, the B1 base, B1
  // 658cd05 and the approved B1 R1 4675eb20 — all the same pre-B2 blob) and the pre-B2 e-mail
  // presenter are no longer the approved version — reverting either file to them is denied
  const PRE_B2 = "4675eb20a97e8750429fad3e2ebda94f42f187b5";
  const preSnap = gitIn(ROOT, ["rev-parse", `${PRE_B2}:${SB}`]).stdout.trim();
  for (const rev of ["c46c27278966e517a02a91e7adc0911084012b20", B1_BASE, "658cd05bdae7d236ece221203c0700523e188c9e"]) {
    const at = gitIn(ROOT, ["rev-parse", `${rev}:${SB}`]); assert.equal(at.status, 0);
    assert.equal(at.stdout.trim(), preSnap, SB + ": one pre-B2 version at " + rev.slice(0, 8));
  }
  for (const f of [SB, SE]) {
    const prev = gitIn(ROOT, ["show", `${PRE_B2}:${f}`]); assert.equal(prev.status, 0, prev.stderr);
    const pv = mustFail(withText(f, prev.stdout), "approved_content_mismatch", f + " pre-B2 bytes");
    assert.equal(pv.detail.file, f); assert.notEqual(pv.detail.actual, SERVER_READER_APPROVED_BLOBS[f]);
  }
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
