# Clear Completion vs Newer Listener State (Codex R1-F2)

## Finding
The coordinator's collection-result branch (`if (res.rows)`) cleared the parked echo and
displayed the result unconditionally. A V2 clear-all returns `rows: []`; if, before its
promise resolved, another client created a row in the new epoch and this client had already
received that authoritative snapshot (parked as `deferred_pending_local`), completion
displayed `[]` — persisted state correct, UI stale, no further event to fix it.

## Contract extension
Operation completion may confirm status/generation; it must not overwrite a newer
authoritative listener revision. Ownership already in the lifecycle is used:
- the listener updates `entriesStorageModeRef` BEFORE delivering the echo (R1 wiring), so
  `onListenerEcho` can stamp a parked echo with the storage epoch it was received under
  (`deferred.storage = io.storageBinding()`);
- a V2 collection result carries `res.generation` (the epoch the transaction produced);
- on commit: `newerParked = res.rows && parked && epoch(parked) >= res.generation`. If newer:
  drop the own-echo marker (the echo it would have matched is the parked one or earlier)
  and `convergeDeferred(writeLane)` (applies only when no newer local work is queued and
  the lane/selection still owns it). Else: apply `res.rows` exactly as before.
- Legacy results (no epoch) and older parked echoes (the pre-clear content this clear was
  confirmed against) are unchanged. Nothing applies the request payload blindly; nothing
  suppresses a valid post-clear row.

## Interleavings (real coordinator + real wiring; in-memory CAS/listeners with hooks)
| Case | Test | Result |
|---|---|---|
| A clear echo → new-row echo → promise resolves last | B2-A | new row visible; raw snapshot converged; no marker left; a later echo applies normally |
| B promise → clear echo → new-row echo | B2-B | `[]`, then row visible |
| C foreign active-epoch row while completion pending | B2-C | row survives (display and store) |
| D stale pre-clear mutation completing after rotation | B2-D | `blocked/target_not_found`, converged to `[]`, epoch followed; a NEW intent under epoch 2 legitimately creates |
| E no post-clear row (parked clear echo / silent) + legacy result | B2-E | `[]` in all three |
| F business switch during pending clear | B2-F | B's rows displayed, B hydrated at its epoch, A cleared, nothing of A's completion reaches B |
Emulator, two real SDK clients: `V2-W03` — B creates row 777 in epoch 2 after A's clear
committed; A's listener receives it before A's promise resolves (exact listener barrier);
A displays 777, `deferredPending=false`, persisted row intact — three rounds.

Result: CLEAR_LISTENER_ORDERING PASS.
