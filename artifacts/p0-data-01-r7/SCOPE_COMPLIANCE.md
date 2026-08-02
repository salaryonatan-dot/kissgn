# P0-DATA-01 R7 — Scope Compliance

## Allowed edits (only these)
- **Runtime:** `index.html` — `createEntriesWriteCoordinator` own-echo ownership
  made destination- and generation-scoped.
- **Test:** `test/dashboard/entries-lifecycle.test.mjs` — R6 own-echo calls now
  pass the live listener ctx; `[source-guard]` updated; 10 new R7 cases.
- **Artifacts:** `artifacts/p0-data-01-r7/` (9 files).

`git diff --name-status 13e70a81 HEAD` = `M index.html`,
`M test/dashboard/entries-lifecycle.test.mjs`, `A artifacts/p0-data-01-r7/*`.
Nothing else.

## Not changed
- `package.json` / `package-lock.json` — **byte-identical to R6**.
- `database.rules.json`, `vercel.json`, `api/`, `lib/`, `src/`, all other
  runtime/config/server files. No schema / Firebase Rules / auth / role / server
  API / financial-definition change. No broad refactor; no unrelated UI change.
- No dependency install or upgrade.
- The approved cron remediation (`kissgn-p0-cron-auth-r1`, `4ce7c84`) is neither
  merged nor depended upon; R7 is a narrow descendant of the R6 data-lifecycle
  commit `13e70a81`.

## Prohibitions honored
No merge / push / rebase / squash / deploy / amend. No Firebase / RTDB /
production / email / external-API call. Exactly one new local commit on the R7
branch. The guarded RTDB emulator test was not invoked (explicit glob used).

## Protected worktrees / repos (verified this session)
| Location | Expected | Observed |
|---|---|---|
| R6 `kissgn-p0-data-01-r6` | `13e70a81…` (clean tracked) | `13e70a81…` clean |
| R5 `kissgn-p0-data-01-r5` | `088310c3…` | `088310c3…` |
| Cron `kissgn-p0-cron-auth-r1` | `4ce7c84…` | `4ce7c84…` |
| Canonical checkout | `0243123027…` (HEAD) | `0243123027…` unchanged |

R6 was read via explicit `--git-dir/--work-tree` (its `.git` uses a host-path
pointer) and never modified. The canonical checkout's HEAD is unchanged; its
pre-existing working-tree edits under `src/agent/*` and `test/agent/` belong to a
separate codex weekday-parser stream and were present before R7 — not touched by
this task. Creating the R7 worktree only added a `.git/worktrees/…-r7` registry
entry; it did not alter any canonical tracked content.

## Formula / VAT containment
No active financial formula changed. `vat-invariant` 5/5 (S0 diff-guard green —
the R7 index.html additions introduce no
`migration/_rtdbSet/storage.set/set(ref/remove(ref/persist(/entries =` line).
Forecast suites pass.
