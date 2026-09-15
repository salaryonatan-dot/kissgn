# A legacy client after cutover

The dangerous transition case: a browser tab loaded before the cutover still holds the
legacy code path and tries to write `{_v: …}` to a business that is now V2.

## Required outcome — and what actually happens

| Attempt | Result | Proven by |
|---|---|---|
| whole-node legacy write `{_v: …}` | **denied** | `V2-X01` |
| direct child write to `…/entries/_v` | **denied** | `V2-X01` |
| schema downgrade `{schemaVersion: 1, _v: …}` | **denied** | `V2-X01` |
| the node afterwards | **byte-intact** | `V2-X01` asserts the whole node is unchanged |

It cannot overwrite rows, cannot downgrade the schema, cannot remove V2 data and cannot
create a second authoritative state.

## Why each is denied

- **Whole-node write.** The node validator requires that a write producing
  `schemaVersion !== 2` is only legal when the stored node was not already V2. A legacy
  `set({_v})` produces a node with no schema marker on a business that has one.
- **`_v` child write.** Once the business is V2, `_v` may only be rewritten to its own
  current value. A legacy client writing a new blob changes the value, so it is denied.
- **Downgrade.** `schemaVersion` may only ever be `2`, and only when it is absent or
  already `2`.

## What the operator sees

The write fails at the transport, so the mutator returns
`{ status: "failed", error: "permission_denied" }`. That flows through the typed outcome
path R10 already fixed: `describeSaveOutcome` renders the generic save-failure message —
"the data was not saved, try again" — and the labor and delete call sites surface it in
their banners. Nothing looks like success, and nothing is written.

A stale tab therefore degrades to "this browser cannot save until it is reloaded", which
is the correct behaviour and is fail-closed. Making that message more specific (for
example "this page is out of date — reload") is a UX addition and is listed as a
follow-up rather than done unilaterally here.

## The read side

A legacy client also *reads* `_v`. After cutover that value is the frozen pre-cutover
snapshot, so an old tab shows stale data until it reloads. It cannot act on it: every
write it attempts is denied. New clients never read `_v` at all — `readEntriesNode`
dispatches on `schemaVersion` and a malformed V2 node fails closed rather than falling
back (`V2-X02`).
