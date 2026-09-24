# MIGRATION WRAPPER — `createFencedConversion` around the UNCHANGED `tools/storage-v2/upgrade.mjs`

`upgradeBusinessToV2(io, {tenantId, bizId})` is not modified (`git diff 47f7f888 -- tools/storage-v2/upgrade.mjs` empty). The wrapper gates it from OUTSIDE:

```
runConversion(t, b, { expectedRevision, operator, operationId })
  1. CAS on the control record: must be VALID ∧ phase === "quiesced" ∧ owned cutover operation (owner, id) ∧ expected revision
     → else policy_required | conversion_requires_quiesced | operation_not_owned | stale_revision — core NEVER invoked
  2. the same CAS writes { conversionAttempted: true, policyRevision + 1 }   ← recorded BEFORE the core runs
  3. invoke upgradeBusinessToV2(entriesIo, {tenantId, bizId}) exactly once (Admin transport)
  4. return { policyRevision, result }; the phase stays quiesced; activateV2 is a separate owned step that requires the entries node to be V2
```

Consequences:
- **phase gate** (VF-23): refused with no record, under `legacy`, `v2_active`, `recovery_hold`, and the core is not called (spy count 0);
- **exactly once / no abort after attempt**: after a conversion attempt `abortQuiescence` is `transition_not_allowed` even if the conversion failed — the operator resolves forward (retry the conversion under the same operation, or `recovery_hold` after activation);
- **ordinary-auth transport is now denied** (VF-17, V2-M01): running the core through a member SDK connection fails with PERMISSION_DENIED and writes nothing — the fence removed the client conversion path the matrix used before; the Admin lane is the only converter;
- **Admin bypasses Rules**: the "only in quiesced" property is enforced by this wrapper and the record's CAS, not by Rules. Anyone running `upgradeBusinessToV2` directly with Admin credentials bypasses the gate; the runbook must call the wrapper (`KNOWN_LIMITATIONS.md`).

CORE_DEPENDENCY_FOUND: not triggered — the core's `(io, {tenantId, bizId})` contract was sufficient to gate it without modification.
