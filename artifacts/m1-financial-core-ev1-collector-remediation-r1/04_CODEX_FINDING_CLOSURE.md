# 04 — Codex re-review finding closure

| Codex item | Status | Where |
|---|---|---|
| **P1** `evidenceComplete:true` with unclassifiable rows (`ev1-collector.mjs:282-283, 404-426`; test `:256-264`) | **CLOSED** | `collect()` emits the `rows_unclassifiable` failure; `evaluateReport()` adds I20 and the per-business equations; `verifyBundle()` recomputes and reports conflicts; tests R1-P1-1…5 and the updated 10–22 |
| **P2** `verifyBundle()` accepts unlisted files (`:540-566`) | **CLOSED** | `BUNDLE_MANIFEST`; directory-listing equality; `lstat` regular-file checks; `COMPLETE.files` key-set + `bundleManifest` binding; tests R1-P2-1…10 + CLI |
| GCLOUD_ENV_POLICY: RELAX (advisory, 04) | **RELAXED** | `FORBIDDEN_ENV` without `GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT`; test R1-ENV |
| Accepted areas (tenant/business enumeration, one read per business, classifier input, row-id omission, IAM side-effect freedom, read-only proof, write-capable credential guard) | **UNCHANGED** | `ev1-transport.mjs`, `ev1-classifier.mjs`, discovery and read accounting are byte-identical to `19ae5eb4`. The import graph is unchanged: `readdirSync` replaces `existsSync` from the same `node:fs` builtin. No network or write API was added |

## Relaxation conditions (all still enforced; tested in R1-ENV)
- Explicit `--project` is validated independently: it must be exactly `kissgn-1227b`, and placeholders are refused.
- The credential `project_id` must equal it.
- `--database-url` must equal `https://kissgn-1227b-default-rtdb.firebaseio.com` exactly, and the host must be bound to the project.
- ADC/default credentials remain refused:
  - `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_OAUTH_ACCESS_TOKEN`, the `CLOUDSDK_*` tokens and the `FIREBASE_*` credential variables stay forbidden;
  - no SDK/ADC resolver exists in the code.
- Emulator leakage remains refused:
  - the four emulator variables stay forbidden;
  - `?ns=`, localhost and private-address database URLs are still rejected.
- No code path reads the two variables: `ev1-collector.mjs` and `ev1-transport.mjs` do not contain them, and the preflight only mentions them in a comment.
