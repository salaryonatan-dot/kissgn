# 02 — Deployment Surface Inventory

Model: `test/support/vercel-surface.mjs` (doc 04). Counts are git-tracked files; untracked local files would be added by a CLI deploy from a working tree (see the last section).

## Totals

| Tree | Tracked files | Uploaded | **Served statically** | Non-runtime files served |
|---|---|---|---|---|
| `0243123` (`origin/main`; Production identity **unverified**) | 206 | 205 | 191 | **58** |
| `05bf5a59` (approved P0 candidate), no `.vercelignore` | 543 | 541 | 527 | **388** |
| **Hardened candidate** (`05bf5a59` + `.vercelignore`) | — | 153 | **139** | **0** |

The approved P0 candidate itself **adds 330 non-runtime static files** compared with `origin/main`: all of `artifacts/` (255), `tools/` (11) and 64 more tests.

## Classification

| Category | Entries | Files (at `05bf5a59`) | Deployed after hardening |
|---|---|---|---|
| **PUBLIC_RUNTIME_REQUIRED** | `index.html`, `landing.html`, `fincore/**` (future C1) | 2 (+ fincore later) | uploaded, served |
| **SERVER_BUNDLE_REQUIRED** | `api/**` (12 functions), `src/**`, `lib/**` | 12 + 93 + 42 | uploaded. `api/` is functions only (not static); `src/`, `lib/` are also **served** (residual, doc 05) |
| **DEPLOYMENT_METADATA_REQUIRED** | `vercel.json`, `package.json`, `package-lock.json`, `tsconfig.json` | 4 | uploaded. `package*.json` not static; `vercel.json` and `tsconfig.json` served (low sensitivity) |
| **NOT_RUNTIME_REQUIRED** | `test/`, `docs/`, `artifacts/`, `tools/`, `scripts/`, `CREATED_FILES_SUMMARY.txt`, `.vercelignore` | 95 + 20 + 255 + 11 + 2 + 1 | **excluded** |
| **SENSITIVE_IF_PUBLIC** (a subset of the non-runtime set, plus stray sources) | `database.rules.json`, `SECURITY.md`, root `admin.js`, `artifacts/**`, `docs/production-readiness/**`, `tools/storage-v2/**`, `scripts/**`, `test/security/**` | see doc 03 | **excluded** |
| **UNKNOWN** | `api לבינה מלאכותית.png` (2880×1800, 1.4 MB, since the initial commit; **not opened**, doc 03) | 1 | **excluded** |

The two nested `.gitignore` files (`docs/production-readiness/output/.gitignore`, `test/historical/.gitignore`) are the only tracked files the CLI defaults drop.

## Requested checks

| Asked | Result |
|---|---|
| `index.html` | runtime; static at `/app` and `/index.html` |
| `fincore/v1/**` | absent at this base; allowed for C1 (tested with synthetic paths) |
| `api/**` | 12 functions; not static (platform pattern) |
| `src/**`, `lib/**` | server bundle inputs; 81 of 135 reached by the functions' trace; currently served statically; still served after hardening (residual) |
| `tools/**`, `test/**`, `docs/**`, `artifacts/**` | not runtime; served today by the model; excluded after hardening |
| `*.rules` / `database.rules.json` | Firebase Rules source: an input to `firebase deploy`, never to Vercel; served today; excluded |
| `firebase*.json`, `.firebaserc` | none tracked; excluded by the allowlist if added |
| package files | `package.json` and `package-lock.json` uploaded, not static |
| review / evidence files | `artifacts/**` (review packages, logs), `docs/production-readiness/output/` (local-only audit outputs, git-ignored): excluded |
| local configuration examples | none tracked (`.env*` absent) |
| operational details | see doc 03 |

## CLI deploys from a working tree
Vercel CLI ignores only its default list plus `.vercelignore`, **not** `.gitignore` rules. Without an allowlist, an operator running `vercel deploy` from a checkout would also upload untracked local files, such as `docs/production-readiness/output/*` audit runs or future evidence bundles. A read-only name scan of three local checkouts on the Mac found **no** `.env`, key, credential or log files outside tracked artifacts, and the audit output directory was empty. The allowlist removes this class entirely.
