# Blocking finding 1 — stale delete could erase concurrent row fields

## What Codex reproduced

> User A can render a row, user B can commit `supplier_payments` or another undeclared
> non-revenue field to that same row, then user A can delete based on the stale UI. The
> transaction commits because the declared base still matches. The concurrent update is
> silently removed with the row.

Its probes showed `"staleDeleteStatus": "committed"`, `"rowDeleted": true`, and the
rendered call site submitting `base: { fields: { sales, deliveries, other_income } }`.

## Why the old shape could not be patched

Adding `supplier_payments` to the list would have fixed exactly this instance and left the
same hole for the next field. The defect is the *shape* of the precondition — a
hand-maintained list of paths — not the particular paths in it.

## The contract now

`buildEntryDeleteIntent(prev)` (exported from `window.MarjinSaveLifecycle`):

```js
return { type: "delete_entry", opId: o.opId, target: { id: prev.id },
         base: { row: JSON.parse(stableStringify(prev)) } };
```

and in the transaction:

```js
const baseRow = intent.base && intent.base.row;
if (!isPlainRow(baseRow)) return { ok: false, status: "precondition_missing", reason: "delete_base_row_required" };
if (stableStringify(baseRow) !== stableStringify(row)) {
  return { ok: false, status: "conflict", conflictPaths: rowDiffPaths(baseRow, row) };
}
```

Four properties follow:

1. **Generic.** Any difference in any field aborts — including fields that did not exist
   when the guard was written. `SD-B[brand_new_field]` asserts precisely that.
2. **Fail-closed.** A delete with no complete base row is refused, so a caller cannot
   opt out of the guard by omitting it (`SD-F2`).
3. **Row-scoped.** Only the target row is compared, so concurrent changes to other rows,
   added rows and reordering do not cause a false stale (`SD-E`, `SD-E2`, `SD-E3`).
4. **Precise.** `rowDiffPaths` names the changed paths in the same shape every other
   conflict uses, so the existing typed UI path shows the operator what moved.

**Exclusions: none.** Every persisted field of an entry row is written by the client and
is semantic; the node carries no server timestamp, no derived total and no revision
counter. `SD-F1` asserts that the base row's key set is the row's full key set, so an
exclusion cannot be introduced silently.

Identity is untouched: the target is still resolved by immutable id only, there is no date
or positional fallback, and business/tenant/generation ownership is unchanged — the intent
still travels through the same coordinator, mutator and selection controller.

## Call sites

`deleteEntryByDate` (the UI's delete action) and `deleteEntryById` (the duplicate-row
delete added in R10) both build the intent with the production builder and both surface a
typed builder refusal without submitting anything, following the R10-GATE-012 rule.

## Regression coverage — `test/dashboard/entries-stale-delete.test.mjs`, 31/31

Every behavioural case runs the rendered call site through the real coordinator, the real
mutator and the Gate-3-approved remote — the actual runtime transaction path, not a helper
in isolation.

| Brief | Test | Result |
|---|---|---|
| A. concurrent `supplier_payments` | `SD-A`, `SD-A2`, `SD-A3` | delete aborts; the supplier change and the row survive; `conflictPaths = ["supplier_payments.sup3"]` |
| B. every supported mutable field | `SD-B[...]` ×16, `SD-B-map`, `SD-B-removed` | aborts for `date`, `sales`, `deliveries`, `food_cost`, `payroll`, `other_expense`, `other_income`, `weather_impact`, `security_event`, `includeVat`, `notes`, `is_exception`, `exception_reason`, `exception_note`, an unknown field, a brand-new field, a map field, and a field REMOVAL |
| C. unchanged row | `SD-C` | commits normally, no error |
| D. same-date sibling | `SD-D`, `SD-D2` | only the addressed id is removed; the twin is byte-intact; a change to the twin does not block the target |
| E. unrelated-row change | `SD-E`, `SD-E2`, `SD-E3` | commits — no false stale from a changed row, an added row, or reordering |
| F. negative control | `SD-F` | the superseded partial base is refused by the transformation, and the test demonstrates why it used to pass: the declared paths were unchanged while the row had in fact changed |
| fidelity | `SD-F1`, `SD-F2`, `SD-F3` | complete-row base with no exclusions; missing base refused; id-less row cannot produce an intent |

Real-emulator coverage of the same scenarios: `EMU-F-stale-delete-supplier`,
`EMU-F-delete-unchanged`, `EMU-F-unrelated-row` — see `EMULATOR_RESULTS.md`.

## Existing tests that had to change

- `entries-concurrency-matrix.test.mjs` **C-10c** documented the OLD boundary — "a delete
  declaring only `sales` is not invalidated by a concurrent `date` change, so it commits".
  That is the behaviour Codex exploited in its general form. It now asserts the delete is
  refused with `conflictPaths = ["date"]` and every row survives.
- `entries-ui-call-sites.test.mjs` **G5-D01** asserted the declared-field base; it now
  asserts the complete canonical base row.
- `entries-lifecycle.test.mjs` pins the exported `MarjinSaveLifecycle` surface, so its
  `FREEZE` constant gained `buildEntryDeleteIntent` and `rowDiffPaths`.
- The two harnesses build deletes through the production builder; the cross-writer harness
  keeps a `legacyBaseFields` escape hatch used by nothing but a negative control.

All of these are now green together: lifecycle 112/112, UI call sites 49/49, concurrency
41/41, clear-all 42/42, duplicate delete 10/10.
