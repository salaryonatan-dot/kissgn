# RULES GUARD UPDATE — narrow re-pin to the R1 Rules bytes/semantics

## Rules delta (core `47f7f888` → live blob `1e5dea2f9b1eac037c766b325b927c20285c0eec`, regenerated from the core bytes by one generator)
Only the `VALID` sub-predicate of `FENCE_GUARD` changed (R0 blob `11799bd7…` → R1). New conjuncts:
```
SAFEINT(x) = (x.isNumber() && x.val() % 1 === 0 && x.val() >= 1 && x.val() <= 9007199254740991)
VALID = contractVersion === 1
     ∧ phase ∈ {legacy, quiesced, v2_active, recovery_hold}
     ∧ SAFEINT(policyRevision)
     ∧ allowV2Initialization.isBoolean() ∧ (allowV2Initialization !== true ∨ phase === 'v2_active')
     ∧ SAFEINT(minStorageProtocol)
     ∧ (!operation.exists() ∨ (operation.id.isString() ∧ id !== '' ∧ kind ∈ {cutover, recovery} ∧ owner.isString() ∧ owner !== '' ∧ SAFEINT(operation.startedAt)))
     ∧ (!conversionAttempted.exists() ∨ conversionAttempted.isBoolean())
```
`LEGACY_BRANCH`, `ACTIVE_BRANCH`, the `_v` freeze, the control root (`storage_v2_control`, member-scoped read, `.write:false`) and everything outside the fence are byte-identical to R0/core. Emulator mirror byte-identical.

## Guard
- `test/support/rules-authorized-delta.mjs`: `FENCE_GUARD` literal replaced by the R1 string (9,858 chars; generated from the same source as the JSON so they cannot drift); `APPROVED_FENCE_RULES_BLOB = 1e5dea2f…`. `authorizedVersionFenceRulesDelta(core, live)` structure unchanged (write = core write + ` && FENCE_GUARD`; control root JSON-equal; remainder normalisation-equal to core). `authorizedEntriesRulesDelta` (base→core) unchanged.
- `vat-invariant.test.mjs` Layer A (fence delta + blob), reader Layer B projection, `[H10]` (BASE→core, core→live, `authorizedEntriesRulesDelta(BASE, live).ok === false`, 13 fence mutations) — all unchanged in code and green against the new literal. No broad exemption was added.
- Server Reader five exact S0 pins: **unchanged** (`a327186c`, `301f9599`, `33a646e9`, `6a3f9be2`, `e36df4d8`; `src/**` byte-identical to `47f7f888`).

## Mutation proof (`storage-v2-rules-guard-mutations.mjs`, 20 → 26, all shipped-deny / mutated-allow / restored-deny AND guard-rejected)
R1 additions, each with its own fixture business (`fracrev`, `unsaferev`, `fracproto`, `legacyflag`, `badop`, `badconv`): integer check dropped for `policyRevision` · safe-integer bound dropped for `policyRevision` · integer check dropped for `minStorageProtocol` · flag×phase relationship dropped · operation structure check dropped · `conversionAttempted` type check dropped. Retained from R0: fence dropped / inert, malformed record fails open (whole-record absence → phase-only), `recovery_hold` admitted, initialization flag ignored, populated-legacy client conversion admitted, control record client-writable / world-readable, `_v` freeze dropped (held twice), cutover guard dropped / weakened, marker-only write (held thrice), plus the 8 core validator mutations. Old-client quiesced denial and old-client V2 denial are covered by "fence guard dropped/weakened" (probe = old-client legacy overwrite of a quiesced business) together with VF-03/04/26 and the historical page proof. **26/26 × 3.**
