# Clear-All Integration (Codex SV2-04, with SV2-02)

## Finding
The real `submitClearAll` (`index.html`, coordinator) and its rendered call site (history
screen "מחק הכל") passed only `{expectedNodeFingerprint, confirmToken, opId}`; the V2
engine demanded `nextGeneration` and returned `blocked/next_generation_required`, so the
production clear-all was unusable on a V2 business.

## Change
The requirement is gone, not satisfied: a caller-chosen epoch was the unsafe part
(GENERATION_CONTRACT.md). The engine derives `current + 1` inside the node CAS, after
re-reading the epoch and the complete-content fingerprint under CAS. The coordinator and
the call site are UNCHANGED in shape — `submitClearAll({expectedNodeFingerprint,
confirmToken})` is exactly what the UI already sent — and the coordinator now forwards the
typed `generation` of the result. A stale intent that still names `nextGeneration` is
refused (`next_generation_not_callable`).

Runtime path traced: button `onClick` → `entriesWriteCoordRef.current.submitClearAll` →
`submitIntent({type:"clear_all", …})` (requires real hydration, fingerprint, confirm token;
captures the storage binding) → `pump` → router → V2 engine `transactNode` →
`window.storage.mutateFor` (whole-node `runTransaction`) → result `{status:"committed",
rows:[], generation, retiredGeneration, destructive:true}` → coordinator applies `rows:[]`
as the authoritative value → listener echo matches the own-echo fingerprint → UI shows the
empty collection; `entriesStorageModeRef` follows the listener to the new epoch.

## Proof
- `[H4]` unit: `submitClearAll` with only the UI's arguments commits, rotates 1→2, typed
  result, display `[]`, mode ref epoch 2; a stale confirmation is refused
  (`precondition_failed`) with nothing cleared.
- `[H4]` unit source pin: call site and coordinator contain no `nextGeneration`; engine
  refuses it.
- `V2-H06` emulator: through the REAL coordinator over the real SDK the clear-all commits
  with `generation === 2` and the display converges to empty.
- `V2-G04/G05`: clear-all vs concurrent edit/delete still refused deterministically.
- `[H3-E2]`: a stale row mutation in flight when the clear lands fails typed
  (`target_not_found`) and converges on the cleared state.

Result: **PASS** (CLEAR_ALL_RUNTIME).
