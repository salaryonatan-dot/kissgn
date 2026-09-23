# CTO D3 — MALFORMED V2 / NO FALLBACK / FAILURE ISOLATION

**Decision:** once `schemaVersion === 2`, the frozen `_v` is never read, merged or used as
a fallback. A malformed V2 node is a typed failure: no stale analytics, no snapshot, no
email. Single-business entry points fail explicitly; multi-business orchestration logs and
skips the bad business and continues with the healthy ones.

## Implementation

- Reader: `readEntriesNode` returns `ok:false` for every malformed variant; `requireEntriesRows` throws `EntriesStorageError`. The legacy branch refuses V2-structured nodes (`storage_v2_node`), the V2 branch never touches `_v`.
- `dailyBuilder.buildAnalyticsForBiz` throws before fetch/persist; `buildAnalyticsForAll` records the failure and continues (existing per-business try/catch).
- `snapshotBuilder.buildSnapshotForBiz` throws; `buildSnapshotForAll` skips (existing per-business try/catch) → the email/report path never sees a stale snapshot.
- Repositories throw; `analyticsService.fetchPlannedData` **re-throws** typed reader errors from the daily / labor / purchases / latest-date catches (previously every error became a soft `fetchStatus:"failed"` with partial data). Non-storage errors keep the historical soft-fail (proven).
- `entryExceptionsRepo.listEntryExceptions` throws; the exceptions API's existing catch maps it to `list_failed` (api untouched).
- Checkers: non-firing, so a malformed node is never even read (D2).

## Malformed variants covered (`test/support/entries-fixtures.mjs` `malformedNodes()`)

`rows_scalar`, `gen_mismatch`, `bad_key`, `id_key_mismatch`, `bad_generation`,
`stripped_marker`, `unsupported_schema`, `legacy_unparseable` — every one carries a
valid-looking `_v` so any fallback would be visible as a wrong success.

Stale-`_v` poison (`noFallbackNode()`): rows say 555 on 2026-08-10 and one row on 08-11;
`_v` says 100/500 on 08-10 plus a deleted row on 08-12 flagged as an exception.

## Proof

| Test | What it proves |
|---|---|
| `entries-reader.test.mjs` | every malformed variant → `ok:false` with the exact reason; poison node → rows only; `JSON.parse` is never invoked on a V2 `_v` string (spy) |
| `entries-reader-client-parity.test.mjs` | server decisions identical to the production browser reader for all variants |
| dailybuilder / snapshot / repos / exceptions suites, "MALFORMED V2" | typed `EntriesStorageError` with `site`; `db.writes === []`; `__EMAILS === []`; native V2 without `_v` works; poison → rows win (555; deleted row absent; stale exception unseen) |
| `entries-reader-repos.test.mjs` "D3 routing" | `fetchPlannedData` rejects with the typed error on a malformed node; healthy node → `fetchStatus.daily/labor "ok"`; a network failure on suppliers still soft-fails (`purchases:"failed"`, `daily:"ok"`) |
| `entries-reader-dailybuilder.test.mjs` "D3/D1 orchestration", `entries-reader-snapshot.test.mjs` "MALFORMED V2 … buildSnapshotForAll" | bad business skipped, healthy built and persisted |
| Emulator `SR-04`, `SR-05`, `SR-06`, `SR-10` | real RTDB: poison → rows only in every reader; all 8 variants fail closed in dailyBuilder, snapshot, 3 repos, `fetchPlannedData`, exceptions — `analytics:daily` / `insights:daily` absent, no email; `[h1, amb, bad, h2]` → 2 docs / 2 typed failures / healthy persisted / snapshots for 3 of 4; after conversion a direct row edit + row delete are what every reader sees while `_v` still holds the old values |
