# P0-DATA-01 R6 — Test Results

Local, offline, non-production, in the R6 worktree (branch
`claude/p0-data-01-r6-destination-lifecycle-convergence`, HEAD = R6 commit, parent `088310c3`).
No dependency install; no Firebase/RTDB/production/external API; storage/API exercised through
deferred stub transports that COMMIT to a simulated store on resolution.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node --test test/dashboard/entries-lifecycle.test.mjs` | 0 | **55 pass / 0 fail** |
| 2 | `node --test test/finance/vat-invariant.test.mjs` | 0 | **5 pass / 0 fail** (S0 diff-guard green) |
| 3 | `node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs` | 0 | **2 files pass** (UI 33, P0 54) |
| 4 | `node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | 0 | **396 pass / 0 fail** |
| 5a | `./node_modules/.bin/tsc --noEmit` | 2 | **22 `TS2742`**, all in `src/firebase/refs.ts` — 0 new/different |
| 5b | `./node_modules/.bin/tsc --noEmit --preserveSymlinks` | 0 | clean |
| 6 | `git diff --check 088310c3… HEAD` | 0 | clean |
| 7 | `git diff --name-status 088310c3… HEAD` | — | `M index.html`, `M test/dashboard/…`, `A artifacts/p0-data-01-r6/*` |
| 8 | `package.json` / `package-lock.json` vs R5 | — | **byte-identical** |
| 9 | security `test/security/entry-exceptions.test.mjs` | 0 | pass (CLIENT WIRING intact) |

The bare `node --test` (guarded RTDB emulator) was NOT run; the requested glob (#4) was used.
The full glob was executed with `--test-concurrency=8` to fit the offline runner's time budget;
the default-concurrency partial run showed identical pass/fail progress with zero failures.

## Terminal / lifecycle probe results

| Probe | Result |
|---|---|
| Cross-writer ordering (supplier 100 + main-save 999) | **PASS** — single-flight; final persisted **999** |
| All six intents through the one lane | **PASS** — one serialized terminal write each |
| Queued invalidation (rev2/rev3) | **PASS** — settle `cancelled_selection_changed` exactly once |
| Switch-away-and-back to T1/A | **PASS** — new write after old settles; persisted **NEW** |
| Firebase local-before-ack own echo | **PASS** — identified by fingerprint; external after ack applied |
| Complete listener race 100→200→echoes | **PASS** — final UI/persisted **200** |
| External convergence / no permanent blacklist | **PASS** |
| Supplier error ownership (old-selection isolation) | **PASS** |
| Insight null-to-owner (same instance) | **PASS** |
| Save-UI business/tenant/logout/unmount | **PASS** — no post-unmount state update |
| Exception op-ID isolation composed with executeEntrySave | **PASS** |
| Explicit-tenant `storage.setFor` | **PASS** |

## Focused composition (55)
≈44 `[prod-helper]` (real seam factories + deferred committing transports), 8 `[prod-entries]`
(real `MarjinEntries`), 3 `[source-guard]` (supplementary wiring only).

## Baseline reconciliation
R2 37/378 · R3 35/376 · R4 46/387 · R5 53/394 · R6 55/396.

## Incident recomputation (R6 helper)
`raw 608236 · canonical 580483 · rows 24 · delta 27753`.
