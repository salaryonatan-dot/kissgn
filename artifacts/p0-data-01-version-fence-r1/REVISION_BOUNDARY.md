# REVISION BOUNDARY — `policyRevision` stays inside the contract domain (Codex F3)

## Change
- `lib/storagePolicy.js`: `nextPolicyRevision(current)` is the ONLY increment: requires a positive safe integer, returns `current + 1`, throws typed `revision_exhausted` when the result is not a safe integer (i.e. at `Number.MAX_SAFE_INTEGER`); `assertValidNextRecord(next)` runs the canonical parser on the record about to be written and throws `invalid_next_record` (with the parser reason) otherwise. `planTransition` uses both.
- `tools/storage-v2/policy.mjs`: `cas()` validates the FULL next record (`assertValidNextRecord`) in addition to `next.policyRevision === current + 1` and the contract version — nothing parser-invalid can be persisted by the control plane; `closeInitialization` and the conversion marker (`createFencedConversion`) use `nextPolicyRevision` instead of `+ 1`.

## Behaviour
| current `policyRevision` | any revision-bumping operation | result |
|---|---|---|
| `< MAX_SAFE_INTEGER − 1` | normal | `+1`, full record validated, written |
| `MAX_SAFE_INTEGER − 1` | quiesce / abort / activateV2 / activateNative / enterRecoveryHold / resumeV2Active / closeInitialization / conversion marker | may succeed; lands EXACTLY on `MAX_SAFE_INTEGER`; persisted record parses valid |
| `MAX_SAFE_INTEGER` | every one of the above | **`revision_exhausted` before any write**; record byte-identical; conversion core never invoked; never `2^53`, never wrapped, never reused |
| `2^53` (parser-invalid) | any | `current_policy_malformed`; Rules deny every client write |

## Proofs
- `test/storage-v2/policy-revision-boundary.test.mjs` (5): (1) all 8 bumping paths at MAX−1 succeed on MAX with a parser-valid persisted record (conversion core invoked exactly once after the marker); (2) all 8 at MAX refuse `revision_exhausted` with nothing written and the core not invoked; (3) primitives (`nextPolicyRevision` domain, `assertValidNextRecord` rejections, `planTransition` at the edge); (4) a planned record that would be parser-invalid is refused before the CAS commits (`operation_identity_required` for a fractional/unsafe `startedAt`); (5) concurrency at the boundary — two operators at MAX−1: one lands on MAX, the loser is `stale_revision`; afterwards abort/conversion/other-operator attempts are `revision_exhausted`/`operation_not_owned`, record byte-identical; the SDK cold-cache probe path cannot sneak a write.
- `test/emulator/storage-v2-version-fence.mjs` VF-27 on the real record: Rules accept `policyRevision = MAX_SAFE_INTEGER` (legacy write allowed); at MAX, quiesce / abort / conversion / activate / enterRecoveryHold / closeInitialization / resume are `revision_exhausted` with byte-identical records and the core never invoked; a `2^53` record denies everything and the tooling refuses it as malformed.

## Transport note (recorded)
On the emulator, an SDK transaction against a node that already holds an integer ≥ `2^53 − 2` never commits (`maxretry`: client/server hash disagreement for such doubles). Operationally unreachable (one increment per operator transition), so the MAX−1 → MAX real-CAS step is proven in the unit suite and the emulator proves the Rules acceptance and the typed refusals at MAX (which abort inside the callback and need no server commit). Listed in `KNOWN_LIMITATIONS.md`.
