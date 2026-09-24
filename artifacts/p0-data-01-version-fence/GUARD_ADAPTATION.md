# GUARD ADAPTATION — S0 anti-migration guard, narrowed to the reviewed fence delta

## Before
Layer A: `authorizedEntriesRulesDelta(BASE 686b4350, live)` — live Rules had to equal the S0 base plus the Storage V2 entries delta. Layer B: five reader blob pins via `serverReaderScopeVerdict`, with `database.rules.json` a protected path.

## After (no permanent broad exemption)
- **Layer A is two-layered**: `authorizedEntriesRulesDelta(BASE, core)` where core = `47f7f888:database.rules.json` (unchanged check), then `authorizedVersionFenceRulesDelta(core, live)`: the entries `.write` must equal `expectedFencedWriteRule(coreWrite)` (the core write with ` && FENCE_GUARD` inserted inside its outer parentheses — the literal `FENCE_GUARD` string is pinned), the `storage_v2_control` root must JSON-equal `EXPECTED_STORAGE_V2_CONTROL_RULES`, and the remainder of the tree must be normalization-equal to core (`unauthorized_change_outside_fence_delta`). Additionally `git hash-object database.rules.json` must equal `APPROVED_FENCE_RULES_BLOB = 11799bd7…`, and the emulator mirror must be byte-identical.
- **Layer B**: reader pins unchanged (five exact blobs). `database.rules.json` is projected out of the reader verdict ONLY after the fence delta validated (`vat-invariant.test.mjs`, `s0-guard-server-reader-mutations.test.mjs`: the raw verdict still rejects `database.rules.json` as `unauthorized_protected_path` — positive control).
- **[H10]** (`entries-storage-v2-hardening.test.mjs`): BASE→core and core→live checked; `authorizedEntriesRulesDelta(BASE, live).ok === false` asserted (there is no blanket exemption); 13 fence mutations rejected with the exact reason; exact-string whitespace check.

## What now FAILS the guard (all asserted)
changing any unrelated Rule · dropping/inerting FENCE_GUARD (`true || …`, replaced by `true`) · removing the malformed-fail-closed conjunct (`!CTRL.exists()` → phase-only) · removing `VALID`/contract conjunct · admitting `quiesced`/`recovery_hold` · removing the init flag · admitting client conversion of a populated legacy node · removing the `_v` freeze · making the control root writable at business or tenant level · widening the control read scope · missing control root · extra child under the control root · any byte change to `database.rules.json` (blob pin).

## Emulator mutation probe (`storage-v2-rules-guard-mutations.mjs`, 20/20)
Uses the same two-layer `guardOf`; every mutation is a real weakening (shipped deny → mutated allow → restored deny). Doubly/triply-held invariants (`_v` freeze, cutover guard, marker-only write) are loosened in every place so the probe measures the invariant, not one copy of it.
