# P0-DATA-01 R5 — Test Results

Local, offline, non-production, in the R5 worktree (branch
`claude/p0-data-01-r5-final-lifecycle-convergence`, HEAD = R5 commit, parent `6c4d9eb1`).
No dependency install; no Firebase/RTDB/production/external API; storage and API exercised
through deferred stub transports that COMMIT to a simulated store on resolution.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node --test test/dashboard/entries-lifecycle.test.mjs` | 0 | **53 pass / 0 fail** |
| 2 | `node --test test/finance/vat-invariant.test.mjs` | 0 | **5 pass / 0 fail** (S0 diff-guard green) |
| 3 | `node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs` | 0 | **2 files pass** (UI 33, P0 54) |
| 4 | `node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | 0 | **394 pass / 0 fail** |
| 5a | `./node_modules/.bin/tsc --noEmit` | 2 | **22 `TS2742`**, all in `src/firebase/refs.ts` — 0 new/different |
| 5b | `./node_modules/.bin/tsc --noEmit --preserveSymlinks` | 0 | clean |
| 6 | `git diff --check 6c4d9eb1… HEAD` | 0 | clean |
| 7 | `git diff --name-status 6c4d9eb1… HEAD` | — | `M index.html`, `M test/dashboard/entries-lifecycle.test.mjs`, `A artifacts/p0-data-01-r5/*` |
| 8 | `package.json` / `package-lock.json` vs R4 | — | **byte-identical** |
| 9 | security `test/security/entry-exceptions.test.mjs` | 0 | pass (CLIENT WIRING intact) |

Per the task, the broad bare `node --test` (which invokes the guarded RTDB emulator
`test/emulator/rtdb-authorization-matrix.mjs` and safety-aborts without `GCLOUD_PROJECT`) was NOT
run; the requested glob command #4 was used.

## Terminal persistence probe results (committing store)

| Probe | Result |
|---|---|
| Persisted supplier ordering (100→200, older last) | **PASS** — only 1 write in flight; final persisted **200** |
| Complete two-edit listener echo (100→200→echo200→echo100) | **PASS** — both own-echoes drained; final UI/persisted **200** |
| Invalidation / pending counter | **PASS** — `pending ≥ 0`; stale echo not applied; final **NEW** |
| Switch-away-and-back same destination | **PASS** — new write dispatched only after old settles; persisted **NEW** |
| Older failure / newer success | **PASS** — persisted **200** |
| Latest failure surfaced | **PASS** — `{persist_failed, latest:true}` → production error setter |
| Explicit-tenant `storage.setFor` | **PASS** — path under captured tenant, `{_v}` envelope, no call on missing tenant |

## Focused suite composition (53)

38 `[prod-helper]` (real seam factories, deferred committing transports), 9 `[prod-entries]` (real
`MarjinEntries`), 6 `[source-guard]` (supplementary wiring only).

## Baseline reconciliation

R2 37/378 · R3 35/376 · R4 46/387 · R5 53/394 (net +7 focused).

## Incident recomputation (independent, R5 helper)

`raw 608236 · canonical 580483 · rows 24 · july24 27753 · delta 27753`.
