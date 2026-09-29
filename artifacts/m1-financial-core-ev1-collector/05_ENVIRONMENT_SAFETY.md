# 05 — Environment safety (`ev1-preflight.mjs`; every check precedes any network activity)

| Check | Refusal code |
|---|---|
| `--env production` exact; `--fixture` not combined with it | `env_required`, `fixture_in_production` |
| No credential, ADC or emulator variables: `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_OAUTH_ACCESS_TOKEN`, `CLOUDSDK_AUTH_ACCESS_TOKEN`, `CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE`, `FIREBASE_TOKEN`, `FIREBASE_SA_JSON`, `FIREBASE_SA_PRIVATE_KEY`, `FIREBASE_SA_CLIENT_EMAIL`, `FIREBASE_CONFIG`, `FIREBASE_DATABASE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_EMULATOR_HUB` | `forbidden_environment` (names only). R1: `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` are no longer refused (Codex re-review 04: RELAX); nothing reads them, identity comes only from the explicit, verified inputs below |
| `--project` present, not a placeholder (`<…>`, `your-…`, `example…`, `test…`, `fixture…`, `demo…`, …), equal to `kissgn-1227b` | `project_placeholder_or_missing`, `project_mismatch` |
| `--database-url` must be all of: https; bare origin (no port, path, query, `?ns=` or credentials); not localhost/loopback/private IP; a `*.firebaseio.com` / `*.firebasedatabase.app` host bound to the project; equal to `https://kissgn-1227b-default-rtdb.firebaseio.com` | `database_url_*`, `database_project_mismatch`, `database_mismatch` |
| `--as-of` a real calendar date (leap-aware), ≤ current Israel business date (`Asia/Jerusalem`) | `as_of_invalid`, `as_of_in_future` |
| `--expected-commit` 40-hex; checkout HEAD equals it; tracked tree clean | `expected_commit_required`, `commit_mismatch`, `tree_dirty` |
| `--out-dir` must be: new (does not exist); parent exists and is not a symlink; not inside any git tree (walks up for `.git`) | `out_dir_*` |
| `--credentials-file`: explicit path; exists; **not a symlink**; regular file; mode without group/other bits (0600 or stricter); JSON `type: service_account`; `client_email`; PEM `private_key`; `project_id == --project`; `token_uri` absent or the Google token endpoint | `credentials_*` |
| No implicit credentials: no ADC or metadata-server fallback exists in the code. The token comes only from the explicit file via a locally signed JWT. | — |
| Credential scope (transport, before any database read): IAM query must show `get` and must not show `update/create/delete` | `CREDENTIAL_SCOPE_TOO_BROAD`, `credential_cannot_read`, `credential_scope_unverifiable` |

- **Credential content:** never printed.
  - The report carries only `{type, projectId, clientEmailSha256Prefix}`.
  - The secret scan blocks the client email, key id and key from every output file.
  - This task never accessed the real credential file. Tests use a throwaway RSA key generated in a temporary directory.
- **Fixture mode:** refuses production inputs (`--credentials-file`, `--database-url`) and never uses the network (test: zero fetch calls). Its report says `mode: fixture`, and operators must require `mode: production` for gate evidence.
- **Observed:** the cloud build container itself carries `CLOUDSDK_AUTH_ACCESS_TOKEN`. The collector refused (`forbidden_environment`) until it was unset, which is the intended behaviour.
