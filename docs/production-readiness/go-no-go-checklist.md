# Go / No-Go Checklist (Phase 8)

No deployment proceeds until every mandatory gate is GREEN. Owner/operator sign-off required.

| # | Mandatory gate | Green when | Status |
|---|---|---|---|
| 1 | Production baseline verified | Vercel prod deployment == git `0130e66`; alias `kissgn.vercel.app`; Rules version captured | ☐ (operator, read-only) |
| 2 | biz_access coverage known | `biz-access-audit.mjs` run per tenant; categories tallied | ☐ (operator) |
| 3 | Backfill reviewed + separately approved | if any NEEDS_BACKFILL/AMBIGUOUS/ORPHANED: dry-run reviewed and written authorization obtained | ☐ |
| 4 | Analytics coverage acceptable | `analytics-audit.mjs` run; only READY/INSUFFICIENT_HISTORY for active businesses (both fail-safe) | ☐ (operator) |
| 5 | API deployment artifact identified | Vercel build of HEAD `a499c8d`; 12 functions; no new function | ☐ |
| 6 | Frontend artifact identified | same deployment's `index.html` build | ☐ |
| 7 | Rules artifact fingerprinted | local `database.rules.json` (matches `test/emulator/database.rules.json`, emulator matrix 108/108 PASS) | ☐ |
| 8 | Rollback artifacts available | prior Vercel deployment (`0130e66`) promotable; prior Rules version retained | ☐ |
| 9 | Smoke-test identities available | synthetic owner/manager/shift/viewer/no-access/cross-tenant identities ready | ☐ |
| 10 | Maintenance/deploy window chosen | short window; announced; before/after cron ticks accounted for | ☐ |
| 11 | Owner/operator approval obtained | explicit go from the release owner | ☐ |

## Sequencing reminders
- API/server (step 1 of release-order) may go first — no lockout risk.
- Restrictive Rules + new frontend go together, and ONLY after gates 2–4 (biz_access + analytics) are green.
- If gate 3 (backfill authorization) is not obtained, hold the Rules+frontend window.

## Pre-verified in the release candidate (already green in CI/local/host)
- TypeScript compile: 0 diagnostics.
- Security/regression test suites: pass.
- Firebase RTDB authorization matrix (host emulator): 108/108 PASS, 0 unexpected allow/deny.
- API function count: 12 (unchanged).
