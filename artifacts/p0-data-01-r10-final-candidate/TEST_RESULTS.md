# Test results — R10 final candidate

All runs from `/Users/yonatan/Documents/marjin/kissgn-p0-data-01-r10`, branch
`claude/p0-data-01-r10`, base `b854054`. Nothing touched Production or Preview.

## Focused suites

```
node --test test/dashboard/entries-lifecycle.test.mjs          112 tests, 112 pass, 0 fail
node --test test/dashboard/entries-ui-call-sites.test.mjs        49 tests,  49 pass, 0 fail
node --test test/dashboard/entries-labor-screen.test.mjs         14 tests,  14 pass, 0 fail   (new — L-GAP-1)
node --test test/dashboard/entries-duplicate-delete.test.mjs     10 tests,  10 pass, 0 fail   (new — D-GAP-1)
node --test test/dashboard/entries-concurrency-matrix.test.mjs   41 tests,  41 pass, 0 fail
node --test test/dashboard/entries-clear-all-matrix.test.mjs     42 tests,  42 pass, 0 fail
node --test test/dashboard/entries-topology-sentinel.test.mjs    14 tests,  14 pass, 0 fail
node --test test/dashboard/entries-remote-atomic.test.mjs        23 tests,  23 pass, 0 fail
node --test test/dashboard/entries-id-contract.test.mjs          12 tests,  12 pass, 0 fail
node --test test/finance/vat-invariant.test.mjs                   5 tests,   5 pass, 0 fail
node --test test/emulator/safety.test.mjs                        12 tests,  12 pass, 0 fail
```

## Emulator concurrency validation (real local RTDB)

```
env -u GOOGLE_APPLICATION_CREDENTIALS -u FIREBASE_CONFIG -u FIREBASE_DATABASE_URL \
    GCLOUD_PROJECT=demo-marjin-rules GOOGLE_CLOUD_PROJECT=demo-marjin-rules \
    FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000 \
    JAVA_HOME=<a JDK 21+> PATH="<that JDK>/bin:$PATH" \
    ./node_modules/.bin/firebase emulators:exec --only database \
      --project demo-marjin-rules --config test/emulator/firebase.json \
      "node test/emulator/entries-remote-atomic-emulator.mjs"

=== TOTALS ===
total=16 passed=16 failed=0
ALL CASES PASSED           (exit 0)
```

Three consecutive runs, identical, no change between them. Per-case table:
`EMULATOR_CONCURRENCY_EVIDENCE.md`.

## Complete repository suite

```
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs

# tests 658   # pass 658   # fail 0   # cancelled 0   # skipped 0   # todo 0
```

Three consecutive runs, identical. Baseline at the start of this round was 634 tests
(633 pass / 1 fail — the git-context failure of the VAT S0 guard). The delta is +14
labor-screen, +10 duplicate-delete, and the VAT guard restored to passing.

Never run as bare `node --test`: that pattern picks up the reserved RTDB emulator suite,
which fails without `GCLOUD_PROJECT=demo-marjin-rules`. The emulator validation script is
deliberately not named `*.test.mjs` so the glob above cannot pick it up either.

## Static checks

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 2, exactly **22** diagnostics, all `TS2742`, all in `src/firebase/refs.ts` — identical to the documented baseline; no new diagnostic, file or category |
| `tsc --noEmit --preserveSymlinks` | exit 0, as documented (the 22 are an artefact of the symlinked `node_modules` in this worktree) |
| `git diff --check` | exit 0 |
| module import check | every new and modified test module imports clean; the emulator script has **no side effects on import** (its safety gate and I/O run only on direct execution) |

## Acceptance criteria

| Criterion | Result |
|---|---|
| emulator concurrency validation | **PASS** (16/16 ×3) |
| R9 negative control reproduces the historical failure | **PASS** (both completion orders) |
| R10 concurrency scenario | **PASS** (both orders and true simultaneity) |
| labor rendered UI tests | **PASS** (14/14) |
| VAT invariant | **PASS** (5/5, assertions unchanged) |
| lifecycle | **PASS** (112/112) |
| no unexplained full-suite failures | **PASS** (658/658 ×3) |
