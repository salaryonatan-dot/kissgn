# ENVIRONMENT SAFETY (fail closed; exit 14)

| gate | rule | error code |
|---|---|---|
| explicit environment | `--env production\|emulator` required and equal to `manifest.environment` | `environment_not_explicit`, `environment_mismatch` |
| process purity | no other Admin app initialised in the process (production/CLI) | `foreign_admin_app` |
| emulator | `FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1\|localhost:<port>`; `GCLOUD_PROJECT` = `demo-…` = manifest project; manifest URL targets that host; no `GOOGLE_APPLICATION_CREDENTIALS`/`FIREBASE_SA_*`; no `--credentials-file` | `emulator_host_required`, `emulator_project_required`, `emulator_url_mismatch`, `credentials_forbidden_in_emulator` |
| production | emulator host unset; credentials env vars unset; `GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT` (if set) = manifest project; `--credentials-file` required, exists, mode 0600, `type: service_account`, `project_id` = manifest | `emulator_host_set_in_production`, `credentials_env_forbidden`, `project_env_mismatch`, `credentials_file_required|missing|permissions|unreadable|shape`, `credentials_project_mismatch` |
| manifest | exact ids (RTDB key charset, no `*`), production URL `https://…firebasedatabase.app|firebaseio.com` and never local, placeholder ids refused in production, 40-hex sha + blob, observer ≠ operator, liveWrite shape | `manifest_invalid` |
| identity | `biz config._v.businessName` = `expectedIdentity.businessName` before any mutating/evidence command | `identity_mismatch`, `identity_unprovable` |
| tool identity | production: repo HEAD = `approved.repoSha`, clean tree; deployed Rules fingerprint ≠ mismatch | `tool_identity_mismatch`, `tool_tree_dirty`, `rules_fingerprint_mismatch` |
| evidence dir | outside git; 0700; no symlinks; exclusive files | `evidence_dir_inside_git`, `dir_permissions_too_open`, `symlink_in_path`, `file_exists` |
| one business | all paths derived from the manifest; transport refuses other tenant/biz keys | `target_mismatch` |
| write commands | dry-run unless `--execute --confirm <token>`; `migrate`/`activate` also `--ack` | `confirmation_missing|mismatch` (15), `observer_ack_required|invalid|wrong_evidence` (15) |

Tests: unit (`canary-transport.test.mjs`, every row with a fake env; `canary-cli.test.mjs`) and emulator (CT-E16). No Production credential appears in any test; the emulator scripts refuse non-demo projects at startup.
