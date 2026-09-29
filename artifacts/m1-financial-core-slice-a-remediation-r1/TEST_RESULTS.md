# Test Results — Slice A Remediation R1

Environment: Node v22.22.2, TypeScript 5.9.3; same results expected on the Mac VM (verified after commit transfer, see CHANGE_SUMMARY). No emulator required (no storage, Rules or runtime consumer touched). No Production access.

## Before (candidate `a8fdf2c8`)
Focused Slice A 179/179; full suite 1059/1059; tsc 22 × TS2742 (also independently reproduced by Codex).

## After (remediation)
Focused (`node --test test/finance/fincore-golden.test.mjs test/finance/fincore-contract.test.mjs test/finance/fincore-guards.test.mjs test/finance/ev1-classifier.test.mjs`): **226 pass / 0 fail**

| File | Pass | Fail | Notes |
|---|---|---|---|
| `fincore-golden.test.mjs` | 168 | 0 | 84 cases × {compiled source, committed artifact}: G-01…G-06, G-07a…G-07n, G-08…G-32, G-18 revised, G-40…G-51, G-X1…G-X5, **R1-A…R1-P** |
| `fincore-contract.test.mjs` | 40 | 0 | G-P1 now 10,000 permutations, G-P2…G-P6, G-30, G-31/G-07f, G-33, G-35, G-36, G-48/TI-16, labor contract, TI-18 projection/presenter/policy, goals not evaluated on incomplete components |
| `fincore-guards.test.mjs` | 9 | 0 | G-B1 byte parity, closure, G-B2, G-S1…G-S4, G-A1, G-M1 |
| `ev1-classifier.test.mjs` | 9 | 0 | see EV1_TEST_RESULTS.md |

Full suite (`node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs`): **1106 pass / 0 fail / 0 cancelled / 0 skipped** (880 base + 226).

Regression requirements: G-07a…G-07n pass; revised G-18 passes; G-40…G-51 pass; all previous Slice A tests pass (expectations changed only where the labor/TI-18 contract changed them — listed in CHANGE_SUMMARY); browser artifact regenerates byte-identically; every golden/contract case runs against compiled source and committed artifact.
