# L-GAP-1 — labor UI result propagation (R10-GATE-014)

## The defect

`index.html` before this round:

```js
const setDailyLabor = async (date, val) => {
  if (typeof submitLaborEntry === "function") await submitLaborEntry(date, val);
};
...
onChange={e=>setDailyLabor(date,e.target.value)}
```

`submitLaborEntry` is fully typed and correct. `setDailyLabor` awaited its promise and
discarded the resolved value, and `EmployeesScreen` declared no error state — the only
entry-error surface in the file, `entrySaveError`, belongs to the dashboard screen. Every
typed non-commit outcome therefore died one line before it reached a human: the operator
typed a payroll figure and a refused, conflicted or rejected write left no trace anywhere.

Gate 5 had tested `submitLaborEntry` directly, so the defect was invisible to it: the
tested function was not the function the screen calls.

## The fix

`setDailyLabor` binds the result, routes it through the **existing production mapper**
(`window.MarjinSaveLifecycle.describeSaveOutcome`) — no parallel API — into a new
`laborSaveError` state rendered as a banner above the daily grid
(`data-testid="labor-save-error"`), and returns the typed result to its caller. A commit
clears the banner.

Two refusal texts were added to `describeSaveOutcome` because they previously fell
through to catch-all wording: `reason === "ambiguous_date_requires_id"` and
`status === "invalid_date"`. Both additions are additive; no existing branch changed.

No lifecycle protection was reduced: `submitLaborEntry`, the coordinator, the mutator and
every ownership seam are untouched.

## Why a failure cannot look like success

The input is fully controlled by stored data — `value={hasVal?val:""}` where `val` comes
from `getDailyLabor(date)`, which reads `entries`. `entries` is only updated by the lane's
`applyRows` on a commit. A refused write therefore leaves the stored value on screen, and
the banner explains why. `LAB-N1` and `LAB-N5` assert exactly that.

## Coverage — `test/dashboard/entries-labor-screen.test.mjs`, 14/14

Every test starts at the RENDERED input's own `onChange` expression, extracted from the
`<input placeholder="₪ נוכחות">` element in `index.html` by attribute brace-matching, and
runs the whole chain: `onChange → setDailyLabor → submitLaborEntry → coordinator → real
transaction → typed outcome → visible state`. Nothing in the chain is re-implemented.

| Test | Outcome exercised | Visible effect asserted |
|---|---|---|
| `LAB-F1` | fidelity | the extracted expression is exactly `e=>setDailyLabor(date,e.target.value)` |
| `LAB-F2` | fidelity | `setDailyLabor` binds the result, maps it, and reaches a state setter |
| `LAB-S1` | commit | one `upsert_entry` addressed by the row's immutable id, value committed, no banner |
| `LAB-S2` | commit after failure | the banner left by a failure is cleared |
| `LAB-S3` | create | a new date gets a canonical id-bearing row, no banner |
| `LAB-N1` | `blocked` / `ambiguous_date_requires_id` | duplicate-date message; **nothing** reaches the lane; field still shows the stored value |
| `LAB-N2` | `blocked_entry_identity_required` | identity message; nothing submitted; node untouched |
| `LAB-N3` | `invalid_date` | date message; nothing submitted |
| `LAB-N4` | `conflict` | conflict message; the other writer's committed value survives byte-intact |
| `LAB-N5` | transport rejection → `failed` | failure message; nothing committed; field still shows the stored value |
| `LAB-N6` | retry exhaustion | competing writer invalidates every attempt; the exhaustion is visible; not committed |
| `LAB-N7` | `stale` / `cancelled` | returned typed; **never** rendered as an error and never clears a banner |
| `LAB-N8` | propagation | the typed status and reason survive the wrapper for both refusal and commit |
| `LAB-X1` | **negative control** | the pre-fix wrapper (result discarded) produces no operator-visible state — proving these tests can see the regression |

## One deliberate deviation from the brief, flagged for the reviewer

The brief lists `stale` among the outcomes to handle. It is handled, but **silently**:
no banner is shown, no existing banner is cleared, and it is never treated as success
(`LAB-N7`). That follows the outcome policy already accepted for `deleteEntryByDate` in
Gate 5 — a selection change is not an operator error, and showing an error for the
business the operator just left would be noise. If the intent was a visible message for
`stale` too, this is a one-line change and should be called out in review rather than
assumed.

## Reachability notes

- `invalid_date` is only reachable when the bound date is empty; the daily grid always
  supplies a well-formed date string. The test drives the rendered expression with an
  empty date and says so.
- The input writes on **every keystroke** (`onChange`, no debounce), so each character
  submits an `upsert_entry`. That is pre-existing behaviour, unchanged here, and is
  recorded in `KNOWN_LIMITATIONS.md`.
