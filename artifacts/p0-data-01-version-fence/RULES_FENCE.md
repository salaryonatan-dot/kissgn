# RULES FENCE — the reviewed delta (core `47f7f888` → live blob `11799bd7e0560caf8d6b5512b4694f6ee865fa6b`)

## 1. Entries `.write` (path `tenants/$tenantId/$dataKey`, `$dataKey = biz:{bizId}:entries` branch)
Core: `(<existing auth> && CUTOVER_GUARD)` → live: `(<existing auth> && CUTOVER_GUARD && FENCE_GUARD)`. The auth conjuncts, `CUTOVER_GUARD` and every `.validate` are byte-identical to core (`authorizedVersionFenceRulesDelta` compares the whole tree after projecting the two authorized changes out).

```
CTRL   = root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries',''))
VALID  = CTRL.contractVersion === 1 ∧ CTRL.policyRevision.isNumber() ∧ ≥ 1 ∧ CTRL.allowV2Initialization.isBoolean()
         ∧ CTRL.minStorageProtocol.isNumber() ∧ ≥ 1 ∧ CTRL.phase ∈ {legacy, quiesced, v2_active, recovery_hold}
LEGACY_BRANCH = (!CTRL.exists() || (VALID && phase === 'legacy'))
                && !(newData.schemaVersion === 2) && !(data.schemaVersion === 2)
ACTIVE_BRANCH = VALID && phase === 'v2_active'
                && newData.schemaVersion === 2
                && (data.exists() ? data.schemaVersion === 2 : CTRL.allowV2Initialization === true)
                && (!data.child('_v').exists() || newData.child('_v').val() === data.child('_v').val())
FENCE_GUARD   = (LEGACY_BRANCH || ACTIVE_BRANCH)
```

Why each conjunct exists (each is proven load-bearing by `storage-v2-rules-guard-mutations.mjs`):
- `!CTRL.exists()` — only WHOLE-record absence is legacy (D-VF2). A present record must be `VALID`; a phase-only or revision-only record denies everything ("malformed record fails OPEN" mutation).
- `!(newData.schemaVersion===2) && !(data.schemaVersion===2)` — the legacy branch admits only legacy-shaped results on legacy/absent nodes: no client conversion, no V2 initialisation without activation, no legacy overwrite of a V2 node.
- `phase === 'v2_active'` — quiesced and recovery_hold admit nothing ("recovery_hold admitted" mutation).
- `data.exists() ? data.schemaVersion===2 : flag` — a populated legacy node can never be converted by a client (Admin lane only); an absent node initialises only with explicit activation (D-VF1; "initialization flag ignored" and "populated-legacy conversion admitted" mutations).
- `_v` freeze — closes the residual the core left open: deleting `_v` kept `schemaVersion===2` and passed `CUTOVER_GUARD` (`.validate` is not evaluated on deletes). VF-18 shows the pre-fence Rules allowed it; live denies it.

`$dataKey.replace(...)` is evaluated on the wildcard string — `$dataKey` matches `biz:{bizId}:entries` only in this branch (the core's `$dataKey.matches(...)` conjunct is unchanged), so the derived business id is exact.

## 2. New root `storage_v2_control` (inserted before `$other`)
```
storage_v2_control: { .read:false, .write:false,
  $tenantId: { .read:false, .write:false,
    $bizId: { .read: auth !== null && members[auth.uid] === true && (role owner || role super_owner || biz_access[$bizId][auth.uid] === true),
              .write: false } } }
```
No client write at any level (VF-10, authorization cases A13-120…128 incl. a combined control+entries multipath). Reads scoped to the business (A13-109…119).

## 3. Not changed / known residuals
- Rows-map protections untouched. The rows-map whole-deletion residual tracked since the core remains (a last-row delete needs it) — unchanged by this delta.
- Rules cannot test integer-ness of `policyRevision`/`minStorageProtocol` (`isNumber()` only); the parser and the tooling enforce safe integers, and the tooling is the only writer.
- Rules do not (and cannot) enforce that Admin conversions happen only in `quiesced` — application-level invariant (`MIGRATION_WRAPPER.md`).

## 4. Generation
Both JSON files are generated from one source (`vf-rules.py`, session scratch) and the guard's `FENCE_GUARD` literal is the same string; `test/emulator/database.rules.json` is asserted byte-identical by every emulator script and by `vat-invariant.test.mjs`.
