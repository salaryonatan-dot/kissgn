# TEST RESULTS — server readers R1 candidate (parent f00568d2)

## Focused
| suite | result |
|---|---|
| `test/analytics/entries-reader-d1-downstream.test.mjs` (repo aggregation, detector ×10 representations, Codex 1/1000, actual `runForBiz`, pre-fix negative control) | 5/5 |
| `test/analytics/entries-reader-repos.test.mjs` (duplicate → one aggregated record, legacy/V2/reversed) | 5/5 |
| reader suites (`entries-reader*.test.mjs`, exception parity, preflight duplicates, declaration parity, false-insights) | all pass (100/100 in the combined focused run incl. the guard suites and hardening R1 30/30) |
| `test/finance/vat-invariant.test.mjs` (Layer A + Layer B exact pin) | 5/5 |
| `test/finance/s0-guard-server-reader-mutations.test.mjs` (A–H + I) | 9/9 |
| `test/dashboard/entries-storage-v2-hardening.test.mjs` ([H10] VAT guard pin) | 30/30 |

## Emulator (real RTDB, one script at a time)
| script | result |
|---|---|
| `server-readers-matrix.mjs` SR-01…SR-11 (SR-11 new: real `runForBiz`, 8 representations) | **11/11 × 3 rounds** — `total=11 passed=11 failed=0 — ALL CASES PASSED` |
| `storage-v2-matrix.mjs` | 46/46 |
| `rtdb-authorization-matrix.mjs` | total=108 expected_allow=37 expected_deny=71 passed=108 failed=0 |
| `entries-remote-atomic-emulator.mjs` | 19/19 |
| `storage-v2-rules-guard-mutations.mjs` | mutations=12 proven_weakening_and_guard_rejected=12 failed=0 |
| `entries-rules-validation-matrix.mjs` | total=30 passed=30 |

## Full suite
```
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
# tests 787   # pass 787   # fail 0   # cancelled 0   # skipped 0   # todo 0
```
(780 at f00568d2 + 5 D1-downstream + 2 net new guard-mutation tests.)

## Static
`tsc --noEmit`: baseline unchanged (exit 2, exactly 22 pre-existing `TS2742`, no other diagnostics) · `git diff --check` clean · S0 added-line regex over `index.html api lib src` (parent → tree) clean · DO-NOT-TOUCH files unchanged vs parent: `index.html`, `database.rules.json` (+ emulator copy), `tools/storage-v2/upgrade.mjs`, `src/alerts/{runner,checkers}.ts`, `lib/entryExceptions.js`, `lib/repositories/entryExceptionsRepo.js`, `lib/analytics/entriesReader.js`, `src/agent/**`, `package*.json`, `tsconfig.json`, `vercel.json`, `test/support/rules-authorized-delta.mjs`.
