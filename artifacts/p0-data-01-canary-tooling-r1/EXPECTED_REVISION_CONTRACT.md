# EXPECTED REVISION CONTRACT (R1 — Finding 1)

**Rule.** Every command that can mutate the policy record or authorise a migration requires an OPERATOR-SUPPLIED `--expected-revision <n>`. The tool reads the current record only to COMPARE it with the operator's statement; it never substitutes the observed revision for a missing one, and this applies to dry-runs as well (the dry-run must exercise the same gate the execution will).

Inventory of every CLI path that can cause a policy CAS or authorise migration — all route through `requireExpectedRevision`:

| command | path | CAS / effect | observed revision compared with |
|---|---|---|---|
| `enroll` | `policyTransition` → `initializeLegacy` | absent → legacy | `0` (record absent) |
| `quiesce` | `policyTransition` → `quiesce` | legacy → quiesced | record |
| `abort` | `policyTransition` → `abortQuiescence` | quiesced → legacy | record |
| `activate` | `activate` → `policyTransition` → `activateV2` | quiesced → v2_active | record |
| `hold` | `policyTransition` → `enterRecoveryHold` | v2_active → recovery_hold | record |
| `resume` | `policyTransition` → `resumeV2Active` | recovery_hold → v2_active | record |
| `migrate` | `migrate` → `createFencedConversion` (CAS `conversionAttempted`) + core | marker CAS + entries transaction | record |
| `probe-legacy-denial` | same-value control PUT with an ordinary token (no CAS; a write command nonetheless) | — | record |
| native activation (`activateNative`), `closeInitialization` | **not exposed** by the CLI (no command; `grep` confirms) | — | — |

Validation order inside every write command: identity → phase/ownership → **expected revision** (`expected_revision_required` when omitted or bare; `expected_revision_invalid` unless `^(0|[1-9]\d*)$` and ≤ 2^53−1; `stale_revision` unless equal to the observed record's `policyRevision`) → drain/evidence gates where applicable → confirmation token (`confirmation_missing` / `confirmation_mismatch`, exit 15) → observer ack → CAS. All refusals are typed, exit 10 (revision) / 15 (token), and happen before any mutation.

**Token binding.** `confirmationToken = sha256(identityDigest:command:expectedRevision:sourceDigest:operationId)[0..16]` is computed from the OPERATOR's `--expected-revision`. A token minted for N presented with `--expected-revision N+1` is refused: `stale_revision` while the record is still at N, `confirmation_mismatch` once the record has moved to N+1. `plan` prints the tokens for the observed revision (`tokensForRevision`) that the operator must restate.

Tests: `canary-cli.test.mjs` "R1-F1" (six families × A missing, B malformed ×6, C stale ±1, D exact, E plan-read-but-omitted, F token N with N+1; migrate/activate families end-to-end), CT-E05 (missing revision, stale token), CT-E16 (missing / malformed / stale on the real emulator, zero writes).
