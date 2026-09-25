# TEST RESULTS — Version Fence R1 (worktree `kissgn-p0-data-01-version-fence`, candidate tree)

## Focused (node --test)
| suite | tests | result |
|---|---|---|
| `test/security/storage-policy-parity.test.mjs` (new) — parser side of the canonical contract, >100 invalid fixtures/mutants, FENCE_GUARD literal conjuncts | 4 | pass |
| `test/security/delete-client-maintenance.test.mjs` (new) — real `api/admin.js`, cases A–G | 7 | pass |
| `test/storage-v2/policy-revision-boundary.test.mjs` (new) — 8 bumping paths at MAX−1 / MAX, primitives, next-record validation, concurrency + cold cache | 5 | pass |
| `test/security/storage-policy.test.mjs`, `test/storage-v2/policy-control.test.mjs`, `test/dashboard/entries-version-fence.test.mjs`, `test/security/entry-exceptions-maintenance.test.mjs` | 5 · 6 · 10 · 3 | pass |
| `test/dashboard/entries-storage-v2-hardening.test.mjs` ([H10] two-layer + fence mutations against the R1 literal), `test/finance/vat-invariant.test.mjs` (R1 blob pin), `test/finance/s0-guard-server-reader-mutations.test.mjs`, `test/typescript/js-declaration-parity.test.mjs` | 30 · 5 · 9 · 12 | pass |
| production wiring, lifecycle, stale delete, duplicate delete, Labor UI, decimal aggregation, reader suites | — | pass (inside the full suite, unchanged) |

## Emulator (real RTDB Rules engine / real Admin transport; one script at a time)
| script | result |
|---|---|
| `storage-policy-parity.mjs` (new) | **708/708 × 3** — `invalid_fixtures=695 valid_fixtures=13` |
| `storage-v2-rules-guard-mutations.mjs` (20 → 26) | **26/26 × 3** |
| `admin-maintenance-gate.mjs` (new) | **8/8 × 3** |
| `historical-page-version-fence.mjs` (new, rendered historical page @1038b4cd) | **5/5 × 3** |
| `storage-v2-version-fence.mjs` (26 → 27, +VF-27 revision boundary) | **27/27 × 3** |
| `storage-v2-matrix.mjs` | 46/46 × 2 |
| `rtdb-authorization-matrix.mjs` | 128/128 (`expected_allow=41 expected_deny=87`) |
| `entries-rules-validation-matrix.mjs` | 30/30 |
| `server-readers-matrix.mjs` | 12/12 — identical behaviour |
| `entries-remote-atomic-emulator.mjs` | 19/19 |

## Full suite
```
shopt -s globstar; node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs
# tests 836   # pass 836   # fail 0   # cancelled 0   # skipped 0
```
(820 at `09370d49` + 16 new.)

## Static gates
`tsc -p . --noEmit`: exit 2, exactly 22 `TS2742` (baseline) · `git diff --check` clean · S0 added-line regex over `index.html api lib src`: no match · `index.html` unchanged · five reader pins byte-identical; `git diff 09370d49 -- src vercel.json api/version.js tools/storage-v2/upgrade.mjs package.json package-lock.json index.html` empty · Rules blob `1e5dea2f…` = `APPROVED_FENCE_RULES_BLOB`; emulator mirror byte-identical.
