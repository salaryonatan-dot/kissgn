# Marjin Foundation Release — Production Readiness Plan

Read-only planning artifacts for promoting local `main` to Production. Nothing here
deploys, writes to Production, or mutates state.

## Boundaries (not hardcoded — verify live)
- Production baseline: `origin/main` = `0130e66a6830c40c60cab25d5308356e222d24f5`.
- Readiness-documentation HEAD advances with each docs commit — check `git rev-parse HEAD`.
- Runtime release boundary = current tree of `index.html`, `database.rules.json`, `api/**`,
  bundled `lib/**`+`src/**`; docs/test/tooling commits do not change it.

## Files
| File | Purpose |
|---|---|
| `production-baseline.md` | Baseline + read-only verification steps |
| `release-delta.md` | Delta by area/surface; runtime vs non-runtime boundary |
| `lib/biz-access-model.mjs` | PURE biz_access parser/classifier (no Firebase) |
| `lib/analytics-model.mjs` | PURE analytics enumeration/coverage classifier (no Firebase) |
| `lib/redact.mjs` | Deterministic non-reversible redaction |
| `biz-access-audit.mjs` | Thin READ-ONLY CLI over the biz_access model |
| `analytics-audit.mjs` | Thin READ-ONLY CLI over the analytics model |
| `biz-access-dry-run.md` / `.json` | biz_access classifications + redacted dry-run format |
| `analytics-coverage.md` | Analytics coverage classifications |
| `release-order.md` | Coordinated sequence (single Vercel artifact + Rules) |
| `rollback-plan.md` | Per-surface rollback |
| `smoke-tests.md` | Post-deploy authenticated smoke tests |
| `go-no-go-checklist.md` | Mandatory gates |
| `test/biz-access-audit.test.mjs` | Synthetic tests for the biz_access model |
| `test/analytics-audit.test.mjs` | Synthetic tests for the analytics model |
| `output/` | Local-only destination for redacted dry-run files (git-ignored content) |

## Safety
- Both CLI audits **never write to Production**: only `.once("value")` reads; no
  set/update/push/remove/transaction; no POST/PUT/PATCH/DELETE; no write-capable flag; no
  auto-remediation; no metadata init; no raw-snapshot logging; no secret printing.
- Output is redacted by default (non-reversible hashes + source indexes). A local file is
  written only with an explicit `--out` under `docs/production-readiness/output/` or `/tmp`,
  and is NOT directly executable as a Production write payload.
- Pure models + tests run with no Firebase and no network (import-safe; `main()` runs only on
  direct execution). Run: `node --test docs/production-readiness/test/*.test.mjs`.
- The audits were NOT executed against live data in the planning environment (no credentials).
