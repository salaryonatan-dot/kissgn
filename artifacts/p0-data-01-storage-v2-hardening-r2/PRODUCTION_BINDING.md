# Production Binding (Codex R1-F1)

## Finding
`index.html` dashboard init block: `mutate: (intent, ctx) => entriesStorageRouterRef.current.mutate(intent, ctx)`.
The coordinator (R1) dispatches `io.mutate(job.intent, ctx, job.binding)`; the two-argument
adapter dropped `binding`, the router forwarded `undefined`, and the V2 engine refused every
operation (`blocked_unhydrated / intent_not_bound_to_generation`) before any transaction —
create, edit, delete, clear-all and the absent-business first save. R1's tests wired
`router.mutate` directly and could not see it.

## Fix
One line: `mutate: (intent, ctx, binding) => entriesStorageRouterRef.current.mutate(intent, ctx, binding)`.
The binding is still the one the coordinator captured at SUBMISSION from
`entriesStorageModeRef` (the listener-/probe-owned storage state of the active selection);
no layer fabricates or refreshes it. The engine keeps requiring it.

Traced path (all executed verbatim by the new harness):
rendered action (`submitLaborEntry` / history "מחק הכל" arguments / typed intents) →
`entriesWriteCoordRef.current.submitIntent|submitClearAll` → `submitIntent` captures
`io.storageBinding()` → `pump` → `io.mutate(intent, ctx, binding)` (the fixed adapter) →
`createEntriesStorageRouter.mutate` (legacy | v2 | absent→v2) → `createV2EntriesMutator.mutate`
→ `window.storage.mutateForPath` / `mutateFor` → RTDB transaction.

## Proof
Harness: `test/support/dashboard-wiring-harness.mjs` slices the ACTUAL init block
(`const entriesMutatorRef = useRef(null);` … `const saveOwnershipCtrlRef`) and the ACTUAL
selection-effect listener/bootstrap block (`const subNodeEntries …` … `loadEntryExceptions`)
from `index.html` and runs them in a vm sandbox; only React's `useRef`/`setEntries` and the
`window.storage` transport are substituted.

Unit (`entries-storage-v2-production-wiring.test.mjs`):
- B1-A absent first save through the real labor call site → `committed`, epoch 1, V2 node,
  no `_v`, listener flips to `v2`, identical repeat idempotent.
- B1-B/C/D create, edit, delete → committed on the row lane (3 row-lane, 0 node-lane writes);
  labor call site edits by immutable id.
- B1-E real clear-all arguments → committed, epoch 2, node emptied, display `[]`.
- B1-F queued intent bound to epoch 1 while a foreign clear rotates to 2 → `blocked /
  generation_retired`, zero transactions for it.
- B1-G switch business after capture → queued A work `cancelled_selection_changed`; B
  hydrates from its own node (epoch 1 vs A's 3); B's create stamped 1; A untouched.
- B1-legacy → legacy engine, `_v` rewritten, binding irrelevant.
- B1-H NEGATIVE CONTROL: the parent commit's `index.html` (`git show 6c879b66:index.html`)
  run through the same harness → all five operations `blocked_unhydrated /
  intent_not_bound_to_generation` with an empty transaction log; source pins for both adapters.

Emulator (real SDK, real Rules): `V2-W01` (absent → gen 1, create, edit, delete, clear → gen 2)
and `V2-W02` (retired binding refused before any transaction; business switch bound to B's
node) — three consecutive rounds.

Result: PRODUCTION_BINDING PASS · ABSENT_FIRST_SAVE PASS · V2_CREATE/EDIT/DELETE PASS ·
CLEAR_ALL_RUNTIME PASS · BUSINESS_SWITCH_OWNERSHIP PASS.
