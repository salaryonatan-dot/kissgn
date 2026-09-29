# Labor + Fixed Cost Calculation Contract — FROZEN (owner, 2026-09-29)

Status: **canonical**. Source: the owner's FINAL OWNER CONTRACT of 2026-09-29. It supersedes every earlier wording about labor and the Actual window (see `SUPERSESSION.md`).
Code versions: `MARJIN_LABOR/2`, `MARJIN_FIN/2`, `MARJIN_PROJ/2`, `MARJIN_NORM/3`. A copy lives in the R1.4 package as `09_LABOR_FIXED_COST_CALCULATION_CONTRACT.md`.

## 1. Daily labor cost

```
DAILY LABOR COST = hourly employer cost (ShiftOrganizer)  +  global employer cost allocation
```

| Part | Source | Meaning | Where in Marjin today |
|---|---|---|---|
| **Hourly** | ShiftOrganizer (attendance system) | The authoritative daily **full employer cost of HOURLY employees only**. Global/full-time employees are excluded. | Entered manually into the entry-row field `payroll`: Employees screen daily grid "עלות כ״א יומית (מתוכנת נוכחות)" (`index.html:7890-7906`) and entry form "עלות שעתיים / נוכחות יומית נוספת (₪)" (`:6964`) |
| **Global** | Marjin employee configuration | Each global/full-time employee's **monthly FULL EMPLOYER COST**. Not gross, not net, no multiplier, no conversion. | `biz:{id}:config.employees[]` with `type: "global"`, field `monthlySalary` (`:7835-7847`, input `:7954`) |

- **No overlap.** ShiftOrganizer never contains global employees, so the two parts are simply added.
- The core applies no payroll formula, uplift or conversion to either part.
- The UI label on the global amount still reads "משכורת חודשית ברוטו" (`:7953`). The owner contract overrides that label. The label fix is a consumer item (VD-28 revised).
- Provenance in code:
  - Hourly: `LABOR_SRC/shiftorganizer-hourly-manual/2026-09-29` = `{meaning: authoritative_employer_cost, sourceSystem: attendance_workforce, sourceProduct: ShiftOrganizer, ingestionMethod: manual, coverage: hourly_employees_only, fields: ["payroll"]}`.
  - Global: each entry is `{kind: authoritative_employer_cost, sourceSystem: marjin_employee_config, ingestionMethod: manual}`.
- A future integration may change `ingestionMethod`/`sourceSystem`, never the meaning.

## 2. `hourly_payroll` — legacy, never counted

`hourly_payroll` is not a current business concept.

- It is **never** a labor source and **never** added to labor.
- Declaring it as a labor field is a contract error (`legacy_labor_field_not_countable`).
- Its values are kept only as an uncounted datum (`CanonicalDay.legacyHourlyPayroll`, `counted: false`) and flagged `legacy_hourly_payroll_not_counted`.
- An invalid `hourly_payroll` value does not invalidate labor.
- What current consumers do with it: see `HOURLY_PAYROLL_FINDING.md`.

## 3. Global employees — calendar-day allocation

```
global per day = Σ monthly employer cost of global employees in force that day / calendar days of that month
```

- The allocation applies to **every calendar day**: operating days, **closed days** and days without data.
- It never divides by operating days and is never conditioned on revenue or on entry rows.
- The full monthly amount is recognised by month end: 30 days × monthly/30 = monthly.
- Effective-dated changes apply per day (`G-11-*`, `G-12`).
- Allocation per case:

  | Case | Treatment | Error / flag |
  |---|---|---|
  | Listed global employee without an amount | MISSING, never zero | `missing_global_amount` |
  | Unparsable amount | INVALID | `invalid_global_amount` |
  | Negative amount | INVALID | `invalid_global_amount` (`negative_amount`); in a recorded timeline, a contract error |
  | Recorded timeline entry that is not `authoritative_employer_cost` (e.g. `gross_salary`) | Contract error | `global_cost_not_employer_cost` |
  | Non-global employee with an amount (e.g. legacy `type: "hourly"`) | Never counted | `employee_amount_not_global` (reported) |

## 4. Fixed costs — calendar-day allocation

Rent, arnona, subscriptions, accounting and every other enabled fixed item: `monthly / calendar days`, on every calendar day, closed days included.

