# Test Results — Storage V2 Hardening R1

All runs on the candidate working tree (child of `cb8ac84e`), local RTDB emulator
v4.11.2 (project `demo-marjin-rules`, `127.0.0.1:9000`, Temurin JDK 21), no Production or
Preview access. Raw logs in `logs/` (paths rewritten to the host worktree path).

## Emulator — three consecutive rounds, scripts run one at a time

| Suite | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| `storage-v2-matrix.mjs` (32 → **42** cases) | 42/42 exit 0 | 42/42 exit 0 | 42/42 exit 0 |
| `storage-v2-rules-guard-mutations.mjs` (new, 12) | 12/12 | 12/12 | 12/12 |
| `rtdb-authorization-matrix.mjs` | 108/108 (allow 37 / deny 71; 0 unexpected, 0 errored) | same | same |
| `entries-remote-atomic-emulator.mjs` (R10, incl. R9 negative control) | 19/19 | 19/19 | 19/19 |
| `entries-rules-validation-matrix.mjs` (R10.1 legacy) | 30/30 (allow 13 / deny 17) | 30/30 | 30/30 |

The final matrix file was additionally run three more consecutive times after its last
edit (`logs/storage-v2-matrix-3-consecutive-rounds.log`): 42/42 ×3.

Storage V2 matrix areas: legacy 1, preflight 4, cutover 5 (`V2-M04` now a real ETag barrier:
`runs=2`, one HTTP 412), identity 8, concurrency 5, generation 5, compatibility 3,
authorization 1, hardening `V2-H01…H10` 10.

## Normal suite (`node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs`)

| | tests | pass | fail | cancelled | skipped |
|---|---:|---:|---:|---:|---:|
| Complete suite (689 → **719**) | 719 | 719 | 0 | 0 | 0 |

Focused (all contained in the complete suite):

| Suite | Result |
|---|---|
| `entries-storage-v2-hardening.test.mjs` (new) | 30/30 |
| `entries-stale-delete.test.mjs` | 31/31 |
| `entries-labor-screen.test.mjs` | 14/14 |
| `entries-duplicate-delete.test.mjs` | 10/10 |
| `entries-lifecycle.test.mjs` | 112/112 |
| `entries-remote-atomic.test.mjs` | 23/23 |
| `entries-concurrency-matrix.test.mjs` | 41/41 |
| `entries-clear-all-matrix.test.mjs` | 42/42 |
| `entries-ui-call-sites.test.mjs` | 49/49 |
| `vat-invariant.test.mjs` (S0) | 5/5 |

## TypeScript
`tsc --noEmit -p .`: exit 2 with exactly 22 `TS2742` in `src/firebase/refs.ts` — the
unchanged symlinked-`node_modules` baseline; `--preserveSymlinks`: exit 0. No new
diagnostics.

## Hygiene
`git diff --check` clean; no emulator artefacts (`database-debug.log`, `.fuse_hidden*`) in
the repository (emulator run from a scratch directory); untracked output only
`node_modules` (symlink) and the new tracked files listed in CHANGE_SUMMARY.md.
