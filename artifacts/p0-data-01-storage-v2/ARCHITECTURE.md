# Storage V2 — row-keyed entries

Branch `claude/p0-data-01-storage-v2`, base `f9168213bfe027995ad4a38ab084071e97824823`.

## Why

Legacy storage keeps every row inside one opaque JSON string at
`biz:{bizId}:entries/_v`. The entries node therefore has exactly one child — a string
leaf of depth 1 — and rows are characters inside it. RTDB Rules can evaluate a tree, and
in that tree the rows do not exist, which is why the server accepted an id-less row, a
nested decoy `meta.id`, and two rows sharing an id. The previous attempt approximated
row boundaries textually, and that approximation is what rejected legitimate free text
containing `},{`.

V2 gives every row its own node, keyed by its own immutable id.

## The tree

```
tenants/{tenantId}/biz:{bizId}:entries/
  schemaVersion : 2                      explicit, and irreversible once set
  generation    : "<uuid v4>"            the collection epoch; clear-all rotates it
  rows/
    {rowId}/                             rowId IS the row's immutable id
      id   : "{rowId}"                   Rules enforce id === the child key
      gen  : "<generation>"              Rules enforce it equals the live generation
      date : "YYYY-MM-DD"                the canonical entryDateKey
      sales, deliveries, food_cost, payroll, other_expense, other_income,
      supplier_payments/{supId}, hourly_payroll/{shiftId},
      weather_impact, security_event, includeVat, notes,
      is_exception, exception_reason, exception_note
  _v : "<frozen pre-cutover snapshot>"   read-only from cutover onward
```

Field naming follows the existing code: the row's business date lives in `date`, whose
value is the canonical `entryDateKey`. Renaming it would have churned every layer above
storage for no structural gain.

## The ten required properties

| # | Requirement | How |
|---|---|---|
| 1 | actual row nodes | `rows/{rowId}` is a real RTDB node with real children |
| 2 | immutable row id | `id` is required and equal to the key; the `id` child validator refuses any other value, so it cannot be rewritten |
| 3 | row key == row.id | `newData.child('id').val() === $rowId`, structurally, independent of key order |
| 4 | explicit schema version | `schemaVersion: 2`, validated, and never downgradable |
| 5 | collection generation | `generation` is a canonical uuid v4; every row carries the `gen` it was written under |
| 6 | duplicate dates allowed | nothing constrains `date` beyond `isString()`; two rows may share one date (`V2-I06`) |
| 7 | duplicate ids impossible | a Firebase key is unique within its parent, so two rows with one id is not a representable state (`V2-I05`) |
| 8 | structural validation | every validator uses child/path semantics; there is no serialization pattern anywhere in the V2 rules |
| 9 | legacy/V2 detection | `detectStorageMode` returns `absent` / `legacy` / `v2` / `malformed` — never a blend |
| 10 | deterministic state | `schemaVersion` is the single source of truth for which engine runs |

No secondary index exists. Identity is not duplicated anywhere it could drift from the
rows: the key *is* the identity.

## Runtime shape

`window.MarjinStorageV2` (in `index.html`, vm-extractable like the lifecycle module):

| Export | Role |
|---|---|
| `detectStorageMode(raw)` | explicit mode, including two malformed cases that must never be read as legacy |
| `readV2Rows(raw)` | V2 map → the rows array every layer above already speaks; fails closed |
| `readEntriesNode(raw)` | the ONE dual-mode read seam |
| `applyRowIntent(row, intent)` | the pure row-scoped transformation — the V2 counterpart of `applyEntryIntent` |
| `createV2EntriesMutator(io)` | per-row CAS for ordinary writes, collection CAS for clear-all |
| `createEntriesStorageRouter(io)` | one `mutate()` for the coordinator; the hydrated mode picks the engine |

Two transports were added: `window.storage.subscribeNode` (raw node, so a reader can
decide the mode instead of being handed an unwrapped `_v`) and
`window.storage.mutateForPath` (row-scoped compare-and-swap).

`applyEntryIntent`, `buildEntryUpsertIntent`, `buildEntryDeleteIntent`, `rowDiffPaths`,
the write coordinator, the save-UI runner and the whole React layer are **unchanged**.
`index.html` is +290 / −7 against the base, and the only edits outside the new module are
the two transports, the mutator wiring, and the hydration listener.

## What V2 buys beyond compliance

Ordinary writes stop contending. In legacy every edit is a compare-and-swap on the whole
collection, so two operators editing different dates retry against each other. In V2 they
transact on different nodes: `V2-C01` runs two parallel edits and records **2 callback
runs for 2 writes** — no retries at all.
