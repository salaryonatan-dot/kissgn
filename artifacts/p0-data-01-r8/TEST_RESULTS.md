# P0-DATA-01 R8 — Test Results

Local, offline, non-production, in the R8 worktree (branch
`claude/p0-data-01-r8-pending-write-isolation`, base/parent `dc321d8`). No
dependency install; no Firebase / RTDB / production / email / external API.
Terminal I/O is injected via deferred committing transports; the coordinator,
selection controller, persistence, markers and `MarjinEntries` under test are the
exact production code vm-extracted from `index.html`.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node --test test/dashboard/entries-lifecycle.test.mjs` | 0 | **79 pass / 0 fail / 0 cancelled** (R7 baseline 65 + 14 R8) |
| 2 | `node --test test/finance/vat-invariant.test.mjs` | 0 | **5 pass / 0 fail** (S0 diff-guard green) |
| 3 | `node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs` | 0 | **2 files pass** (UI + P0) |
| 4 | `node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | 0 | **420 pass / 0 fail / 0 cancelled** (R7 baseline 406 + 14) |
| 5 | `./node_modules/.bin/tsc --noEmit` | 2 | **22 `TS2742`**, all in `src/firebase/refs.ts` — 0 new/different |
| 6 | `./node_modules/.bin/tsc --noEmit --preserveSymlinks` | 0 | clean |
| 7 | `git diff --check dc321d8 HEAD` | 0 | clean |
| 8 | `package.json` / `package-lock.json` / `database.rules.json` / `vercel.json` vs R7 | — | byte-identical |

## New R8 cases (all pass)
| Test | Asserts |
|---|---|
| R8-1 | old success isolation: T2/B hydrates (4321); old callback stale; old ack no mutation; no T2/B persist |
| R8-2 | old failure isolation: T2/B hydrates; old failure cleanup only; ownPending 0 |
| R8-3 | cross-tenant same business hydrates while old write pending (222) |
| R8-4 | same tenant different business hydrates while old write pending (333) |
| R8-5 | switch-away-back new generation hydrates before original settles (444) |
| R8-6 | different payload hydrates (999) — not fingerprint-gated |
| R8-7 | old completion after new hydration: desired/render/persist/transports unchanged |
| R8-8 | new-lane pending intent protected (deferred), converges to local value (777 not 888) |
| R8-9 | current same-generation own echo still ignored_own_echo |
| R8-10 | dropped deferred payload not replayed into another lane by old completion |
| R8-11 | old completion cannot clear current-generation marker/pending; persisted 2 |
| R8-12 | superseded revisions: newest wins (200); identical future remote not blacklisted |
| R8-13 | invalidation during pending: fresh lane (pendingLocal false, desired null); old cb stale |
| R8-14 | no pending intent → normal live hydration applied (321) |

## Retained R7 cases
All 65 R7 cases retained unchanged (R6-* and R7-1..R7-10, plus S-series and
source-guards). No pre-existing test removed or weakened.

## Baseline reconciliation
Focused: R7 65/0 → R8 79/0. Full suite: R7 406/0 → R8 420/0. No pre-existing test
disappeared or regressed.

## Negative control
See `ADVERSARIAL_PROBES.md`: pending-switch R7 `deferred_pending_local`
(hydrated:false, desired:null) vs R8 `applied` (hydrated:true, old stale, no
current mutation); acknowledged-write control `applied` on both.
