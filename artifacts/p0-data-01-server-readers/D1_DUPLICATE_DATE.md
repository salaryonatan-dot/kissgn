# CTO D1 — DUPLICATE BUSINESS DATE: no silent winner

**Decision:** a business date carried by more than one immutable row is an explicit,
typed ambiguity. No reader picks first / last / array position / uuid order / `(date,id)`
order. Aggregators count every row. One-row-per-date derivations: 0 → absent, 1 → use,
>1 → `duplicate_business_date`. dailyBuilder persists no analytics/insights for an
ambiguous business; healthy businesses continue. The exceptions fallback returns an
explicit `origin: "legacy_ambiguous"` record with duplicate metadata. Nothing is deleted
or merged automatically; the preflight only reports.

## Implementation

- `rowForDate` / `requireRowForDate` in the shared reader (ambiguity → `EntriesAmbiguityError{status:"duplicate_business_date", date, count, ids}`).
- `dailyBuilder.buildAnalyticsForBiz`: `todayEntry = requireRowForDate(rows, date, ctx)` — evaluated right after the reads, **before** the weather / oref fetches and before `saveAnalyticsDoc` / `buildAndSaveInsights`. `buildAnalyticsForAll`'s existing per-business try/catch records `{tenantId, bizId, error}` and continues.
- Aggregators (`snapshotBuilder`, `dailyMetricsRepo.getDailyMetrics`, `getLatestDailyDate`, `laborRepo`, `purchasesRepo`, checkers' prepared path): unchanged semantics — every row contributes.
- `entryExceptionsRepo.listEntryExceptions`: per date `rowForDate(inRange, d)`; ambiguous ⇒ `{[LEGACY_AMBIGUOUS]:true, count, ids}` marker ⇒ `buildEffectiveRecord` returns `{ source:"legacy_ambiguous", origin:"legacy_ambiguous", status:"normal", reasonCode:null, reasonText:null, revision:0, structured:false, duplicateCount, duplicateIds }`. A structured envelope for that date still wins (structured-first order unchanged).
- `tools/storage-v2/preflight.mjs`: `duplicateDates:[{date, ids}]` reported on ok AND blocked legacy reports; never a blocker; conversion keeps all rows.

## Proof

| Test | What it proves |
|---|---|
| `entries-reader.test.mjs` | `rowForDate` absent/single/ambiguous; ids sorted; `duplicateDates` shape; reader never collapses rows in either form |
| `entries-reader-dailybuilder.test.mjs` "D1" | both physical forms: typed error with `count:2`, both ids named, **0 external fetches**, `db.writes === []`; the unique sibling date (2026-08-11) still builds |
| `entries-reader-dailybuilder.test.mjs` "D3/D1 orchestration" | `[healthy, ambiguous, malformed, healthy]` → 2 docs, 2 typed failures (`duplicate_business_date`, `malformed_v2`), analytics persisted only for the healthy two |
| `entries-reader-snapshot.test.mjs` "D1" | both duplicate rows summed and counted, identical in both forms |
| `entries-reader-repos.test.mjs` "date window…" | duplicate dates → two daily records |
| `entries-reader-exceptions.test.mjs` "D1" | `source/origin === "legacy_ambiguous"`, `duplicateCount 2`, `duplicateIds` both; never first/last; structured state still wins |
| `test/storage-v2/preflight-duplicates.test.mjs` (6) | report sorted, ids sorted, present on blocked reports, `ok:true`, rows kept, pure/deterministic, agrees with `duplicateDates()` in both forms, no report fabricated for absent/V2/malformed |
| Emulator `SR-06`, `SR-07`, `SR-09` | on the real RTDB: typed refusal + nothing persisted + sibling date ok + repos keep both rows + `legacy_ambiguous` + **node byte-identical before/after** (no auto delete/merge) + preflight report + conversion keeps all three rows |

## Operator path (unchanged, out of scope here)

Duplicates are resolved by the operator through the stable-id delete path (client
`buildEntryDeleteIntent` on the chosen row id). The preflight report gives the ids.
