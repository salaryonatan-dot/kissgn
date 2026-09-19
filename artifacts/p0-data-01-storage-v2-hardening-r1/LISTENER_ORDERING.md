# Listener Ordering / Authoritative UI State (Codex SV2-03)

## Finding
A V2 row commit returns `{status:"committed", row}` — no collection value. The coordinator
cleared its parked (`deferred_pending_local`) authoritative echo unconditionally and only
applied `res.rows`; with the SDK's real ordering (the listener fires before the transaction
promise resolves) the echo carrying the new value was discarded and the UI stayed stale.

## Change (coordinator, `createEntriesWriteCoordinator`)
- `writeLane.deferred = null` moved INSIDE the `if (res.rows)` branch (legacy / clear-all:
  the transaction result is authoritative, as in R10).
- rows-less commit branch: own-echo marker removed (there is no fingerprint to match) and
  `convergeDeferred(writeLane)` — the parked echo, which is the authoritative full-node
  snapshot, is applied unless newer local work is still queued (then the next echo
  supersedes it). Nothing invents a collection value from the request payload.
- `convergeDeferred` now also sets `rawRows`, so the clear-all fingerprint (R10-GATE-004)
  is computed from what the operator sees.
- Existing revision ordering, selection binding and own-echo handling are untouched.

## Adversarial interleavings (all deterministic, fake CAS remote + real coordinator)
| Case | Test | Result |
|---|---|---|
| A. echo before the promise resolves | `[H3-A]` | parked, then applied at commit; `deferredPending=false`, `pending=0` |
| B. promise before the echo | `[H3-B]` | applied directly when it arrives |
| C. two queued writes; C'. two clients completing in opposite order | `[H3-C]`, `[H3-C']` | final display = last authoritative value on both clients |
| D. same-row conflict with a parked echo | `[H3-E]` | converges (R10 path unchanged) |
| E. clear-all lands while a stale mutation is in flight | `[H3-E2]` | mutation `blocked/target_not_found`, display `[]`, epoch followed |
| foreign write during ours | `[H3-D]` | both values visible |
| selection retired mid-write | `[H3]` | nothing applied to the new selection |
| legacy engine result | `[H3]` | `res.rows` still applied directly |

Real emulator + real SDK + real coordinator: `V2-H06` — edit, two queued edits, foreign
write during ours, delete, clear-all: display converges each time; row lane used (no
collection-scoped write for ordinary intents); raw snapshot equals the display after a
converged delete; mode ref follows the listener after clear-all.

Result: **PASS** (AUTHORITATIVE_LISTENER).
