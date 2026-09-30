# 03 — Earlier expectations superseded by the owner amendment (not B1 defects)

| Test | Old expectation | New expectation |
|---|---|---|
| golden O-02 | closed Sep 5 carries global/fixed: 10000 / 1000, profit −6500 | Sep 5 carries 0; 29 eligible dates: 270000/29, 27000/29, profit −166500/29 |
| golden O-15 | all completed days closed: costs accrue, profit −2200 | completed closures carry 0 (future dates carry the month): profit 0 |
| golden O-20 | a closed day's daily labor = global allocation 1000 | 0 on the completed closure; Sep 1 = 100 + 30000/29 |
| golden G-10, R1-G | `globalAllocation:"calendar_days"`, LABOR/2, FIN/2 | `eligible_days_excluding_completed_closures`, LABOR/3, FIN/3 |
| B1 API-03 | the ledger is read only with `need.exceptions` | also read with `need.config` / `need.fixed` (TD-CDM1-2) |
| B1 API-13 | direct report with `NO_DECLARED_CLOSURES` | direct report with the product closure calendar (source `entry_exception_closure`) |
| B1 B1R1-01 | ledger decodes to booleans | decodes to `{status, reasonCode}`; boolean meaning identical |
| B1 PRJ-01 | projection ≡ v1 composition, projected revenue a decimal string of the binary engine value | ≡ v2 composition, exact amount string |
| B1 PFN-04, GUARD-03, fincore G-S4 | `NO_DECLARED_CLOSURES` bound; PRODUCT/1; product imports `src/forecast` | the product closure calendar bound; PRODUCT/2; no `src/forecast` import |
| B1 GUARD-08 | closure = base + `productFinance.ts` | + `src/metrics/revenueForecast.ts` |
| report semantics | nonzero `payroll` on a closed day contradicts it | only nonzero revenue does (CD-AT11) |

Without any declared closure, the placement equals the previous calendar placement: monthly × segment days / month days over a segment's days = monthly / month days per date. Every other golden, B1 and Slice A expectation is unchanged and passes.
