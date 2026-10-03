# 01 — Current Vercel Deployment Contract (base `05bf5a59`)

Sources:
- the repository at `05bf5a59cd62bcfde2bc74f3ab0b9d38ba619661`;
- installed `@vercel/node` 3.2.29 and `@vercel/nft` 0.27.3 (read locally);
- public Vercel documentation and the public `vercel/vercel` source, cited below.

**No Vercel account, project, API or deployment was accessed.** Project Settings (dashboard overrides) are **unknown**, and every statement below assumes they match the repository (preset "Other", no overrides).

| Aspect | Finding | Evidence |
|---|---|---|
| Framework / build | No framework, no `build` script (`package.json` has only `dependencies`/`devDependencies`), no `buildCommand`/`outputDirectory`/`framework` in `vercel.json`. The Vercel preset is therefore "Other" with no build step | `package.json`, `vercel.json`; docs "Configuring a Build" |
| Output directory | For "Other": `public` if it exists, otherwise `.` (project root). **There is no `public/` directory**, so the root is the static output | docs: *"This sets the output directory as `public` if it exists or `.` (root directory of the project) otherwise"* |
| Static files | Zero-config static builder `@vercel/static` with `src = !{api/**, node_modules/**, middleware.[jt]s, package.json, package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lock, bun.lockb, .gitignore, README.md}`. **Every other uploaded file becomes a static asset.** | `vercel/vercel` `packages/fs-detectors/src/detect-builders.ts` (`VERCEL_PLATFORM_FILES`, `getStaticFilesPattern`, branch `apiBuilders.length && hasNoneApiFiles`) |
| Upload boundary | CLI: every file in the directory except the default ignore list (`.git`, `node_modules`, `.env.local`, `.env.*.local`, `.vercel`, …) and `.vercelignore`. Git integration: the repository checkout. **There is no `.vercelignore` today.** Vercel does not apply nested `.gitignore` semantics (only the `.gitignore` file itself is a default-ignored name) | docs ".vercelignore", "Build Features → Ignored files and folders"; `vercel/vercel` `packages/client` `getVercelIgnore` |
| Functions | Every `api/**/*.{js,ts}` without a `/_` or `/.` segment: **12 functions**. Each is bundled by `@vercel/node`, which runs `@vercel/nft` (`base`, `processCwd`, `ts:true`, `mixedModules:true`, TypeScript compiled before analysis) and packages the traced files | `node_modules/@vercel/node/dist/index.js` `compile2` → `nodeFileTrace` |
| Rewrites | `/` → `/landing.html`; `/app` → `/index.html`; `/api/:path*` → itself; catch-all `/((?!api\|_next\|landing\|index\|favicon).*)` → `/index.html` | `vercel.json` |
| Rewrite vs file | **The filesystem wins.** An existing static file is served even when a rewrite source matches its path. The catch-all therefore only applies to paths with no file | docs `vercel.json` → rewrites: *"precedence is given to the filesystem prior to rewrites being applied"* |
| Headers | `nosniff`, `DENY`, CSP, and others on `/(.*)`; they apply to static files too | `vercel.json` |
| Crons | 4 paths, all under `api/` (auth hardened in `05bf5a59`) | `vercel.json` |

## What the runtime needs

| Consumer | Needs | How determined |
|---|---|---|
| Browser | `index.html` (`/app`), `landing.html` (`/`). No other same-origin asset: every same-origin request in `index.html` is `/api/*`; all scripts and styles come from allowlisted CDNs | grep of `src=`/`href=`/`fetch(` in both HTML files |
| Browser (future, C1) | `/fincore/v1/**` (Financial Core module, same-origin) | downstream preflight C1-K1; absent at this base |
| Functions | `api/**` plus their traced closure: **22 `lib/` files, 59 `src/` files, `package.json`** (union over the 12 functions); `node_modules` is installed by Vercel from `package.json`/`package-lock.json`; `tsconfig.json` is read by the `@vercel/node` TypeScript compile | local `@vercel/nft` trace (doc 04) |
| Build | `vercel.json`, `package.json`, `package-lock.json`, `tsconfig.json` | Vercel build inputs |

**No runtime reason to deploy:** `test/`, `docs/`, `artifacts/`, `tools/`, `scripts/`, `database.rules.json` (published with the Firebase CLI, never read by a function), `SECURITY.md`, `CREATED_FILES_SUMMARY.txt`, root `admin.js` (a stale copy that **differs** from `api/admin.js` by about 1,600 diff lines; referenced by nothing), and the root image `api לבינה מלאכותית.png` (referenced by nothing).

Inside `src/`/`lib/`, 54 of 135 files are not reached by any function (type-only modules, `.d.ts`, unused POS/forecast modules). They are kept deliberately: the TypeScript compile resolves declarations and `resolveJsonModule` imports, and excluding them buys little (doc 05).
