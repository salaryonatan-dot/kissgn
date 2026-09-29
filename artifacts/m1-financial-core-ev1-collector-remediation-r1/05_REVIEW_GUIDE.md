# 05 — Review guide (focused re-review of the R1 successor commit)

## Identity
- Parent: `19ae5eb49b9bd75e7fcf9a50b5ff2af903c355b8`.
- The successor commit and SHA are recorded in the external handoff `~/Documents/marjin-reviews/2026-09-29/ev1-collector-remediation-r1/`.
- `git diff 19ae5eb4..HEAD --stat`:
  - `tools/finance-core/ev1-collector.mjs`;
  - `tools/finance-core/ev1-preflight.mjs` (the `FORBIDDEN_ENV` list + comment only);
  - `test/finance/ev1-collector.test.mjs`;
  - artifacts.
- `ev1-transport.mjs` and `ev1-classifier.mjs` are unchanged.

## Where to look
1. `collect()`: the `rows_unclassifiable` failure after a successful classification.
2. `businessEquations()`: the two new per-business equations.
3. `evaluateReport()`: I20. It is recomputed from `scope.businesses[].rows` and `classification.counts.malformedRows`, not from stored counters.
4. `BUNDLE_MANIFEST`, `writeBundle()` (`bundleManifest` in COMPLETE), and `verifyBundle()` (rewritten, fail-closed order in 02).
5. `ev1-preflight.mjs` `FORBIDDEN_ENV`.

## Commands
```
node --test test/finance/ev1-collector.test.mjs test/finance/ev1-classifier.test.mjs      # 49/49
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs   # 1198/1198
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit                            # 22 × TS2742 (refs.ts), baseline
```
In a shell that exports `CLOUDSDK_AUTH_ACCESS_TOKEN`, prefix the commands with `env -u CLOUDSDK_AUTH_ACCESS_TOKEN`. Otherwise the offline production-path tests are refused by design.

## Independent probes to repeat
- Fixture `{"_v":"[\"garbage\"]"}`: expect `evidenceComplete:false`, `rows_unclassifiable` failure, and I20 false.
- Valid bundle plus `UNLISTED.txt`: expect `{ok:false}` with `unexpected bundle entry: "UNLISTED.txt" (length 12)`.

## Open questions for the reviewer
- **No metadata allowance.** A `.DS_Store` fails verification. The runbook says to verify before opening the folder. Accept, or name an explicit allowance?
- **Equivalent mutants.** Two are recorded in 03, both redundant by construction.
