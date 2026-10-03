# 06 — Runtime Regression Proof (local)

## New suite: `test/security/vercel-deployment-surface.test.mjs` (11 tests)
| # | Asserts |
|---|---|
| 1 | `.vercelignore` exists; its first rule is `/*`; every `!` rule names one classified runtime entry |
| 2 | every top-level repository entry is classified (a new entry fails until reviewed) |
| 3 | `index.html`, `landing.html`, `vercel.json`, package and tsconfig files are uploaded; every non-API rewrite destination (`/landing.html`, `/index.html`) is uploaded **and** static |
| 4 | `fincore/v1/**` paths (C1) are uploaded and static |
| 5 | exactly 12 functions, all uploaded; each of the 4 cron paths has an uploaded handler |
| 6 | **the `@vercel/nft` closure of all 12 functions is uploaded.** It covers the auth helpers (`verifyToken`, `helpers`, `adminSdk`, `securityContext`, `ownerGuard`, `bizAccess`), analytics (`dailyBuilder`), snapshot (`snapshotBuilder`, `snapshotEmail`), proactive (`runProactiveJob`, `proactiveCore`), alerts (`runner`, `alertsCore`), `sendEmail`, `firebase/admin`. Traced files never leave the runtime roots |
| 7 | every file under `api/`, `src/`, `lib/` is uploaded except `*.test.*`; declarations and the JSON fixture imported by `src/pos/mockAdapter.ts` stay |
| 8 | `docs`, `test`, `artifacts`, `tools`, `scripts`, `database.rules.json`, `SECURITY.md`, `admin.js`, the image, `CREATED_FILES_SUMMARY.txt`, `.vercelignore`, `firebase.json`, `.firebaserc`: not uploaded |
| 9 | `.env*`, keys, certs, service-account/credential JSON, logs, `.DS_Store`, swap/backup files, `.git`, `.vercel`, `node_modules`, and unknown new roots (`secrets/`, `local-evidence/`, `logs/`) are not uploaded, including inside `api/`/`src/`/`lib/` |
| 10 | the served set is limited to {`index.html`, `landing.html`, `fincore/`, `lib/`, `src/`, `tsconfig.json`, `vercel.json`} and includes both HTML entry points. Negative control: with no `.vercelignore` the same model serves docs, test, artifacts, tools, scripts, Rules, `SECURITY.md`, `admin.js`, and more than 3× as many files |
| 11 | no served file has a secret-like name |

## Mutation check (22 mutations of `.vercelignore`; each is caught)
| Mutation | Failing tests |
|---|---|
| no `.vercelignore` | 1, 8, 9, 10, 11 |
| drop `!/lib` / drop `!/src` | 6, 7 |
| drop `!/api` | 5, 6, 7 |
| drop `!/index.html` / drop `!/landing.html` | 3, 10 |
| drop `!/vercel.json` | 3 |
| drop `!/package.json` | 3, 6 |
| drop `**/.env.*`, `**/.env`, `**/*.pem`, `**/*credentials*.json`, `**/*.log` (each) | 9 |
| drop `!/fincore` | 4 |
| add `!/docs`, `!/artifacts`, `!/tools`, `!/test`, `!/database.rules.json` (each) | 1, 8, 10 |
| add `src/firebase` / add `lib/*.js` (exclude traced runtime files) | 6, 7 |
| new unclassified top-level file | 2 |

## Existing behaviour unchanged
- **No runtime file changed:** `index.html`, `api/`, `src/`, `lib/`, `vercel.json`, `database.rules.json` and the package files are byte-identical to `05bf5a59`.
- The scheduled-auth focused suite: 138/138. Full suite: 976/976 (965 + 11). tsc: 22 × TS2742 (baseline).
- The upload decision is the only behaviour this candidate changes on Vercel.
