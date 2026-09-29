# 01 — P1: unclassifiable rows can no longer yield complete evidence

## Finding (Codex re-review 02)
`collect()` mapped EV1/3 `malformedRows` to `rows.unclassifiable` and marked the business `CLASSIFIED`. I11 checked only `observed == classified + unclassifiable`, so `["garbage"]` produced `evidenceComplete: true`.

## Fix (`tools/finance-core/ev1-collector.mjs`)
1. **Typed failure, count only.** After a successful classification with `malformedRows ≠ 0`, `collect()` appends
   `{scope: "classifier", tenantId, bizId, code: "rows_unclassifiable", count}`. The business stays `CLASSIFIED` so its safe aggregate counts are preserved. The rows stay counted in `rows.unclassifiable`, and no row content is stored.
2. **New invariant `I20_no_unclassifiable_rows`, recomputed from partitions.** It holds only when all three are true:
   - `counters.rows.unclassifiable == 0`, recomputed by `computeCounters`;
   - Σ over businesses of `rows.unclassifiable` == 0;
   - Σ over `CLASSIFIED` businesses of the classifier's own `counts.malformedRows` == 0.
3. **Per-business equations (inside I12).** Two new equations:
   - `rows.unclassifiable == malformedRows`;
   - `rows.classified == rowsTotal − malformedRows`.

   A forged partition therefore disagrees with the classifier counts.
4. **`--verify` never trusts the stored boolean.** `verifyBundle()` re-runs `evaluateReport()` and reports each of these as a problem:
   - `recorded evidenceComplete conflicts with the recomputed value`;
   - `COMPLETE.json evidenceComplete conflicts with the recomputed value`;
   - the existing invariant-array mismatch.

   Its `evidenceComplete` output is the recomputed value, and it is valid only when there are no problems.

## New definition
```
evidenceComplete  ⇔  I01 ∧ … ∧ I20
I20               ⇔  counters.rows.unclassifiable = 0
                     ∧ Σ_b rows.unclassifiable = 0
                     ∧ Σ_{b classified} classifier.malformedRows = 0
```
I15 (no failures) is independently false whenever a `rows_unclassifiable` failure exists. The effect is conjunctive: removing the failure record alone does not make evidence complete.

## Operator effect
- Exit code 10 (`EV1_EVIDENCE_INCOMPLETE`).
- `COMPLETE.json.evidenceComplete: false`.
- `--verify` ⇒ `EV1_BUNDLE_VERIFIED_INCOMPLETE`.

The runbook stop markers now name `rows.unclassifiable > 0` (07, updated).
