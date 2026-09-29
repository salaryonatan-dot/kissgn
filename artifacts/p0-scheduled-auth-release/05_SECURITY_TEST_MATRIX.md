# 05 — Local security test matrix

New file `test/security/scheduled-auth-matrix.test.mjs` has **54 tests**.
- Each of the four cron routes is compiled from source with the repo's TypeScript.
- The tests exercise the REAL `requireCron`/`requireBizContext`, and for alerts the real `alertsCore` + `apiScope`.
- Only terminal dependencies are stubbed; each stub records calls.
- Every rejection asserts **zero** protected calls: build, save, insights, POS, snapshot build/email, proactive job, alerts run/read/write.
- The fake secret is the deterministic `fixture-cron-secret-7c1e0b`.

| Case (per route: daily-builder, daily-snapshot, proactive, alerts) | Expected | Result |
|---|---|---|
| NO AUTH | 401, no side effect | pass ×4 |
| WRONG AUTH (wrong, +x, truncated, upper-case, leading space) | 401 | pass ×4 |
| CORRECT MACHINE AUTH | 200, scheduled job reached | pass ×4 |
| Correct auth + spoofed `x-vercel-cron` | 200 (header has no effect) | pass ×4 |
| SPOOFED `x-vercel-cron` / `x-vercel-cron-schedule` / `user-agent: vercel-cron` / `x-vercel-id` ONLY | 401 | pass ×4 |
| USER AUTH ONLY (valid owner Firebase token) | 401 | pass ×4 |
| MALFORMED `Authorization` (raw secret, `Bearer`, `Bearer `, lower/upper scheme, double space, trailing space, Basic, Token, tab, empty, NUL, array-valued header) | 401 | pass ×4 |
| EMPTY / MISSING `CRON_SECRET` × {`Bearer `, `Bearer undefined`, `Bearer null`, `Bearer <fixture>`} | 401 | pass ×4 |
| QUERY-STRING secret (`secret`, `token`, `cron_secret`, `authorization`, `key`) | 4xx, no side effect | pass ×4 |
| WRONG / ALTERNATE METHODS (PUT, PATCH, DELETE, HEAD, TRACE, CONNECT, `get`, `Get`) × {none, correct secret, spoofed header} | 405/400/401, no side effect | pass ×4 |
| OPTIONS (with/without spoofed header) | 200/204, no side effect | pass ×4 |
| ERROR PATH: job throws | denied stays 401 with zero calls; authorized ⇒ 500 (visible) | pass ×4 |
| daily-builder backfill POST / beecomm_diagnose POST: no auth, spoofed, user token, lower-case scheme, empty secret, unset secret | 401; correct secret reaches the effect | pass ×2 |
| Cron secret is not a user identity (proactive POST, snapshot POST, alerts POST) | 401, no side effect | pass ×3 |
| User read/write never reaches the all-business job (proactive `?action=insights`, alerts POST) | no `runProactiveJob` / `runAlertsForAll` | pass |
| `vercel.json` declares exactly the four covered cron paths | equal | pass |

**Negative control.** I ran the same file against `f5d0a8ed`'s route sources: **12 failures**, covering:
- spoofed header accepted on daily-builder, snapshot and proactive;
- trailing-space secret accepted;
- proactive secret captured at load;
- proactive PUT reaching the scan;
- backfill via spoofed header;
- snapshot POST with the cron secret.

The matrix therefore detects the P0.

Also kept from the approved SYS-P0-001 commit:
- `test/security/cron-auth-hardening.test.mjs` (24);
- `test/security/cron-auth-source-invariants.test.mjs` (7; repo-wide scan: `x-vercel-cron` in no runtime code condition);
- `test/analytics/rebuild-rate-limiter.test.mjs` (updated for the removed `verifyAuth`).

No emulator coverage is claimed: the touched code does not involve Rules or RTDB transactions.
