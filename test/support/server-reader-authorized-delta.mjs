// Marjin — S0 anti-migration guard, LAYER B: the AUTHORIZED SERVER-READER DELTA for the
// five historically protected runtime files, pinned EXACTLY.
//
// Layer A of the guard (test/finance/vat-invariant.test.mjs) keeps the historical S0
// contract intact for the whole range BASE (686b4350) → the Codex-approved Storage V2
// core (8cac71c1): no change under src/analytics/, src/repositories/, src/agent/,
// src/snapshot/, src/forecast/, package files, vercel.json or stored-data scripts, and
// database.rules.json only through the semantic entries-contract exception.
//
// Layer B (this module) authorizes ONE further change on top of that core — the
// P0-DATA-01 server-reader convergence (CTO decision, 2026-09-23) — and authorizes it
// by CONTENT, never by path: for each of exactly five named files the normalized
// unified diff `8cac71c1 → working tree` must equal the literal delta pinned below.
// Any other protected path that changes, any extra line in one of the five files, a
// partial revert that leaves the expected tokens in place, an inserted parser, a
// touched revenue/VAT expression — all differ from the pinned lines and are rejected.
// Directories, globs and patterns are not accepted as authorized entries at all.
//
// Widening this authorization therefore REQUIRES editing this file in the same reviewed
// change — that is the point. When the reader slice is merged and a new guard base is
// adopted, the pinned delta is retired, not extended.

import { gitIn } from "./git-context.mjs";

/** The Codex-approved Storage V2 core; the reader delta is authorized on top of it. */
export const SERVER_READER_BASE = "8cac71c1248ad5cc49dfa1a727bf292398ae74e8";

/** Protected roots under which a change is otherwise forbidden by the S0 guard. */
export const PROTECTED_ROOTS = Object.freeze([
  /^src\/analytics\//, /^src\/repositories\//, /^src\/agent\//, /^src\/snapshot\//, /^src\/forecast\//,
  /^database\.rules\.json$/, /^vercel\.json$/, /^package(?:-lock)?\.json$/, /(?:^|\/)(?:migration|migrations|scripts)\//i,
]);
export const isProtectedPath = (rel) => PROTECTED_ROOTS.some((re) => re.test(rel));

/**
 * An authorized entry must name ONE existing TypeScript source file by its exact
 * repository-relative path under a protected src root: no directory, no trailing
 * slash, no glob or regex metacharacters, no `..`, no leading slash.
 */
export function isPlainAuthorizedFile(rel) {
  if (typeof rel !== "string" || !rel) return false;
  if (/[*?[\]{}()|^$\\]/.test(rel)) return false;
  if (rel.startsWith("/") || rel.endsWith("/") || rel.includes("..") || rel.includes("//")) return false;
  if (!/\.ts$/.test(rel)) return false;
  return /^src\/(?:analytics|repositories|snapshot)\/[A-Za-z0-9_./-]+\.ts$/.test(rel);
}

/**
 * Normalize a unified diff (`--unified=0`) to its content lines only: every added or
 * removed line, marker kept, leading/trailing whitespace trimmed and internal runs
 * collapsed. Hunk headers, index lines and file headers carry no content and are
 * dropped; blank added/removed lines are dropped too. Formatting-only noise is thus
 * tolerated; any token change is not.
 */
export function normalizeUnifiedDiff(text) {
  return String(text || "").split(/\r?\n/)
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .map((l) => l[0] + " " + l.slice(1).trim().replace(/\s+/g, " "))
    .filter((l) => l !== "+ " && l !== "- ");
}

