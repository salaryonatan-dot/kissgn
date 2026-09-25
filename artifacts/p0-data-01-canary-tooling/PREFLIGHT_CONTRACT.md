# PREFLIGHT CONTRACT (`preflight`, and the bundled `preflight.json`)

Pure read-only. Composes the UNCHANGED `tools/storage-v2/preflight.mjs` (`createLegacyPreflight` over the production window helpers) — its blocker codes are forwarded verbatim (`already_v2 malformed_node not_an_array missing_entry_id duplicate_entry_id unsupported_row_shape invalid_entry_date reserved_field_present unrepresentable_field_key unrepresentable_value`) and never re-derived. No repair, no dedup, no reorder.

Classification per finding: `PASS | WARNING | OPERATOR_ACTION_REQUIRED | BLOCKER`; aggregate = worst (an OPERATOR_ACTION_REQUIRED marked `resolved` via `--resolved code` no longer counts). Eligibility: `ELIGIBLE | ELIGIBLE_WITH_WARNING | NOT_ELIGIBLE`.

| finding | classification | meaning |
|---|---|---|
| `identity_match` / `identity_unprovable` / `identity_mismatch` | PASS / BLOCKER / BLOCKER | `biz config._v.businessName` vs manifest |
| `read_failed` | BLOCKER | any required read denied/failed (never treated as empty) |
| `tool_identity_mismatch`, `tool_tree_dirty` | BLOCKER (production) / WARNING (emulator) | repo HEAD ≠ `approved.repoSha`; uncommitted changes |
| `rules_fingerprint_match` / `_unknown` / `_mismatch` | PASS / OPERATOR_ACTION_REQUIRED / BLOCKER | deployed Rules git-blob id vs `approved.rulesBlob` (byte or structural) |
| `policy_absent` | OPERATOR_ACTION_REQUIRED | enroll first |
| `policy_malformed`, `policy_unsupported_contract`, `policy_quiesced_foreign_operation`, `policy_phase_not_migratable` | BLOCKER | |
| `policy_legacy`, `policy_quiesced_owned` | PASS | |
| `storage_absent` + `absent_not_first_canary` | PASS + OPERATOR_ACTION_REQUIRED | absent business is a native-initialisation workflow, NOT this canary |
| `already_v2`, `malformed_node`, `unexpected_envelope_siblings` | BLOCKER | |
| core blocker codes (above) | BLOCKER | |
| `legacy_parse`, `representable`, `domain_gen_present`, `exceptions_shape` | PASS | representable = expected V2 node computed with `stampRow`; digest reported |
| `duplicate_dates` + `duplicate_dates_acceptance` | WARNING + OPERATOR_ACTION_REQUIRED | owner acceptance; never deduplicated |
| `approved_canonicalization`, `numeric_key_maps` | WARNING | reported normalisation (null/empty drops; map fields) |
| `non_finite_numeric`, `raw_v_over_platform_limit`, `representation_failed`, `exceptions_malformed` | BLOCKER | |
| `above_rehearsed_cap` | OPERATOR_ACTION_REQUIRED | rows > `limits.maxRows` or bytes > `limits.maxNodeBytes` |
| `duplicate_date_with_exception` | OPERATOR_ACTION_REQUIRED | |
| `final_held_conditions` / `final_preflight_conditions` | PASS / OPERATOR_ACTION_REQUIRED | held preflight: owned quiesced + DRAIN_EVIDENCE_COMPLETE |
| `drift_during_preflight` | WARNING | entries changed while the report was computed — rerun |

Report fields: `target`, `identity`, `environment`, `storage` (mode, envelope keys, raw `_v` bytes/sha256, node bytes, source digest), `policy`, `legacy`, `ids` (ordered/sorted ids, id→date multiset, date groups, per-row digests, latest/oldest date), `expectedV2 {digest, logicalDigest, rowCount}`, `normalization`, `exceptions`, `findings[]`, `aggregate`, `eligibility`.
