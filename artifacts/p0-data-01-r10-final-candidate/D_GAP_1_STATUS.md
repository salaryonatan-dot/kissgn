# D-GAP-1 — status: **FIXED** (R10-GATE-015)

## Specification check performed first

Phase 4 required leaving D-GAP-1 open if the specification says deletion must remain
unavailable in R10. It does not. The only recorded position is the opposite — the gap is
described as a referred UI addition, not a prohibition:

> **D-GAP-1 — `deleteEntryById` is unreachable from the UI.** It is defined and correct
> (G5-D07, G5-D08) but no element invokes it, so R10-GATE-006's "duplicate-date rows are
> individually deletable" is not reachable by an operator; the wired delete refuses
> ambiguous dates (G5-D02). Wiring it is a UI addition and is referred.
> — `artifacts/p0-data-01-r10/GATE5_REAL_UI_CALL_SITE_COVERAGE.md`

R10-GATE-006 is the contract that duplicate rows are distinct, individually deletable
records. Nothing forbids exposing it. The gap was implemented.

## What the inspection found — the gap was larger than "no button"

The dashboard day list is built as:

```js
entries.forEach((e,i)=>{
  if(e?.date && e.date.startsWith(monthPrefix) && !entriesByDate.has(e.date)) {
    entriesByDate.set(e.date, {...e,_idx:i,__missing:false});
  }
});
```

`!entriesByDate.has(e.date)` keeps only the **first** row per business date. A duplicate
row that R10 deliberately preserves was therefore not merely undeletable — it was
invisible: not rendered, not summed into the day card, not reachable by any action.

## The change

Smallest safe path, additive:

1. `dupExtras` — a per-date map of the rows **beyond the first** for the displayed month,
   built from the same `entries` array and the same head-row selection, so it cannot
   disagree with the list.
2. Each day card with extras renders them, each with its own income and payroll summary
   and a single-row delete button that calls `deleteEntryById(dup.id)` behind an explicit
   `window.confirm` naming the date and stating that one row only is removed and the
   action cannot be undone.

Against the Phase 4 requirements:

| Requirement | How |
|---|---|
| delete by stable entry ID, never by array position | `deleteEntryById(dup.id)`; `DG-F1` asserts the handler contains no `_idx`, index, `indexOf` or `splice`, and `DG-X1` proves a positional delete would have removed the *other* row |
| preserve business/identity authorization | routed through the existing coordinator and mutator with the live selection ctx; `DG-6` proves an identical id in another business is untouched and the write is addressed to the selected destination only |
| explicit operator action | `window.confirm`; `DG-2` proves declining submits nothing |
| no automatic destructive cleanup | nothing runs without a click; no self-heal, no collapse, no rewrite |
| no bulk deletion | `DG-3`: with three rows on one date, one click removes exactly one and submits exactly one intent |
| no Production action | test-only and emulator-only throughout |
| regression test the rendered call site | `test/dashboard/entries-duplicate-delete.test.mjs`, 10/10, driving the button's own extracted `onClick` |

## Coverage — 10/10

`DG-F1` handler is id-addressed, confirmed and never positional · `DG-F2` the production
collection lists exactly the rows beyond the first, in `entries` order · `DG-F3` rows
outside the displayed month are never listed · `DG-1` confirming removes exactly the
duplicate and the first row for that date stays byte-intact · `DG-2` declining changes
nothing · `DG-3` one click, one row, one intent · `DG-4` the twin sharing the date is
never taken with it and the business date still exists · `DG-5` an id-less legacy
duplicate is refused with the identity message and nothing is submitted · `DG-6`
destination scoping · `DG-X1` positional negative control.

## Deliberately not changed

`deleteEntryByDate` keeps its Gate-5-accepted behaviour, including refusing an ambiguous
date (`G5-D02`); the duplicate path is a separate, additional action. Duplicates are
still never collapsed automatically — only removed one at a time by an operator who
confirmed it.
