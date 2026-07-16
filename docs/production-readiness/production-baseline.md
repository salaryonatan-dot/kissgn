# Production Baseline (Phase 1)

## Known baseline (to be verified read-only by an authenticated operator)
- **Production alias:** https://kissgn.vercel.app
- **Production source baseline:** `0130e66a6830c40c60cab25d5308356e222d24f5` (== `origin/main`)
- **Release candidate HEAD:** `a499c8de29ae0e2e840e5475a238283ef03bf759` (local `main`, ahead 26, behind 0)
- **API function inventory (expected, unchanged):** 12 Vercel serverless functions
  - `api/admin.js`, `api/agent/ask.ts`, `api/ai-chat.js`, `api/alerts/run.ts`,
    `api/analytics/daily-builder.ts`, `api/bootstrap-owner.js`, `api/config.js`,
    `api/create-tenant.js`, `api/daily-snapshot/run.ts`, `api/oref.js`,
    `api/proactive/run.ts`, `api/whatsapp.js`
- **Cron schedule (vercel.json, unchanged):** daily-builder 23:00, whatsapp-daily 21:00,
  proactive/run 03:00, alerts/run 04:00, daily-snapshot/run 04:05.

## Verification (read-only; run from an authenticated operator machine)
1. `vercel inspect https://kissgn.vercel.app` (or Vercel dashboard) → confirm the
   currently-promoted deployment's **git commit** == `0130e66`. If not → **BLOCKED — PRODUCTION BASELINE DRIFT**.
2. `vercel ls` / dashboard → confirm the production alias points to that deployment; no
   unexpected newer promotion.
3. Firebase Console → Realtime Database → Rules → note the **currently deployed** Rules
   version/fingerprint (this release will replace it with local `database.rules.json`).
4. Vercel → Project → Settings → Environment Variables → confirm the **names** exist
   (do not print values): `FIREBASE_SA_JSON` (or `FIREBASE_SA_*`), `FIREBASE_DATABASE_URL`,
   `CRON_SECRET`, `ALLOWED_ORIGIN`, `SMTP_EMAIL`/`SMTP_APP_PASSWORD`, `BEECOMM_API_KEY`,
   optional `TABIT_*`, `UPSTASH_REDIS_REST_URL`/`_TOKEN`, `ANTHROPIC_API_KEY`.
5. Firebase API function inventory == 12 (no new function added in this release).

## Status in the planning environment
Live Production/Vercel/Firebase read was **not possible** here: no Vercel CLI, no
Firebase login/credentials, and the environment is network-isolated from Production.
The baseline above is the documented expected state; items 1–5 must be confirmed by a
read-only operator before Go.
