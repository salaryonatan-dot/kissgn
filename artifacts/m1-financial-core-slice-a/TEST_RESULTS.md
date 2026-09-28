# Test Results — Financial Core Slice A

Environment: Node v22.22.2, TypeScript 5.9.3 (lockfile), clean worktree of `claude/m1-financial-core-slice-a` (node_modules linked, untracked). No emulator was required or run (Slice A touches no storage, Rules or runtime consumer). No Production access.

## Baseline (base `f5d0a8ed`, before any edit)
`node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` → **880 tests, 880 pass, 0 fail**.

## Focused Slice A tests
`node --test test/finance/fincore-golden.test.mjs test/finance/fincore-contract.test.mjs test/finance/fincore-guards.test.mjs` → **179 tests, 179 pass, 0 fail**.

| File | Tests | Content |
|---|---|---|
| `fincore-golden.test.mjs` | 134 (67 cases × {compiled source, committed artifact}) | G-01…G-06, G-07a…G-07n, G-08…G-29, G-32, G-18 revised, G-40…G-49, G-51, G-X1…G-X5 |
| `fincore-contract.test.mjs` | 36 (18 × 2) | G-P1…G-P6 (G-P5 = G-50), G-30 TZ/DST, G-31/G-07f legacy↔V2, G-33, G-35, G-36 (measured ~7–14 ms, budget 500 ms), G-48/TI-16, BD-3 projection separation, labor invariant, window contract, decimal/rounding, self-review regressions (projection other-expense, duplicate_day, not-evaluable labor goal) |
| `fincore-guards.test.mjs` | 9 | G-B1 regeneration byte-equality, closure, G-B2 zero consumers, G-S1, G-S2, G-S3, G-S4, G-A1, G-M1 |

Golden coverage mapping to the plan: R1.2 G-01…G-36 (G-34 DEFERRED TO B1 — needs the migrated repository; G-35 adapter part only; G-31 in the contract file); R1.3 G-07a…G-07n (G-07b/c folded into G-07a-B; G-07f in the contract file), G-18 revised, G-40…G-51 (G-44/G-46 converted to contract-error tests: SUPERSEDED BY BD-1; G-50 = G-P5).

During authoring one hand-written expectation was wrong (G-20 period total: expected `2999999999999997.61`, correct `3000000000000297.61` = 0.3 + 300.3 + 2999999999999997.01, verified with an independent rational calculator); the fixture was corrected, not the code.

## Full suite (after changes)
Same command → **1059 tests, 1059 pass, 0 fail** (880 baseline + 179 new). The existing S0 VAT guard (`test/finance/vat-invariant.test.mjs`) and server-reader/Rules guards pass unchanged: no protected path, VAT literal or forbidden added line.

## Typecheck
See TYPECHECK_BASELINE.md: 22 × TS2742 before and after, identical list.

## Artifact determinism
`node tools/finance-core/gen-browser.mjs` regenerates `fincore/v1` byte-identically (G-B1); sourceDigest recorded in `fincore/v1/MANIFEST.json`.
