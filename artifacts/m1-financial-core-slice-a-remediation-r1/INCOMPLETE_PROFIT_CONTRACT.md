# Incomplete-Profit Contract — TI-18

A total that depends on several components is a **typed result**; a number exists only when every required component is complete.

```ts
type TypedAmount =
  | { state: "complete"; value: AmountString; issues: [] }
  | { state: "revenue_missing" | "incomplete_components" | "invalid_components"; value: null; issues: ComponentIssue[] };
type ComponentIssue = { component: "revenue" | "purchases" | "labor_employer_cost" | "salaried_employer_cost" | "other_expense" | "cost_configuration";
                        kind: "missing" | "invalid"; reason: string; dates: BusinessDate[] };
```
Applies to `actual.operatingProfit`, `actual.contributionBeforeFixed` and `actual.labor.employerCost`; `actual.labor.employerCostPct` carries `incomplete_components` / `invalid_components` states.

## Required components (per recognised day of the window)
| Component | Required | Complete when | Explicit zero |
|---|---|---|---|
| revenue | every day | present and not partial | `0` is a real fact (can produce a real loss) |
| purchases | every day | present (supplier map incl. `0`/`"skip"`, or legacy `food_cost`) and not partial | complete |
| labor employer cost (entered) | every day | present and not partial, under a valid `LaborSourceInput` | complete |
| salaried employer cost | only for scope `excludes_salaried` | every day's version has only authoritative salaried entries | an empty salaried list is an explicit "no salaried staff" |
| other_expense | optional category (declared in the contract) | absence = none recorded; an invalid/partial value is an **invalid component** | complete |
| cost configuration | every day | a version covers the day; no invalid fixed/rate value; no enabled fixed item without an amount and no percentage rent/royalty without a rate (`missing_fixed_amount`, `missing_rate`) | an explicit 0 amount/rate is complete |

Missing ≠ zero; invalid ≠ zero; not-recorded employer cost ≠ zero; gross salary never completes labor.

## State precedence
`invalid_components` (any invalid/partial required value or invalid config — including invalid revenue) → `revenue_missing` (no revenue recorded in the window) → `incomplete_components` (any missing required value) → `complete`. `issues` always lists every problem found.

## Layers that must not turn a non-value into a number
- Report computes the value only inside `typedAmount(() => …)` when there are no issues; required operands are asserted non-null.
- Projection (`applyProjection`) derives ratios only from a complete Actual; otherwise purchases/labor/profit are `null` with `actual_components_incomplete`.
- Presenters: `formatTypedAmount` renders "—" for any non-complete state; ratio presenters render "—" for non-value states.
- Labor %: `labor.employerCostPct` is a value only when the employer cost AND revenue are complete over the window.
- Policy: `evaluatePolicy` returns `not_evaluable` for non-value ratios and for a purchases goal whose revenue or purchases coverage has missing, invalid or partial days.
- Legacy adapter: `toDailyMetric` has no profit field; ratios are `null` when not a value.

## Required cases (goldens, both compiled source and committed artifact)
| Case | Golden | Result |
|---|---|---|
| A revenue present, purchases missing, labor present | R1-A | `incomplete_components` (purchases missing) |
| B purchases explicit 0, labor authoritative | R1-B | `complete` 800 |
| C labor invalid | R1-C | `invalid_components` |
| C2 purchases partially invalid (Codex adversarial) | R1-C2 | `invalid_components` |
| D revenue missing, costs present | R1-D | `revenue_missing` |
| E revenue explicitly 0, costs complete | R1-E, G-15 | `complete` −300 / −100 |
| F authoritative value not entered; gross salary present | R1-F | labor `incomplete_components`; no gross fallback |
| G authoritative value entered (manual, attendance) | R1-G | labor `complete` with provenance |
| H gross salary only under `excludes_salaried` | R1-H | `salaried_employer_cost / gross_salary_not_employer_cost` |
| other_expense invalid / fixed config invalid / missing day | R1-I, R1-J, R1-L | invalid / invalid / incomplete |
| rate or fixed amount missing in config | R1-M, R1-N | incomplete (cost_configuration missing) |
| labor % with an incomplete denominator | R1-O | `incomplete_components` |
| revenue invalid on every day | R1-P | `invalid_components` |

## Open owner decision (reported, not changed)
BD-3 keeps today live/open and recognised. Under TI-18 today is therefore a required day: month-to-date profit is `incomplete_components` until today's revenue, purchases and labor are entered (the issue lists exactly those dates). If the owner prefers an MTD profit "through yesterday" while today is open, that is a presentation/window choice for C1 (e.g. a closed-days sub-window), not a change to the completeness rule.
