# P0-DATA-01 — Server Reader Convergence — CHANGE SUMMARY

**Worktree:** `/Users/yonatan/Documents/marjin/kissgn-p0-data-01-server-readers`
**Branch:** `claude/p0-data-01-server-readers`
**Base (Storage V2 core, Codex-APPROVED):** `8cac71c1248ad5cc49dfa1a727bf292398ae74e8`
**Candidate commit:** ONE local commit on `claude/p0-data-01-server-readers`, parent
`8cac71c1` (`git log -1` in the worktree; the SHA is in the final report). Not pushed,
not deployed.

**Status history:** the first pass reported `CORE_DEPENDENCY_FOUND`: the S0/VAT scope
guard (`test/finance/vat-invariant.test.mjs`, test 5) forbids ANY change under
`src/analytics/`, `src/repositories/`, `src/snapshot/` relative to BASE `686b4350`, and three
of the nine live read sites live there. On 2026-09-23 the CTO ruled this an expected
scope-guard policy boundary (not a Storage V2 core dependency) and authorized the MINIMUM
guard change that recognizes this exact five-file delta by content. That two-layer guard
is now applied — see `S0_GUARD_ADAPTATION.md`. Reader behaviour is unchanged from the
first pass.

## What changed (runtime)

| File | Change |
|---|---|
| `lib/analytics/entriesReader.js` (**new**) | Shared server reader: `readEntriesNode`, `requireEntriesRows`, `rowForDate`, `requireRowForDate`, `rowsInRange`, `duplicateDates`, typed `EntriesStorageError` / `EntriesAmbiguityError`, `isEntriesReadError`. Mirror of the client `MarjinStorageV2.readEntriesNode` contract: absent / legacy `_v` / V2 rows / malformed; schemaVersion 2 ⇒ `_v` is never consulted. |
| `lib/analytics/entriesReader.d.ts` (**new**) | Declarations (parity-checked by `test/typescript/js-declaration-parity.test.mjs`). |
| `src/analytics/dailyBuilder.ts` | Entries via `requireEntriesRows`; `todayEntry` via `requireRowForDate` (CTO D1: `duplicate_business_date` typed refusal before weather/oref fetch and before any persisted analytics/insights). `parseFirebaseData` kept for config/business. |
| `src/snapshot/snapshotBuilder.ts` | Entries via `requireEntriesRows`; aggregation unchanged (all rows counted). |
| `src/repositories/analytics/dailyMetricsRepo.ts` | `parseV` → `readRows` (shared reader), sites `getDailyMetrics` / `getLatestDailyDate`. |
| `src/repositories/analytics/laborRepo.ts` | `parseV` removed; shared reader. |
| `src/repositories/analytics/purchasesRepo.ts` | Entries via shared reader; `parseLegacyListEnvelope` kept ONLY for the suppliers list (not Storage V2). |
| `src/services/analyticsService.ts` | CTO D3 routing: typed entries-read errors are re-thrown from the daily/labor/purchases/latest-date catches (never a soft `failed` with partial data); other errors keep the historical soft-fail. |
| `lib/repositories/entryExceptionsRepo.js` | `parseLegacyEntries` removed; shared reader; per-date `rowForDate` → ambiguous dates carry an explicit `LEGACY_AMBIGUOUS` marker. |
| `lib/entryExceptions.js` | `LEGACY_AMBIGUOUS` export; `buildEffectiveRecord` returns `{source:"legacy_ambiguous", origin:"legacy_ambiguous", duplicateCount, duplicateIds}` for marked dates (structured state still wins). |
| `src/alerts/checkers.ts` | CTO D2: `export const ENTRIES_ANOMALY_CHECKS_ENABLED = false`; both entries-backed checkers return `[]` BEFORE any read. Their (dead) `orderByKey().startAt/endAt` query is replaced by a whole-node read through the shared reader + `rowsInRange` — prepared, proven equivalent, but externally non-firing. |
| `tools/storage-v2/preflight.mjs` | Informational `duplicateDates: [{date, ids}]` in both ok/blocked legacy reports. Never a blocker, never a repair. |

