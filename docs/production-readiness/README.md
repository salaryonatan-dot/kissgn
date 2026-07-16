# Marjin Foundation Release — Production Readiness Plan

Read-only planning artifacts for promoting `main` (HEAD `a499c8d`, 26 commits ahead
of `origin/main` `0130e66`) to Production. Nothing here deploys, writes, or mutates.

| File | Purpose |
|---|---|
| `production-baseline.md` | Current Production baseline + read-only verification steps |
| `release-delta.md` | The 26-commit delta, classified by area and deployment surface |
| `biz-access-audit.mjs` | READ-ONLY biz_access coverage audit (operator-run) |
| `biz-access-dry-run.md` | biz_access classifications + dry-run backfill format |
| `analytics-audit.mjs` | READ-ONLY analytics coverage audit (operator-run) |
| `analytics-coverage.md` | Analytics coverage classifications |
| `release-order.md` | Exact coordinated release sequence + incompatibility windows |
| `rollback-plan.md` | Per-surface rollback triggers, artifacts, reversibility |
| `smoke-tests.md` | Post-deploy authenticated smoke tests |
| `go-no-go-checklist.md` | Mandatory go/no-go gates |

The two `*-audit.mjs` scripts must be run by an authenticated operator with
**read-only** Firebase access; they perform only `.once("value")` reads and write
no data. They were NOT executed in the planning environment (no Production
credentials there).
