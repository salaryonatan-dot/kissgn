# 05 — Hardening Design

## Options
| Option | Change | Effect | Risk | Verdict |
|---|---|---|---|---|
| A. Denylist `.vercelignore` | list `docs`, `test`, `artifacts`, … | removes known paths; **a new top-level folder is public by default** | coverage decays | rejected |
| **B. Allowlist `.vercelignore` (chosen)** | `/*`, then re-allow 10 named runtime entries, plus never-upload patterns inside them | deny-by-default upload boundary. Every future top-level entry is excluded until reviewed | functions lose a file only if an allowed directory is wrong. This is guarded by the nft-closure test and mutation-checked (doc 06) | **implemented** |
| C. Output-directory boundary | `buildCommand` copies `index.html`, `landing.html`, `fincore/` into `public/`; `vercel.json` `outputDirectory: "public"` | static output = exactly the browser files; `src/`/`lib/` stop being served while functions still bundle from source | changes the Production build (a new build step, a protected `vercel.json` edit, interaction with dashboard overrides and C1) | **later structural step (P2)** |

## The candidate (`.vercelignore`, 46 lines)
- `/*` excludes every root entry.
- Re-allowed:
  - browser: `index.html`, `landing.html`, `fincore`;
  - functions: `api`, `src`, `lib`;
  - build: `vercel.json`, `package.json`, `package-lock.json`, `tsconfig.json`.
- **Never uploaded, anywhere:** `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.crt`, `*service-account*.json`, `*serviceAccount*.json`, `*credentials*.json`, `*.log`, `.DS_Store`, `*.swp`, `*~`, `*.test.*`.

Deliberately **not** excluded inside the runtime directories:
- `.d.ts` files and the `src/**/__fixtures__/*.json` samples, because `src/pos/mockAdapter.ts` imports one with `resolveJsonModule`, and the TypeScript compile resolves declarations;
- untraced `src`/`lib` modules. Removing them saves little and risks a build break.

`.git` needs no rule: it is a CLI default. Do **not** re-allow it; a `!/.git` rule would upload the repository history in CLI deploys.

## Residual after hardening
- `src/**` and `lib/**` (135 server-source files; no secrets found) plus `vercel.json`/`tsconfig.json` stay statically downloadable. This is server logic including auth code, but it contains no credentials; the functions read secrets from the environment.
- Removing it needs Option C (**P2 structural**).

## Guard for the future
The test fails when:
- a new top-level entry is unclassified;
- a re-allow rule names anything but a classified runtime entry;
- a traced runtime file is excluded;
- a secret-like name is served.