/** Exactly the five files the CTO authorized for this slice — nothing under a directory. */
export const SERVER_READER_AUTHORIZED_DELTA = Object.freeze({
  "src/analytics/dailyBuilder.ts": Object.freeze([
    "+ import { requireEntriesRows, requireRowForDate } from \"../../lib/analytics/entriesReader.js\";",
    "- const entries = parseFirebaseData<DailyEntry[]>(entriesSnap.val(), []);",
    "+ // Server reader convergence: the entries node is read through the shared dual-mode",
    "+ // reader (legacy `_v` | Storage V2 rows | absent) — never through the generic",
    "+ // envelope parser. A malformed node throws a typed EntriesStorageError before any",
    "+ // external fetch or derived write (CTO D3); a business date carried by more than",
    "+ // one immutable row throws a typed EntriesAmbiguityError (duplicate_business_date)",
    "+ // — there is no silent first/last/position winner (CTO D1). Both propagate to the",
    "+ // caller: buildAnalyticsForAll records the business failure and continues.",
    "+ const readerCtx = { tenantId, bizId, site: \"dailyBuilder\" };",
    "+ const rows = requireEntriesRows(entriesSnap.val(), readerCtx) as unknown as DailyEntry[];",
    "- const todayEntry = entries.find((e) => e.date === date);",
    "+ const todayEntry = (requireRowForDate(rows as unknown as Array<{ date?: string }>, date, readerCtx) as unknown as DailyEntry | null) ?? undefined;",
  ]),
  "src/repositories/analytics/dailyMetricsRepo.ts": Object.freeze([
    "+ import { requireEntriesRows } from \"../../../lib/analytics/entriesReader.js\";",
    "- function parseV(snapshot: any): RawEntry[] {",
    "- const raw = snapshot.val();",
    "- if (!raw) return [];",
    "- // Data is wrapped in { _v: \"JSON_STRING\" }",
    "- if (raw._v && typeof raw._v === \"string\") {",
    "- try { return JSON.parse(raw._v); } catch { return []; }",
    "- }",
    "- // Fallback: might be direct array or object",
    "- if (Array.isArray(raw)) return raw;",
    "- if (typeof raw === \"object\") return Object.values(raw);",
    "- return [];",
    "+ // Server reader convergence: the shared dual-mode reader (legacy `_v` | Storage V2",
    "+ // rows | absent). Every stored row is returned (duplicate business dates included —",
    "+ // this repository aggregates, it never picks one row per date); a malformed node",
    "+ // throws a typed EntriesStorageError instead of silently yielding an empty dataset.",
    "+ function readRows(snapshot: any, tenantId: string, bizId: string, site: string): RawEntry[] {",
    "+ return requireEntriesRows(snapshot.val(), { tenantId, bizId, site }) as unknown as RawEntry[];",
    "- const entries = parseV(snapshot);",
    "+ const rows = readRows(snapshot, tenantId, bizId, \"dailyMetricsRepo.getDailyMetrics\");",
    "- return entries",
    "+ return rows",
    "- const entries = parseV(snapshot);",
    "- if (entries.length === 0) return null;",
    "- const sorted = entries.filter((e) => e.date).sort((a, b) => b.date.localeCompare(a.date));",
    "+ const rows = readRows(snapshot, tenantId, bizId, \"dailyMetricsRepo.getLatestDailyDate\");",
    "+ if (rows.length === 0) return null;",
    "+ const sorted = rows.filter((e) => e.date).sort((a, b) => b.date.localeCompare(a.date));",
  ]),
  "src/repositories/analytics/laborRepo.ts": Object.freeze([
    "+ import { requireEntriesRows } from \"../../../lib/analytics/entriesReader.js\";",
    "- function parseV(snapshot: any): any[] {",
    "- const raw = snapshot.val();",
    "- if (!raw) return [];",
    "- if (raw._v && typeof raw._v === \"string\") {",
    "- try { return JSON.parse(raw._v); } catch { return []; }",
    "- }",
    "- if (Array.isArray(raw)) return raw;",
    "- if (typeof raw === \"object\") return Object.values(raw);",
    "- return [];",
    "- }",
    "+ // Server reader convergence: shared dual-mode reader; all rows; typed failure on a",
    "+ // malformed node (never an empty labor dataset from corrupt storage).",
    "- const entries = parseV(snapshot);",
    "+ const rows: any[] = requireEntriesRows(snapshot.val(), { tenantId, bizId, site: \"laborRepo.getLaborMetrics\" });",
    "- return entries",
    "+ return rows",
  ]),
  "src/repositories/analytics/purchasesRepo.ts": Object.freeze([
    "+ import { requireEntriesRows } from \"../../../lib/analytics/entriesReader.js\";",
    "- function parseV(snapshot: any): any[] {",
    "+ // The SUPPLIERS list is a legacy `_v` envelope that is NOT part of Storage V2; this",
    "+ // parser is kept for it alone. Entries go through the shared dual-mode reader below.",
    "+ function parseLegacyListEnvelope(snapshot: any): any[] {",
    "- const suppliers = parseV(suppSnap) as Array<{ id: string | number; name: string }>;",
    "+ const suppliers = parseLegacyListEnvelope(suppSnap) as Array<{ id: string | number; name: string }>;",
    "- // Get entries",
    "+ // Entries: shared dual-mode reader; every stored row contributes its payments;",
    "+ // a malformed node throws a typed EntriesStorageError (no silent empty result).",
    "- const entries = parseV(snapshot);",
    "+ const rows: any[] = requireEntriesRows(snapshot.val(), { tenantId, bizId, site: \"purchasesRepo.getPurchaseMetrics\" });",
    "- for (const e of entries) {",
    "+ for (const e of rows) {",
  ]),
  "src/snapshot/snapshotBuilder.ts": Object.freeze([
    "+ import { requireEntriesRows } from \"../../lib/analytics/entriesReader.js\";",
    "- const entries = parseFirebaseData<DailyEntry[]>(entriesSnap.val());",
    "+ // Server reader convergence: entries through the shared dual-mode reader — every",
    "+ // stored row (duplicate business dates included) is aggregated exactly as before; a",
    "+ // malformed node throws a typed EntriesStorageError, so no snapshot (and no email)",
    "+ // is ever derived from the frozen `_v` (CTO D3).",
    "+ const rows = requireEntriesRows(entriesSnap.val(), { tenantId, bizId, site: \"snapshotBuilder\" }) as unknown as DailyEntry[];",
    "- const monthEntries = entries.filter((e) => e.date?.startsWith(currentMonth));",
    "+ const monthEntries = rows.filter((e) => e.date?.startsWith(currentMonth));",
  ]),
});
export const SERVER_READER_AUTHORIZED_FILES = Object.freeze(Object.keys(SERVER_READER_AUTHORIZED_DELTA));

