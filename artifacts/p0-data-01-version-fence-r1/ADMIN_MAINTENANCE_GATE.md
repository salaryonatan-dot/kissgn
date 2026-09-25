# ADMIN MAINTENANCE GATE — contract and implementation (`api/admin.js`)

## Contract
| policy state of an affected business | entries-domain Admin mutation (`set/clear-entry-exception`) | destructive Admin operation (`delete-client`) |
|---|---|---|
| absent record | admitted | admitted |
| `legacy` | admitted | admitted |
| `v2_active` | admitted | admitted |
| `quiesced` | **423 maintenance** (only the explicit migration/control-plane lane — `tools/storage-v2/policy.mjs#createFencedConversion` — operates in quiesced) | **423 maintenance** |
| `recovery_hold` | **423 maintenance** | **423 maintenance** |
| malformed / unsupported contract | **423** (`policy_malformed` / `unsupported_contract`) | **423** |
| unreadable (transport error) | **423 `policy_unavailable`** | **423 `policy_unavailable`** |

Authentication and authorization are unchanged and run FIRST (401 / 403 / 404 / 400 never become a policy answer — AM-G, unit G). No new policy-management API exists; the control plane stays `tools/storage-v2/policy.mjs`.

## Tenant-wide delete — smallest correct check
`delete-client` is tenant-scoped and can affect every business of the tenant, so `tenantMaintenanceHold(db, tenantId)` reads `storage_v2_control/{tenantId}` ONCE (all business records), parses each with the canonical parser and applies `decideAdminAdmission`; the first non-admitted business (sorted bizId) refuses the whole operation with `{ error: "maintenance", reason, bizId, phase? }` — **before** anything is written. A missing control root admits (all businesses legacy/absent). The deletion itself stays ONE atomic multi-path `update` (tenant, `user_tenants`, `username_index`, and — R1 — `storage_v2_control/{tenantId}`), so a tenant is never partially deleted and a deleted tenant leaves no orphan policy state that could pre-activate a re-created business. Firebase Auth user deletion remains best-effort and happens only after that update, exactly as before.

## Proof
- `test/security/delete-client-maintenance.test.mjs` (real handler, in-memory Admin seams): A quiesced → 423, zero writes, no auth deletion · B recovery_hold → 423 · C malformed (phase-only, fractional revision, scalar, newer contract) → 423 · D unreadable → 423 `policy_unavailable` · E eligible (no records / legacy / legacy+v2_active) → 200, exactly one atomic update, tenant + user_tenants + username_index + policy records gone, caller's auth user kept · F one normal + one quiesced → whole operation refused, both intact · G 401/403/404/400 unchanged.
- `test/emulator/admin-maintenance-gate.mjs` (real handler over the real Admin transport to the emulator): the same A–G with whole-database byte comparison, plus AM-H: entry-exception guard admits legacy/absent/v2_active (ledger written) and refuses quiesced / recovery_hold / phase-only / fractional protocol (no ledger). **8/8 × 3**.
