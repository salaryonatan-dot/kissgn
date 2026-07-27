# P0-DATA-01 R6 — Listener Event Ordering (Firebase local-before-ack)

## The model

Firebase RTDB: `terminal set() → local onValue event → server acknowledgement`. The local event
can arrive BEFORE the `set()` Promise resolves. R5's scalar `expectedEchoes` incremented only after
ack, so an own local-before-ack echo was mis-handled and a later external payload was consumed.

## R6 content-fingerprint ownership

- On DISPATCH (before ack), the pump registers `{fp, rev}` where `fp = JSON.stringify(canonical
  desired)` into a bounded list `ownPending` (last 16).
- `onListenerEcho(rows, ctx)`:
  1. stale ctx (tenant/business/generation) → `stale`, nothing applied.
  2. compute `echoFp = fp(canonicalize(rows))`. If it matches an unconsumed `ownPending` record →
     remove it → `ignored_own_echo` (this is our own write's echo — local-before-ack OR post-ack;
     either arrives with the identical value we wrote, so the fingerprint matches).
  3. otherwise it is EXTERNAL. If a local op is pending (`writing || desiredRev > attemptedRev`) →
     `deferred_pending_local` (never applied, never mis-owned). Else → apply (convergence), updating
     desired; if the payload carried duplicates, conditionally self-heal through the same lane.

## Why the R5 failures are fixed

- **Local echo before ack:** the fingerprint was registered at dispatch, so the local echo matches
  and is consumed as own — no counter to poison.
- **External after ack:** ack registers nothing new (fp already registered at dispatch), so the next
  external payload has no matching own record → it is applied, not swallowed.
- **Two serialized writes:** each write registers its own fp; each own echo consumes exactly one;
  two later external payloads (`999`, `888`) both apply.
- **Delayed older own echo (`100` after `200`):** its fingerprint matches the `100` write's record →
  `ignored_own_echo`; it cannot regress the newer `200`.
- **No permanent blacklist:** a fingerprint is removed on first match, and the list is bounded to 16,
  so an identical FUTURE remote payload (after the own record is consumed/retired) is applied.
- **Self-heal:** routed through the same lane; its own echo is recognised by fingerprint → no loop.
- **Stale callback:** rejected by ctx liveness.

## Deferred external policy

A non-matching external payload arriving WHILE a local op is pending is `deferred_pending_local`:
not applied (so it cannot regress the newer optimistic desired), not consumed as own (so it is not
lost to a counter). It is reconciled by the next echo once the lane is quiescent. This is the
deterministic, tested policy for the single-user-per-business model (`R6-8b`).

R2 canonicalization is unchanged; own/external identity is by canonical content, not by envelope.
