# SYS-P0-001 — Root Cause & Security Invariants

## Root cause
Each of the three job routes carried its own copy of a permissive `verifyAuth`
(or inline check) whose FIRST branch accepted the presence of the
`x-vercel-cron` request header as sufficient authorization:

```
if (req.headers["x-vercel-cron"]) return true;   // spoofable
```

`x-vercel-cron` is a plain HTTP header on the forwarded request. It is not a
cryptographic proof of origin and is fully attacker-controllable. Because the
header short-circuited before the `CRON_SECRET` comparison, an unauthenticated
attacker could:
- trigger `daily-builder` GET → rebuild analytics for **every** business;
- trigger `daily-snapshot` GET → send owner-snapshot **emails** for every
  business, and POST → email an arbitrary tenant/business snapshot;
- trigger `proactive` GET/POST → run scan jobs for any/all businesses.

Duplicated auth logic (three copies) also meant no single place enforced the
invariant, and drift was likely.

## Security invariants now enforced
1. **Scheduled execution requires a server-verified secret.** Authorization for
   a cron run is granted ONLY by `Authorization: Bearer ${CRON_SECRET}`,
   verified by the centralized `requireCron` (constant-time compare via
   `timingSafeEqual`).
2. **`x-vercel-cron` is never an authorization signal.** It is ignored entirely
   by `requireCron` and appears in no runtime code condition (enforced by an
   executable repo-wide scan test).
3. **Fail-closed on missing secret.** If `CRON_SECRET` is unset/empty,
   `requireCron` throws 401 — it never falls open.
4. **The secret is never logged.** No route logs the secret or the full
   `Authorization` header; the removed `verifyAuth` copies and the stale
   `const CRON_SECRET` module copy are gone.
5. **Scheduled ≠ manual.** Scheduled paths use `requireCron`; human-triggered
   paths use a verified Firebase identity (`requireBizContext` /
   `requireAuth`+RBAC). The two authorization models never substitute for each
   other.
6. **Manual jobs are identity- and scope-bound.** Manual snapshot/proactive
   require a VERIFIED owner/super_owner with canonical server-side tenant
   membership and business access; manual analytics rebuild requires a verified
   user with server-side tenant RBAC + business access.
7. **No client-supplied field establishes authorization.** tenant, business,
   uid, role, membership and `allowedBizIds` are all resolved/verified
   server-side. A request body claiming `role:"owner"` or
   `allowedBizIds:[...]` cannot expand access (proven by tests).
8. **Deny before side effect.** Unsupported methods are rejected (405) and any
   authorization failure returns before any write, email, or job runs
   (proven by "zero side-effect" assertions on mocked terminal deps).
9. **Least surprise for the diagnostic branch.** The read-only
   `beecomm_diagnose` branch, already strict, now shares the same centralized
   constant-time `requireCron` rather than an inline string compare.

## Why source assertions alone are insufficient (and what we did instead)
The finding is closed with an EXECUTABLE proof
(`test/security/cron-auth-hardening.test.mjs`) that compiles the real route
handlers, imports the real `requireCron`/`requireBizContext` from
`lib/securityContext.js`, and drives spoofed / missing / wrong / correct
credentials through them — asserting both the HTTP status AND that terminal
side effects (analytics build, snapshot email, proactive job) do not run when
unauthorized. Source-string scans are retained only as supplementary
regression guards.
