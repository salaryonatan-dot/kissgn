# SECURITY.md — Marjin Dashboard

## Architecture overview

```
Browser (index.html)
  │  Firebase Anonymous Auth + App Check token
  │  ID token in Authorization: Bearer header
  ▼
Vercel Edge Functions  (/api/*)
  │  Verify Firebase ID token  (verifyToken.js)
  │  Enforce RBAC              (helpers.js)
  │  Apply rate limiting       (helpers.js)
  │  Call upstream with server secrets
  ▼
External APIs
  ├── Pikud HaOref   — public, cached 15s
  ├── Beecomm POS    — BEECOMM_API_KEY (env only)
  └── Tabit Shift    — TABIT_API_KEY   (env only)

Firebase RTDB
  /tenants/{tenantId}/  ← RBAC by role stored at roles/{uid}
  /app-users/           ← auth-gated, all authenticated users
  /app-businesses/      ← auth-gated
```

---

## Security controls

### 1. No secrets in index.html
- Firebase config served by `/api/config` from Vercel env vars
- Beecomm + Tabit API keys exist **only** in Vercel env vars
- `index.html` contains zero secrets and zero external API calls

### 2. Firebase Auth + App Check
- **Anonymous Auth** for pilot — every session gets a Firebase UID
- `window.getIdToken()` fetches a fresh ID token for every Edge Function call
- **App Check (reCAPTCHA v3)** initialized at boot — enforced in Firebase Console
- Token verified in every Edge Function via `api/lib/verifyToken.js` (Web Crypto, no Admin SDK)

### 3. RTDB Security Rules — tenant RBAC
```
/tenants/{tenantId}/roles/{uid}  → "owner"|"manager"|"shift_manager"|"viewer"
```
| Path | owner | manager | shift_manager | viewer |
|------|-------|---------|---------------|--------|
| roles | R/W | R | R | R |
| entries, config, suppliers, fixed | R/W | R/W | R | R |
| tasks, logs, active-log | R/W | R/W | R/W | R |
| pin | R/W | R/W | — | — |

All paths deny unauthenticated access. Unknown paths deny all.
Size limits on every node prevent payload abuse.

### 4. Edge Function hardening (all endpoints)
- **ID token verification** — every request to `/api/beecomm` and `/api/tabit`
- **RBAC** — beecomm: manager+; tabit: shift_manager+
- **Rate limiting** — per IP + per UID, separate windows
- **Allowlisted upstreams** — hardcoded constants, no user-supplied URLs (SSRF prevented)
- **Timeouts** — 4s (oref), 8s (beecomm/tabit)
- **Aggregate-only responses** — raw POS/shift payloads never forwarded to client
- **No secret logging** — only `status code` and error type logged, never keys or payloads

### 5. Pikud HaOref
- 15-second server-side cache — upstream called max 4×/min regardless of client count
- 10 req/30s rate limit per IP
- Response validated: max 10 KB, must be valid JSON

### 6. Security headers (vercel.json)
| Header | Value |
|--------|-------|
| `Content-Security-Policy` | Restricts scripts to known CDNs |
| `Strict-Transport-Security` | 2 years + subdomains |
| `X-Frame-Options` | DENY |
| `X-Content-Type-Options` | nosniff |
| `Referrer-Policy` | strict-origin-when-cross-origin |
| `Permissions-Policy` | camera/mic/geo disabled |

> CSP requires `unsafe-eval` while Babel standalone is used. Pre-compile for production.

### 7. Password hashing
App-level passwords hashed with **SHA-256** (Web Crypto) before RTDB storage.
> Upgrade path: server-side bcrypt via a dedicated `/api/auth` Edge Function.

---

## Required Vercel environment variables

```
# Firebase
FIREBASE_API_KEY
FIREBASE_AUTH_DOMAIN
FIREBASE_DATABASE_URL
FIREBASE_PROJECT_ID
FIREBASE_STORAGE_BUCKET
FIREBASE_MESSAGING_SENDER_ID
FIREBASE_APP_ID

# App Check
RECAPTCHA_SITE_KEY          ← from console.firebase.google.com → App Check

# POS integrations
BEECOMM_API_KEY
TABIT_API_KEY
TABIT_ORG_ID                ← Tabit organization identifier

# Deployment
ALLOWED_ORIGIN              ← e.g. https://your-app.vercel.app
```

---

## Pre-production checklist

### Critical — must complete before any real users

- [ ] Set **all** Vercel environment variables above — `NODE_ENV=production` must be set in **Production** environment only (not Preview)
- [ ] Deploy `database.rules.json` to Firebase RTDB → Rules
- [ ] Enable **Firebase Auth → Anonymous** sign-in method
- [ ] Register **Firebase App Check** with reCAPTCHA v3 site key — set to **Enforce** (not Monitoring) on RTDB in Firebase Console
- [ ] Create first owner via **`POST /api/bootstrap-owner`** (never manually in RTDB):
  1. Set `BOOTSTRAP_ENABLED=true` in Vercel → **Production** environment temporarily
  2. Check Vercel logs — you will see a `WARNING: BOOTSTRAP_ENABLED=true in production` line (confirms flag is active)
  3. Call endpoint once — uses RTDB transaction (race-safe zero-owner check), writes role + membership + audit atomically
  4. **Immediately** delete `BOOTSTRAP_ENABLED` env var — trigger a redeploy
  5. Confirm endpoint returns `404` (test with curl)
  - ⚠️ Never leave `BOOTSTRAP_ENABLED=true` after bootstrap is complete
