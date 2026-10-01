# 10 — Codex review guide

## Identity
| Item | Value |
|---|---|
| Branch | `claude/p0-scheduled-auth-release` |
| Parent | `f5d0a8edffc216f0b6ad342f8bd1bb0d630276ab` |
| Commit count | one commit on top of the parent (SHA in the external handoff) |
| Worktree | `~/Documents/marjin/kissgn-p0-scheduled-auth-release` |

## Verify first (the port claim)
1. `git diff --stat f5d0a8ed HEAD -- api lib src index.html database.rules.json vercel.json package.json` shows only the three route files.
2. `git rev-parse HEAD:api/analytics/daily-builder.ts HEAD:api/daily-snapshot/run.ts HEAD:api/proactive/run.ts` equals `git rev-parse 4ce7c842:<same paths>` (the approved SYS-P0-001 blobs).
3. `git diff --stat 088310c3 f5d0a8ed -- <the three routes> lib/securityContext.js lib/securityContext.d.ts lib/bizAccess.js lib/verifyToken.js lib/helpers.js lib/proactiveCore.js lib/alertsCore.js lib/apiScope.js lib/adminSdk.js src/firebase/admin.ts src/agent/proactive` is empty. Only `src/analytics/dailyBuilder.ts` and `src/snapshot/snapshotBuilder.ts` changed among the route dependencies (reader convergence).

## Then
4. `test/security/scheduled-auth-matrix.test.mjs`: the matrix of 05. Try running it against `f5d0a8ed` (negative control: 12 failures).
5. `03_RELEASE_BLOCKERS.md`: classification. Challenge whether J-01 (duplicate snapshot email) should be P0.
6. `06_RELEASE_MANIFEST.md` / `07_COORDINATED_DEPLOYMENT_PLAN.md`:
   - order: biz_access → promote → Rules ≤ 5 min → entry-ID apply;
   - the window placed outside cron hours;
   - the rollback note (ids decay under the July client);
   - the point of no simple return = entry-ID apply for this window, and V2 `migrate` for the canary.
7. `08_GATE0_DEPENDENCY_MAP.md`: remaining blockers.

## Out of scope / prohibited (not done)
- No push, merge, rebase or deploy.
- No Rules publication.
- No Production read or write.
- No Gate 0, EV-1, entry-ID remediation or `biz_access` mutation.
- No secret inspection or change.
- The Financial Core worktree was not touched.
