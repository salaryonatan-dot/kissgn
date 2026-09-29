# Owner contract — corrections A–J and tests 1–12 → code and tests

## Corrections
| # | Correction | Code | Tests |
|---|---|---|---|
| A | Global monthly amount = full employer cost | `configCompat.ts` → `authoritative_employer_cost` / `marjin_employee_config`; `costTimeline.ts` `GlobalEmployeeEntry` | G-01, G-10, O-09 |
| B | Gross-salary assumption removed | `gross_salary` kind, `grossSalaryDatumPresent`, `gross_salary_not_labor_cost` and scope `all_staff` / `excludes_salaried` removed; a non-employer-cost entry is a contract error | O-13, labor contract test |
| C | Calendar-day global allocation | `accrueDay`: monthly / `daysInMonthOf(date)` on every recognised date | O-01, G-11-*, G-12, G-29a/b |
| D | Calendar-day fixed allocation | Same function, fixed items and fixed rent | O-02, G-02, R1-E |
| E | No revenue conditioning | `accrueWindow` ignores entry rows; global is never divided by operating days | O-02, O-04a/b, O-15, property test "test 4" |
| F | Actual MTD stops at D-1 | `actualWindowDates` (`report.ts`); `toDailyMetric` refuses the current day | G-02, G-03, G-04, O-05, window contract test |
| G | An unentered current day does not make MTD incomplete | The current day is not a recognised date; its day object is not required | O-11, test 7 (`noTodayObject`) |
| H | Missing data inside the completed window ⇒ incomplete | `metricIssues` over operating days. Profit, contribution, labor, labor %, purchases %, and fixed with a % rent are all typed. | O-10, O-02b, R1-L, G-07d, O-19 |
| I | Closed vs missing distinct | `ReportContext.operatingCalendar`; `Coverage.closedDays`; contradiction issue | O-02 vs O-02b, O-14, O-14z, O-15, O-16 |
| J | `hourly_payroll` never counted | `normalize.ts` `hourlyLabor = payroll`; `legacyHourlyPayroll`; `legacy_labor_field_not_countable` | O-12, O-12e, G-05, R1-G |

## Tests 1–12
| # | Owner test | Where | Hand value |
|---|---|---|---|
| 1 | 30,000 global / 30-day month = 1,000 per day | golden O-01 (report + `dm.globalLaborCost`) | 1000 |
| 2 | Closed day still accrues global | golden O-02 (Sep 5 closed, Sep 1–10) | 30000 × 10/30 = 10000 |
| 3 | Closed day still accrues fixed | golden O-02 | 3000 × 10/30 = 1000 |
| 4 | Operating-day count does not change total global | golden O-04a/O-04b; contract property test (60 random closure sets) | 30000; 42345.67 |
| 5 | Morning of Sep 29: global covers Sep 1–28 only | golden O-05 | 28000 |
| 6 | Sep 29 accrual outside Actual | golden O-05 (a Sep 29 row with 99999 values is ignored); contract test 7 (byte-identical report with/without Sep 29) | fixed 2800, profit −16800 |
| 7 | Projection may include Sep 29–30 while Actual stays unchanged | contract "owner contract test 7" | `afterActual` Sep 29–30: global 2000, fixed 200; projection global 30000; Actual serialization unchanged |
| 8 | Hourly ShiftOrganizer + global = canonical daily labor | golden O-08 (report + daily adapter); O-20 (closed day = global only) | 2500 + 1000 = 3500 |
| 9 | Global amount participates directly (no multiplier, no gross) | golden O-09; labor contract test | 12345.67 over the full month |
| 10 | No valid revenue on an expected completed day ⇒ incomplete | golden O-10, O-02b | `incomplete_components`, revenue missing [Sep 28] |
| 11 | Unentered current day does not make prior MTD incomplete | golden O-11; contract test 7 | complete, −16800 |
| 12 | `hourly_payroll` cannot silently add a second labor amount | golden O-12, O-12e, R1-G; EV-1 R3 cross-check | 1000 (not 1400); 1250 (not 1300) |

All expected values are hand-written in `test/finance/golden/author_goldens.py`, with the arithmetic in comments next to each case.
