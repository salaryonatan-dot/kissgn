# 04 — Local Proof (offline)

## Harness
`test/support/vercel-surface.mjs` (test code, excluded from the deployment) answers **"would file X be uploaded / served statically / bundled?"** It has a CLI:
```
node test/support/vercel-surface.mjs <path>…          # under the committed .vercelignore
node test/support/vercel-surface.mjs --base <path>…   # as if there were no .vercelignore
```

| Layer | Implementation | Fidelity |
|---|---|---|
| Upload | the Vercel CLI default ignore list (copied from `vercel/vercel` `packages/client` `getVercelIgnore`) + `.vercelignore`, evaluated with **`ignore`** 7.0.6 (already installed; the library that client imports) | same gitignore semantics as the CLI. Minor version differences in `ignore` are possible |
| Static | minimatch over `VERCEL_PLATFORM_FILES` (`fs-detectors` `getStaticFilesPattern`) | matches the documented zero-config static builder for preset Other without `public/` |
| Functions | `api/**/*.{js,mjs,cjs,ts}` without `/_` or `/.` segments; each traced with the **installed `@vercel/nft` 0.27.3** using the options `@vercel/node` 3.2.29 passes (`base`, `processCwd`, `ts:true`, `mixedModules:true`) and TypeScript transpiled before analysis (`typescript.transpileModule`; `@vercel/node` uses its own `register`) | the same tracer and options as the builder; literal dynamic imports (`import("./verifyToken.js")`, `import("../firebase/admin.js")` …) are resolved and asserted |

No network was used: no Vercel CLI is installed, nothing was authenticated, no project settings were downloaded, and there was no `vercel build`/`dev`/`pull`. Public Vercel **documentation** and the public `vercel/vercel` GitHub source were read to pin the rules above.

## Results
| Question | Answer |
|---|---|
| Functions found | 12 (`admin`, `agent/ask`, `ai-chat`, `alerts/run`, `analytics/daily-builder`, `bootstrap-owner`, `config`, `create-tenant`, `daily-snapshot/run`, `oref`, `proactive/run`, `whatsapp`) |
| Traced project files per function | 15, 46, 6, 20, 17, 2, 2, 2, 13, 2, 42, 2 (union: `api` 12, `lib` 22, `src` 59, `package.json`) |
| Traced files outside `api/`, `src/`, `lib/`, `package.json` | **none**, so no function reads `docs/`, `tools/`, `test/`, `scripts/` or `artifacts/` |
| Served statically today (`05bf5a59`, model) | 527 files, of which 388 are non-runtime |
| Served statically after hardening | 139: `index.html`, `landing.html`, `vercel.json`, `tsconfig.json`, `src/**` (93), `lib/**` (42) |

## What this proves, and what it does not
- **Proven locally:** under Vercel's documented contract for this project shape, those 388 files are **inputs to the static output**, and the allowlist removes them. The functions' complete traced closure stays uploaded.
- **Documented, not observed:** HTTP reachability. The docs say the filesystem takes precedence over rewrites, so a static file in the output is served at its path. No deployment was requested or observed.
- **Unknown locally:**
  - Project Settings overrides (Framework, Build or Output overrides, Root Directory, an Ignored Build Step);
  - the build-service version;
  - whether Production is Git-deployed or CLI-deployed. `.vercelignore` is documented for uploads and "served files". Third-party evidence shows Git-integration builds also honour it, but the Vercel docs do not say so explicitly.
  - Doc 07 closes these gaps with a Preview.
- Therefore **PUBLIC_EXPOSURE_PROVEN_LOCALLY = PARTIAL**: inclusion in the static output is proven under the documented contract; reachability on Production is not.

References (public docs/source, read-only):
- vercel.com/docs/deployments/vercel-ignore
- vercel.com/docs/builds/build-features (ignored files)
- vercel.com/docs/builds/configure-a-build (Output Directory)
- vercel.com/docs/project-configuration/vercel-json (rewrites: filesystem precedence)
- github.com/vercel/vercel `packages/fs-detectors/src/detect-builders.ts`
- github.com/vercel/vercel `packages/client/src/utils/index.ts`