- [ ] Verify `ALLOWED_ORIGIN` matches your exact deployment URL
- [ ] Test RTDB rules in Firebase Console → Rules Playground for each role
- [ ] Rotate all API keys after first successful test
- [ ] Verify outbound timeouts: Beecomm 8s, Tabit 8s, Oref 4s, RTDB lookups 3s
- [ ] **Log redaction pre-launch**: grep Vercel logs for `Authorization`/`Bearer`/`api_key` — must be zero hits

### Important — complete within first sprint

- [ ] If storing any PIN/code in RTDB: replace SHA-256 with bcrypt/argon2 server-side. Using Firebase Email/Password exclusively? Skip — Firebase handles hashing
- [ ] Replace **anonymous auth** with Firebase Email/Password for named staff accounts
- [ ] Set Firebase Auth custom claims per user (role) via Admin SDK in a setup script
- [ ] Pre-compile React — eliminate `unsafe-eval` from CSP
- [ ] Add `report-uri` directive to CSP for violation monitoring
- [ ] Set up Firebase Monitoring Alerts for unusual write volumes
- [ ] Firebase ID token TTL handled by SDK (auto-refresh). For localStorage:
  - Never store role/permissions locally — always read from server
  - Add expiry to any non-Firebase session data (e.g. selected tenantId)

### Ongoing

- [ ] Monthly dependency review of `firebase-admin` + all API imports (`npm audit`)
- [ ] Quarterly rotation of Beecomm / Tabit / Upstash API keys
- [ ] Review Firebase RTDB usage metrics for anomalies
- [ ] Verify no secrets appear in Vercel function logs (spot-check after each deploy)
- [ ] Review audit log at `/tenants/{id}/audit/roles/` for unexpected role changes
- [ ] Periodic access review: audit owners/managers per tenant; offboard departed staff via `POST /api/admin-roles` with `role: null`

### Removed (already done ✅)

_(see Ongoing section above)_

---

## Analytics module

### Data stored
- Daily aggregates only: `revenue_total`, `tickets`, `avg_check`, channel splits, hourly sums
- Weather/alert/calendar **context features** (counts + booleans, never raw payloads)
- Path: `tenants/{tenantId}/analytics/daily/main/{YYYY-MM-DD}`
- No Beecomm/Tabit raw responses ever stored in RTDB

### Access control
| Path | Read | Write |
|------|------|-------|
| `analytics/` | Members only | `false` — server only |
| `analytics/daily/main/{date}` | Members | `false` |

Backfill endpoint (`POST /api/analytics/backfill`) restricted to **manager+**.
Check endpoint (`GET /api/analytics/check`) restricted to **manager+**.
Daily builder (`/api/analytics/daily-builder`) protected by `CRON_SECRET` header.

### Secrets + logs
- `CRON_SECRET` in Vercel env (Production only) — rotate quarterly
- Logs: source name + HTTP status only. No upstream body, no revenue values in logs
- Failed tenants logged as: `source/reason` (e.g. `beecomm/http_503`)

### Future AI insights
Future AI/LLM layer will read **only** from `analytics/daily/` — never direct upstream access.
No model has access to Beecomm/Tabit credentials.

### Multi-branch readiness
Path structure supports multiple branches: `analytics/daily/{branchId}/{date}`.
Pilot uses `branchId = "main"` hardcoded.
To add branches: add `branches` list under tenant, pass `branchId` as param to builder.

---

## Multi-tenant POS credentials (F4)

**Current architecture** uses one shared `BEECOMM_API_KEY` / `TABIT_API_KEY` for all tenants.

| Scenario | Risk | Recommendation |
|----------|------|----------------|
| Single key, all tenants share one POS account | Key leak exposes all tenants | Rotate quarterly; restrict key permissions in Beecomm/Tabit console |
| Per-tenant keys stored in RTDB | RTDB rules misconfig → key leak | **Do not store POS keys in RTDB** |
| Per-tenant keys in Vercel env | Not scalable beyond ~10 tenants | Migrate to **Vercel KV** or **GCP Secret Manager** keyed by tenantId |

**For pilot (single shared key):** current approach is acceptable. Mark `BEECOMM_API_KEY` as "scope: all-tenants" in your secrets inventory.

**For production multi-tenant:** store per-tenant credentials in GCP Secret Manager (`projects/{id}/secrets/beecomm-{tenantId}`) and fetch in the Edge Function via Service Account with least-privilege IAM role. Never store POS API keys in RTDB.

---

## Audit log retention

`/tenants/{tenantId}/audit/roles/` grows unbounded. Recommended policies:
- **Pilot**: no action needed
- **Production**: Firebase Function on schedule → delete entries older than 90 days
- **Compliance**: archive to Cloud Storage before deletion

---

## QA checklist — 6 tests to confirm closed

| # | בדיקה | ציפייה |
|---|-------|--------|
| 1 | עובד קורא `tenants/{A}/members` (שורש) | `Permission denied` |
| 2 | עובד קורא `tenants/{A}/members/{selfUid}` | ✅ מותר |
| 3 | עובד קורא `tenants/{A}/roles/{otherUid}` | `Permission denied` |
| 4 | עובד מסניף A קורא `tenants/{B}/members/{selfUid}` | `Permission denied` |
| 5 | `POST /api/beecomm?tenantId=B` מעובד של סניף A | `403 not a tenant member` |
| 6 | עובד רגיל שולח `POST /api/admin-roles` | `403 forbidden` |

---

## Known limitations (acceptable for pilot)

| Limitation | Risk | Production fix |
|------------|------|----------------|
| Babel standalone → `unsafe-eval` in CSP | Medium | Pre-compile |
| SHA-256 passwords (no salt) | Medium | Server bcrypt |
| Anonymous auth (no identity binding) | Low | Email/password auth |
| In-memory rate limiter resets on cold start | Low | Upstash Redis |
| No audit log for role changes | Low | Firebase Functions trigger |
