# SYS-P0-001 — Scope Compliance

## Allowed edits (only these)
- **Runtime:** `api/analytics/daily-builder.ts`, `api/daily-snapshot/run.ts`,
  `api/proactive/run.ts` — edited.
- **Tests:** `test/security/cron-auth-hardening.test.mjs` (new),
  `test/security/cron-auth-source-invariants.test.mjs` (new),
  `test/analytics/rebuild-rate-limiter.test.mjs` (updated).
- **Artifacts:** `artifacts/p0-cron-auth-r1/` (8 files).

`git diff --name-status 088310c3 HEAD` = `M` on the 3 routes + the rebuild test,
`A` on the 2 new tests + `artifacts/p0-cron-auth-r1/*`. Nothing else.

## Explicitly NOT changed (verified)
- `lib/securityContext.js` and `lib/securityContext.d.ts` — **byte-identical to
  R5** (`git diff` empty). The reusable-helper allowance was NOT needed;
  `requireCron`/`requireBizContext`/`requireBizAccess` already sufficed and the
  owner-tier gate is enforced in-route. This keeps the js/.d.ts export-parity
  guard green.
- `lib/bizAccess.js`, `lib/alertsCore.js`, `api/alerts/run.ts` — unchanged.
- `package.json`, `package-lock.json` — byte-identical to R5.
- `vercel.json` (cron declarations), `database.rules.json`, `index.html`,
  entries-lifecycle code/tests, RTDB schema/paths, all other api/lib/src files —
  unchanged.

## Prohibitions honored
No new/changed secret; `CRON_SECRET` is only READ via the existing helper, never
created, logged, or embedded. No push / merge / rebase / squash / deploy. No
Firebase / RTDB / production / external-provider / network call. No real emails,
no real scheduled-job or backfill execution, no production data touched. No
Firebase Rules / permissions / credentials change. No dependency install or
upgrade. R5, R6, and the canonical worktrees were not modified. Exactly one new
local commit on the R1 branch. The guarded RTDB emulator test was not invoked
(the explicit glob was used instead). No secret or full Authorization header is
logged by any edited route.

## Authorization-model integrity
No client-supplied tenant / business / uid / role / membership / `allowedBizIds`
can establish or widen authorization on any edited path; all are validated or
derived server-side (`requireCron` for scheduled, `requireBizContext` /
`requireAuth`+`requireTenantAccess`+server `biz_access` for manual). Proven by
`test/security/cron-auth-hardening.test.mjs`.

## Read-only worktrees / canonical (unchanged this task)
| Ref | Expected |
|---|---|
| R5 base | `088310c3…` |
| R1 worktree HEAD before commit | `088310c3…` |
No modifications were made outside the R1 worktree.
