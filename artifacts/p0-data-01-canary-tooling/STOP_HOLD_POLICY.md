# STOP / HOLD POLICY

Levels (ordered): `OK < EXPECTED < WARNING < REVIEW_REQUIRED < RECOVERY_HOLD_RECOMMENDED < STOP`. `classify(findings, {phase})` returns the worst level, a recommendation and `automaticTransition:false` — always.

| level | recommendation | exit | who acts |
|---|---|---|---|
| OK / EXPECTED / WARNING | NONE | 0 | — |
| REVIEW_REQUIRED | INVESTIGATE_BEFORE_NEXT_BUSINESS | 0 | operator, before any second business |
| STOP / RECOVERY_HOLD_RECOMMENDED under `v2_active` | RECOVERY_HOLD_RECOMMENDED (+ the exact `hold` command line printed) | 12 | a person decides and runs `hold --execute --confirm <token> --reason <ref>` |
| STOP under `quiesced` | REMAIN_QUIESCED (or REMAIN_QUIESCED_AND_ESCALATE from `status`) | 12 | operator; `abort` only if no conversion was attempted |
| unknown migration outcome | run `status` (A1/A2/B/C/HOLD) | 13 | operator; never a blind retry |

Guarantees: `verify`, `live-check`, `monitor`, `status` and `migrate` never call `enterRecoveryHold`; the only writer of `recovery_hold` is the explicit `hold` command (dry-run by default, token-gated; CT-27, CT-E14). `resume` is likewise explicit and requires the recovery operation to be owned. STOP conditions include: generation change without a tool-observed clear, frozen `_v` change, unexpected policy change, malformed V2 (typed reader error), financial drift, old-client write succeeded, unexplained row delta, expected-node digest mismatch, unrecognised node state after an attempt.
