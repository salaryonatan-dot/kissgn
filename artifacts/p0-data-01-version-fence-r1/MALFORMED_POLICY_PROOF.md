# MALFORMED POLICY PROOF — Codex F1 reproduced, then closed on the real emulator

Codex reproduced six present-but-invalid records under which the R0 Rules admitted owner/manager entries writes. All six — and the whole contract — now deny:

| Codex case | R0 Rules | R1 Rules (emulator) | where proven |
|---|---|---|---|
| fractional `policyRevision` (1.5) | allow ✗ | **deny** owner+manager, set+CAS, V2 row; node byte-identical | parity PI (fractional revision 1.5 / 2.0000001; + mutants), mutation "integer check dropped for policyRevision" |
| unsafe `policyRevision` (2^53, 1e16, 1e300) | allow ✗ | **deny** | parity PI (unsafe ×3), VF-27, mutation "safe-integer bound dropped" |
| fractional `minStorageProtocol` (2.5) | allow ✗ | **deny** | parity PI, mutation "integer check dropped for minStorageProtocol" |
| `allowV2Initialization=true` while `phase=legacy` | allow ✗ | **deny** (also quiesced / recovery_hold + true) | parity PI ×3, mutation "flag×phase relationship dropped" |
| malformed `operation` (scalar / array / missing or empty or mistyped id, kind, owner, startedAt) | allow ✗ | **deny** ×19 shapes | parity PI, mutation "operation structure check dropped" |
| non-boolean `conversionAttempted` ("true", "false", 1, 0, object, array) | allow ✗ | **deny** ×7 | parity PI, mutation "conversionAttempted type check dropped" |

Every denial is against ordinary member auth (`databaseAuthVariableOverride` owner and manager), on a populated legacy node (whole-node `set({_v})` and node CAS returning `{_v}`) and on a V2 node (row write) — and the node is compared byte-for-byte before/after. The parser rejects each record with the same verdict (`test/security/storage-policy-parity.test.mjs`), the Admin gate refuses it (`admin-maintenance-gate.mjs` AM-C: phase-only, fractional, unsafe, scalar, newer contract → 423) and the tooling refuses it as `current_policy_malformed` (VF-27 for 2^53).

Positive controls kept: valid `legacy` records (incl. `policyRevision = MAX_SAFE_INTEGER`, diagnostics of the wrong type, unknown extra keys) still allow legacy writes (parity PV-01…07, VF-01/02/27); valid `v2_active` records admit V2 rows (PV-11…13, VF-05).
