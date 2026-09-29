# GLOBAL_EMPLOYEE_DATA_FINDING — current behaviour (no Production migration)

The owner reports that global employee values disappear each month and must be re-entered. That is not the desired model; the approved target remains effective-dated history.

## What the code does today (base `f5d0a8ed`, read-only)
| Aspect | Current behaviour | Evidence |
|---|---|---|
| Storage | One undated list `employees[]` inside the single object `biz:{id}:config`. There is no month key, no `effectiveFrom` and no history. | `saveBusinessConfig` → `window.storage.set(\`biz:${id}:config\`, JSON.stringify(cfg))` (`index.html:5154-5158`); subscription `:4988` |
| Add / edit / remove | Add and edit write `{name, role, type: "global", monthlySalary}` into the list; remove filters it out. | `:7835-7847` |
| Month navigation | The Employees screen's month picker changes only the **divisor** (`emDays`) and the daily grid dates. The list itself is not per-month. | `:7793-7829` |
| Candidate deletion path | Re-running the setup/settings wizard builds a fresh `cfg` without an `employees` key and writes it as the whole config object. That drops the list (along with any other keys the wizard does not carry). | `SetupWizard` cfg `:3978-3994`, `onComplete` → `storage.set(config, cfg)` `:5918-5925` |
| Month-by-month disappearance | **Not reproducible from code.** No code path resets `employees` at a month boundary. The wizard overwrite above is the only code-level deletion path found besides explicit removal. It is reported, not fixed. | — |
| Proration in current consumers | `calcMetrics` and `snapshotBuilder` prorate by `entries.length / daysInMonth` (entry-row count), which conditions global cost on entered days. The Employees screen and entry form prorate `monthly / calendar days` per day (rounded per employee). | `index.html:4364-4371`, `:6925-6926`, `:7829`; `src/snapshot/snapshotBuilder.ts:224-236` |

## What this change does
- **No schema, Rules, data or index.html change**, and no Production migration or backfill.
- `configCompat` reads the current list as **authoritative employer cost**, calendar-day allocated.
  - A listed employee without an amount is **missing** (`missing_global_amount`), so a blanked value shows as "incomplete", never as a silent 0.
  - A wholly deleted list cannot be distinguished from "no global employees". This is a known limit of the undated storage and is fixed only by effective-dated persistence.
- The cost timeline type is already effective-dated (`CostVersion {versionId, effectiveFrom, recordedAt, basis, globalEmployees[]}`). Future persistence (BD-2 / Slice F `cost_versions`) needs **no semantic change**:
  - each persisted version carries the employees' monthly employer cost;
  - the core allocates it per calendar day in force.

## Deferred (not in this commit)
- Effective-dated persistence (Slice F).
- A fix for the wizard overwrite (consumer/C1 item, `index.html`).
- Relabelling "משכורת חודשית ברוטו" to employer cost (C1).
