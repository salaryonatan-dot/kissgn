# Test Results — Storage V2 Hardening R2

All on the candidate working tree (child of `6c879b66`), local RTDB emulator v4.11.2
(`demo-marjin-rules`, `127.0.0.1:9000`, Temurin JDK 21), no Production/Preview access.
Raw logs in `logs/` (paths rewritten to the host worktree path; trailing whitespace stripped).

## Focused (all inside the full suite)
| Suite | Result |
|---|---|
| `entries-storage-v2-production-wiring.test.mjs` (new): B1 A–H + legacy, B2 A–F, B3 unit + runtime | 15/15 |
| `entries-storage-v2-hardening.test.mjs` (R1) | 30/30 |
| `entries-stale-delete.test.mjs` | 31/31 |
| `entries-labor-screen.test.mjs` | 14/14 |
| `entries-duplicate-delete.test.mjs` | 10/10 |
| `entries-lifecycle.test.mjs` | 112/112 |
| `vat-invariant.test.mjs` (S0) | 5/5 |
| `entries-ui-call-sites.test.mjs` | 49/49 |
| `entries-remote-atomic.test.mjs` / concurrency / clear-all matrices | 23/23 · 41/41 · 42/42 |

## Full suite
`node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs`
→ **734/734** (719 + 15), 0 fail / 0 cancelled / 0 skipped (`logs/r2-full-1.log`).

## Emulator (scripts one at a time; consecutive rounds)
| Suite | Rounds | Result |
|---|---|---|
| `storage-v2-matrix.mjs` (42 → **46**: + `V2-W01…W04`) | 4 (`r2-matrix-1`, `r2-emu-r1/r2/r3`) | 46/46 each |
| `storage-v2-rules-guard-mutations.mjs` | 3 (`r2-emu-r1/r3/r4`) | 12/12 each |
| `rtdb-authorization-matrix.mjs` | 3 (`r2-emu-r1/r3/r5`) | 108/108 (allow 37 / deny 71; 0 unexpected) each |
| `entries-remote-atomic-emulator.mjs` | 3 (`r2-emu-r2/r4/r5`) | 19/19 each |
| `entries-rules-validation-matrix.mjs` | 3 (`r2-emu-r2/r4/r5`) | 30/30 each |

## TypeScript / hygiene
`tsc --noEmit -p .`: exit 2, exactly 22 `TS2742` (unchanged symlinked-`node_modules` baseline).
`git diff --check` (excluding raw logs) clean; no emulator artefacts in the repository;
untracked output only `node_modules` (symlink) + the new tracked files.