## S0 guard adaptation (CTO-authorized, test-only)

| File | Change |
|---|---|
| `test/support/server-reader-authorized-delta.mjs` (**new**) | Pinned literal normalized delta `8cac71c1 → tree` for exactly the five approved files; pure `serverReaderScopeVerdict`; git collector. |
| `test/finance/vat-invariant.test.mjs` | Test 5 body: Layer A (historical BASE→8cac71c1 forbidden-path + semantic Rules check; Rules frozen after the core) + Layer B (five-file content pin). Tests 1–4 and the added-line regex byte-identical. |
| `test/finance/s0-guard-server-reader-mutations.test.mjs` (**new**) | Mutation proofs A–F (7 tests). |
| `test/dashboard/entries-storage-v2-hardening.test.mjs` | [H10] pin of the VAT guard file adapted: masks only the scope-check body, re-asserts both semantic modules are consumed and no directory allowlist exists. |

Diffstat (runtime + tooling): 171 insertions, 84 deletions across 14 tracked files
(`git diff --stat`), plus 13 new files (reader, declarations, fixtures, harness, 8 test
files, 1 emulator matrix).

## What changed (tests / docs)

- New: `test/support/entries-fixtures.mjs` (dual-form fixtures F0…F10, stale-`_v` poison node, 8 malformed V2 variants, vm-loaded client contract), `test/support/server-reader-harness.mjs` (compiles the real `src/`+`lib/` with only the Admin/email seams replaced; in-memory RTDB with key-range query semantics).
- New: `test/analytics/entries-reader.test.mjs` (6), `entries-reader-client-parity.test.mjs` (2), `entries-reader-dailybuilder.test.mjs` (6), `entries-reader-snapshot.test.mjs` (5), `entries-reader-repos.test.mjs` (5), `entries-reader-exceptions.test.mjs` (5), `entries-reader-checkers.test.mjs` (3), `test/storage-v2/preflight-duplicates.test.mjs` (6).
- New: `test/emulator/server-readers-matrix.mjs` (SR-01…SR-10, real emulator + real compiled server modules + real Admin SDK; 3 consecutive rounds green).
- Modified (guard): see the S0 guard adaptation table above.
- Modified: `test/analytics/entry-exception-parity.test.mjs` and `test/insights/false-insights-p0.test.mjs` copy `lib/analytics/entriesReader.{js,d.ts}` into their temp compile dirs (they compile the real modules, which now import the reader); `test/typescript/js-declaration-parity.test.mjs` adds the reader pair and scans `export class`; `test/emulator/README.md` documents the sixth emulator script.

## Not changed (DO-NOT-MODIFY list — verified by `git status`)

`index.html`, `database.rules.json`, `test/emulator/database.rules.json`,
`tools/storage-v2/upgrade.mjs`, Storage V2 coordinator/router/mutator, generation/clear_all,
VAT arithmetic assertions 1–4 and `test/support/rules-authorized-delta.mjs` (the guard's scope
test 5 was adapted under explicit CTO authorization — `S0_GUARD_ADAPTATION.md`),
`src/alerts/runner.ts`, `src/agent/**`, `api/**`, `src/forecast/**`, `package*.json`,
`tsconfig.json` — none modified. `CORE_STORAGE_MODIFIED: NO`.

## Gate results (see TEST_RESULTS.md / EMULATOR_RESULTS.md)

- Focused reader suites: 38/38 (+ preflight duplicates 6/6, declaration parity 11/11, exception parity 9/9, false-insights 56/56 inner checks).
- Emulator: server-readers-matrix 10/10 ×3 rounds; storage-v2-matrix 46/46; rules-guard mutations 12/12; authorization 108/108; remote atomic 19/19; legacy rules validation 30/30.
- Full emulator-free suite: **780/780** (773 + 7 guard mutation tests). VAT/S0 5/5.
- `tsc --noEmit`: baseline unchanged (exit 2, exactly 22 pre-existing `TS2742`, 0 with `--preserveSymlinks`). `git diff --check`: clean.
