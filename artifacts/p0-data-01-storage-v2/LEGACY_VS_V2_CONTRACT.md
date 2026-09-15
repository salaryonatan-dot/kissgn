# Legacy vs V2 — the dual-mode contract

There is no long-lived dual-write. At any moment a business is in exactly one mode, and
`schemaVersion` is the only thing that decides which.

| | LEGACY business | V2 business |
|---|---|---|
| authoritative state | `_v` (one JSON string) | `rows/{rowId}` (real nodes) |
| `_v` | read/write, as before | **frozen**: byte-identical rewrites only, never a source of truth |
| write engine | `createRemoteEntriesMutator` (whole-node CAS) | `createV2EntriesMutator` (per-row CAS; collection CAS for clear-all) |
| read | `parseEntriesNode` | `readV2Rows` |
| identity enforced by | the client transaction only | the client transaction **and** RTDB Rules |
| duplicate ids | possible, detected after the fact | **unrepresentable** |
| free text | the `},{` pattern artifact applies | plain values; the artifact is gone |

## Mode detection — `detectStorageMode`

| Stored node | Mode |
|---|---|
| absent / null | `absent` — an empty collection, writable after cutover |
| `schemaVersion === 2` | `v2` |
| has `rows` or `generation` but **no** `schemaVersion` | `malformed` (`v2_structure_without_schema_version`) |
| has some other `schemaVersion` | `malformed` (`unsupported_schema_version`) |
| parses as a legacy envelope / array / string | `legacy` |
| anything else | `malformed` (`legacy_unparseable`) |

The third row matters. If someone strips the schema marker from a V2 node, the frozen
`_v` snapshot is still sitting next to live rows; reading that node as legacy would
silently replace current data with a pre-cutover copy. It is malformed, and the runtime
refuses it (`V2-X02`).

## The read seam — `readEntriesNode`

One function, one typed answer: `{ok, mode, rows, generation}` or `{status, reason, mode}`.
There is no path in which V2 rows and `_v` are merged, and no path in which a malformed V2
node falls back to `_v`. A malformed node keeps the write lane fail-closed through the
existing `onListenerError`, exactly as an unreadable legacy node already did.

## The write seam — `createEntriesStorageRouter`

The coordinator still calls one `mutate(intent, ctx)`. The router reads the hydrated mode
and dispatches. If the mode is unknown (not yet hydrated) or malformed, it returns
`blocked_unhydrated` and **neither engine runs** (`V2-X03`) — an unknown storage mode is
not a writable state.

## What is identical in both modes

Identity is the immutable id and only the id. A delete's precondition is the complete
canonical row (R10.1). A create with an existing id is idempotent-or-collision. `id` is
immutable. Conflicts carry exact `conflictPaths`. Duplicate business dates are legal.
`applyRowIntent` reuses the same helpers as `applyEntryIntent` — `patchPaths`, `readPath`,
`sameVal`, `applyPaths`, `rowDiffPaths`, `stableStringify` — so the two engines cannot
drift on semantics.

## `gen` is infrastructure, not data

Each row stores the generation it belongs to, but `readV2Rows` strips it before handing
the row to the application. The semantic row the UI edits, and the complete-row base a
delete compares against, are therefore byte-identical to what R10.1 accepted. A stale
generation is not surfaced as a field conflict; it is refused by Rules outright.
