# P0-DATA-01 R8 — Review Guide

Independent re-review of `fix: isolate pending entry hydration`
(parent `dc321d8`, branch `claude/p0-data-01-r8-pending-write-isolation`).

## 1. Containment
```
git diff --name-status dc321d8 HEAD      # M index.html · M test/dashboard/… · A artifacts/p0-data-01-r8/*
git diff --check dc321d8 HEAD            # clean
git diff dc321d8 HEAD -- package.json package-lock.json database.rules.json vercel.json   # empty
git merge-base --is-ancestor 4ce7c84 HEAD && echo BAD || echo "cron not merged"          # cron not merged
```

## 2. The fix (index.html → createEntriesWriteCoordinator)
- `const curOwner = () => ...` and `newLane = (gen, owner) => ({ gen, owner: owner || null, ... })`;
  `let lane = newLane(0, curOwner())`; `invalidate()`: `lane = newLane(old.gen + 1, curOwner())`.
- `let writingLane = null;` set to `ln` at dispatch (after `writing = true`),
  cleared in the `finally` with `writing`.
- `onListenerEcho` deferral:
  ```
  const laneOwned = !!(ln.owner && ctx && ln.owner.tenantId === ctx.tenantId
    && ln.owner.bizId === ctx.bizId && ln.owner.gen === ctx.gen);
  const ownWriteInFlight = writing && writingLane === ln;
  if (laneOwned && (ownWriteInFlight || ln.desiredRev > ln.attemptedRev)) return { status: "deferred_pending_local" };
  ```
  The global `writing` no longer defers by itself; `pump` still uses `if (writing) return;` for serialization.

## 3. Why R7 same-lane behavior is preserved
- Same-lane in-flight write: `writing && writingLane === ln` → true → deferred (as R7).
- Same-lane queued rev: `desiredRev > attemptedRev` → true → deferred (as R7).
- Failed write (writing=false, nothing queued): both false → applies (as R7; see R8-2/R7-8).
- Foreign in-flight write after switch: `writingLane !== ln` and current lane fresh → applies (the fix).

## 4. Reproduce
```
node --test test/dashboard/entries-lifecycle.test.mjs                     # 79/0
node --test test/finance/vat-invariant.test.mjs                           # 5/0
node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs  # 420/0
./node_modules/.bin/tsc --noEmit                                          # 22 TS2742 (refs.ts), exit 2
./node_modules/.bin/tsc --noEmit --preserveSymlinks                       # exit 0
```
(Do NOT run bare `node --test` — it invokes the guarded RTDB emulator test.)

## 5. Negative control (proves closure)
`/tmp/r8-negctl/probe.mjs` loads each worktree's real coordinator. Pending-switch:
R7 → `deferred_pending_local` (hydrated:false, desired:null); R8 → `applied`
(hydrated:true, old stale, no current mutation). Acknowledged-write control:
`applied` on both. See `ADVERSARIAL_PROBES.md`.

## 6. Key tests to read
`R8-1` (old-success isolation), `R8-2` (old-failure isolation), `R8-5`
(switch-away-back), `R8-7` (old completion after hydration), `R8-8` (new-lane
pending intent protected + converges to local), `R8-10` (scoped deferred),
`R8-11` (old vs newer marker), `R8-13` (invalidation during pending). R7-6/R8-9
still assert same-generation own-echo suppression.

## 7. Not changed
`package*`, `database.rules.json`, `vercel.json`, `api/`, `lib/`, `src/`,
financial formulas/VAT, RTDB schema/paths/Rules, dependencies, the cron
remediation. R5/R6/R7/cron worktrees and the canonical repo untouched.
