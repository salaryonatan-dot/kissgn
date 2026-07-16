# Release Order (Phase 5, corrected)

## Actual Vercel deployment structure (verified from vercel.json)
This repo is a **single Vercel project**: the serverless functions under `api/**` and
the static frontend (`index.html`, `landing.html`) build and deploy as **one immutable
Vercel artifact**. There is **no** mechanism to promote the API separately from the
frontend — a promotion swaps the entire deployment (functions + static + crons) atomically.
The earlier "deploy API first, frontend later" step was fictional and is removed.

The two coordinated surfaces are therefore:
1. the **Vercel deployment** (API + frontend + crons, one artifact), and
2. the **Firebase RTDB Rules** (`database.rules.json`), deployed separately via Firebase.

## Incompatibility analysis
| Scenario | Result | Why |
|---|---|---|
| NEW Vercel artifact (frontend+API) under OLD (permissive) Rules | **OK** | New frontend uses server-mediated `/api/admin` (Admin SDK bypasses Rules) for parameterized data and direct RTDB for fixed biz keys; old permissive Rules still allow member access. Isolation simply not-yet-enforced (== current Production state). |
| OLD Vercel artifact (frontend) under NEW (restrictive) Rules | **BREAKS / LOCKOUT** | Old frontend writes biz-scoped data by direct RTDB; new Rules require `biz_access`. Managers/shift_managers/viewers without grants get PERMISSION_DENIED. |
| New API under old data model | OK | Same biz-scoped keys; version-token CAS + strict validation are backward-tolerant. |
| New Rules before biz_access backfill | **LOCKOUT** | scoped users without grants lose access. |

**Conclusion:** deploy **Vercel-first, then Rules** — the new frontend tolerates old Rules,
but the old frontend does NOT tolerate new Rules. Vercel-first yields the strictly smaller,
safer compatibility window (a brief period of not-yet-enforced isolation, identical to
today's Production posture). Keep the gap between the two deploys short. Both are gated on
biz_access coverage being green.

## Preferred safe sequence
- **A. Live read-only baseline + coverage audits.** Operator (read-only creds) runs
  `biz-access-audit.mjs` and `analytics-audit.mjs`, and verifies the Production baseline.
- **B. Approve + execute biz_access backfill separately, only if needed.** If the audit
  reports NEEDS_BACKFILL/AMBIGUOUS/ORPHANED/UNKNOWN/MISSING, obtain separate written
  authorization and run `scripts/backfill-biz-access.mjs` (dry-run first). Re-run the audit
  until coverage is green. **This audit proposes additive grants only and never removes.**
- **C. Create one Vercel deployment (API + frontend) from the release HEAD.** Build the
  single artifact; do not promote yet.
- **D. Validate in Preview if possible WITHOUT Production mutation.** CAVEAT: a Vercel
  Preview deployment uses the project's environment variables and therefore hits the SAME
  Firebase project as Production unless a separate preview Firebase project is configured.
  In Preview, run only READ-ONLY / login smoke; do NOT run mutating flows against Production
  data. If a dedicated preview Firebase project exists, full smoke is safe there.
- **E. Coordinated Production window (short):**
  1. Promote the Vercel artifact to Production (frontend + API + crons swap atomically).
  2. Immediately deploy the restrictive `database.rules.json` via Firebase.
  Order is **Vercel-first, then Rules** (smaller window; see analysis above). Announce brief maintenance.
- **F. Immediate authenticated smoke tests** (smoke-tests.md) across roles + isolation.
- **G. Rollback thresholds** (rollback-plan.md): cross-tenant/business exposure (P0/P1),
  mass PERMISSION_DENIED for legitimate users (P1), cron failures, or unexpected mail/mutation.

## If a true partial/preview mechanism exists
Only use one if documented for this project (e.g., a separate preview Firebase project, or
Firebase Rules staging). Do not assume it. As configured (single Vercel project, one Firebase
project referenced by env), treat deployment as the atomic Vercel-artifact + Rules pair above.
