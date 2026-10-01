# SYS-P0-001 — Test Results

Local, offline, non-production, in the R1 worktree (branch
`claude/p0-cron-auth-r1`, base `088310c3`). No dependency install; no Firebase /
RTDB / email / provider / network call. Terminal deps are in-memory stubs; the
real `requireCron` / `requireBizContext` / `requireBizAccess` from
`lib/securityContext.js` (+ `lib/bizAccess.js`) are exercised for real.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `node --test test/security/cron-auth-hardening.test.mjs` | 0 | **24 pass / 0 fail** |
| 2 | `node --test test/security/cron-auth-source-invariants.test.mjs` | 0 | **7 pass / 0 fail** |
| 3 | `node test/analytics/rebuild-rate-limiter.test.mjs` | 0 | **35 pass / 0 fail** |
| 4 | `node --test test/security/*.test.mjs test/analytics/*.test.mjs test/typescript/*.test.mjs` | 0 | **287 pass / 0 fail** |
| 5 | `node --test test/**/*.test.mjs docs/production-readiness/test/*.test.mjs` (`--test-concurrency=8`) | 0 | **425 pass / 0 fail** |
| 6 | `./node_modules/.bin/tsc --noEmit` | 2 | 22 `TS2742` (all `src/firebase/refs.ts`; 0 new/changed) |
| 7 | `./node_modules/.bin/tsc --noEmit --preserveSymlinks` | 0 | clean |
| 8 | `git diff --check 088310c3 HEAD` | 0 | clean |

Full-suite baseline reconciliation: R5 = 394 → R1 = 425 (+31 = 24 hardening +
7 source-invariants; the rebuild-rate-limiter file gained 2 internal cases but
counts as one node:test entry). No pre-existing test was lost or disabled.

## Executable route-auth cases (the finding's primary proof)

### daily-builder (scheduled cron / backfill / manual rebuild / diagnostic)
| Case | Expect |
|---|---|
| GET spoofed `x-vercel-cron` only | 401; `buildAnalyticsForAll` NOT called |
| GET random `x-vercel-cron` value | 401 |
| GET missing `Authorization` | 401 |
| GET wrong bearer | 401; no scan |
| GET `CRON_SECRET` missing (fail-closed) with bearer | 401; no scan |
| GET correct Bearer `CRON_SECRET` | 200; scan runs |
| POST backfill spoofed cron header vs correct Bearer | 401 no build / 200 build |
| rebuild: no verified user | 401; no build |
| rebuild: wrong tenant (RBAC throws) | 403; no build |
| rebuild: client body `role:"owner"`+`allowedBizIds` vs server manager w/o grant | 403 `business_access_denied`; no build |
| beecomm_diagnose spoofed cron vs correct Bearer | 401 (no `fetchBeecommDaily`) / not-401 |

### daily-snapshot (scheduled cron / manual owner email)
| Case | Expect |
|---|---|
| GET spoofed `x-vercel-cron` only | 401; no build, no email |
| GET correct Bearer | 200; `buildSnapshotForAll` runs |
| POST verified owner | 200; email sent |
| POST viewer role | 403; no email |
| POST unauthenticated | 401; no email |
| POST manager WITHOUT biz grant | 403; no email |
| POST client body `role:"owner"` over server manager | 403 `owner_role_required`; no email |

### proactive (scheduled full scan / manual owner scan)
| Case | Expect |
|---|---|
| GET spoofed `x-vercel-cron` only | 401; no job |
| GET correct Bearer | 200; `runProactiveJob` runs |
| POST verified owner | 200; `runForBiz` runs |
| POST viewer role | 403; no job |
| POST unauthenticated | 401; no job |
| PUT (unsupported method) | 405 before any side effect |

### Source invariants (regression guards)
Repo-wide scan of `api/`, `lib/`, `src/` (comments stripped) finds `x-vercel-cron`
in ZERO code conditions; each route imports/calls `requireCron` and defines no
local `verifyAuth`; manual snapshot/proactive gate on owner/super_owner; the
alerts route/core remain hardened.
