# 00 — Vercel Public Surface Audit + Hardening Candidate — Executive Status

**Base:** `05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661` (the approved P0 scheduled-auth candidate). No HF-1 or EV-1 dependency.

**Constraints kept:** local only. No Production access, no Vercel account or project access, no Preview or Production deploy, no push.

| Item | Result |
|---|---|
| Current contract | preset "Other", no build step, no `public/` ⇒ **the project root is the static output**. Every uploaded file outside `api/`, `node_modules/` and the package files is a static asset. **The filesystem wins over the catch-all rewrite** (Vercel docs). There is no `.vercelignore` |
| Current surface (model) | `05bf5a59`: 527 static files, **388 non-runtime** (artifacts 255, test 95, docs 20, tools 11, scripts 2, Rules, `SECURITY.md`, stale root `admin.js`, 1 unreviewed image, 1 notes file). `origin/main` (Production identity unverified): 58 non-runtime |
| Secrets | no real credential value in any tracked text file (all hits are synthetic fixtures). One binary `api לבינה מלאכותית.png` is **UNKNOWN**; it was not opened. The owner should review it privately |
| Exposure proven locally | **PARTIAL**: inclusion in the static output is proven under the documented contract; HTTP reachability is not observed |
| Severity | **P0_RELEASE_BLOCKER**, scoped to the release: the approved candidate would **newly** publish 330 non-runtime files, including open security posture and operator runbooks. Current Production: unverified (P1 if confirmed) |
| Hardening | **Implemented:** an allowlist `.vercelignore` (deny-by-default: 10 runtime entries re-allowed, never-upload patterns for env, key, credential and log files) |
| Runtime preserved | **YES.** The `@vercel/nft` closure of all 12 functions (incl. the 4 crons, auth, analytics, snapshot, proactive, alerts) stays uploaded; `index.html`/`landing.html`/`fincore/**` stay served; no runtime byte changed |
| Tests | surface 11/11 (22/22 mutations caught); P0 focused 138/138; full suite 976/976; tsc 22 × TS2742 (baseline) |
| Residual | `src/**`/`lib/**` server source (no secrets) and `vercel.json`/`tsconfig.json` remain static. A structural output boundary is P2 |
| Preview | **BOTH:** P-BEFORE (negative evidence on the current contract) and P-AFTER (allowlist + fincore), then a Git-integration Preview of the release commit before promote |

Docs:
- 01 contract
- 02 inventory
- 03 sensitive review
- 04 local proof
- 05 design
- 06 regression
- 07 Preview interaction
- 08 release impact and manifest delta
- 09 test results
- 10 review guide
