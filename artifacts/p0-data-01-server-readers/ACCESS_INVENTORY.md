# ACCESS INVENTORY — server reads of `tenants/{tenantId}/biz:{bizId}:entries` at `8cac71c1`

Method: `grep -rn ":entries\|bizEntriesRef" src lib api` on the approved base, cross-checked
against the read-only prep inventory (`reviews/2026-09-19/server-reader-convergence-prep/`)
and the Codex plan (`marjin-reviews/2026-09-22/server-reader-convergence-plan/`). Result:
**9 live read sites in 7 files**, all now converged on `lib/analytics/entriesReader.js`.

| # | File | Function / site id | Pre-convergence parser | Post-convergence | Semantics |
|---|---|---|---|---|---|
| 1 | `src/analytics/dailyBuilder.ts` | `buildAnalyticsForBiz` → `dailyBuilder` | `parseFirebaseData<DailyEntry[]>(entriesSnap.val(), [])` (generic `_v` envelope; V2 node → `[]` silently) | `requireEntriesRows` + `requireRowForDate` | one-row-per-date (D1 typed refusal), D3 typed failure before fetch/persist |
| 2 | `src/snapshot/snapshotBuilder.ts` | `buildSnapshotForBiz` → `snapshotBuilder` | `parseFirebaseData<DailyEntry[]>` | `requireEntriesRows` | aggregator (all rows) |
| 3 | `src/repositories/analytics/dailyMetricsRepo.ts` | `getDailyMetrics` | local `parseV` (`_v` → JSON; else `Object.values(raw)` — a V2 node would yield `[schemaVersion, generation, rows-map…]` garbage) | `readRows` → `requireEntriesRows` | aggregator |
| 4 | `src/repositories/analytics/dailyMetricsRepo.ts` | `getLatestDailyDate` | local `parseV` | `readRows` | max date over all rows |
| 5 | `src/repositories/analytics/laborRepo.ts` | `getLaborMetrics` | local `parseV` | `requireEntriesRows` | aggregator |
| 6 | `src/repositories/analytics/purchasesRepo.ts` | `getPurchaseMetrics` | local `parseV` (also used for suppliers) | `requireEntriesRows` for entries; `parseLegacyListEnvelope` retained for suppliers only | aggregator |
| 7 | `lib/repositories/entryExceptionsRepo.js` | `listEntryExceptions` → `entryExceptionsRepo.listEntryExceptions` | local `parseLegacyEntries` (`_v` → JSON; else `[]`) | `requireEntriesRows` + per-date `rowForDate` | one-row-per-date fallback; ambiguous → `legacy_ambiguous` (D1) |
| 8 | `src/alerts/checkers.ts` | `checkSupplierAnomaly` → `checkers.checkSupplierAnomaly` | `orderByKey().startAt(date).endAt(date)` on the entries node — DEAD (children are `_v`/`generation`/`rows`/`schemaVersion`, never dates) → always `null` → never fired | kill-switch `false` → `[]` before read; prepared path: whole node + `rowsInRange` | non-firing (D2) |
| 9 | `src/alerts/checkers.ts` | `checkExpensiveEmployee` → `checkers.checkExpensiveEmployee` | same dead query | same | non-firing (D2) |

Routing (not a read site): `src/services/analyticsService.ts` `fetchPlannedData` — re-throws
typed reader errors from the repo catches (D3).

Non-sites confirmed:
- `src/agent/proactive/runProactiveJob.ts:415-422` — discovers business ids from SHALLOW child
  key names matching `^biz:(.+?):entries$`; never reads node contents. Unchanged (agent is DO-NOT-MODIFY).
- `src/firebase/refs.ts` `bizEntriesRef` — ref factory only.
- `api/**` — no direct entries read (the exceptions API goes through site 7's repo; it already
  maps thrown errors to `list_failed`).
- `src/forecast/**` — reads `analytics:daily` docs, not entries.

`LEGACY_ONLY_READERS_REMAINING: 0` — no server code parses `_v` for the entries node any more
(`purchasesRepo.parseLegacyListEnvelope` parses the SUPPLIERS list, which is not part of
Storage V2).

## Reconciliation with the Codex plan

| Topic | Codex plan | Claude prep / this implementation | Evidence-based resolution |
|---|---|---|---|
| Reader location | `lib/entriesReader.js` | `lib/analytics/entriesReader.js` | Assignment named `lib/analytics/…`; kept. Declaration parity test covers it. |
| `src/alerts/runner.ts` | modify (scope decomposition) | not modified | DO-NOT-MODIFY. Runner is proven unaffected by tests (D2). |
| `test/finance/vat-invariant.test.mjs` | modify (decompose scope guard) | first pass: not modified → `CORE_DEPENDENCY_FOUND`; 2026-09-23: CTO authorized the minimum change → two-layer guard with a literal five-file pinned delta (`S0_GUARD_ADAPTATION.md`) | Agrees with Codex's own reading ("a test-boundary issue, NOT a core-storage dependency"), resolved by explicit approval. |
| Checkers duplicate dates | `ambiguous_payment_order` typed status | every row contributes in `(date,id)` order; checkers non-firing (D2) | CTO D2 supersedes; the prepared path aggregates (order is output determinism only). |
| Exceptions duplicate dates | "conflicting states error" | `legacy_ambiguous` record with duplicate metadata (D1) | CTO D1 supersedes; API shape stays a record, never an exception for a single date. |
| Read-site count | 9 / 7 files | 9 / 7 files | agree. |
