# P0-DATA-01 R8 — Adversarial Probes / Negative Control

## Negative control (R7 fails, R8 passes)
`/tmp/r8-negctl/probe.mjs` loads the REAL `createEntriesWriteCoordinator` +
`createSelectionController` + `MarjinEntries` from a given `index.html` via the
same vm extraction the suite uses. It runs two scenarios per worktree.

### Scenario A — pending-switch (the FIND-001 reproduction)
1. Selection `T1/A` (gen 1). `submit(rows)` — the commit transport is a deferred
   promise held UNRESOLVED (physical write in flight).
2. Switch to `T2/B` (`selection.invalidate` + `coordinator.invalidate`).
3. Deliver the live `T2/B` initial listener payload (`onListenerEcho(rows, current)`).
4. Deliver an old `T1/A` callback (stale ctx).
5. Resolve the old commit `{ok:true}`.

| Worktree | current initial | hydrated | active desired after | old callback | final desired | old mutated current |
|---|---|---|---|---|---|---|
| R7 | `deferred_pending_local` | **false** | `null` | `stale` | `null` | false |
| R8 | `applied` | **true** | `set` | `stale` | `set` | **false** |

### Scenario B — acknowledged-write control (R6 fix must remain)
Dispatch `T1/A`, ACK it, switch to `T2/B`, deliver identical payload.

| Worktree | status | hydrated |
|---|---|---|
| R7 | `applied` | true |
| R8 | `applied` | true |

Commands:
```
node /tmp/r8-negctl/probe.mjs R7 <r7>/index.html
node /tmp/r8-negctl/probe.mjs R8 <r8>/index.html
```
Raw output:
```
R7: {"pendingSwitch":{"currentInitialResult":"deferred_pending_local","currentInitialHydrated":false,"activeLaneDesiredAfterCurrentInitial":null,"staleOldResult":"stale","finalActiveLaneDesired":null,"oldCompletionMutatedCurrent":false},"ackedControl":{"status":"applied","hydrated":true}}
R8: {"pendingSwitch":{"currentInitialResult":"applied","currentInitialHydrated":true,"activeLaneDesiredAfterCurrentInitial":"set","staleOldResult":"stale","finalActiveLaneDesired":"set","oldCompletionMutatedCurrent":false},"ackedControl":{"status":"applied","hydrated":true}}
```

### Why this proves closure
The only variable between runs is the coordinator source. With R7 the current
destination is suppressed (`deferred_pending_local`, `desired:null`) while the old
write is in flight; with R8 it hydrates (`applied`, `desired:set`), the old
callback stays `stale`, and completing the old write does not mutate the current
destination. Scenario B confirms the earlier R6 acknowledged-write fix is intact.
R7 was read-only; the probe lives only under `/tmp` and imports each worktree's
`index.html` without modification (no copied coordinator).

## In-suite adversarial coverage
- `R8-8` protects a NEW lane's own pending intent (deferral survives) while the
  old write is in flight, then converges to the local value (777), not the
  external payload (888).
- `R8-10` a dropped deferred payload is not replayed into another lane by the old
  write's completion.
- `R8-11` old-generation completion cannot clear the current generation's
  marker/pending state.
- `R8-13` invalidation during pending work leaves a fresh lane; a later old
  callback stays `stale`.
