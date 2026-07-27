# P0-DATA-01 R6 — Destination Writer Model

## The one lane

There is exactly one `createEntriesWriteCoordinator` instance per component (per business
selection). Its destination identity is `(captured tenantId, captured bizId, "entries")` — every
terminal write derives tenant+key from the captured selection context via `storage.setFor`, never
the mutable `_currentTenantId`. The raw persistence transport (`persistEntriesRaw`, wired as the
lane's `io.commit`) is PRIVATE to the lane; no UI/runtime caller may call it directly.

## Replace vs transform intents

`submit(op)`:
- **`op.rows` → wholesale REPLACE.** `desired = canonicalize(op.rows)`. Used by the main daily save
  (preserving R2 "the later explicit save wins wholesale") and clear-all (`rows: []`).
- **`op.transform(desired) → newRows`.** Maps the LATEST desired canonical rows (falling back to
  `canonicalize(op.baseRows)` only when the lane has no live desired). Used by supplier edit (upsert
  a supplier payment), employee labor (upsert payroll), and delete-by-date (filter the date out).
  A transform is never computed from a stale React snapshot when the lane already owns newer desired.

Every writer routed:

| Writer | Production caller | Intent |
|---|---|---|
| Supplier edit | `setSupPayDate → submitSupplierEdit` | transform (upsert supplier payment) |
| Main daily save | `executeEntrySave.persistRows → submit({rows, apply:false})` | replace (wholesale) |
| Delete by date | `deleteEntryByDate → submit({transform:filter})` | transform |
| Clear all | history button → `submit({rows: []})` | replace |
| Employee daily labor | `EmployeesScreen.setDailyLabor → submitLaborEntry → submit({transform:upsert payroll})` | transform |
| Duplicate self-heal | `onListenerEcho` → internal `submit`-equivalent pump | conditional replace (deduped) |

## Single-flight ordering (global, per destination)

One `writing` flag guards the pump across generations. At most one terminal write is in flight;
a later op updates optimistic desired but does not dispatch; when the active write settles the pump
persists the latest desired revision. Consequences:
- newest logical operation commits last → wins in persisted storage;
- an older in-flight write (retired lane, e.g. switch-away-and-back to the same business) settles
  before the new-generation write is dispatched — it can never beat newer data;
- distinct suppliers / labor all survive because each transform builds on the latest desired.

## Result contract

`submit` resolves `{status, rev, latest, canonical}`:
- `applied` — the write covering this rev succeeded;
- `persist_failed` — that write failed (never reverts to older; converges on next listener echo);
- `stale` — captured selection went stale during the write;
- `cancelled_selection_changed` — the op was queued and invalidation retired it before dispatch;
- `noop` / `invalid_date` — nothing to write.
`latest = (rev === desiredRev)` at settle. Every caller inspects its result and does not silently
ignore failures (supplier surfaces a visible error via ownership; delete/labor log).
