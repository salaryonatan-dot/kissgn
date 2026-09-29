# Verification (cloud worktree, Node v22.22.2, parent d83705f)

## Tests
| Scope | Command | Result |
|---|---|---|
| Focused (4 files) | `node --test --test-concurrency=8 test/finance/fincore-golden.test.mjs test/finance/fincore-contract.test.mjs test/finance/fincore-guards.test.mjs test/finance/ev1-classifier.test.mjs` | **278 / 278** |
| Full suite | `node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | **1158 / 1158** (0 fail, 0 cancelled, 0 skipped) |

Focused breakdown by file:

| File | Result | Change |
|---|---|---|
| `fincore-golden` | 214 | 107 hand-authored cases × {compiled, committed}; was 168 / 84 |
| `fincore-contract` | 46 | was 40 |
| `fincore-guards` | 9 | — |
| `ev1-classifier` | 9 | — |

At parent d83705f the full suite was 1106. The delta of +52 is the new golden cases and contract tests.

## Typecheck
`node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` gives **22 × TS2742**, all in `src/firebase/refs.ts`. The error list is byte-identical to the pre-existing baseline (`diff` empty), so no new errors.

## Generated browser artifact
- `node tools/finance-core/gen-browser.mjs` → `fincore/v1`, 22 files, sourceDigest `10c6adcf0a61eb6b2ae04a44c9ae7ed86f3783dc2da5ea4ddea751fc4f05e298`.
- Regeneration is byte-identical (guard G-B1).

## Guards
| Check | Result |
|---|---|
| G-S1…G-S4, G-B1, G-B2 (no runtime consumer), G-A1, G-M1 | pass |
| VAT invariant: no `1.18`, no VAT operators, no migration/persistence tokens in added `src` lines | pass (0 hits) |
| No change to `package.json`, `scripts/`, Rules, `vercel.json`, `index.html`, `api/`, `lib/`, or server consumers | holds |
| `git diff --check` | clean |
