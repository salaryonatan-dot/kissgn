# TEST RESULTS — emulator-free suites, worktree `kissgn-p0-data-01-server-readers` — candidate commit (parent 8cac71c1)

## Focused reader suites (`node --test …`)

| file | tests | result |
|---|---|---|
| `test/analytics/entries-reader.test.mjs` | 6 | pass |
| `test/analytics/entries-reader-client-parity.test.mjs` | 2 | pass |
| `test/analytics/entries-reader-dailybuilder.test.mjs` | 6 | pass |
| `test/analytics/entries-reader-snapshot.test.mjs` | 5 | pass |
| `test/analytics/entries-reader-repos.test.mjs` | 5 | pass |
| `test/analytics/entries-reader-exceptions.test.mjs` | 5 | pass |
| `test/analytics/entries-reader-checkers.test.mjs` | 3 | pass |
| `test/analytics/entry-exception-parity.test.mjs` (existing, temp-dir copy of reader added) | 9 | pass |
| `test/storage-v2/preflight-duplicates.test.mjs` | 6 | pass |
| `test/typescript/js-declaration-parity.test.mjs` (reader pair + `export class` scan) | 11 | pass |
| `test/insights/false-insights-p0.test.mjs` (temp-dir copy of reader added) | 56 inner checks | pass |
| `test/finance/vat-invariant.test.mjs` (Layer A + Layer B scope guard) | 5 | pass |
| `test/finance/s0-guard-server-reader-mutations.test.mjs` (A–F + positive control) | 7 | pass |
| `test/dashboard/entries-storage-v2-hardening.test.mjs` ([H10] pin adapted) | 30 | pass |

Sub-total new reader tests: **38/38** (+6 preflight).

## Full suite

```
shopt -s globstar
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
# tests 780
# pass 780
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

(First pass, before the CTO-authorized guard adaptation: 773 tests, 772 pass, 1 fail — the
S0 scope guard's forbidden-path assertion on the five reader files; its added-line
content regex was clean and VAT assertions 1–4 passed. After the two-layer guard: all
green; +7 mutation-proof tests.)

Storage V2 core emulator-free suites inside the full run (all pass): dashboard hardening R1,
production wiring R2 (15), stale-delete, labor, duplicate-delete, lifecycle / R10 gates,
rules authorized delta, finance VAT tests 1–4, agent, api, forecast, insights.

## Static gates

| gate | result |
|---|---|
| `tsc --noEmit -p tsconfig.json` | exit 2 with **exactly 22** pre-existing `TS2742` (baseline unchanged; 0 errors with `--preserveSymlinks`); no new diagnostics |
| `git diff --check` | clean |
| S0 added-line regex over runtime diff | clean |
| `git status` — DO-NOT-MODIFY files | none modified (`index.html`, `database.rules.json`, emulator rules copy, `tools/storage-v2/upgrade.mjs`, `src/alerts/runner.ts`, `src/agent/**`, `api/**`, `src/forecast/**`, `package*.json`, `tsconfig.json`, `vercel.json`, `test/support/rules-authorized-delta.mjs`); `test/finance/vat-invariant.test.mjs` changed only in test 5's scope body under CTO authorization (VAT assertions 1–4 byte-identical, pinned by [H10]) |
