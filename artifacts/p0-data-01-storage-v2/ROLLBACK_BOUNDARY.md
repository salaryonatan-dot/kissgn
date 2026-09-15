# Rollback boundary

Design analysis for a safe rollout. No automatic rollback exists and none should: an
automatic path would overwrite newer V2 data with an older snapshot.

## What is retained

The pre-cutover blob is kept byte-identically at `…/entries/_v` and made immutable by
Rules. It is a frozen audit and rollback artifact — never a second source of truth.

## When rollback is safe

**Between the cutover and the first V2 write.** At that instant the frozen `_v` and the
row tree describe the same data. Reverting means writing the legacy node back and dropping
the V2 children, and nothing is lost.

## When rollback stops being safe

**The moment the first V2 write commits.** From then on the row tree contains data the
frozen `_v` has never seen. Restoring `_v` as authoritative would silently discard every
edit made since the cutover — the same class of loss as the original R9 incident.

So the exact boundary is: **the first committed write to `rows/` after `schemaVersion`
becomes 2.** Before it, `_v` is a valid authoritative state. After it, `_v` is history.

A rollback after that point is not a restore — it is a **conversion in the opposite
direction**: read the current row tree, serialize it back into a legacy array, write it as
`_v`, and remove the V2 children. That is a second data transformation with its own
preflight, its own atomicity requirement and its own review. It is not built here, and it
should not be treated as a safety net that already exists.

## Detecting which side of the boundary a business is on

Not currently recorded. Two candidates, if the CTO wants an explicit marker before
Production rollout:

- a `cutoverAt` / `firstWriteAt` pair at the collection node, or
- simply comparing the row tree against the frozen `_v`; they are identical if and only if
  no V2 write has happened.

The second needs no schema change and is exact, but costs a read and a comparison. The
first is cheap and explicit. This is a small decision, and it should be made before any
Production business is converted, because it determines whether rollback eligibility is
knowable without inspecting data.

## Recommended rollout posture

1. Convert one pilot business; do not write to it; verify the row tree against `_v`.
2. Exercise normal operations on the pilot; from the first write, treat it as one-way.
3. Convert the rest in batches, each preceded by its own preflight.
4. Once every business is V2 and a retention period has passed, `_v` can be dropped — a
   separate, explicitly approved step, not part of the cutover.
