# P0-DATA-01 R8 — Scope Compliance

## Allowed edits (only these)
- **Runtime:** `index.html` — `createEntriesWriteCoordinator` hydration gate
  isolated from the global transport flag (lane owner + `writingLane` +
  scoped deferral).
- **Test:** `test/dashboard/entries-lifecycle.test.mjs` — 14 new R8 cases; all 65
  R7 cases retained.
- **Artifacts:** `artifacts/p0-data-01-r8/` (9 files).

`git diff --name-status dc321d8 HEAD` = `M index.html`,
`M test/dashboard/entries-lifecycle.test.mjs`, `A artifacts/p0-data-01-r8/*`.
Nothing else.

## Not changed (verified byte-identical to R7)
- `package.json`, `package-lock.json`, `database.rules.json`, `vercel.json`
  (empty diff).
- `api/`, `lib/`, `src/`, all other runtime/config/server files. No schema /
  Firebase Rules / auth / role / server API / financial-definition change. No
  broad refactoring; no unrelated UI or agent code change; no dependency change.

## Prohibited shortcuts avoided
- `writing` is NOT forced false during invalidation; the old promise settles
  naturally against its captured lane.
- `deferred_pending_local` is NOT disabled globally — it is scoped to the current
  lane's own pending intent (still fires for same-lane in-flight/queued work).
- No fingerprint-only reliance; no test-only bypass; no coordinator duplication in
  the harness or probe (both load the real production coordinator); no
  timeouts/delays/retries; no stale-callback classification after touching state
  (stale-first ordering retained from R7).

## Prohibitions honored
No merge / push / rebase / squash / amend / deploy. No Firebase / RTDB /
production / email / external-API call. Exactly one new local commit on the R8
branch. The guarded RTDB emulator test was not invoked (explicit glob used).
The approved cron commit `4ce7c84` is not merged and is not an ancestor of R8;
R8 is a narrow direct descendant of R7 `dc321d8`.

## Protected worktrees / repos (verified this session)
| Location | Expected | Observed |
|---|---|---|
| R5 | `088310c3…` | `088310c3…` |
| R6 | `13e70a81…` | `13e70a81…` |
| R7 (base) | `dc321d8…` (branch/subject/single-parent 13e70a81, clean) | matches |
| Cron | `4ce7c84…` | `4ce7c84…` |
| Canonical checkout | `0243123027…` (HEAD) | `0243123027…` unchanged |

R7 was read via explicit `--git-dir/--work-tree` (host-path `.git` pointer) and
never modified. The canonical checkout HEAD is unchanged; its pre-existing
working-tree edits under `src/agent/*` and `test/agent/` belong to a separate
codex stream and were present before R8 — not touched by this task.

## Formula / VAT containment
No active financial formula changed. `vat-invariant` 5/5 (S0 diff-guard green —
the R8 index.html additions introduce no
`migration/_rtdbSet/storage.set/set(ref/remove(ref/persist(/entries =` line).
Forecast suites pass.
