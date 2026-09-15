# Test results — R10.1

Run from `/Users/yonatan/Documents/marjin/kissgn-p0-data-01-r10`, branch
`claude/p0-data-01-r10`, parent `1038b4cd`. Nothing touched Production or Preview.

## Focused suites

```
node --test test/dashboard/entries-stale-delete.test.mjs        31 tests,  31 pass, 0 fail   (new — blocking finding 1)
node --test test/dashboard/entries-lifecycle.test.mjs          112 tests, 112 pass, 0 fail
node --test test/dashboard/entries-ui-call-sites.test.mjs        49 tests,  49 pass, 0 fail
node --test test/dashboard/entries-labor-screen.test.mjs         14 tests,  14 pass, 0 fail
node --test test/dashboard/entries-duplicate-delete.test.mjs     10 tests,  10 pass, 0 fail
node --test test/dashboard/entries-concurrency-matrix.test.mjs   41 tests,  41 pass, 0 fail
node --test test/dashboard/entries-clear-all-matrix.test.mjs     42 tests,  42 pass, 0 fail
node --test test/dashboard/entries-topology-sentinel.test.mjs    14 tests,  14 pass, 0 fail
node --test test/dashboard/entries-remote-atomic.test.mjs        23 tests,  23 pass, 0 fail
node --test test/dashboard/entries-id-contract.test.mjs          12 tests,  12 pass, 0 fail
node --test test/finance/vat-invariant.test.mjs                   5 tests,   5 pass, 0 fail
node --test test/emulator/safety.test.mjs                        12 tests,  12 pass, 0 fail
```

## Emulator suites

Three consecutive rounds, identical: authorization matrix 108/108, R10 concurrency 19/19,
Rules validation 30/30. Per-case detail in `EMULATOR_RESULTS.md`.

## The two broad commands, and exactly what each includes

**A — the repository's regression command.**

```
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs

# tests 689   # pass 689   # fail 0   # cancelled 0   # skipped 0   # todo 0
```

40 files under `test/` (624 tests) plus the production-readiness files (65 tests). Three
consecutive runs, identical. Baseline before this round: 658; the delta is the 31 new
stale-delete tests.

**B — `node --test test/**/*.mjs`.**

This glob matches 47 files: the same 40 test files plus seven that are not test files —
three emulator scripts and four harness modules:

```
test/emulator/entries-remote-atomic-emulator.mjs
test/emulator/entries-rules-validation-matrix.mjs
test/emulator/rtdb-authorization-matrix.mjs
test/support/cross-writer-harness.mjs
test/support/entries-id-offline-transformer.mjs
test/support/git-context.mjs
test/support/ui-call-site-harness.mjs
```

It also does **not** include `docs/production-readiness/test/*.test.mjs`, so it is neither
a superset nor a subset of A.

Run with no emulator, the three emulator scripts fail — by design, and the failure is
their own safety gate, not a regression:

```
node --test --test-concurrency=8 test/**/*.mjs
not ok 13 - test/emulator/entries-remote-atomic-emulator.mjs
not ok 14 - test/emulator/entries-rules-validation-matrix.mjs
not ok 15 - test/emulator/rtdb-authorization-matrix.mjs
# tests 631   # pass 628   # fail 3

$ node test/emulator/entries-rules-validation-matrix.mjs
SAFETY ABORT: GCLOUD_PROJECT must be demo-marjin-rules
```

Run inside an emulator and sequentially — each script reseeds the database root, so they
must not run concurrently — the same 47 files are fully green:

```
firebase emulators:exec --only database --project demo-marjin-rules \
  --config test/emulator/firebase.json \
  "node --test --test-concurrency=1 <the 47 files>"

# tests 631   # pass 631   # fail 0   # cancelled 0   # skipped 0
Script exited successfully (code 0)
```

The four harness modules contribute zero tests. `631 = 624 + 3 + 4`. Command A remains the
regression command; B is recorded here because it was asked for, and because the reason it
differs is worth knowing.

Neither command may be replaced by bare `node --test`, which sweeps in the reserved RTDB
emulator suite.

## Static checks

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 2, exactly **22** diagnostics, all `TS2742`, all in `src/firebase/refs.ts` — identical to the documented baseline, no new diagnostic, file or category |
| `git diff --check` | exit 0 |
| `database.rules.json` vs `test/emulator/database.rules.json` | byte-identical (the emulator harness aborts otherwise) |
| module import check | the two new emulator scripts import with no side effects; their gates run only on direct execution |

## Mutation probes on the S0 rules exception

The content-verified exception described in `RULES_VALIDATION.md` was probed three times.
Each probe was applied to the working tree, the guard was run, and the file was restored
byte-identically afterwards.

| Probe | Change | VAT guard |
|---|---|---|
| 1 | loosen an unrelated authorization rule (`roles` `.write` from `false` to `auth !== null`) | **FAIL** (4/5) |
| 2 | replace both added validators with the inert expression `true` | **FAIL** (4/5) |
| 3 | add an extra key under `$dataKey/_v` alongside the validator | **FAIL** (4/5) |
| — | restored | PASS (5/5) |

The exception admits the authorized addition and nothing else.

## Acceptance criteria

| Criterion | Result |
|---|---|
| Codex stale-delete reproduction no longer loses concurrent supplier changes | **PASS** (`SD-A`, `EMU-F-stale-delete-supplier`) |
| delete detects all meaningful target-row changes generically | **PASS** (`SD-B[...]` ×18, including an unknown and a brand-new field, and a removal) |
| unrelated-row changes do not cause false stale rejection | **PASS** (`SD-E`, `SD-E2`, `SD-E3`, `SD-D2`, `EMU-F-unrelated-row`) |
| valid delete still works | **PASS** (`SD-C`, `EMU-F-delete-unchanged`) |
| same-date sibling remains untouched | **PASS** (`SD-D`) |
| malformed authorized writes rejected by RTDB Rules | **PASS** (17 deny cases, including the three Codex proved and the child-path bypass) |
| legitimate R10 writes remain allowed | **PASS** (13 allow cases; authorization matrix 108/108; concurrency suite 19/19) |
| real emulator concurrency tests pass | **PASS** (19/19 ×3) |
| runtime transaction assumptions not weakened | **PASS** (retry, conflict, idempotency, id-collision, ownership, cold-cache all unchanged) |
| Labor UI green | **PASS** (14/14) |
| duplicate/delete green | **PASS** (10/10) |
| lifecycle green | **PASS** (112/112) |
| VAT guard green | **PASS** (5/5, assertions unchanged, exception content-verified) |
| broad suites have no unexplained failures | **PASS** (A 689/689; B's three failures explained and green under an emulator) |