/**
 * Pure verdict. Inputs:
 *   changedProtectedPaths — protected paths that differ between SERVER_READER_BASE and
 *                           the working tree (already filtered by isProtectedPath);
 *   deltas                — { [rel]: unified diff text of SERVER_READER_BASE → working tree }
 *                           for at least every authorized file (missing ⇒ empty diff);
 *   authorized            — the pinned delta table (defaults to the one above; mutation
 *                           tests pass altered tables to prove the checks bite).
 * Returns { ok:true } or { ok:false, reason, detail }.
 */
export function serverReaderScopeVerdict({ changedProtectedPaths, deltas, authorized = SERVER_READER_AUTHORIZED_DELTA }) {
  const keys = Object.keys(authorized || {});
  if (keys.length === 0) return { ok: false, reason: "empty_allowlist" };
  for (const k of keys) {
    if (!isPlainAuthorizedFile(k)) return { ok: false, reason: "invalid_allowlist_entry", detail: k };
    const pinned = authorized[k];
    if (!Array.isArray(pinned) || pinned.length === 0 || !pinned.every((l) => typeof l === "string" && /^[+-] \S/.test(l))) {
      return { ok: false, reason: "invalid_pinned_delta", detail: k };
    }
  }
  const changed = Array.from(new Set(changedProtectedPaths || []));
  const stray = changed.filter((rel) => isProtectedPath(rel) && !Object.prototype.hasOwnProperty.call(authorized, rel));
  if (stray.length) return { ok: false, reason: "unauthorized_protected_path", detail: stray.sort() };
  for (const k of keys) {
    const actual = normalizeUnifiedDiff((deltas || {})[k]);
    const pinned = authorized[k];
    const n = Math.max(actual.length, pinned.length);
    for (let i = 0; i < n; i++) {
      if (actual[i] !== pinned[i]) {
        return { ok: false, reason: "authorized_delta_mismatch",
                 detail: { file: k, index: i, expected: pinned[i] ?? null, actual: actual[i] ?? null, expectedLines: pinned.length, actualLines: actual.length } };
      }
    }
  }
  return { ok: true };
}

/** Collect the real inputs from git for `root` (the working tree vs SERVER_READER_BASE). */
export function collectServerReaderScopeInputs(root, base = SERVER_READER_BASE) {
  const names = gitIn(root, ["diff", "--name-only", base, "--"]);
  if (names.status !== 0) throw new Error("git diff --name-only failed: " + names.stderr);
  const changedAll = names.stdout.trim().split(/\n/).filter(Boolean);
  const changedProtectedPaths = changedAll.filter(isProtectedPath);
  const deltas = {};
  for (const rel of SERVER_READER_AUTHORIZED_FILES) {
    const d = gitIn(root, ["-c", "diff.algorithm=myers", "diff", "--no-color", "--no-ext-diff", "--unified=0", base, "--", rel]);
    if (d.status !== 0) throw new Error("git diff failed for " + rel + ": " + d.stderr);
    deltas[rel] = d.stdout;
  }
  return { changedAll, changedProtectedPaths, deltas };
}
