# S0 VAT Invariant Test Results

Validation run in `/Users/yonatan/Documents/marjin/kissgn-m1-s0-vat-invariant`.

## Dependency State

- `npm ci`: completed from the existing lockfile so TypeScript and the full test suite could run in this new worktree.
- No package or lockfile diff was produced.
- `node_modules/` remains untracked and was not staged.

## Results

- `node --test test/finance/vat-invariant.test.mjs`
  - Passed: 5
  - Failed: 0
- `node --test test/forecast/revenue-forecast-ui.test.mjs test/forecast/revenue-forecast-p0.test.mjs`
  - Passed test files: 2
  - `revenue-forecast-p0`: 54 passed, 0 failed
  - `revenue-forecast-ui`: 33 passed, 0 failed
- `node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs`
  - Passed: 341
  - Failed: 0
- `./node_modules/.bin/tsc --noEmit`
  - Passed with no output.
- `git diff --check`
  - Passed with no output.

## Notes

- `npm ci` reported existing audit findings and dependency deprecation warnings. No audit fix, dependency upgrade, or package edit was run.
