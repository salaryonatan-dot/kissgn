# TEST RESULTS — Version Fence P0 (worktree `kissgn-p0-data-01-version-fence`, uncommitted tree = candidate)

## Focused (node --test)
| suite | tests | result |
|---|---|---|
| `test/security/storage-policy.test.mjs` (new): parser fail-closed matrix, `decideEntriesAccess` every policy × mode cell, admin admission, transition table, `planTransition` | 5 | pass |
| `test/storage-v2/policy-control.test.mjs` (new): happy path, VF-21, VF-22 (interleaved CAS), VF-23, VF-11/25 + native, SDK cold-cache probe | 6 | pass |
| `test/dashboard/entries-version-fence.test.mjs` (new): browser/lib parity, source pins, VF-02, VF-12, VF-14/15/16 client, v2_without_policy/conversion_pending, policy change/`policy_changed`/quiesce, VF-08 switch, foreground/online/rollback, server-denied race | 10 | pass |
| `test/security/entry-exceptions-maintenance.test.mjs` (new, real `api/admin.js`): admitted phases, 423 refusals, ordering after authorization | 3 | pass |
| `test/dashboard/entries-storage-v2-production-wiring.test.mjs` (policies seeded; B1-H pin updated) | 15 | pass |
| `test/dashboard/entries-storage-v2-hardening.test.mjs` ([H10] two-layer + 13 fence mutations) | 30 | pass |
| `test/finance/vat-invariant.test.mjs` (Layer A fence delta + blob pin; Layer B projection) | 5 | pass |
| `test/finance/s0-guard-server-reader-mutations.test.mjs` (raw verdict positive control) | 9 | pass |
| `test/typescript/js-declaration-parity.test.mjs` (+ `lib/storagePolicy`) | 12 | pass |
| lifecycle / stale delete / duplicate delete / Labor UI / server reader (reader, parity, D1, dailybuilder, snapshot, exceptions, checkers, decimal aggregation) | — | pass (inside full suite, unchanged) |

## Emulator (real RTDB Rules engine, one script at a time)
| script | result |
|---|---|
| `storage-v2-version-fence.mjs` VF-01…VF-26 (new) | **26/26 × 3 rounds** — `total=26 passed=26 failed=0 — ALL CASES PASSED` |
| `storage-v2-rules-guard-mutations.mjs` (12 → 20 mutations, two-layer guard) | **20/20 × 3** — `mutations=20 proven_weakening_and_guard_rejected=20 failed=0` |
| `storage-v2-matrix.mjs` (policies seeded, Admin-lane conversions, client conversion asserted denied, unfenced init asserted denied) | **46/46 × 3** |
| `rtdb-authorization-matrix.mjs` (+20 `storage_v2_control` cases) | **128/128 × 2** — `expected_allow=41 expected_deny=87` |
| `server-readers-matrix.mjs` (unchanged) | **12/12 × 3** — identical behaviour |
| `entries-remote-atomic-emulator.mjs` | 19/19 × 2 |
| `entries-rules-validation-matrix.mjs` | 30/30 |

## Full suite
```
shopt -s globstar; node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
# tests 820   # pass 820   # fail 0   # skipped 0   # todo 0
```
(795 at `47f7f888` + 25 new/expanded.)

## Static gates
- `tsc -p . --noEmit`: exit 2 with exactly 22 `TS2742` (baseline unchanged, no other errors).
- `git diff --check`: clean.
- S0 added-line regex (`migration|migrate|_rtdbSet|storage\.set|set\(ref|remove\(ref|persist\(|entries\s*=`) over `index.html api lib src` added lines and the new files: no match.
- Five reader pins byte-identical to `47f7f888` (`a327186c`, `301f9599`, `33a646e9`, `6a3f9be2`, `e36df4d8`); `git diff 47f7f888 -- src vercel.json api/version.js tools/storage-v2/upgrade.mjs package.json package-lock.json` empty.
- Rules blob `11799bd7e0560caf8d6b5512b4694f6ee865fa6b` = `APPROVED_FENCE_RULES_BLOB`; emulator mirror byte-identical.

## Fixed while proving on the real emulator
- `tools/storage-v2/policy.mjs`: Firebase transaction cold-cache first run (`null`) made every transition on an existing record abort as `stale_revision` — added the no-op probe + vanished-record detection (unit test #6, VF-21…26 green afterwards).
- Fence matrix: the production legacy engine needs a live listener (as a real page has) to run its CAS against the node.