- Percentage rent/royalty are the only revenue-linked charges. They apply to the day's recorded revenue.
- `fixedAccrual` is typed. Its amounts exist only when:
  - configuration covers every recognised day;
  - no fixed amount or rate is missing or invalid;
  - revenue is complete whenever a percentage charge applies.
- Otherwise the amounts are `null` with the issues listed.

## 5. Closed day vs missing day

| | Closed day | Missing day |
|---|---|---|
| What it is | Intentional non-operating day | Data not yet entered |
| How it is known | **Declared** in the caller's operating calendar (`context.operatingCalendar = {source, closedDates}`) | Any recognised day that is not declared closed and lacks a required fact |
| Revenue / purchases / hourly labor | Not required | Required ⇒ missing ⇒ result incomplete |
| Global + fixed cost | Accrue | Accrue |

- Closed is **never inferred** from absent revenue.
- Without a declaration (`source: "none_declared"`) no day is closed, so absent data is missing.
- This is not a universal 365-day rule. It is the absence of a closure declaration, and any business can declare closures.
  - The pilot operates 365 days/year, so for the pilot a missing completed day is normally missing data.
  - Nothing in the core hardcodes 365-day operation.
  - The product has no closure-declaration input today; that is a future consumer/input item.
- Recorded non-zero revenue or hourly labor on a declared closed day contradicts the declaration: issue `operating_calendar / invalid / closed_day_has_recorded_values`.
- Explicit zeros, purchases and other expenses on a closed day are consistent and are counted.
- A window whose completed days are all closed has a known zero revenue. Profit is a real loss (global + fixed), and labor % has a zero denominator.

## 6. Actual window — last completed business day (D-1)

Under the current **manual** model:

```
Actual MTD = month start … last completed business day = asOfBusinessDate − 1
```

- **Example:** on the morning of Sep 29, Actual = Sep 1–28.
- **What stays out:** Sep 29 enters no Actual revenue, purchases, hourly labor, global labor, fixed accrual, profit, labor %, food-cost %, average or any other Actual KPI. A supplied Sep 29 row or day object is ignored for Actual; the day object is not even required.
- **On the 1st of the month:** there is no completed day. `window.state = "no_completed_days"`, and every typed total is `empty_window`.
- **Closed month:** all its days.
- **Report fields:** `window.rule = "completed_days_through_d_minus_1"`, `window.completedThrough`, `window.currentDay = {date, inActual: false}`.
- **Current day not entered:** it never makes the completed MTD incomplete (test 11).
- **Missing data inside the completed window:** it always makes the dependent outputs incomplete (test 10). These outputs are profit, contribution, labor, labor %, purchases %, and fixed when a % rent applies.
- **Daily adapter:** `toDailyMetric` refuses the current day and later (`day_outside_actual`).

## 7. Economic accrual vs report window

- Costs accrue economically by calendar day, but the current day lies outside the completed Actual window.
- The current day's global and fixed accrual belongs to **projection context** (`ProjectedFinancials.afterActual`).
- No live/same-day model is designed. A future live model would be a new window rule and version; it is deferred.

## 8. Forecast / projection stays separate

- `applyProjection` returns a separate object. It covers the full calendar month of global and fixed cost, and `afterActual` holds the current day through month end.
- Hourly labor, purchases and other expense are projected as Actual ratio × projected revenue, and only from a complete Actual.
- When global or fixed cost is unknown, the projection shows `null` plus a warning, never 0.
- Nothing projected is ever written into, merged into or read back as Actual. Test 7 checks that the serialized Actual stays byte-identical.

## 9. Global-employee data persistence (current behaviour, no migration)

- Today the global list is one **undated current-state** object in `biz:{id}:config`. It has no history or effective dating, and the core labels it `current_applied_retrospectively`.
- The owner reports that values disappear each month and must be re-entered. That is not the desired model.
- The approved target remains **effective-dated history** (BD-2 / Slice F `cost_versions`). The timeline type already carries `effectiveFrom`, `recordedAt` and `basis` per version with `globalEmployees[]`, so future persistence needs no semantic change.
- No Production data migration is part of this change. See `GLOBAL_EMPLOYEE_DATA_FINDING.md`.

## 10. Deferred

- Live/same-day Actual model.
- Closure-declaration input and persistence.
- Effective-dated persistence of global employees (Slice F).
- ShiftOrganizer integration.
- Consumer migration of every `hourly_payroll` sum and of the entry-count-based global proration (B1/C1).
