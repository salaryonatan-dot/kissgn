# 04 — Read-only proof

## Import graph (whole, transitive)
| Module | Role | I/O |
|---|---|---|
| `tools/finance-core/ev1-collector.mjs` | entrypoint, discovery, reconciliation, output | local fs (new output dir only); `spawnSync("git", GIT_HEAD \| GIT_STATUS)` |
| `tools/finance-core/ev1-transport.mjs` | the only network module | `fetch` (see the request list below) |
| `tools/finance-core/ev1-preflight.mjs` | identity/env/credential checks | `lstat` / `stat` / `read` of the credential file; existence checks |
| `tools/finance-core/ev1-classifier.mjs` | approved EV1/3 (unchanged) | none |
| `lib/analytics/entriesReader.js` | shared server reader (unchanged) | none |
| node builtins | `node:fs`, `node:path`, `node:url`, `node:crypto`, `node:child_process` | — |

- The graph contains no `firebase-admin`, no Firebase SDK, and no Gate 0, remediation, canary, storage-v2, upgrade or policy module.
- No `require()`, and dynamic imports are enumerated.
- The test "read-only proof …" checks this exactly: the module list equals `SOURCE_FILES`, and the bare imports equal the five builtins.

## Every network operation the Production path can perform
| # | Method | URL | Purpose | Data effect |
|---|---|---|---|---|
| 1 | POST | `https://oauth2.googleapis.com/token` | JWT-bearer grant (RS256 assertion signed locally with `node:crypto`) → short-lived access token | none (credential exchange) |
| 2 | POST | `https://cloudresourcemanager.googleapis.com/v1/projects/kissgn-1227b:testIamPermissions` | Permission **query** for `firebasedatabase.instances.{get,update,create,delete}`. Any `update/create/delete` granted ⇒ `CREDENTIAL_SCOPE_TOO_BROAD`. `get` missing ⇒ refused. **Both run before any database read.** | none |
| 3 | GET | `https://kissgn-1227b-default-rtdb.firebaseio.com/tenants.json?shallow=true` | tenant list | read |
| 4 | GET | `…/tenants/<t>.json?shallow=true` | tenant key listing (keys only) | read |
| 5 | GET | `…/tenants/<t>/app/business.json` | business registry | read |
| 6 | GET | `…/tenants/<t>/biz%3A<b>%3Aentries.json` | entries node, once per business | read |

No other URL or method exists in the code:
- The static test asserts the transport's method literals are exactly `POST, POST, GET` (+ the fixture's `GET` record).
- No `PUT/PATCH/DELETE`, `x-http-method-override` or `print=silent`.
- No `.ref(`, `runTransaction`, `set(ref`/`update(ref`/`remove(ref`/`push(ref`.
- `fetch` is called only in the transport.

## Runtime proof
- The Production-path test drives `main()` with a fake `fetch` and records every request.
  - Non-GET requests are exactly `[oauth2 token, IAM query]`.
  - Every database request is GET.
  - Entries reads equal the number of businesses.
- Report invariant **I17** re-checks the recorded request list, and **I18** checks one entries read per business.
- Broad credential / IAM 403 / token 400 / no `get` permission ⇒ exit 3 with **zero** database requests (test).

## Local writes (not remote)
- Only inside the **new** output directory: `mkdir` (0700) + four exclusive `wx` files (0600).
- The collector never writes elsewhere, never deletes, and never writes to git.

## Child processes
- Exactly two, with frozen argv:
  - `git --no-optional-locks rev-parse HEAD`;
  - `git --no-optional-locks status --porcelain --untracked-files=no`.
- Both are read-only. `--no-optional-locks` prevents the index refresh write.
- The static test pins both call sites and both argv constants, and forbids child processes in every other module.
