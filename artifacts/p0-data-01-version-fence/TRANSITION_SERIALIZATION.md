# TRANSITION SERIALIZATION — `tools/storage-v2/policy.mjs`

Every policy/migration operation is exactly ONE RTDB transaction on `/storage_v2_control/{t}/{b}` through the Admin SDK (`io.transactControl`), after reading the entries node mode and a pre-read of the record:

1. the callback parses the current record; a malformed/unsupported current record aborts (`current_policy_malformed` / `current_policy_unsupported`);
2. `current.policyRevision` (0 for absent) must equal the operator's `expectedRevision`, else abort **`stale_revision`** — nothing written;
3. the operation-specific check runs (phase, `operation` ownership `owner`/`id`/`kind`, `conversionAttempted`, entries mode for `activateV2`/`abort`/native) and `planTransition` produces the next record with `policyRevision + 1`; `invalid_next_record` if not;
4. the SDK commits only if the record still hashes to what the callback saw; otherwise it re-runs on the fresh value — which then fails step 2 for the loser.

**SDK cold-cache discipline** (found on the real emulator, fixed and unit-tested): a Firebase transaction may run its callback first against an EMPTY local cache (`null`) although the record exists. The tool returns the current (null) value as a no-op probe when its pre-read saw a record; the server answers with the real record and the callback re-runs on it; if the record truly vanished between pre-read and CAS the probe commits nothing new and the tool reports `stale_revision` (never re-creating a record). `policy-control.test.mjs` #6 models both branches.

Properties proven (`policy-control.test.mjs` in-memory CAS with interleaving hooks; VF-21…VF-23 over the real Admin SDK):
- **monotonic revision**: +1 per transition; a stale/reused/rolled-back expected revision (0, 2, 99 against 1) is rejected with nothing written (VF-21);
- **concurrent transitions**: two operators quiescing from the same revision — exactly one commits, the loser gets `stale_revision`, one bump only (VF-22);
- **ownership visible & enforced**: `operation {id, kind, owner, startedAt}` is in the record; the loser cannot abort, convert or activate (`operation_not_owned`); wrong kind ⇒ `operation_kind_mismatch`; second operation ⇒ `operation_in_progress`;
- **no rollback**: `v2_active → legacy`, `recovery_hold → legacy`, `quiesced → legacy` after `conversionAttempted` are `transition_not_allowed` (VF-11, VF-23, VF-25); `minStorageProtocol` never decreases (`min_protocol_decrease`);
- **native activation explicit**: `activateNative` only for a genuinely absent entries node (`entries_already_v2` / `entries_not_absent`), sets `allowV2Initialization=true`; `closeInitialization` clears it.

Operator CLI surface (`createStoragePolicyControl(io)`): `inspect`, `initializeLegacy`, `quiesce`, `abortQuiescence`, `activateV2`, `activateNative`, `closeInitialization`, `enterRecoveryHold`, `resumeV2Active`, `createFencedConversion`, `isAllowedTransition`. The module is inert (no side effects at import, no credentials); the io adapter is supplied by the operator's runbook.
