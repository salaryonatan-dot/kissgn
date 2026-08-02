# P0-DATA-01 R7 — Test Results

Local, offline, non-production, in the R7 worktree (branch
`claude/p0-data-01-r7-fingerprint-ownership`, base `13e70a81`). No dependency
install; no Firebase / RTDB / production / external API. Terminal I/O is injected
via deferred committing transports; the coordinator, selection controller,
persistence, fingerprint echo ownership and `MarjinEntries` under test are the
exact production code vm-extracted from `index.html`.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node --test test/dashboard/entries-lifecycle.test.mjs` | 0 | **65 pass / 0 fail** (R6 baseline 55 + 10 R7) |
| 2 | `node --test test/finance/vat-invariant.test.mjs` | 0 | **5 pass / 0 fail** (S0 diff-guard green) |
| 3 | `node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs` | 0 | **2 files pass** (UI + P0) |
| 4 | `node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | 0 | **406 pass / 0 fail / 0 cancelled** (R6 baseline 396 + 10) |
| 5 | `./node_modules/.bin/tsc --noEmit` | 2 | **22 `TS2742`**, all in `src/firebase/refs.ts` — 0 new/different |
| 6 | `./node_modules/.bin/tsc --noEmit --preserveSymlinks` | 0 | clean |
| 7 | `git diff --check 13e70a81 HEAD` | 0 | clean |
| 8 | `package.json` / `package-lock.json` vs R6 | — | byte-identical |

## New R7 closure cases (all pass)
| Test | Asserts |
|---|---|
| R7-1 | identical payload T1/A→T2/B → `applied`, hydrated, revenue rendered |
| R7-2 | identical payload T1/A→T2/A (new tenant) → `applied` |
| R7-3 | identical payload T1/A→T1/B (new business) → `applied` |
| R7-4 | switch T1/A→T2/B→T1/A (new generation) → `applied` |
| R7-5 | delayed old-context echo → `stale`; no active-destination mutation |
| R7-6 | same tenant/business/generation local-before-ack own echo → `ignored_own_echo` |
| R7-7 | foreign-destination callback `stale`; T1/A marker survives; own echo `ignored_own_echo` |
| R7-8 | failed write: `ownPending` 1→0 (own marker only); later identical remote → `applied` |
| R7-9 | identical fingerprints across dest/gen isolated; straggler `stale`; `ownPending==0` |
| R7-10 | two-edit ordering (newest wins); own echo ignored; different remote applied |

## Retained R6 cases
All 55 R6 cases retained. Own-echo `onListenerEcho` calls now pass the live
listener ctx (`h.ctrl.current()`), faithful to the single production call site
(`onListenerEcho(val, ctxAtSetup)`); assertions unchanged or strengthened. The
`[source-guard]` coordinator test updated to assert the scoped-marker shape and
the tenant+business+generation consumption predicate.

## Baseline reconciliation
Focused: R6 55/0 → R7 65/0. Full suite: R6 396/0 → R7 406/0. No pre-existing
test disappeared or was weakened.

## Negative control
See `ADVERSARIAL_PROBES.md`: R6 → `ignored_own_echo` (hydrated:false);
R7 → `applied` (hydrated:true).
