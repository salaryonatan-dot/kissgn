# TEST RESULTS — server readers R2 (parent c46c2727)

## Focused
| suite | tests | result |
|---|---|---|
| `test/analytics/entries-reader-decimal-aggregation.test.mjs` (new): #1 108-representation permutation proof (revenue/laborCost/foodCost/strings) · #2 adversarial numeric contract (15 cases × all representations + 0.01×10000 + fallback) · #3 non-finite categories & coercion parity · #4 singleton passthrough, distinct dates, window, latest, ratios, denominators · #5 Codex counterexample ×72 through the actual proactive flow · #6 positive persistence control · #7 parent negative control (600.5999… / Infinity / flipped verdict) · #8 fixture discrimination (ordinary, value-sorted, Kahan, pairwise, cents, per-step Number all fail) | 8 | pass |
| `test/analytics/entries-reader-d1-downstream.test.mjs` (existing D1) | 5 | pass |
| `test/analytics/entries-reader-repos.test.mjs` | 5 | pass |
| `test/finance/s0-guard-server-reader-mutations.test.mjs` (+ R1-bytes denial, four-pins-unchanged, decimal-specific mutants) | 9 | pass |
| `test/finance/vat-invariant.test.mjs` | 5 | pass |
| `test/dashboard/entries-storage-v2-hardening.test.mjs` | 30 | pass |
| server reader focused suites (reader, parity, dailybuilder, snapshot, exceptions, checkers, preflight duplicates, declaration parity, false-insights) | — | pass (inside full suite) |

## Emulator
| script | result |
|---|---|
| `server-readers-matrix.mjs` SR-01…SR-12 (SR-12 new: Codex counterexample, 24 representations, real `runForBiz`) | **12/12 × 3 rounds** — `total=12 passed=12 failed=0 — ALL CASES PASSED` |
| `storage-v2-matrix.mjs` | 46/46 |
| `rtdb-authorization-matrix.mjs` | total=108 expected_allow=37 expected_deny=71 passed=108 failed=0 |
| `entries-remote-atomic-emulator.mjs` | 19/19 |
| `storage-v2-rules-guard-mutations.mjs` | mutations=12 proven_weakening_and_guard_rejected=12 failed=0 |
| `entries-rules-validation-matrix.mjs` | 30/30 |

## Full suite
```
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
# tests 795   # pass 795   # fail 0   # cancelled 0   # skipped 0   # todo 0
```
(787 at c46c2727 + 8 new.)

## Static
`tsc --noEmit`: exit 2 with exactly 22 pre-existing `TS2742`, no other diagnostics (baseline unchanged) · `git diff --check` clean · S0 added-line regex over `index.html api lib src` (parent → tree) clean · runtime files changed vs parent: `src/repositories/analytics/dailyMetricsRepo.ts` only (verified with `git diff --name-only c46c2727 -- src lib api index.html tools`).
