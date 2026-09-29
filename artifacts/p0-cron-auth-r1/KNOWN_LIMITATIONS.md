# SYS-P0-001 — Known Limitations

All items are non-blocking and documented; none reintroduces the finding or
weakens authorization.

1. **Idempotency is out of scope (separate P1).** This change hardens
   AUTHORIZATION only. Whether a legitimately-authorized scheduled run is safely
   repeatable (e.g. duplicate emails on retry) is unchanged and tracked
   separately. No idempotency behavior was added or altered.

2. **Operator backfill (daily-builder POST, no action) stays CRON_SECRET-gated.**
   It is treated as an operator/scheduled capability, not an end-user flow, so it
   is authorized by `requireCron` (strict Bearer) rather than a Firebase user.
   This preserves existing operational use while removing the spoofable header.
   If it should become a user-authenticated flow, that is a follow-up.

3. **Manual jobs require an OWNER-tier role.** Manual snapshot email and manual
   proactive scan require owner/super_owner (enforced in-route after
   `requireBizContext(write)`), which also admits managers at the helper layer.
   This is deliberately stricter than the write floor. A future dedicated
   `allowedRoles` option on `requireBizContext` could centralize this, but that
   would touch `lib/securityContext.js` + its `.d.ts` export-parity guard and was
   out of the minimal-change scope here.

4. **`beecomm_diagnose` error text is now uniform 401.** Its former
   `unauthorized_cron_secret_not_configured` vs `unauthorized` distinction is
   collapsed to a single `unauthorized` (via `requireCron`), which also avoids
   disclosing whether the secret is configured.

5. **Tests compile the routes with `tsc` at run time.** They require the project
   `typescript` devDependency (already present; `npm install` not run by this
   task). Terminal Firebase/email/job deps are in-memory stubs; there is no live
   Firebase/RTDB/email exercise (nor is one permitted).

6. **TypeScript `TS2742` (22, `src/firebase/refs.ts`).** Pre-existing
   symlink-portability diagnostics; `--preserveSymlinks` is clean. Unchanged by
   this task; no new diagnostic introduced.
