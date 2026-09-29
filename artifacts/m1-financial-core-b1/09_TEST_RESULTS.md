# 09 — Test results

## Cloud (authoritative run for this candidate; fresh `TMPDIR` per run)
| Check | Command | Result |
|---|---|---|
| New tests | `node --test test/finance/b1-*.test.mjs` | **101/101** (97 + R1 B1R1-01/02, AT-16, AT-18) |
| Focused | 7 new files + E5–E8, E10, VERIFY parity, `fincore-guards`, `s0-guard-server-reader-mutations`, `vat-invariant` | **150/150** |
| Full suite | `node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | **1299/1299** (BASE 1198 + 101), 0 fail / cancelled / skipped, ≈ 174 s |
| TypeScript | `tsc -p tsconfig.json --noEmit` | 22 × TS2742, all `src/firebase/refs.ts` — identical to BASE; **0 new diagnostics** |
| Generated artifact | G-B1 / GUARD-08 | `fincore/v1` byte-identical to a fresh generation (tsc 5.9.3) |
| Whitespace | `git diff --check` | clean |
| Diff scope | `git diff --name-only 213fb350` | 46 files = 45 manifest + 1 VERIFY (01); RETAIN set untouched |
| Emulator | local RTDB emulator (`demo-marjin-rules`, 127.0.0.1:9000, no credentials) `node test/emulator/server-readers-matrix.mjs` | **13/13** (SR-01…13) |
| Emulator | `node test/emulator/canary-operator-matrix.mjs` | **18/18** |

Emulator note: in the cloud sandbox `firebase emulators:exec` could not upload the rules through the egress proxy, so the same pinned emulator JAR (`firebase-database-emulator-v4.11.2`) was started directly on 127.0.0.1:9000 and the canonical Rules were loaded locally; the matrix scripts' own safety checks (demo project, emulator host, no credentials, byte-identical Rules copy) all passed.

## Performance (API-24; report-only, no threshold set)
| Fixture | Series (90 d) | Month report | Latest date |
|---|---:|---:|---:|
| EV-1 max: 213 rows over ≥ 3 years (standalone) | 12.6 ms | 11.5 ms | 19.8 ms |
| 3-year daily stress: 1,100 rows (standalone) | 46.7 ms | 17.6 ms | 26.5 ms |
| same, under `--test-concurrency=8` (focused run) | 36.4 / 190.2 ms | 1.8 / 40.4 ms | 90.9 / 112.6 ms |

## Mac
The Mac worktree is created from a git bundle of this exact commit; its focused / full (chunked with a file manifest, fresh `TMPDIR`) / tsc results are recorded in the Codex handoff (B1: `~/Documents/marjin-reviews/2026-09-29/financial-core-b1/00_CODEX_HANDOFF.md`; R1: `~/Documents/marjin-reviews/2026-09-29/b1-remediation-r1/`), because they are produced after this commit exists.
