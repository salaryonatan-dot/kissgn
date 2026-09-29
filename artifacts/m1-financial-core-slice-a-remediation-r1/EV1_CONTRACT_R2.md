# EV-1 Contract R2 (pre-B1, READ-ONLY; NOT EXECUTED)

Supersedes `financial-core-b1-readiness/02_EV1_EVIDENCE_CONTRACT.md` field list. Classifier: `tools/finance-core/ev1-classifier.mjs` (`EV1/2`), pure, no I/O; tests: `test/finance/ev1-classifier.test.mjs` (part of the full suite). **0 Production reads.**

## Fail-closed input
`classifyBusiness(rows, asOf)` throws `Ev1InputError`: `rows_not_array` (non-array / undecoded node), `invalid_as_of` (as-of not a real calendar date). `summarize(perBusiness, readFailures)` sets `evidenceComplete` true only when ≥ 1 business was classified and `readFailures` is an empty array (undefined ⇒ incomplete).

## Output (per business) — counts and canonical row UUIDs only
Overlap rule: counters overlap unless stated exclusive.

| Group | Fields |
|---|---|
| census | `rowsTotal`; `malformedRows` (non-object rows; exclusive — counted nowhere else) |
| identity (all object rows, incl. future/invalid-date) | `validIds` (canonical UUID v4, same pattern as `entriesReader`), `missingIds` (undefined/null/""), `malformedIds`, `duplicateIdRows`, `duplicateIdValues`, `duplicateIds[]` (≤ 50, canonical ids only; malformed id values are never output) |
| dates (exclusive chain) | `badShapeDateRows` → `impossibleDateRows` (real Gregorian validation: month 1–12, day ≤ days-in-month incl. leap rule) → `validDateRows` = `futureRows` + `actualWindowRows`; `duplicateDateDates` |
| supplier (actual-window rows) | `rowsWithSupplierRecorded`, `rowsWithExplicitZeroCell`, `rowsWithSkipCell`, `rowsWithNegativeCell`, `rowsWithInvalidCell`, `rowsWithOffsettingNonzeroCells` (≥ 2 non-zero cells whose exact sum is 0), `invalidMapShapeRows`, `cells{zero,skip,positive,negative,invalid}` |
| legacy food_cost | `presentPositiveRows`, `presentNegativeRows`, `presentZeroRows`, `invalidRows`, `legacyOnlyRows` (food present, supplier not recorded) |
| VD-16 | `supplierRecordedAndLegacyFoodRecorded` (collision), `ofWhichSelectionChanges` (today's `Σsupplier || food_cost` picks food), `supplierRecordedAndLegacyFoodInvalid`, `rowIds[]` (≤ 50) |
| labor (entered employer cost) | `rowsWithLaborPresent`, `rowsWithLaborZero`, `rowsWithLaborInvalid`, `invalidHourlyMapShapeRows` |
| presence | `noFinancialValueRows` = `notesOnlyRows` + `emptyRows` + `invalidOnlyRows` (exclusive sub-classes, precedence invalid → notes → empty); `rowsWithInvalidFinancialCell` (overlaps) |
| VD-23 drivers | `rowsZeroOnlyPresent`, `rowsNotEnteredTodayButPresentNow`, `revenueZeroRows` (overlaps), exclusive "only" drivers: `laborOnlyRows` (⊇ `hourlyOnlyRows`), `otherIncomeOnlyRows`, `otherExpenseOnlyRows`, `purchasesOnlyRows` |
| invalid cells | `invalidCellsByReason` (`ambiguous_comma`, `bad_grammar`, `wrong_type`, `out_of_range`, `non_finite`, `invalid_map_shape`), `invalidCellsByField` |
| other | `includeVatTrueRows` |

Never output: amounts, row dates, notes/free text, business or person names, malformed id values, emails, payloads (test asserts no leakage).

## Aggregates
`businessesScanned`, `readFailures[{scope,tenantId,bizId,code}]`, `evidenceComplete`, `businessesWithDuplicateIds`, `businessesWithMissingOrMalformedIds`, `businessesWithVd16Collisions`, `businessesWithSelectionChanges`, `totalVd16Rows`, `totalSelectionChanges`, `businessesWithZeroOnlyRows`, `businessesWithInvalidCells`, `businessesWithImpossibleDates`, `businessesWithLegacyOnlyFoodRows`.

## Go/no-go for B1 (unchanged principle, extended)
`evidenceComplete:false` ⇒ STOP. `businessesWithDuplicateIds > 0` ⇒ B1 cannot read those businesses (core rejects duplicate ids) — Gate 0 remediation decision required first. Impossible dates, invalid cells and VD-16 selection changes are listed per business in the B1 release note; nothing is repaired by EV-1 or B1.

## Still required before execution
A reviewed read-only collector (reusing Gate 0 D1 transport and fail-closed read accounting), separate CTO authorization, and a clean run. EV-1 contract status after R2: **READY for collector implementation/review**; B1 remains NOT READY until EV-1 evidence exists.
