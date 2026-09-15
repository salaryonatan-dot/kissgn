# Regression — the previously accepted P0 evidence

## Full suite

```
node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
# tests 689   # pass 689   # fail 0   # cancelled 0   # skipped 0
```

Three runs, identical (two before the commit, one after). The count is unchanged from
R10.1 — V2 added no unit tests, because everything V2 claims is proven against the real
Rules engine and the real transaction protocol rather than a fake store.

## Focused suites

| Suite | Result |
|---|---|
| `entries-stale-delete.test.mjs` | 31 / 31 |
| `entries-lifecycle.test.mjs` | 112 / 112 |
| `entries-ui-call-sites.test.mjs` | 49 / 49 |
| `entries-labor-screen.test.mjs` | 14 / 14 |
| `entries-duplicate-delete.test.mjs` | 10 / 10 |
| `entries-concurrency-matrix.test.mjs` | 41 / 41 |
| `entries-clear-all-matrix.test.mjs` | 42 / 42 |
| `entries-topology-sentinel.test.mjs` | 14 / 14 |
| `entries-remote-atomic.test.mjs` | 23 / 23 |
| `entries-id-contract.test.mjs` | 12 / 12 |
| `finance/vat-invariant.test.mjs` | 5 / 5 |
| `emulator/safety.test.mjs` | 12 / 12 |

## Emulator suites

Authorization matrix 108/108 · R10 concurrency 19/19 · R10.1 rules validation 30/30 ·
Storage V2 32/32. Details in `EMULATOR_RESULTS.md`.

## Static checks

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 2, exactly 22 `TS2742`, all in `src/firebase/refs.ts` — the documented baseline, no new diagnostic |
| `git diff --check` | exit 0 |
| `database.rules.json` vs `test/emulator/database.rules.json` | byte-identical |
| new modules import cleanly, no side effects on import | yes (preflight, upgrade, V2 matrix) |

## Changed test assumptions — two, both documented

**1. `test/finance/vat-invariant.test.mjs` — the S0 rules exception was extended.**
`database.rules.json` remains a forbidden path. The content-verified exception, approved in
R10.1 for two validators, now also covers the three V2 validators at that same location.
It still requires: the rules tree with exactly the authorized additions removed is
deep-equal to the base; each addition carries a validator and nothing else beside it; the
row contract contains its identity clause (`newData.child('id').val() === $rowId`) and its
generation clause verbatim; and no addition is inert. **Every VAT assertion is unchanged.**

Three mutation probes, each applied to the working tree and then restored byte-identically:

| Probe | Change | Guard |
|---|---|---|
| 1 | loosen an unrelated authorization rule (`roles` `.write`) | **FAIL** (4/5) |
| 2 | delete the row identity clause from the row validator | **FAIL** (4/5) |
| 3 | smuggle an extra child rule under `rows/$rowId` | **FAIL** (4/5) |
| — | restored | PASS (5/5) |

**2. `tools/storage-v2/preflight.mjs` — a comment was reworded, not a test changed.**
The TEST-ONLY boundary test (`entries-id-contract.test.mjs`) walks the repository for any
non-test file referencing the offline entry-id transformer by filename. The preflight
originally cited that path in a comment. It now names the approved *action* instead, so the
boundary test keeps its full strength and is not excluded or narrowed. 12/12.

## No test was deleted or weakened

No legacy-mode test was removed. Every R10 / R10.1 invariant runs unchanged, and the legacy
engine, the legacy rules and the legacy read path are all still exercised — `V2-L01` adds a
direct legacy read/write check on top, so legacy mode is now covered in the emulator too.
