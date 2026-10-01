# 09 — Test results (cloud clone of the canonical repo, Node v22.22.2)

| Run | Command | Result |
|---|---|---|
| Baseline at `f5d0a8ed` | `node --test --test-concurrency=8 test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` | **880 / 880** |
| Baseline typecheck | `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | 22 × TS2742 (`src/firebase/refs.ts`), 0 other |
| Focused (scheduled auth) | `node --test test/security/scheduled-auth-matrix.test.mjs test/security/cron-auth-hardening.test.mjs test/security/cron-auth-source-invariants.test.mjs test/analytics/rebuild-rate-limiter.test.mjs test/security/security-context.test.mjs test/security/alerts-dispatch.test.mjs test/security/vercel-cron-routes.test.mjs` | **138 / 138** (breakdown below) |
| Full suite (candidate) | same full command | **965 / 965** (880 + 31 SYS-P0-001 + 54 matrix); 0 fail / cancelled / skipped |
| Typecheck (candidate) | same | 22 × TS2742, error list **byte-identical** to baseline (`api/**/*.ts` is in `tsconfig.include`) |
| Negative control | matrix run against `f5d0a8ed` route sources | **12 failures** (the P0 is detected) |
| `git diff --check` | — | clean |
| S0 runtime regex on added `api/lib/src/index.html` lines | — | 0 hits |

Focused breakdown:

| File | Result |
|---|---|
| matrix | 54 / 54 |
| cron-auth-hardening | 24 / 24 |
| source invariants | 7 / 7 |
| rebuild-rate-limiter | 1 / 1 |
| security-context | 21 / 21 |
| alerts-dispatch | 29 / 29 |
| vercel-cron-routes | 2 / 2 |

The Mac worktree re-run is recorded in the external handoff.

Not claimed:
- **Emulator:** the touched code involves no Rules or RTDB transaction.
- **Production:** no Production run of any kind.
