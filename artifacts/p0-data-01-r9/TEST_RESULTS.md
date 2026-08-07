# R9 — TEST RESULTS

Worktree: `kissgn-p0-data-01-r9` · Branch: `claude/p0-data-01-r9` · Base: `3685c92` (R8)
Runner: `node v22.22.3`. No dependencies were installed; `node_modules` is the shared symlink.

## Commands, exit codes, counts

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node --test test/dashboard/entries-lifecycle.test.mjs` | 0 | **103 pass / 0 fail / 0 cancelled** |
| 2 | `node --test test/finance/vat-invariant.test.mjs` | 0 | **5 pass / 0 fail** |
| 3 | `node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs` | 0 | **2 files pass** |
| 4 | `node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | 0 | **444 pass / 0 fail / 0 cancelled / 0 skipped** |
| 5 | `./node_modules/.bin/tsc --noEmit` | 2 | 22 diagnostics, **all `TS2742`, all in `src/firebase/refs.ts`** — the accepted project baseline |
| 6 | `./node_modules/.bin/tsc --noEmit --preserveSymlinks` | 0 | clean |
| 7 | `git diff --check` | 0 | clean |
| 8 | `git diff --check 3685c926..` | 0 | clean |

### Baseline comparison (verified against the untouched R8 base)
- Focused suite at base: **79 pass / 0 fail** → R9: **103 pass / 0 fail** (**+24 new R9 tests**).
- Full suite at base (per the Codex R8 review): **420 pass / 0 fail** → R9: **444 pass / 0 fail**
  (+24, exactly the new tests; **no pre-existing test changed its result**).
- `tsc --noEmit` exit 2 with 22 `TS2742` in `src/firebase/refs.ts` is the **pre-existing, documented
  project baseline** (identical at R8 and unchanged by R9; `--preserveSymlinks` is clean). It is a
  module-resolution artifact of the symlinked `node_modules`, not a code defect introduced here.
- No lint script is defined in `package.json`; `tsc` + `git diff --check` are the repository's
  defined static checks.

## Required-case coverage map

| # | Required case | Test |
|---|---|---|
| 1 | Full-history hydration before a revenue save | `R9-1` |
| 2 | Food-cost save before hydration blocked, no intent | `R9-3` |
| 3 | Revenue save before hydration blocked, no intent | `R9-2` |
| 4 | Current-month filter cannot become the persisted collection | `R9-4` |
| 5 | Tenant switch while hydration pending | `R9-16` |
| 6 | Business switch while hydration pending | `R9-15` |
| 7 | Late listener callback from the previous business | `R9-17` |
| 8 | Late write success from a previous generation | `R9-18` |
| 9 | Late write failure from a previous generation | `R9-18` |
| 10 | Two rapid edits to the same date | `R9-19` |
| 11 | Two rapid edits to different dates | `R9-20` |
| 12 | Multiple writers with inverted completion order | `R9-18`, `R9-21`, retained `R6-1`/`R8-11` |
| 13 | Listener echo arriving between queued edits | `R9-21` |
| 14 | Failed first write followed by a newer queued edit | `R9-22` |
| 15 | Retry payload ownership and ordering | `R9-23` |
| 16 | Logout/unmount with work in flight | `R9-9` |
| 17 | Malformed or ambiguous owner context | `R9-8` |
| 18 | Listener failure before hydration | `R9-7` |
| 19 | Food-cost edit preserves all hydrated historical dates | `R9-5` (160-date fixture) |
| 20 | Revenue edit preserves all hydrated historical dates | `R9-1` (160-date fixture) |
| 21 | Opening/navigating produces no entries write intent | `R9-6` |
| 22 | All previously passing P0-DATA-01 regressions | retained `R6-*`/`R7-*`/`R8-*` (79) |
| 23 | Every case requested by the R8 Codex review | `R9-10`..`R9-14` (failure/no-reemit, success, own-echo-only, supersession, invalidation) + negative control |

## Independent negative control (not committed; lives under `/tmp`)
The same terminal-convergence scenario was run against **both** vm-extracted coordinators:

| | deferred status | stored | settled | rendered | desired | another emit required |
|---|---|---|---|---|---|---|
| **R8 `3685c92`** | `deferred_pending_local` | **false** | `persist_failed` | 200 | **200** | **yes** |
| **R9** | `deferred_pending_local` | **true** | `persist_failed` | **999** | **999** | **no** |

R8 reproduces Codex's documented defect numbers exactly; R9 converges deterministically with no
further listener emission. This is the direct evidence that `P0-DATA-01-R8-FIND-001` is closed.
