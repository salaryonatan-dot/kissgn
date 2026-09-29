# 07 — Persisted doc compatibility and rollback

## What changes in `tenants/{t}/biz:{b}:analytics:daily:{date}`
| Field | Before B1 | B1 |
|---|---|---|
| `revenue.sales/deliveries/other_income/total/food_cost/payroll` | always numbers (`Number(v)||0`) | present only when the canonical fact is complete; omitted otherwise |
| `revenue.payroll` | `payroll + Σ hourly_payroll` | canonical daily labor = `payroll` + global calendar-day allocation |
| `revenue.had_entry` | a row exists and sales/deliveries/food_cost > 0 | presence of the business date (explicit zero counts) |
| `revenue.has_sales` | any revenue part > 0 | complete revenue > 0 |
| `fin` | — | NEW additive block (versions, exact amounts, presence, flags; no ids / free text) |
| duplicate business date | build refused (`EntriesAmbiguityError`) | one aggregated doc |
| current / future date | built with numbers | `fin.inActual:false`, no financial legacy field |
Everything else (weather, alerts, operational, calendar, meta, exception) is unchanged. Insights docs: unchanged engine; non-Actual docs take the empty path.

## Mixed deployment
- **Old readers on new docs:** `strictLegacyDailyMetric` (alerts) skips a date with an omitted field (COMPAT-01/07); the insight engine never sees NaN (COMPAT-02/03, `baselines.trailingRatioAvg` / `rules.ruleLaborRisk` guards); `fin` is ignored by old code.
- **New code on old docs** (no `fin`, all numbers): handled as legacy history (COMPAT-04).
- The API wrapper `api/analytics/daily-builder.ts` is unchanged and works with the new docs: GET summary, manual POST, `rebuild_after_entry_save` readback (COMPAT-08).

## Rollback
- Docs are derivatives rebuilt nightly (02:00 IST cron for yesterday) and on each entry save. Redeploying the pre-B1 build makes the next builds write the old shape again; B1 docs left in RTDB remain readable by the old code (omitted keys ⇒ strict skip; `fin` ignored).
- No migration, no backfill, no Rules change, no stored-entry change: rolling back is a redeploy only. No data repair is needed in either direction.
