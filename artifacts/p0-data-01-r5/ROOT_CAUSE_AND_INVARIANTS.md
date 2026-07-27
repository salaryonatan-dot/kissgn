# P0-DATA-01 R5 — Root Cause & Invariants

## The R4 root cause Codex proved

R4 sequenced the **React state apply** (`mySeq === seq`) but dispatched the terminal
storage writes **concurrently**. Two facts followed:

1. The transport for edit `100` and edit `200` were both in flight; whichever RTDB
   committed last won the persisted value. With `200` resolving first and `100` last,
   persisted storage ended at `100` while UI showed `200`.
2. A shared mutable `pending` counter was reset by `invalidate()` while old promises
   still ran `finally { pending-- }`, so the coordinator believed no write was pending
   and applied a stale echo during a new generation's write.

The fix is architectural: terminal writes must be **serialized** (single-flight), and
all accounting must be **generation-scoped** so retired work cannot touch live work.

## The supplier serialization model (exact)

- One global `writing` flag. `pump()` dispatches a terminal write only when `!writing`.
- `desiredRows` / `desiredRev` advance on every edit (optimistic UI is always the newest).
- `attemptedRev` = the revision last handed to a terminal write; `committedRev` = the
  revision whose write succeeded.
- On settle, the pump re-invokes itself for the CURRENT lane and, if `desiredRev >
  attemptedRev`, persists the newest desired — so the terminal sequence is: write rev N,
  then (after it settles) write the latest rev M>N. Never two in flight at once.
- Because `writing` is global (not per-lane), an old in-flight write from a retired lane
  must settle before the new lane's write dispatches → the newest write commits last and
  wins; an older terminal write can never beat newer data, including across
  switch-away-and-back to the same destination.
- Coalescing: rapid edits between two settles collapse into one write of the latest
  desired; no logical edit is lost because `desiredRows` always reflects every edit and
  every edit's waiter resolves when a write covering its rev settles (`{status, rev,
  latest}`).
- Terminal identity is `io.selection.capture()` at dispatch → `persistEntries` uses
  `ctx.tenantId`/`ctx.bizId` via `storage.setFor`; never the mutable `_currentTenantId`.

## The generation / listener ownership model

- A **lane** object `{gen, desiredRows, desiredRev, committedRev, attemptedRev,
  expectedEchoes, waiters}` holds all accounting. `invalidate()` installs a fresh lane
  (`gen+1`) and retires the old one.
- An old completion finalizes only `writeLane` (its captured lane); it never mutates the
  current lane. `pending = desiredRev − committedRev ≥ 0` always.
- Listener echoes: rejected if the callback's captured ctx is stale; ignored while
  `writing` or `desiredRev > attemptedRev` (pending edits); own committed writes' echoes
  are drained via `expectedEchoes` (consumed, not applied) so a delayed older echo cannot
  regress; when quiescent and no own-echoes remain, an external payload applies and
  updates desired (convergence). Duplicate hydration self-heals through the same
  single-flight pump.

## System-level invariants now enforced (all executable)

1. **Immutable selection context** on every read/write (persist, readback, exceptions, coordinator).
2. **Operation identity where overlap is possible** — supplier revision + waiters; save ownership token; exception op IDs.
3. **No request/write after context is stale** — persistence pre-dispatch gate; readback before/after each candidate; exception preflight; coordinator ctx checks.
4. **Identity from captured context** — storage tenant `ctx.tenantId` (via `setFor`), key `biz:${ctx.bizId}:…`, readback/exception requests from ctx.
5. **Liveness/ownership after every await** — persistence, coordinator pump, save seam, readback loop, exception load.
6. **Domain isolation** — entries writers never touch fixed; fixed never touch entries.
7. **Newer edit wins** — terminal serialization + revision gate + own-echo drain; older completions/failures/echoes never overwrite a newer value in state OR persistence.
8. **Tests execute production boundaries** — the helpers under test are the exact helpers the UI delegates to; only terminal transports/timers/observable ports are injected.

Replay/canonicalization invariants preserved: explicit save wins wholesale; earliest-non-zero scalar; nested-map union earliest-wins never summed; deterministic idempotent canonicalization; incident canonical **₪580,483**.
