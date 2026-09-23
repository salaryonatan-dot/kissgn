# READER CONTRACT — `lib/analytics/entriesReader.js`

Pure module (no Firebase import, no I/O, no logging, no writes). Input is always the raw
snapshot value of `tenants/{tenantId}/biz:{bizId}:entries`. It mirrors the browser's
`MarjinStorageV2.readEntriesNode` decision table exactly; parity is pinned by
`test/analytics/entries-reader-client-parity.test.mjs`, which vm-loads the production
`index.html` block and compares both readers over every fixture, every malformed variant,
key-shuffled maps and numeric-key MAP fields.

## Decision table (`readEntriesNode(raw)` — never throws)

| Raw node | Result |
|---|---|
| `null` / `undefined` | `{ ok:true, mode:"absent", rows:[], generation:null }` |
| `{ _v:"<json array>" }` / bare string / bare array (legacy) | `{ ok:true, mode:"legacy", rows:<array verbatim>, generation:null }` — nothing reordered, nothing stripped, duplicates kept |
| `{ schemaVersion:2, generation:<int ≥1>, rows?:{[uuid]: {id===key, _gen===generation, …}}, _v? }` | `{ ok:true, mode:"v2", rows:<rows with _gen stripped, sorted (date,id)>, generation }` — **`_v` is never read** |
| `schemaVersion:2` with any of: non-epoch `generation`, `rows` not a map, non-canonical row key, row not an object, `id !== key`, `_gen !== generation` | `{ ok:false, mode:"v2", status:"malformed_v2", reason, key? }` — **no `_v` fallback** |
| `schemaVersion` absent but `rows`/`generation` present (stripped marker) | `{ ok:false, mode:"malformed", status:"malformed_storage", reason:"v2_structure_without_schema_version" }` |
| `schemaVersion` other than 2 | `{ ok:false, …, reason:"unsupported_schema_version" }` |
| legacy `_v` not JSON / not an array; object without `_v` | `{ ok:false, …, reason:"legacy_unparseable" }` |

The V2 `(date, id)` sort exists only so output arrays are deterministic. It carries **no**
duplicate-date policy (CTO D1).

## Helpers

- `requireEntriesRows(raw, ctx)` → rows, or throws `EntriesStorageError { name, status: malformed_v2|malformed_storage, mode, reason, key?, tenantId, bizId, site }`.
- `rowForDate(rows, date)` → `{status:"absent", row:null}` | `{status:"single", row}` | `{status:"ambiguous", row:null, count, ids(sorted)}` — never picks.
- `requireRowForDate(rows, date, ctx)` → row | null, or throws `EntriesAmbiguityError { name, status:"duplicate_business_date", date, count, ids, tenantId, bizId, site }`.
- `rowsInRange(rows, from, to)` — inclusive string range, every row kept.
- `duplicateDates(rows)` → `[{date, ids}]` sorted (agrees with the preflight report).
- `isEntriesStorageError` / `isEntriesAmbiguityError` / `isEntriesReadError` — name-based, so they work across compiled copies of the module.

## Consumer semantics

| Consumer | Uses | Duplicate-date behaviour |
|---|---|---|
| dailyBuilder | `requireEntriesRows` + `requireRowForDate` | typed refusal for that date, nothing persisted, before external fetches |
| snapshotBuilder, dailyMetricsRepo (×2), laborRepo, purchasesRepo, checkers (prepared path) | `requireEntriesRows` (+ `rowsInRange`) | aggregators: every row counted |
| entryExceptionsRepo | `requireEntriesRows` + `rowForDate` | `legacy_ambiguous` record with `duplicateCount` / `duplicateIds`; structured state still wins |
| preflight | own `byDate` map (same shape) | informational report |

## Invariants proven

- Legacy rows are returned **verbatim** (order, fields, string/number types) — equivalence with the previous parsers is byte-for-byte on legacy nodes (`entries-reader.test.mjs`, dual-form equivalence in every per-caller suite).
- Numeric-key MAP fields (`supplier_payments`, `hourly_payroll`) read back from RTDB as arrays aggregate identically (`SR-02` on the real emulator; `F10_numeric_maps` in unit suites).
- No consumer parses `_v` for the entries node any more (`ACCESS_INVENTORY.md`).
