# Rollback Plan (Phase 6)

No rollback command is executed here. Each surface below lists trigger, artifact to
restore, reversibility, window, and post-rollback verification.

## 1. Vercel frontend + API
- **Trigger:** mass PERMISSION_DENIED for legitimate users, `/api/admin` 5xx spike,
  broken dashboard/checklist, or any smoke-test P0/P1 failure.
- **Restore:** re-promote the previous Production deployment (git commit `0130e66`) via
  Vercel "Promote to Production" / instant rollback to the prior deployment alias target.
- **Reversible:** yes, fully (static + serverless are immutable deployments; alias flip).
- **Window:** minutes (alias re-point).
- **Verify:** `https://kissgn.vercel.app` serves the old build; smoke of login + dashboard.

## 2. Firebase RTDB Rules
- **Trigger:** legitimate users locked out (missing biz_access), OR unexpectedly permissive
  behavior detected.
- **Restore:** redeploy the previously captured Rules version (recorded in
  production-baseline.md step 3) via Firebase Console → Database → Rules → revert to the
  prior published version (Firebase retains Rules history).
- **Reversible:** yes (Rules are versioned; revert is instant). No data is changed by a
  Rules revert.
- **Window:** minutes.
- **Verify:** re-run the emulator matrix intent spot-checks against the reverted Rules;
  confirm legitimate role/business access restored.
- **Coupling:** roll back Rules and frontend **together** (same incompatibility as forward).

## 3. biz_access backfill
- **Trigger:** backfill granted access incorrectly (wrong biz/user), or introduced
  cross-business exposure.
- **Restore:** the backfill tool writes a per-run change log; revert by removing the
  exact grants it added (operator tool supports a reconcile/cleanup mode). Only remove
  grants the backfill created — never pre-existing ones.
- **Reversible:** partially — added grants are removable; but if users acted under the new
  access, their data writes are **not** auto-reversible (see below).
- **Window:** same-day preferred.
- **Verify:** re-run `biz-access-audit.mjs`; confirm coverage matches the intended state.

## 4. Checklist / server-mediated API
- **Trigger:** version-token CAS regressions, 409 storms, or lost checklist writes.
- **Restore:** roll back the Vercel deployment (surface 1) to `0130e66`; the previous
  `api/admin.js` behavior returns. Checklist docs use version-token CAS — no schema
  migration to undo.
- **Reversible:** code path yes. Any checklist docs already written under the new flow
  remain (they are valid documents; not automatically reverted).
- **Window:** minutes.

## 5. Analytics / alert checkers
- **Trigger:** false alerts, missing alerts, or cron errors after deploy.
- **Restore:** roll back the Vercel deployment (surface 1). The strict-validation checker
  reverts to the previous behavior. **No analytics regeneration** is performed either way.
- **Reversible:** yes (code only). Alert emails already sent are **not** reversible — mitigate
  by pausing the `alerts/run` cron (Vercel cron disable) if needed before rollback.
- **Window:** before the next cron tick (alerts 04:00, proactive 03:00, daily-builder 23:00).

## Non-automatically-reversible data
- Emails/WhatsApp already sent (alerts/whatsapp crons).
- User writes performed under newly-granted biz_access.
- Checklist/entry documents written under the new flow (valid, but not auto-reverted).
Mitigation: keep the maintenance window short, pause mutating crons during the window,
and verify smoke tests before opening to all users.
