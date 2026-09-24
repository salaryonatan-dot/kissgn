# STATE MACHINE — business storage policy

```
 (absent)  ── initializeLegacy ──▶  legacy
 (absent)  ── activateNative (entries absent only) ──▶  v2_active (+ allowV2Initialization=true)
  legacy   ── quiesce (opens cutover op) ──▶  quiesced
  legacy   ── activateNative (entries absent only) ──▶  v2_active (+ flag true)
 quiesced  ── abortQuiescence (owner; ONLY if !conversionAttempted) ──▶  legacy
 quiesced  ── activateV2 (owner; entries node must be V2) ──▶  v2_active
 v2_active ── enterRecoveryHold (opens recovery op) ──▶  recovery_hold
 recovery_hold ── resumeV2Active (owner) ──▶  v2_active
 v2_active ── closeInitialization ──▶  v2_active (flag → false, hygiene)
 NEVER: v2_active → legacy · recovery_hold → legacy · v2_active → quiesced (dropped per Codex) · quiesced → legacy after a conversion attempt
```

## Behaviour per phase (server = Rules, client = honest dashboard, admin = api/admin.js)
| phase | old client (legacy shapes) | compatible client | Admin-lane conversion | `api/admin.js` entry exceptions |
|---|---|---|---|---|
| absent record | legacy writes allowed on legacy/absent nodes; **V2 initialisation denied**; V2 node blocked (`v2_without_policy`) | legacy engine; absent → `initialization_not_enabled` | refused (`policy_required`) | admitted |
| `legacy` | as absent | as absent | refused (`conversion_requires_quiesced`) | admitted |
| `quiesced` | **denied** | `maintenance_read_only`, no transaction | allowed once, owner only, marks `conversionAttempted` | 423 |
| `v2_active` | **denied** (legacy overwrite, `_v` change/delete, node delete, multipath) | V2 lane; absent node initialises only with flag=true; legacy node ⇒ `conversion_pending` | refused | admitted |
| `recovery_hold` | **denied** | `maintenance_read_only` (reason `recovery_hold`) | refused | 423 |
| malformed record | **denied** (all shapes, all nodes) | `policy_malformed`, no transaction | refused (`current_policy_malformed`) | 423 |

Every transition is one CAS at the exact expected `policyRevision` (`TRANSITION_SERIALIZATION.md`). Proofs: `test/security/storage-policy.test.mjs` (table), `test/storage-v2/policy-control.test.mjs`, emulator VF-09/11/21–26.
